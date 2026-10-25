//! 供应商路由器模块
//!
//! 负责选择和管理代理目标供应商，实现智能故障转移

use crate::app_config::AppType;
use crate::database::Database;
use crate::error::AppError;
use crate::live::engine::DeviceStore;
use crate::mode::stack::{ResolvedFallback, StackBalanceContext, StackTarget};
use crate::mode::state::{self, BalanceStrategy, BalancedSession, StackState};
use crate::provider::Provider;
use crate::proxy::circuit_breaker::{AllowResult, CircuitBreaker, CircuitBreakerConfig};
use crate::proxy::session::SessionIdResult;
use crate::services::UsageCache;
use std::collections::{HashMap, HashSet};
use std::str::FromStr;
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tokio::sync::RwLock;

#[derive(Default)]
struct StackBalanceRuntime {
    round_robin_cursors: HashMap<String, u64>,
    weighted_scores: HashMap<String, HashMap<String, i64>>,
    in_flight: HashMap<String, usize>,
    session_in_flight: HashMap<String, usize>,
    latency_ewma_ms: HashMap<String, f64>,
}

/// Keeps a provider's load count until the response body completes, then folds
/// the observed time-to-response into the latency EWMA.
pub(crate) struct StackLoadGuard {
    router: Arc<ProviderRouter>,
    key: String,
    session_key: Option<String>,
    started_at: Instant,
    succeeded: bool,
}

impl StackLoadGuard {
    pub(crate) fn record_success(&mut self) {
        self.succeeded = true;
    }
}

impl Drop for StackLoadGuard {
    fn drop(&mut self) {
        let mut runtime = self
            .router
            .stack_balance
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if let Some(count) = runtime.in_flight.get_mut(&self.key) {
            *count = count.saturating_sub(1);
            if *count == 0 {
                runtime.in_flight.remove(&self.key);
            }
        }
        if let Some(session_key) = self.session_key.as_ref() {
            if let Some(count) = runtime.session_in_flight.get_mut(session_key) {
                *count = count.saturating_sub(1);
                if *count == 0 {
                    runtime.session_in_flight.remove(session_key);
                }
            }
        }
        let elapsed_ms = self.started_at.elapsed().as_secs_f64() * 1000.0;
        if self.succeeded {
            let ewma = runtime
                .latency_ewma_ms
                .entry(self.key.clone())
                .or_insert(elapsed_ms);
            *ewma = (*ewma * 0.7) + (elapsed_ms * 0.3);
        }
    }
}

/// Codex Official requests carry the selected account's native Authorization
/// header. Reusing that request against another account card would cross the
/// account boundary, so these cards must never participate in provider retry.
pub(crate) fn provider_supports_failover(app_type: &str, provider: &Provider) -> bool {
    app_type != AppType::Codex.as_str()
        || !crate::proxy::providers::is_codex_official_provider(provider)
}

/// 供应商路由器
pub struct ProviderRouter {
    /// 数据库连接
    db: Arc<Database>,
    /// 熔断器管理器 - key 格式: "app_type:provider_id"
    circuit_breakers: Arc<RwLock<HashMap<String, Arc<CircuitBreaker>>>>,
    /// Runtime-only balancing state. Session assignments live in live-state.json.
    stack_balance: Arc<Mutex<StackBalanceRuntime>>,
}

impl ProviderRouter {
    /// 创建新的供应商路由器
    pub fn new(db: Arc<Database>) -> Self {
        Self {
            db,
            circuit_breakers: Arc::new(RwLock::new(HashMap::new())),
            stack_balance: Arc::new(Mutex::new(StackBalanceRuntime::default())),
        }
    }

    pub(crate) fn begin_stack_load(
        self: &Arc<Self>,
        app_type: &str,
        provider_id: &str,
        balance: Option<&StackBalanceContext>,
    ) -> StackLoadGuard {
        let key = balance_target_key(app_type, provider_id);
        let session_key = balance.map(|context| balance_session_target_key(app_type, context));
        let mut runtime = self
            .stack_balance
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        *runtime.in_flight.entry(key.clone()).or_default() += 1;
        if let Some(session_key) = session_key.as_ref() {
            *runtime
                .session_in_flight
                .entry(session_key.clone())
                .or_default() += 1;
        }
        drop(runtime);
        StackLoadGuard {
            router: self.clone(),
            key,
            session_key,
            started_at: Instant::now(),
            succeeded: false,
        }
    }

    /// Apply the persisted App-level policy to one aggregated-model request.
    /// Priority mode is deliberately left untouched so its resolution remains
    /// byte-for-byte compatible with the pre-balancing behavior.
    pub async fn balance_stack_target(
        self: &Arc<Self>,
        store: &DeviceStore,
        app: &AppType,
        session: &SessionIdResult,
        usage_cache: &UsageCache,
        mut target: StackTarget,
    ) -> Result<StackTarget, AppError> {
        let stack = target.balance_policy.clone();
        if stack.balance_strategy == BalanceStrategy::Priority
            || !provider_supports_failover(app.as_str(), &target.provider)
        {
            return Ok(target);
        }

        let logical_model = target.original_model.clone();
        let session_id = balance_session_id(app, &session.session_id);
        let client_provided = session.client_provided && !session_id.is_empty();
        let mut all_candidates = Vec::new();
        all_candidates.push(ResolvedFallback {
            provider: target.provider.clone(),
            upstream_model: target.upstream_model.clone(),
        });
        all_candidates.extend(target.fallbacks.iter().cloned());
        all_candidates
            .retain(|candidate| provider_supports_failover(app.as_str(), &candidate.provider));

        let candidates = first_candidate_per_provider(&all_candidates);
        if candidates.is_empty() {
            return Ok(target);
        }

        let eligible = self
            .eligible_balance_candidates(app, &candidates, usage_cache)
            .await;
        let choose_from = if eligible.is_empty() {
            candidates.clone()
        } else {
            eligible
        };

        let previous = if client_provided {
            state::balanced_session(store, app.as_str(), &session_id, &logical_model)?
        } else {
            None
        };

        let mut reason = match stack.balance_strategy {
            BalanceStrategy::RoundRobin => "roundRobin",
            BalanceStrategy::WeightedRoundRobin => "weighted",
            BalanceStrategy::LeastLoad => "leastLoad",
            BalanceStrategy::Priority => unreachable!("handled above"),
        };

        let selected = if let Some(assignment) = previous.clone() {
            choose_from
                .iter()
                .find(|candidate| {
                    candidate.provider.id == assignment.provider_id
                        && candidate.upstream_model == assignment.upstream_model
                })
                .inspect(|_| reason = "sticky")
                .cloned()
        } else {
            None
        };
        if previous.is_some() && selected.is_none() {
            reason = "reassign";
        }

        let selected = selected.unwrap_or_else(|| {
            self.pick_balance_candidate(
                app,
                &logical_model,
                stack.balance_strategy,
                &stack,
                &choose_from,
            )
        });

        let assignment = BalancedSession {
            provider_id: selected.provider.id.clone(),
            upstream_model: selected.upstream_model.clone(),
        };
        if client_provided && previous.as_ref() != Some(&assignment) {
            state::remember_balanced_session(
                store,
                app.as_str(),
                &session_id,
                &logical_model,
                assignment,
            )?;
        }

        target.fallbacks = remaining_candidates(&all_candidates, &selected);
        target.provider = selected.provider;
        target.upstream_model = selected.upstream_model;
        target.balance = Some(StackBalanceContext {
            session_id,
            logical_model: logical_model.clone(),
            selected_provider_id: target.provider.id.clone(),
            selected_upstream_model: target.upstream_model.clone(),
            client_provided,
            reason,
            candidate_count: choose_from.len(),
        });
        if let Some(context) = target.balance.as_ref() {
            log::debug!(
                "[{}] aggregation balance: model={}, session={}, provider={}, reason={}, candidates={}",
                app.as_str(),
                context.logical_model,
                context.session_id,
                target.provider.id,
                context.reason,
                context.candidate_count
            );
        }
        Ok(target)
    }

    pub fn clear_stack_balance_on_failure(
        &self,
        app: &AppType,
        context: &StackBalanceContext,
        provider_id: &str,
        upstream_model: &str,
    ) {
        if !context.client_provided {
            return;
        }
        let key = balance_session_target_key(app.as_str(), context);
        let runtime = self
            .stack_balance
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if runtime.session_in_flight.get(&key).copied().unwrap_or(0) > 0 {
            return;
        }
        drop(runtime);
        if let Err(error) = state::clear_balanced_session_if_target(
            &DeviceStore::for_device(),
            app.as_str(),
            &context.session_id,
            &context.logical_model,
            provider_id,
            upstream_model,
        ) {
            log::warn!(
                "[{}] failed to clear aggregation balance session {}: {error}",
                app.as_str(),
                context.session_id
            );
        }
    }

    pub fn confirm_stack_balance_success(
        &self,
        app: &AppType,
        context: &StackBalanceContext,
        provider_id: &str,
        upstream_model: &str,
    ) {
        if !context.client_provided {
            return;
        }
        if provider_id == context.selected_provider_id
            && upstream_model == context.selected_upstream_model
        {
            return;
        }
        if let Err(error) = state::remember_balanced_session(
            &DeviceStore::for_device(),
            app.as_str(),
            &context.session_id,
            &context.logical_model,
            BalancedSession {
                provider_id: provider_id.to_string(),
                upstream_model: upstream_model.to_string(),
            },
        ) {
            // The response is already successful; a failed bookkeeping write
            // must not turn it into an error.
            log::warn!(
                "[{}] failed to confirm aggregation balance session {}: {error}",
                app.as_str(),
                context.session_id
            );
        }
    }

    async fn eligible_balance_candidates(
        &self,
        app: &AppType,
        candidates: &[ResolvedFallback],
        usage_cache: &UsageCache,
    ) -> Vec<ResolvedFallback> {
        let now = chrono::Utc::now();
        let mut eligible = Vec::with_capacity(candidates.len());
        for candidate in candidates {
            if usage_cache.provider_quota_exhausted(app, &candidate.provider.id, now) {
                continue;
            }
            let key = format!("{}:{}", app.as_str(), candidate.provider.id);
            let breaker = self.get_or_create_circuit_breaker(&key).await;
            if breaker.is_available().await {
                eligible.push(candidate.clone());
            }
        }
        eligible
    }

    fn pick_balance_candidate(
        &self,
        app: &AppType,
        logical_model: &str,
        strategy: BalanceStrategy,
        stack: &StackState,
        candidates: &[ResolvedFallback],
    ) -> ResolvedFallback {
        if candidates.len() == 1 {
            return candidates[0].clone();
        }
        let pool_key = balance_pool_key(app, logical_model, candidates, stack);
        let mut runtime = self
            .stack_balance
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        match strategy {
            BalanceStrategy::RoundRobin => {
                let cursor = runtime.round_robin_cursors.entry(pool_key).or_default();
                let selected = candidates[(*cursor % candidates.len() as u64) as usize].clone();
                *cursor = cursor.wrapping_add(1);
                selected
            }
            BalanceStrategy::WeightedRoundRobin => {
                let scores = runtime.weighted_scores.entry(pool_key).or_default();
                let mut total = 0i64;
                let mut selected = candidates[0].provider.id.clone();
                let mut selected_score = i64::MIN;
                for candidate in candidates {
                    let provider_id = candidate.provider.id.clone();
                    let weight = i64::from(stack.weight_for(&provider_id));
                    total += weight;
                    let score = scores.entry(provider_id.clone()).or_default();
                    *score += weight;
                    if *score > selected_score {
                        selected_score = *score;
                        selected = provider_id;
                    }
                }
                *scores.entry(selected.clone()).or_default() -= total;
                candidates
                    .iter()
                    .find(|candidate| candidate.provider.id == selected)
                    .expect("selected weighted candidate exists")
                    .clone()
            }
            BalanceStrategy::LeastLoad => {
                let loads = candidates
                    .iter()
                    .map(|candidate| {
                        let weight = stack.weight_for(&candidate.provider.id).max(1) as f64;
                        let key = balance_target_key(app.as_str(), &candidate.provider.id);
                        let in_flight = runtime.in_flight.get(&key).copied().unwrap_or(0) as f64;
                        let latency = runtime.latency_ewma_ms.get(&key).copied();
                        (candidate, in_flight / weight, latency)
                    })
                    .collect::<Vec<_>>();
                let min_load = loads
                    .iter()
                    .map(|(_, load, _)| *load)
                    .fold(f64::INFINITY, f64::min);
                let load_ties = loads
                    .into_iter()
                    .filter(|(_, load, _)| (*load - min_load).abs() < f64::EPSILON)
                    .collect::<Vec<_>>();
                let min_latency = load_ties
                    .iter()
                    .map(|(_, _, latency)| latency.unwrap_or(0.0))
                    .fold(f64::INFINITY, f64::min);
                let latency_ties = load_ties
                    .into_iter()
                    .filter(|(_, _, latency)| {
                        (latency.unwrap_or(0.0) - min_latency).abs() < f64::EPSILON
                    })
                    .collect::<Vec<_>>();
                let cursor = runtime.round_robin_cursors.entry(pool_key).or_default();
                let selected = latency_ties[(*cursor % latency_ties.len() as u64) as usize]
                    .0
                    .clone();
                *cursor = cursor.wrapping_add(1);
                selected
            }
            BalanceStrategy::Priority => candidates[0].clone(),
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub fn record_stack_fallback_event(
        &self,
        session_id: &str,
        app_type: &str,
        logical_model: &str,
        attempt_index: usize,
        failed_provider_id: &str,
        next_provider_id: &str,
        next_model: &str,
        error_class: &str,
    ) {
        if let Err(error) = self.db.record_stack_fallback_event(
            session_id,
            app_type,
            logical_model,
            attempt_index,
            failed_provider_id,
            next_provider_id,
            next_model,
            error_class,
        ) {
            log::warn!("[{app_type}] failed to record aggregation fallback event: {error}");
        }
    }

    /// 选择可用的供应商（支持故障转移）
    ///
    /// 返回按优先级排序的可用供应商列表：
    /// - 故障转移关闭时：仅返回当前供应商
    /// - 故障转移开启时：仅使用故障转移队列，按队列顺序依次尝试（P1 → P2 → ...）
    pub async fn select_providers(&self, app_type: &str) -> Result<Vec<Provider>, AppError> {
        // 代理模式下路由到代理路由那家，和直连指针无关。
        let current_provider = AppType::from_str(app_type).ok().and_then(|app_enum| {
            crate::mode::current::provider_in_use(&self.db, &app_enum)
                .ok()
                .flatten()
        });
        self.select_providers_with_current(app_type, current_provider)
            .await
    }

    /// 同 [`Self::select_providers`]，正在用的那家由调用方给出：处理请求时上下文已经读过
    /// 一次（要读 `live-state.json` 和这一行），不用每个请求再读一遍，两处用的也一定是
    /// 同一家。
    pub async fn select_providers_with_current(
        &self,
        app_type: &str,
        current_provider: Option<Provider>,
    ) -> Result<Vec<Provider>, AppError> {
        self.select_providers_with_current_and_usage(app_type, current_provider, None)
            .await
    }

    /// Same selection as [`Self::select_providers_with_current`], but known
    /// exhausted quota windows move behind healthy queue entries. Queue order
    /// still wins within each quota state, and exhausted entries are retained
    /// as last-resort attempts.
    pub async fn select_providers_with_current_and_usage(
        &self,
        app_type: &str,
        current_provider: Option<Provider>,
        usage_cache: Option<&UsageCache>,
    ) -> Result<Vec<Provider>, AppError> {
        let mut result = Vec::new();
        let mut total_providers = 0usize;
        let mut circuit_open_count = 0usize;

        // 检查该应用的自动故障转移开关是否开启（从 proxy_config 表读取）
        let auto_failover_enabled = match self.db.get_proxy_config_for_app(app_type).await {
            Ok(config) => config.auto_failover_enabled,
            Err(e) => {
                log::error!("[{app_type}] 读取 proxy_config 失败: {e}，默认禁用故障转移");
                false
            }
        };

        if auto_failover_enabled
            && current_provider
                .as_ref()
                .is_some_and(|provider| !provider_supports_failover(app_type, provider))
        {
            // A selected Codex Official account is an explicit account choice.
            // Keep it as a single route even if an old failover setting remains
            // enabled; retrying would reuse its inbound token for another card.
            total_providers = 1;
            result.push(current_provider.expect("checked above"));
        } else if auto_failover_enabled {
            // 故障转移开启：仅按队列顺序依次尝试（P1 → P2 → ...）
            let all_providers = self.db.get_all_providers(app_type)?;

            // 使用 DAO 返回的排序结果，确保和前端展示一致
            let ordered_ids: Vec<String> = self
                .db
                .get_failover_queue(app_type)?
                .into_iter()
                .map(|item| item.provider_id)
                .collect();

            for provider_id in ordered_ids {
                let Some(provider) = all_providers.get(&provider_id).cloned() else {
                    continue;
                };
                if !provider_supports_failover(app_type, &provider) {
                    continue;
                }
                total_providers += 1;

                let circuit_key = format!("{app_type}:{}", provider.id);
                let breaker = self.get_or_create_circuit_breaker(&circuit_key).await;

                if breaker.is_available().await {
                    result.push(provider);
                } else {
                    circuit_open_count += 1;
                }
            }
        } else {
            // 故障转移关闭：仅使用当前供应商，跳过熔断器检查
            if let Some(current) = current_provider {
                total_providers = 1;
                result.push(current);
            }
        }

        if let Some(cache) = usage_cache {
            if let Ok(app_type) = AppType::from_str(app_type) {
                let now = chrono::Utc::now();
                result.sort_by_key(|provider| {
                    cache.provider_quota_exhausted(&app_type, &provider.id, now)
                });
            }
        }

        if result.is_empty() {
            if total_providers > 0 && circuit_open_count == total_providers {
                log::warn!("[{app_type}] [FO-004] 所有供应商均已熔断");
                return Err(AppError::AllProvidersCircuitOpen);
            } else {
                log::warn!("[{app_type}] [FO-005] 未配置供应商");
                return Err(AppError::NoProvidersConfigured);
            }
        }

        Ok(result)
    }

    /// 请求执行前获取熔断器“放行许可”
    ///
    /// - Closed：直接放行
    /// - Open：超时到达后切到 HalfOpen 并放行一次探测
    /// - HalfOpen：按限流规则放行探测
    ///
    /// 注意：调用方必须在请求结束后通过 `record_result()` 释放 HalfOpen 名额，
    /// 否则会导致该 Provider 长时间无法进入探测状态。
    pub async fn allow_provider_request(&self, provider_id: &str, app_type: &str) -> AllowResult {
        let circuit_key = format!("{app_type}:{provider_id}");
        let breaker = self.get_or_create_circuit_breaker(&circuit_key).await;
        breaker.allow_request().await
    }

    /// 记录供应商请求结果
    pub async fn record_result(
        &self,
        provider_id: &str,
        app_type: &str,
        used_half_open_permit: bool,
        success: bool,
        error_msg: Option<String>,
    ) -> Result<(), AppError> {
        // 1. 更新熔断器状态
        let circuit_key = format!("{app_type}:{provider_id}");
        let breaker = self.get_or_create_circuit_breaker(&circuit_key).await;

        if success {
            breaker.record_success(used_half_open_permit).await;
        } else {
            breaker.record_failure(used_half_open_permit).await;
        }

        // 2. 更新数据库健康状态（使用配置的阈值）
        self.record_health_result(provider_id, app_type, success, error_msg)
            .await
    }

    /// 只更新供应商健康历史，不读写熔断器。
    ///
    /// 单家路由没有可切换对象；此时打开熔断器既不会改变当前请求，也可能让
    /// 下一次选路误报“全部熔断”。健康历史仍有诊断价值，因此单独保留。
    pub async fn record_health_result(
        &self,
        provider_id: &str,
        app_type: &str,
        success: bool,
        error_msg: Option<String>,
    ) -> Result<(), AppError> {
        let failure_threshold = self.failure_threshold(app_type).await;
        self.db
            .update_provider_health_with_threshold(
                provider_id,
                app_type,
                success,
                error_msg,
                failure_threshold,
            )
            .await
    }

    async fn failure_threshold(&self, app_type: &str) -> u32 {
        match self.db.get_proxy_config_for_app(app_type).await {
            Ok(app_config) => app_config.circuit_failure_threshold,
            Err(_) => 5, // 默认值
        }
    }

    /// 重置熔断器（手动恢复）
    pub async fn reset_circuit_breaker(&self, circuit_key: &str) {
        let breakers = self.circuit_breakers.read().await;
        if let Some(breaker) = breakers.get(circuit_key) {
            breaker.reset().await;
        }
    }

    /// 重置指定供应商的熔断器
    pub async fn reset_provider_breaker(&self, provider_id: &str, app_type: &str) {
        let circuit_key = format!("{app_type}:{provider_id}");
        self.reset_circuit_breaker(&circuit_key).await;
    }

    /// 仅释放 HalfOpen permit，不影响健康统计（neutral 接口）
    ///
    /// 用于整流器等场景：请求结果不应计入 Provider 健康度，
    /// 但仍需释放占用的探测名额，避免 HalfOpen 状态卡死
    pub async fn release_permit_neutral(
        &self,
        provider_id: &str,
        app_type: &str,
        used_half_open_permit: bool,
    ) {
        if !used_half_open_permit {
            return;
        }
        let circuit_key = format!("{app_type}:{provider_id}");
        let breaker = self.get_or_create_circuit_breaker(&circuit_key).await;
        breaker.release_half_open_permit();
    }

    /// 更新所有熔断器的配置（热更新）
    pub async fn update_all_configs(&self, config: CircuitBreakerConfig) {
        let breakers = self.circuit_breakers.read().await;
        for breaker in breakers.values() {
            breaker.update_config(config.clone()).await;
        }
    }

    /// 更新指定应用已创建熔断器的配置（热更新）
    pub async fn update_app_configs(&self, app_type: &str, config: CircuitBreakerConfig) {
        let prefix = format!("{app_type}:");
        let breakers = self.circuit_breakers.read().await;
        for (key, breaker) in breakers.iter() {
            if key.starts_with(&prefix) {
                breaker.update_config(config.clone()).await;
            }
        }
    }

    /// 获取熔断器状态
    #[allow(dead_code)]
    pub async fn get_circuit_breaker_stats(
        &self,
        provider_id: &str,
        app_type: &str,
    ) -> Option<crate::proxy::circuit_breaker::CircuitBreakerStats> {
        let circuit_key = format!("{app_type}:{provider_id}");
        let breakers = self.circuit_breakers.read().await;

        if let Some(breaker) = breakers.get(&circuit_key) {
            Some(breaker.get_stats().await)
        } else {
            None
        }
    }

    /// 获取或创建熔断器
    async fn get_or_create_circuit_breaker(&self, key: &str) -> Arc<CircuitBreaker> {
        // 先尝试读锁获取
        {
            let breakers = self.circuit_breakers.read().await;
            if let Some(breaker) = breakers.get(key) {
                return breaker.clone();
            }
        }

        // 如果不存在，获取写锁创建
        let mut breakers = self.circuit_breakers.write().await;

        // 双重检查，防止竞争条件
        if let Some(breaker) = breakers.get(key) {
            return breaker.clone();
        }

        // 从 key 中提取 app_type (格式: "app_type:provider_id")
        let app_type = key.split(':').next().unwrap_or("claude");

        // 按应用独立读取熔断器配置
        let config = match self.db.get_proxy_config_for_app(app_type).await {
            Ok(app_config) => crate::proxy::circuit_breaker::CircuitBreakerConfig {
                failure_threshold: app_config.circuit_failure_threshold,
                success_threshold: app_config.circuit_success_threshold,
                timeout_seconds: app_config.circuit_timeout_seconds as u64,
                error_rate_threshold: app_config.circuit_error_rate_threshold,
                min_requests: app_config.circuit_min_requests,
            },
            Err(_) => crate::proxy::circuit_breaker::CircuitBreakerConfig::default(),
        };

        let breaker = Arc::new(CircuitBreaker::new(config));
        breakers.insert(key.to_string(), breaker.clone());

        breaker
    }
}

fn balance_session_id(app: &AppType, session_id: &str) -> String {
    let session_id = session_id.trim();
    let session_id = if *app == AppType::Codex {
        session_id.strip_prefix("codex_").unwrap_or(session_id)
    } else {
        session_id
    };
    if session_id.is_empty() || session_id.len() > 256 || session_id.chars().any(char::is_control) {
        String::new()
    } else {
        session_id.to_string()
    }
}

fn balance_session_target_key(app_type: &str, context: &StackBalanceContext) -> String {
    format!(
        "{}\0{}\0{}",
        app_type, context.session_id, context.logical_model
    )
}

fn balance_target_key(app_type: &str, provider_id: &str) -> String {
    format!("{app_type}\0{provider_id}")
}

fn balance_pool_key(
    app: &AppType,
    logical_model: &str,
    candidates: &[ResolvedFallback],
    stack: &StackState,
) -> String {
    let mut key = format!("{}\0{logical_model}", app.as_str());
    for candidate in candidates {
        key.push('\0');
        key.push_str(&candidate.provider.id);
        key.push('\0');
        key.push_str(&candidate.upstream_model);
        key.push('\0');
        key.push_str(&stack.weight_for(&candidate.provider.id).to_string());
    }
    key
}

fn first_candidate_per_provider(candidates: &[ResolvedFallback]) -> Vec<ResolvedFallback> {
    let mut seen = HashSet::new();
    candidates
        .iter()
        .filter(|candidate| seen.insert(candidate.provider.id.clone()))
        .cloned()
        .collect()
}

fn remaining_candidates(
    candidates: &[ResolvedFallback],
    selected: &ResolvedFallback,
) -> Vec<ResolvedFallback> {
    let mut seen = HashSet::new();
    candidates
        .iter()
        .filter(|candidate| {
            !(candidate.provider.id == selected.provider.id
                && candidate.upstream_model == selected.upstream_model)
        })
        .filter(|candidate| {
            seen.insert((
                candidate.provider.id.clone(),
                candidate.upstream_model.clone(),
            ))
        })
        .cloned()
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::Database;
    use crate::provider::{AuthBinding, AuthBindingSource, ProviderMeta};
    use serde_json::json;
    use serial_test::serial;
    use std::env;
    use tempfile::TempDir;

    fn managed_codex_official(id: &str, account_id: &str) -> Provider {
        let mut provider = Provider::with_id(
            id.to_string(),
            "OpenAI Official".to_string(),
            json!({ "auth": {}, "config": "" }),
            None,
        );
        provider.category = Some("official".to_string());
        provider.meta = Some(ProviderMeta {
            provider_type: Some("codex_oauth".to_string()),
            auth_binding: Some(AuthBinding {
                source: AuthBindingSource::ManagedAccount,
                auth_provider: Some("codex_oauth".to_string()),
                account_id: Some(account_id.to_string()),
            }),
            ..Default::default()
        });
        provider
    }

    fn balance_candidate(id: &str, model: &str) -> ResolvedFallback {
        ResolvedFallback {
            provider: Provider::with_id(id.to_string(), id.to_uppercase(), json!({}), None),
            upstream_model: model.to_string(),
        }
    }

    fn balance_stack(weights: &[(&str, u32)]) -> StackState {
        let mut stack = StackState::default();
        stack.balance_weights = weights
            .iter()
            .map(|(id, weight)| ((*id).to_string(), *weight))
            .collect();
        stack
    }

    #[test]
    fn round_robin_rotates_every_provider_even_when_the_primary_is_not_first() {
        let router = ProviderRouter::new(Arc::new(Database::memory().unwrap()));
        let stack = balance_stack(&[]);
        let candidates = vec![
            balance_candidate("b", "model-b"),
            balance_candidate("a", "model-a"),
            balance_candidate("c", "model-c"),
        ];
        let selected = (0..6)
            .map(|_| {
                router
                    .pick_balance_candidate(
                        &AppType::Claude,
                        "ccs-b/model-b",
                        BalanceStrategy::RoundRobin,
                        &stack,
                        &candidates,
                    )
                    .provider
                    .id
            })
            .collect::<Vec<_>>();
        assert_eq!(selected, ["b", "a", "c", "b", "a", "c"]);
    }

    #[test]
    fn smooth_weighted_round_robin_observes_one_two_three() {
        let router = ProviderRouter::new(Arc::new(Database::memory().unwrap()));
        let stack = balance_stack(&[("a", 1), ("b", 2), ("c", 3)]);
        let candidates = vec![
            balance_candidate("a", "model-a"),
            balance_candidate("b", "model-b"),
            balance_candidate("c", "model-c"),
        ];
        let mut counts = HashMap::new();
        for _ in 0..12 {
            let id = router
                .pick_balance_candidate(
                    &AppType::Claude,
                    "shared-model",
                    BalanceStrategy::WeightedRoundRobin,
                    &stack,
                    &candidates,
                )
                .provider
                .id;
            *counts.entry(id).or_insert(0) += 1;
        }
        assert_eq!(counts["a"], 2);
        assert_eq!(counts["b"], 4);
        assert_eq!(counts["c"], 6);
    }

    #[test]
    fn least_load_uses_normalized_in_flight_then_recent_latency() {
        let router = ProviderRouter::new(Arc::new(Database::memory().unwrap()));
        let stack = balance_stack(&[("a", 2), ("b", 1), ("c", 1)]);
        let candidates = vec![
            balance_candidate("a", "model-a"),
            balance_candidate("b", "model-b"),
            balance_candidate("c", "model-c"),
        ];
        {
            let mut runtime = router.stack_balance.lock().unwrap();
            runtime
                .in_flight
                .insert(balance_target_key("claude", "a"), 2);
            runtime
                .in_flight
                .insert(balance_target_key("claude", "b"), 1);
            runtime
                .latency_ewma_ms
                .insert(balance_target_key("claude", "b"), 500.0);
            runtime
                .latency_ewma_ms
                .insert(balance_target_key("claude", "c"), 50.0);
        }
        let selected = router
            .pick_balance_candidate(
                &AppType::Claude,
                "shared-model",
                BalanceStrategy::LeastLoad,
                &stack,
                &candidates,
            )
            .provider
            .id;
        assert_eq!(selected, "c");
        {
            let mut runtime = router.stack_balance.lock().unwrap();
            runtime.in_flight.clear();
            runtime
                .latency_ewma_ms
                .insert(balance_target_key("claude", "a"), 1_000.0);
            runtime
                .latency_ewma_ms
                .insert(balance_target_key("claude", "b"), 50.0);
            runtime
                .latency_ewma_ms
                .insert(balance_target_key("claude", "c"), 500.0);
        }
        let latency_tie_winner = router
            .pick_balance_candidate(
                &AppType::Claude,
                "shared-model",
                BalanceStrategy::LeastLoad,
                &stack,
                &candidates,
            )
            .provider
            .id;
        assert_eq!(latency_tie_winner, "b");
    }

    #[test]
    fn load_guard_tracks_in_flight_and_records_a_success_sample_on_drop() {
        let router = Arc::new(ProviderRouter::new(Arc::new(Database::memory().unwrap())));
        let key = balance_target_key("claude", "a");
        let context = StackBalanceContext {
            session_id: "thread-1".into(),
            logical_model: "model-a".into(),
            selected_provider_id: "a".into(),
            selected_upstream_model: "model-a".into(),
            client_provided: true,
            reason: "leastLoad",
            candidate_count: 2,
        };
        let session_key = balance_session_target_key("claude", &context);
        let mut guard = router.begin_stack_load("claude", "a", Some(&context));
        assert_eq!(
            router.stack_balance.lock().unwrap().in_flight.get(&key),
            Some(&1)
        );
        assert_eq!(
            router
                .stack_balance
                .lock()
                .unwrap()
                .session_in_flight
                .get(&session_key),
            Some(&1)
        );
        guard.record_success();
        drop(guard);
        let runtime = router.stack_balance.lock().unwrap();
        assert!(!runtime.in_flight.contains_key(&key));
        assert!(!runtime.session_in_flight.contains_key(&session_key));
        assert!(runtime.latency_ewma_ms.contains_key(&key));
    }

    #[test]
    #[serial]
    fn successful_fallback_replaces_the_sticky_target() {
        let _home = TempHome::new();
        let store = DeviceStore::for_device();
        let context = StackBalanceContext {
            session_id: "thread-1".into(),
            logical_model: "ccs-a/model-a".into(),
            selected_provider_id: "a".into(),
            selected_upstream_model: "model-a".into(),
            client_provided: true,
            reason: "roundRobin",
            candidate_count: 2,
        };
        state::remember_balanced_session(
            &store,
            "claude",
            &context.session_id,
            &context.logical_model,
            BalancedSession {
                provider_id: "a".into(),
                upstream_model: "model-a".into(),
            },
        )
        .unwrap();
        let router = ProviderRouter::new(Arc::new(Database::memory().unwrap()));

        router.confirm_stack_balance_success(&AppType::Claude, &context, "b", "model-b");
        router.clear_stack_balance_on_failure(&AppType::Claude, &context, "a", "model-a");

        let assignment = state::balanced_session(
            &store,
            "claude",
            &context.session_id,
            &context.logical_model,
        )
        .unwrap()
        .expect("fallback assignment remains");
        assert_eq!(assignment.provider_id, "b");
        assert_eq!(assignment.upstream_model, "model-b");
    }

    struct TempHome {
        #[allow(dead_code)]
        dir: TempDir,
        original_home: Option<String>,
        original_userprofile: Option<String>,
        original_test_home: Option<String>,
    }

    impl TempHome {
        fn new() -> Self {
            let dir = TempDir::new().expect("failed to create temp home");
            let original_home = env::var("HOME").ok();
            let original_userprofile = env::var("USERPROFILE").ok();
            let original_test_home = env::var("CC_SWITCH_TEST_HOME").ok();

            env::set_var("HOME", dir.path());
            env::set_var("USERPROFILE", dir.path());
            env::set_var("CC_SWITCH_TEST_HOME", dir.path());
            crate::settings::reload_settings().expect("reload settings");

            Self {
                dir,
                original_home,
                original_userprofile,
                original_test_home,
            }
        }
    }

    impl Drop for TempHome {
        fn drop(&mut self) {
            match &self.original_home {
                Some(value) => env::set_var("HOME", value),
                None => env::remove_var("HOME"),
            }

            match &self.original_userprofile {
                Some(value) => env::set_var("USERPROFILE", value),
                None => env::remove_var("USERPROFILE"),
            }

            match &self.original_test_home {
                Some(value) => env::set_var("CC_SWITCH_TEST_HOME", value),
                None => env::remove_var("CC_SWITCH_TEST_HOME"),
            }
        }
    }

    #[tokio::test]
    #[serial]
    async fn test_provider_router_creation() {
        let _home = TempHome::new();
        let db = Arc::new(Database::memory().unwrap());
        let router = ProviderRouter::new(db);

        let breaker = router.get_or_create_circuit_breaker("claude:test").await;
        assert!(breaker.allow_request().await.allowed);
    }

    #[tokio::test]
    #[serial]
    async fn balancing_keeps_a_session_sticky_and_rotates_a_new_session() {
        let _home = TempHome::new();
        let db = Arc::new(Database::memory().unwrap());
        db.save_provider(
            "claude",
            &Provider::with_id("a".into(), "A".into(), json!({}), None),
        )
        .unwrap();
        db.save_provider(
            "claude",
            &Provider::with_id("b".into(), "B".into(), json!({}), None),
        )
        .unwrap();
        let store = DeviceStore::for_device();
        state::update(&store, |live| {
            let stack = &mut live.apps.entry("claude".into()).or_default().stack;
            stack.enabled = true;
            stack.members = vec!["a".into(), "b".into()];
            stack.balance_strategy = BalanceStrategy::RoundRobin;
        })
        .unwrap();
        let router = Arc::new(ProviderRouter::new(db.clone()));
        let usage = UsageCache::new();
        let target = || StackTarget {
            provider: Provider::with_id("a".into(), "A".into(), json!({}), None),
            upstream_model: "model-a".into(),
            original_model: "ccs-a/model-a".into(),
            fallbacks: vec![ResolvedFallback {
                provider: Provider::with_id("b".into(), "B".into(), json!({}), None),
                upstream_model: "model-b".into(),
            }],
            balance_policy: StackState {
                balance_strategy: BalanceStrategy::RoundRobin,
                ..Default::default()
            },
            balance: None,
        };
        let session = |id: &str| SessionIdResult {
            session_id: id.into(),
            source: crate::proxy::SessionIdSource::Header,
            client_provided: true,
        };

        let first = router
            .balance_stack_target(
                &store,
                &AppType::Claude,
                &session("thread-1"),
                &usage,
                target(),
            )
            .await
            .unwrap();
        let second = router
            .balance_stack_target(
                &store,
                &AppType::Claude,
                &session("thread-1"),
                &usage,
                target(),
            )
            .await
            .unwrap();
        let next_session = router
            .balance_stack_target(
                &store,
                &AppType::Claude,
                &session("thread-2"),
                &usage,
                target(),
            )
            .await
            .unwrap();
        let mut different_model = target();
        different_model.original_model = "ccs-a/model-other".into();
        let different_model_result = router
            .balance_stack_target(
                &store,
                &AppType::Claude,
                &session("thread-1"),
                &usage,
                different_model,
            )
            .await
            .unwrap();
        let restarted = Arc::new(ProviderRouter::new(db));
        let after_restart = restarted
            .balance_stack_target(
                &store,
                &AppType::Claude,
                &session("thread-1"),
                &usage,
                target(),
            )
            .await
            .unwrap();

        assert_eq!(first.provider.id, "a");
        assert_eq!(first.balance.as_ref().unwrap().reason, "roundRobin");
        assert_eq!(second.provider.id, "a");
        assert_eq!(second.balance.as_ref().unwrap().reason, "sticky");
        assert_eq!(next_session.provider.id, "b");
        assert_eq!(different_model_result.provider.id, "a");
        assert_eq!(
            state::balanced_sessions(&store, "claude").unwrap()["thread-1"].len(),
            2
        );
        assert_eq!(after_restart.provider.id, "a");
        assert_eq!(after_restart.balance.as_ref().unwrap().reason, "sticky");
    }

    #[tokio::test]
    #[serial]
    async fn balancing_skips_a_provider_with_runtime_quota_exhaustion() {
        let _home = TempHome::new();
        let router = ProviderRouter::new(Arc::new(Database::memory().unwrap()));
        let usage = UsageCache::new();
        usage.mark_runtime_quota_exhausted(&AppType::Claude, "a");
        let candidates = vec![
            balance_candidate("a", "model-a"),
            balance_candidate("b", "model-b"),
        ];

        let eligible = router
            .eligible_balance_candidates(&AppType::Claude, &candidates, &usage)
            .await;

        assert_eq!(
            eligible
                .iter()
                .map(|candidate| candidate.provider.id.as_str())
                .collect::<Vec<_>>(),
            ["b"]
        );
    }

    #[tokio::test]
    #[serial]
    async fn health_only_result_does_not_create_a_circuit_breaker() {
        let _home = TempHome::new();
        let db = Arc::new(Database::memory().unwrap());
        let router = ProviderRouter::new(db.clone());
        let provider =
            Provider::with_id("a".to_string(), "Provider A".to_string(), json!({}), None);
        db.save_provider("claude", &provider).unwrap();

        router
            .record_health_result("a", "claude", false, Some("usage limit".to_string()))
            .await
            .unwrap();

        assert!(router
            .get_circuit_breaker_stats("a", "claude")
            .await
            .is_none());
        let health = db.get_provider_health("a", "claude").await.unwrap();
        assert_eq!(health.consecutive_failures, 1);
        assert_eq!(health.last_error.as_deref(), Some("usage limit"));
    }

    #[tokio::test]
    #[serial]
    async fn test_failover_disabled_uses_current_provider() {
        let _home = TempHome::new();
        let db = Arc::new(Database::memory().unwrap());

        let provider_a =
            Provider::with_id("a".to_string(), "Provider A".to_string(), json!({}), None);
        let provider_b =
            Provider::with_id("b".to_string(), "Provider B".to_string(), json!({}), None);

        db.save_provider("claude", &provider_a).unwrap();
        db.save_provider("claude", &provider_b).unwrap();
        db.set_current_provider("claude", "a").unwrap();
        db.add_to_failover_queue("claude", "b").unwrap();

        let router = ProviderRouter::new(db.clone());
        let providers = router.select_providers("claude").await.unwrap();

        assert_eq!(providers.len(), 1);
        assert_eq!(providers[0].id, "a");
    }

    #[tokio::test]
    #[serial]
    async fn test_failover_enabled_uses_queue_order_ignoring_current() {
        let _home = TempHome::new();
        let db = Arc::new(Database::memory().unwrap());

        // 设置 sort_index 来控制顺序：b=1, a=2
        let mut provider_a =
            Provider::with_id("a".to_string(), "Provider A".to_string(), json!({}), None);
        provider_a.sort_index = Some(2);
        let mut provider_b =
            Provider::with_id("b".to_string(), "Provider B".to_string(), json!({}), None);
        provider_b.sort_index = Some(1);

        db.save_provider("claude", &provider_a).unwrap();
        db.save_provider("claude", &provider_b).unwrap();
        db.set_current_provider("claude", "a").unwrap();

        db.add_to_failover_queue("claude", "b").unwrap();
        db.add_to_failover_queue("claude", "a").unwrap();

        // 启用自动故障转移（使用新的 proxy_config API）
        let mut config = db.get_proxy_config_for_app("claude").await.unwrap();
        config.auto_failover_enabled = true;
        db.update_proxy_config_for_app(config).await.unwrap();

        let router = ProviderRouter::new(db.clone());
        let providers = router.select_providers("claude").await.unwrap();

        assert_eq!(providers.len(), 2);
        // 故障转移开启时：仅按队列顺序选择（忽略当前供应商）
        assert_eq!(providers[0].id, "b");
        assert_eq!(providers[1].id, "a");
    }

    #[tokio::test]
    #[serial]
    async fn known_exhausted_queue_head_moves_behind_healthy_provider() {
        let _home = TempHome::new();
        let db = Arc::new(Database::memory().unwrap());
        let provider_a =
            Provider::with_id("a".to_string(), "Provider A".to_string(), json!({}), None);
        let mut provider_b =
            Provider::with_id("b".to_string(), "Provider B".to_string(), json!({}), None);
        provider_b.sort_index = Some(1);

        db.save_provider("claude", &provider_a).unwrap();
        db.save_provider("claude", &provider_b).unwrap();
        db.add_to_failover_queue("claude", "b").unwrap();
        db.add_to_failover_queue("claude", "a").unwrap();

        let mut config = db.get_proxy_config_for_app("claude").await.unwrap();
        config.auto_failover_enabled = true;
        db.update_proxy_config_for_app(config).await.unwrap();

        let cache = UsageCache::new();
        cache.put_script(
            AppType::Claude,
            "b".to_string(),
            crate::provider::UsageResult {
                success: true,
                data: Some(vec![crate::provider::UsageData {
                    plan_name: Some("five_hour".to_string()),
                    extra: Some(format!(
                        r#"{{"resetsAt":"{}"}}"#,
                        chrono::Utc::now() + chrono::Duration::hours(1)
                    )),
                    is_valid: Some(true),
                    invalid_message: None,
                    total: Some(100.0),
                    used: Some(100.0),
                    remaining: Some(0.0),
                    unit: Some("%".to_string()),
                }]),
                error: None,
            },
        );

        let router = ProviderRouter::new(db.clone());
        let providers = router
            .select_providers_with_current_and_usage("claude", None, Some(&cache))
            .await
            .unwrap();
        assert_eq!(
            providers
                .iter()
                .map(|item| item.id.as_str())
                .collect::<Vec<_>>(),
            vec!["a", "b"]
        );

        cache.put_script(
            AppType::Claude,
            "a".to_string(),
            crate::provider::UsageResult {
                success: true,
                data: Some(vec![crate::provider::UsageData {
                    plan_name: Some("weekly".to_string()),
                    extra: None,
                    is_valid: Some(true),
                    invalid_message: None,
                    total: Some(100.0),
                    used: Some(100.0),
                    remaining: Some(0.0),
                    unit: Some("%".to_string()),
                }]),
                error: None,
            },
        );
        let providers = router
            .select_providers_with_current_and_usage("claude", None, Some(&cache))
            .await
            .unwrap();
        assert_eq!(
            providers
                .iter()
                .map(|item| item.id.as_str())
                .collect::<Vec<_>>(),
            vec!["b", "a"],
            "when every target is exhausted, preserve queue order as last resort"
        );
    }

    #[tokio::test]
    #[serial]
    async fn test_failover_enabled_uses_queue_only_even_if_current_not_in_queue() {
        let _home = TempHome::new();
        let db = Arc::new(Database::memory().unwrap());

        let provider_a =
            Provider::with_id("a".to_string(), "Provider A".to_string(), json!({}), None);
        let mut provider_b =
            Provider::with_id("b".to_string(), "Provider B".to_string(), json!({}), None);
        provider_b.sort_index = Some(1);

        db.save_provider("claude", &provider_a).unwrap();
        db.save_provider("claude", &provider_b).unwrap();
        db.set_current_provider("claude", "a").unwrap();

        // 只把 b 加入故障转移队列（模拟“当前供应商不在队列里”的常见配置）
        db.add_to_failover_queue("claude", "b").unwrap();

        let mut config = db.get_proxy_config_for_app("claude").await.unwrap();
        config.auto_failover_enabled = true;
        db.update_proxy_config_for_app(config).await.unwrap();

        let router = ProviderRouter::new(db.clone());
        let providers = router.select_providers("claude").await.unwrap();

        assert_eq!(providers.len(), 1);
        assert_eq!(providers[0].id, "b");
    }

    #[tokio::test]
    #[serial]
    async fn codex_official_current_stays_single_route_when_failover_is_stale() {
        let _home = TempHome::new();
        let db = Arc::new(Database::memory().unwrap());
        let official = managed_codex_official("official-a", "account-a");
        let fallback = Provider::with_id(
            "fallback".to_string(),
            "Fallback".to_string(),
            json!({}),
            None,
        );
        db.save_provider("codex", &official).unwrap();
        db.save_provider("codex", &fallback).unwrap();
        db.set_current_provider("codex", &official.id).unwrap();
        db.add_to_failover_queue("codex", &fallback.id).unwrap();

        let mut config = db.get_proxy_config_for_app("codex").await.unwrap();
        config.auto_failover_enabled = true;
        db.update_proxy_config_for_app(config).await.unwrap();

        let providers = ProviderRouter::new(db)
            .select_providers("codex")
            .await
            .unwrap();
        assert_eq!(providers.len(), 1);
        assert_eq!(providers[0].id, official.id);
    }

    #[tokio::test]
    #[serial]
    async fn stale_codex_official_queue_entries_are_not_retry_targets() {
        let _home = TempHome::new();
        let db = Arc::new(Database::memory().unwrap());
        let current = Provider::with_id(
            "third-party".to_string(),
            "Third Party".to_string(),
            json!({}),
            None,
        );
        let official = managed_codex_official("official-a", "account-a");
        let fallback = Provider::with_id(
            "fallback".to_string(),
            "Fallback".to_string(),
            json!({}),
            None,
        );
        db.save_provider("codex", &current).unwrap();
        db.save_provider("codex", &official).unwrap();
        db.save_provider("codex", &fallback).unwrap();
        db.set_current_provider("codex", &current.id).unwrap();
        db.add_to_failover_queue("codex", &official.id).unwrap();
        db.add_to_failover_queue("codex", &fallback.id).unwrap();

        let mut config = db.get_proxy_config_for_app("codex").await.unwrap();
        config.auto_failover_enabled = true;
        db.update_proxy_config_for_app(config).await.unwrap();

        let providers = ProviderRouter::new(db)
            .select_providers("codex")
            .await
            .unwrap();
        assert_eq!(
            providers
                .iter()
                .map(|provider| provider.id.as_str())
                .collect::<Vec<_>>(),
            vec!["fallback"]
        );
    }

    #[tokio::test]
    #[serial]
    async fn test_select_providers_does_not_consume_half_open_permit() {
        let _home = TempHome::new();
        let db = Arc::new(Database::memory().unwrap());

        db.update_circuit_breaker_config(&CircuitBreakerConfig {
            failure_threshold: 1,
            timeout_seconds: 0,
            ..Default::default()
        })
        .await
        .unwrap();

        let provider_a =
            Provider::with_id("a".to_string(), "Provider A".to_string(), json!({}), None);
        let provider_b =
            Provider::with_id("b".to_string(), "Provider B".to_string(), json!({}), None);

        db.save_provider("claude", &provider_a).unwrap();
        db.save_provider("claude", &provider_b).unwrap();

        db.add_to_failover_queue("claude", "a").unwrap();
        db.add_to_failover_queue("claude", "b").unwrap();

        // 启用自动故障转移（使用新的 proxy_config API）
        let mut config = db.get_proxy_config_for_app("claude").await.unwrap();
        config.auto_failover_enabled = true;
        db.update_proxy_config_for_app(config).await.unwrap();

        let router = ProviderRouter::new(db.clone());

        router
            .record_result("b", "claude", false, false, Some("fail".to_string()))
            .await
            .unwrap();

        let providers = router.select_providers("claude").await.unwrap();
        assert_eq!(providers.len(), 2);

        assert!(router.allow_provider_request("b", "claude").await.allowed);
    }

    #[tokio::test]
    #[serial]
    async fn test_release_permit_neutral_frees_half_open_slot() {
        let _home = TempHome::new();
        let db = Arc::new(Database::memory().unwrap());

        // 配置熔断器：1 次失败即熔断，0 秒超时立即进入 HalfOpen
        db.update_circuit_breaker_config(&CircuitBreakerConfig {
            failure_threshold: 1,
            timeout_seconds: 0,
            ..Default::default()
        })
        .await
        .unwrap();

        let provider_a =
            Provider::with_id("a".to_string(), "Provider A".to_string(), json!({}), None);
        db.save_provider("claude", &provider_a).unwrap();
        db.add_to_failover_queue("claude", "a").unwrap();

        // 启用自动故障转移
        let mut config = db.get_proxy_config_for_app("claude").await.unwrap();
        config.auto_failover_enabled = true;
        db.update_proxy_config_for_app(config).await.unwrap();

        let router = ProviderRouter::new(db.clone());

        // 触发熔断：1 次失败
        router
            .record_result("a", "claude", false, false, Some("fail".to_string()))
            .await
            .unwrap();

        // 第一次请求：获取 HalfOpen 探测名额
        let first = router.allow_provider_request("a", "claude").await;
        assert!(first.allowed);
        assert!(first.used_half_open_permit);

        // 第二次请求应被拒绝（名额已被占用）
        let second = router.allow_provider_request("a", "claude").await;
        assert!(!second.allowed);

        // 使用 release_permit_neutral 释放名额（不影响健康统计）
        router
            .release_permit_neutral("a", "claude", first.used_half_open_permit)
            .await;

        // 第三次请求应被允许（名额已释放）
        let third = router.allow_provider_request("a", "claude").await;
        assert!(third.allowed);
        assert!(third.used_half_open_permit);
    }
}
