//! 托盘展示用的用量缓存（进程内、写穿式）。
//!
//! 各 usage 查询命令成功时写入；系统托盘构建菜单时读取。不持久化，
//! 进程重启即空，由下一次自动查询或托盘悬停触发的刷新重新填充。

use std::collections::HashMap;
use std::sync::RwLock;
use std::time::SystemTime;

use crate::app_config::AppType;
use crate::provider::UsageResult;
use crate::services::subscription::SubscriptionQuota;

const SCRIPT_EXHAUSTION_MAX_AGE_SECS: i64 = 15 * 60;
const RUNTIME_EXHAUSTION_MAX_AGE_SECS: i64 = 15 * 60;

#[derive(Default)]
pub struct UsageCache {
    subscription: RwLock<HashMap<AppType, SubscriptionQuota>>,
    codex_oauth: RwLock<HashMap<String, SubscriptionQuota>>,
    script: RwLock<HashMap<(AppType, String), UsageResult>>,
    script_at: RwLock<HashMap<(AppType, String), SystemTime>>,
    runtime_exhausted_until: RwLock<HashMap<(AppType, String), chrono::DateTime<chrono::Utc>>>,
}

impl UsageCache {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn put_subscription(&self, app_type: AppType, quota: SubscriptionQuota) {
        if let Ok(mut w) = self.subscription.write() {
            w.insert(app_type, quota);
        }
    }

    pub fn put_codex_oauth(&self, account_id: String, quota: SubscriptionQuota) {
        if let Ok(mut w) = self.codex_oauth.write() {
            w.insert(account_id, quota);
        }
    }

    /// Managed accounts must never share the CLI's app-wide subscription snapshot.
    pub fn with_codex_oauth<R>(
        &self,
        account_id: &str,
        f: impl FnOnce(&SubscriptionQuota) -> R,
    ) -> Option<R> {
        self.codex_oauth
            .read()
            .ok()
            .and_then(|r| r.get(account_id).map(f))
    }

    pub fn put_script(&self, app_type: AppType, provider_id: String, result: UsageResult) {
        let key = (app_type, provider_id);
        let exhausted_key = key.clone();
        let clear_runtime_exhaustion = result.success;
        if let Ok(mut w) = self.script.write() {
            w.insert(key.clone(), result);
        }
        if let Ok(mut w) = self.script_at.write() {
            w.insert(key, SystemTime::now());
        }
        if clear_runtime_exhaustion {
            if let Ok(mut w) = self.runtime_exhausted_until.write() {
                w.remove(&exhausted_key);
            }
        }
    }

    /// Remember a quota-exhaustion response even when the provider has no
    /// usage extractor. The short TTL prevents a stale 429 from disabling the
    /// target forever; a later successful usage query clears it immediately.
    pub fn mark_runtime_quota_exhausted(&self, app_type: &AppType, provider_id: &str) {
        if let Ok(mut w) = self.runtime_exhausted_until.write() {
            w.insert(
                (app_type.clone(), provider_id.to_string()),
                chrono::Utc::now() + chrono::Duration::seconds(RUNTIME_EXHAUSTION_MAX_AGE_SECS),
            );
        }
    }

    /// Whether the latest usage snapshot says this provider has exhausted a
    /// quota window and that window has not reset yet. Unknown/stale snapshots
    /// never block routing; a future reset time remains authoritative even when
    /// the snapshot itself is older than the freshness window.
    pub fn provider_quota_exhausted(
        &self,
        app_type: &AppType,
        provider_id: &str,
        now: chrono::DateTime<chrono::Utc>,
    ) -> bool {
        let key = (app_type.clone(), provider_id.to_string());
        if self
            .runtime_exhausted_until
            .read()
            .ok()
            .and_then(|map| map.get(&key).copied())
            .is_some_and(|until| until > now)
        {
            return true;
        }
        let Some(result) = self
            .script
            .read()
            .ok()
            .and_then(|map| map.get(&key).cloned())
        else {
            return false;
        };
        let Some(observed_at) = self
            .script_at
            .read()
            .ok()
            .and_then(|map| map.get(&key).copied())
        else {
            return false;
        };
        usage_result_quota_exhausted(&result, observed_at, now)
    }

    /// 以借用形式暴露订阅快照，避免托盘每次重建时深拷贝整个 `SubscriptionQuota`。
    pub fn with_subscription<R>(
        &self,
        app_type: &AppType,
        f: impl FnOnce(&SubscriptionQuota) -> R,
    ) -> Option<R> {
        self.subscription
            .read()
            .ok()
            .and_then(|r| r.get(app_type).map(f))
    }

    /// 以借用形式暴露脚本型用量结果，同上。
    pub fn with_script<R>(
        &self,
        app_type: &AppType,
        provider_id: &str,
        f: impl FnOnce(&UsageResult) -> R,
    ) -> Option<R> {
        self.script
            .read()
            .ok()
            .and_then(|r| r.get(&(app_type.clone(), provider_id.to_string())).map(f))
    }

    pub fn invalidate_script(&self, app_type: &AppType, provider_id: &str) {
        // 热路径会对每个禁用脚本的 provider 在托盘重建时调用一次：先走读锁
        // `contains_key` 快速放行"本来就不在缓存里"的常见情况，避免无谓的写锁升级。
        let key = (app_type.clone(), provider_id.to_string());
        if !self.script.read().is_ok_and(|r| r.contains_key(&key)) {
            return;
        }
        if let Ok(mut w) = self.script.write() {
            w.remove(&key);
        }
        if let Ok(mut w) = self.script_at.write() {
            w.remove(&key);
        }
        if let Ok(mut w) = self.runtime_exhausted_until.write() {
            w.remove(&key);
        }
    }

    pub fn invalidate_subscription(&self, app_type: &AppType) {
        if !self
            .subscription
            .read()
            .is_ok_and(|r| r.contains_key(app_type))
        {
            return;
        }
        if let Ok(mut w) = self.subscription.write() {
            w.remove(app_type);
        }
    }

    /// Drop all process-local usage snapshots after a database/provider restore.
    pub fn invalidate_all(&self) {
        if let Ok(mut subscriptions) = self.subscription.write() {
            subscriptions.clear();
        }
        if let Ok(mut scripts) = self.script.write() {
            scripts.clear();
        }
        if let Ok(mut times) = self.script_at.write() {
            times.clear();
        }
        if let Ok(mut exhausted) = self.runtime_exhausted_until.write() {
            exhausted.clear();
        }
        if let Ok(mut accounts) = self.codex_oauth.write() {
            accounts.clear();
        }
    }
}

fn usage_result_quota_exhausted(
    result: &UsageResult,
    observed_at: SystemTime,
    now: chrono::DateTime<chrono::Utc>,
) -> bool {
    if !result.success {
        return false;
    }
    let observed_at = chrono::DateTime::<chrono::Utc>::from(observed_at);
    let fresh =
        now.signed_duration_since(observed_at).num_seconds() <= SCRIPT_EXHAUSTION_MAX_AGE_SECS;

    result.data.as_deref().unwrap_or_default().iter().any(|data| {
        let exhausted = data.is_valid == Some(false)
            || data
                .remaining
                .is_some_and(|remaining| remaining <= 0.0 && data.total != Some(-1.0))
            || matches!((data.used, data.total), (Some(used), Some(total)) if total > 0.0 && used >= total);
        if !exhausted {
            return false;
        }
        match quota_reset_at(data.extra.as_deref()) {
            Some(reset_at) => reset_at > now,
            None => fresh,
        }
    })
}

fn quota_reset_at(extra: Option<&str>) -> Option<chrono::DateTime<chrono::Utc>> {
    let raw = extra?.trim();
    if raw.is_empty() {
        return None;
    }
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(raw) {
        for key in ["resetsAt", "resetAt", "reset_at", "resetTime"] {
            if let Some(reset) = value.get(key).and_then(serde_json::Value::as_str) {
                return parse_rfc3339(reset);
            }
        }
        for key in ["resetsAtMs", "resetAtMs", "reset_at_ms"] {
            if let Some(millis) = value.get(key).and_then(serde_json::Value::as_i64) {
                return chrono::DateTime::<chrono::Utc>::from_timestamp_millis(millis);
            }
        }
    }
    parse_rfc3339(raw)
}

fn parse_rfc3339(value: &str) -> Option<chrono::DateTime<chrono::Utc>> {
    chrono::DateTime::parse_from_rfc3339(value.trim())
        .ok()
        .map(|value| value.with_timezone(&chrono::Utc))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::subscription::CredentialStatus;

    fn fake_quota() -> SubscriptionQuota {
        SubscriptionQuota {
            tool: "claude".to_string(),
            credential_status: CredentialStatus::Valid,
            credential_message: None,
            success: true,
            tiers: vec![],
            extra_usage: None,
            reset_credits: None,
            credits_balance: None,
            error: None,
            queried_at: Some(0),
        }
    }

    fn fake_result() -> UsageResult {
        UsageResult {
            success: true,
            data: None,
            error: None,
        }
    }

    #[test]
    fn subscription_round_trip() {
        let cache = UsageCache::new();
        assert!(cache
            .with_subscription(&AppType::Claude, |q| q.success)
            .is_none());
        cache.put_subscription(AppType::Claude, fake_quota());
        let got = cache
            .with_subscription(&AppType::Claude, |q| q.success)
            .unwrap();
        assert!(got);
        assert!(cache
            .with_subscription(&AppType::Codex, |q| q.success)
            .is_none());
    }

    #[test]
    fn script_round_trip_and_invalidate() {
        let cache = UsageCache::new();
        assert!(cache
            .with_script(&AppType::Codex, "pid", |r| r.success)
            .is_none());
        cache.put_script(AppType::Codex, "pid".to_string(), fake_result());
        assert!(cache
            .with_script(&AppType::Codex, "pid", |r| r.success)
            .is_some());
        cache.invalidate_script(&AppType::Codex, "pid");
        assert!(cache
            .with_script(&AppType::Codex, "pid", |r| r.success)
            .is_none());
    }

    #[test]
    fn script_keys_isolated_by_app_type() {
        let cache = UsageCache::new();
        cache.put_script(AppType::Claude, "same".to_string(), fake_result());
        assert!(cache
            .with_script(&AppType::Claude, "same", |r| r.success)
            .is_some());
        assert!(cache
            .with_script(&AppType::Codex, "same", |r| r.success)
            .is_none());
    }

    #[test]
    fn invalidate_all_clears_all_usage_snapshots() {
        let cache = UsageCache::new();
        cache.put_subscription(AppType::Claude, fake_quota());
        cache.put_codex_oauth("account-1".to_string(), fake_quota());
        cache.put_script(AppType::Codex, "provider".to_string(), fake_result());

        cache.invalidate_all();

        assert!(cache
            .with_subscription(&AppType::Claude, |quota| quota.success)
            .is_none());
        assert!(cache
            .with_script(&AppType::Codex, "provider", |usage| usage.success)
            .is_none());
        assert!(cache
            .with_codex_oauth("account-1", |quota| quota.success)
            .is_none());
    }

    fn exhausted_usage(extra: Option<&str>) -> UsageResult {
        UsageResult {
            success: true,
            data: Some(vec![crate::provider::UsageData {
                plan_name: Some("five_hour".to_string()),
                extra: extra.map(str::to_string),
                is_valid: Some(true),
                invalid_message: None,
                total: Some(100.0),
                used: Some(100.0),
                remaining: Some(0.0),
                unit: Some("%".to_string()),
            }]),
            error: None,
        }
    }

    #[test]
    fn exhausted_quota_window_blocks_until_its_reset() {
        let now = chrono::DateTime::parse_from_rfc3339("2026-10-25T10:00:00Z")
            .unwrap()
            .with_timezone(&chrono::Utc);
        let observed = SystemTime::now() - std::time::Duration::from_secs(3600);
        let future = exhausted_usage(Some(r#"{"resetsAt":"2026-10-25T15:00:00Z"}"#));
        let past = exhausted_usage(Some(r#"{"resetsAt":"2026-10-25T09:00:00Z"}"#));

        assert!(usage_result_quota_exhausted(&future, observed, now));
        assert!(!usage_result_quota_exhausted(&past, observed, now));
    }

    #[test]
    fn exhausted_quota_without_reset_only_blocks_fresh_snapshots() {
        let usage = exhausted_usage(None);
        let fresh = SystemTime::now();
        let now = chrono::DateTime::<chrono::Utc>::from(fresh);
        let stale = fresh - std::time::Duration::from_secs(16 * 60);

        assert!(usage_result_quota_exhausted(&usage, fresh, now));
        assert!(!usage_result_quota_exhausted(&usage, stale, now));
    }

    #[test]
    fn any_exhausted_five_hour_weekly_or_monthly_window_blocks_routing() {
        let now = chrono::DateTime::parse_from_rfc3339("2026-10-25T10:00:00Z")
            .unwrap()
            .with_timezone(&chrono::Utc);
        let observed = SystemTime::now();

        for plan_name in ["five_hour", "weekly", "monthly"] {
            let usage = UsageResult {
                success: true,
                data: Some(vec![
                    crate::provider::UsageData {
                        plan_name: Some("healthy_window".to_string()),
                        extra: None,
                        is_valid: Some(true),
                        invalid_message: None,
                        total: Some(100.0),
                        used: Some(20.0),
                        remaining: Some(80.0),
                        unit: Some("%".to_string()),
                    },
                    crate::provider::UsageData {
                        plan_name: Some(plan_name.to_string()),
                        extra: Some(r#"{"resetAt":"2026-10-26T10:00:00Z"}"#.to_string()),
                        is_valid: Some(true),
                        invalid_message: None,
                        total: Some(100.0),
                        used: Some(100.0),
                        remaining: Some(0.0),
                        unit: Some("%".to_string()),
                    },
                ]),
                error: None,
            };

            assert!(
                usage_result_quota_exhausted(&usage, observed, now),
                "{plan_name} exhaustion must block routing"
            );
        }
    }

    #[test]
    fn epoch_millisecond_reset_time_is_honored() {
        let now = chrono::DateTime::parse_from_rfc3339("2026-10-25T10:00:00Z")
            .unwrap()
            .with_timezone(&chrono::Utc);
        let future_ms = (now + chrono::Duration::hours(1)).timestamp_millis();
        let past_ms = (now - chrono::Duration::hours(1)).timestamp_millis();
        let observed = SystemTime::now();

        assert!(usage_result_quota_exhausted(
            &exhausted_usage(Some(&format!(r#"{{"resetAtMs":{future_ms}}}"#))),
            observed,
            now
        ));
        assert!(!usage_result_quota_exhausted(
            &exhausted_usage(Some(&format!(r#"{{"resetAtMs":{past_ms}}}"#))),
            observed,
            now
        ));
    }

    #[test]
    fn runtime_quota_marker_expires_or_clears_after_a_fresh_usage_snapshot() {
        let cache = UsageCache::new();
        let app = AppType::Claude;
        let now = chrono::Utc::now();
        cache.mark_runtime_quota_exhausted(&app, "relay");

        assert!(cache.provider_quota_exhausted(&app, "relay", now));
        assert!(!cache.provider_quota_exhausted(
            &app,
            "relay",
            now + chrono::Duration::minutes(16)
        ));

        cache.mark_runtime_quota_exhausted(&app, "relay");
        cache.put_script(
            AppType::Claude,
            "relay".to_string(),
            crate::provider::UsageResult {
                success: false,
                data: None,
                error: Some("transient usage lookup failure".to_string()),
            },
        );
        assert!(cache.provider_quota_exhausted(&AppType::Claude, "relay", now));

        cache.put_script(
            app,
            "relay".to_string(),
            crate::provider::UsageResult {
                success: true,
                data: Some(vec![crate::provider::UsageData {
                    plan_name: Some("monthly".to_string()),
                    extra: None,
                    is_valid: Some(true),
                    invalid_message: None,
                    total: Some(100.0),
                    used: Some(10.0),
                    remaining: Some(90.0),
                    unit: Some("%".to_string()),
                }]),
                error: None,
            },
        );
        assert!(!cache.provider_quota_exhausted(&AppType::Claude, "relay", now));
    }
}
