//! Per-Codex-thread provider/model routing.
//!
//! A route is stored by the stable client thread id, independent of the
//! global route/default provider. The proxy reads it on every request so an
//! active conversation can switch models on its next turn.

use std::collections::BTreeMap;

use axum::http::HeaderMap;
use serde::Serialize;

use crate::app_config::AppType;
use crate::database::Database;
use crate::error::AppError;
use crate::live::engine::DeviceStore;
use crate::mode::stack::{self, StackTarget};
use crate::proxy::extract_session_id;

use super::state::{self, SessionRoute};

const MAX_SESSION_ID_BYTES: usize = 256;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CodexSessionModelTarget {
    pub provider_id: String,
    pub provider_name: String,
    pub upstream_model: String,
    pub official: bool,
}

/// Client session headers carry a `codex_` namespace prefix for proxy/cache
/// isolation, while session records store the raw thread id.
pub fn normalize_session_id(session_id: &str) -> Result<String, AppError> {
    let trimmed = session_id.trim();
    let normalized = trimmed.strip_prefix("codex_").unwrap_or(trimmed);
    if normalized.is_empty() {
        return Err(AppError::InvalidInput(
            "Codex session id cannot be empty".to_string(),
        ));
    }
    if normalized.len() > MAX_SESSION_ID_BYTES {
        return Err(AppError::InvalidInput(
            "Codex session id is too long".to_string(),
        ));
    }
    if normalized.chars().any(char::is_control) {
        return Err(AppError::InvalidInput(
            "Codex session id contains control characters".to_string(),
        ));
    }
    Ok(normalized.to_string())
}

pub fn routes(store: &DeviceStore) -> Result<BTreeMap<String, SessionRoute>, AppError> {
    state::session_routes(store, AppType::Codex.as_str())
}

pub fn set_route(
    db: &Database,
    store: &DeviceStore,
    session_id: &str,
    provider_id: &str,
    upstream_model: &str,
) -> Result<(), AppError> {
    let session_id = normalize_session_id(session_id)?;
    let provider_id = provider_id.trim();
    let upstream_model = upstream_model.trim();
    if provider_id.is_empty() || upstream_model.is_empty() {
        return Err(AppError::InvalidInput(
            "Provider and model are required".to_string(),
        ));
    }

    let provider = db
        .get_provider_by_id(provider_id, AppType::Codex.as_str())?
        .ok_or_else(|| AppError::InvalidInput("Codex provider no longer exists".to_string()))?;
    if !stack::codex_models(&provider)
        .iter()
        .any(|model| model == upstream_model)
    {
        return Err(AppError::InvalidInput(format!(
            "Model {upstream_model} is not configured on provider {provider_id}"
        )));
    }

    state::update(store, |live| {
        live.apps
            .entry(AppType::Codex.as_str().to_string())
            .or_default()
            .session_routes
            .insert(
                session_id,
                SessionRoute {
                    provider_id: provider_id.to_string(),
                    upstream_model: upstream_model.to_string(),
                },
            );
    })?;
    Ok(())
}

pub fn clear_route(store: &DeviceStore, session_id: &str) -> Result<(), AppError> {
    let session_id = normalize_session_id(session_id)?;
    state::update(store, |live| {
        if let Some(app) = live.apps.get_mut(AppType::Codex.as_str()) {
            app.session_routes.remove(&session_id);
        }
    })?;
    Ok(())
}

pub fn model_targets(db: &Database) -> Result<Vec<CodexSessionModelTarget>, AppError> {
    let providers = db.get_all_providers(AppType::Codex.as_str())?;
    let mut targets = Vec::new();
    for provider in providers.values() {
        let official = provider.category.as_deref() == Some("official")
            || crate::proxy::providers::is_codex_official_provider(provider);
        for upstream_model in stack::codex_models(provider) {
            targets.push(CodexSessionModelTarget {
                provider_id: provider.id.clone(),
                provider_name: provider.name.clone(),
                upstream_model,
                official,
            });
        }
    }
    targets.sort_by(|a, b| {
        a.provider_name
            .cmp(&b.provider_name)
            .then_with(|| a.upstream_model.cmp(&b.upstream_model))
    });
    targets.dedup_by(|a, b| a.provider_id == b.provider_id && a.upstream_model == b.upstream_model);
    Ok(targets)
}

/// Resolve a pinned route for this request. A stale provider is ignored so a
/// deleted card cannot take a live conversation offline.
pub fn resolve_request(
    db: &Database,
    store: &DeviceStore,
    headers: &HeaderMap,
    body: &serde_json::Value,
) -> Result<Option<StackTarget>, AppError> {
    let extracted = extract_session_id(headers, body, AppType::Codex.as_str());
    if !extracted.client_provided {
        return Ok(None);
    }
    let session_id = normalize_session_id(&extracted.session_id)?;
    let Some(route) = routes(store)?.get(&session_id).cloned() else {
        return Ok(None);
    };
    let Some(provider) = db.get_provider_by_id(&route.provider_id, AppType::Codex.as_str())? else {
        log::warn!(
            "[Codex] session {session_id} is pinned to missing provider {}; using global routing",
            route.provider_id
        );
        return Ok(None);
    };
    let original_model = body
        .get("model")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("unknown")
        .to_string();
    Ok(Some(StackTarget {
        provider,
        upstream_model: route.upstream_model,
        original_model,
        fallbacks: Vec::new(),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;
    use serde_json::json;
    use tempfile::TempDir;

    fn provider(id: &str, name: &str, model: &str) -> crate::provider::Provider {
        crate::provider::Provider::with_id(
            id.to_string(),
            name.to_string(),
            json!({
                "auth": {},
                "config": format!(r#"model = "{model}""#),
            }),
            None,
        )
    }

    fn fixture() -> (
        Database,
        DeviceStore,
        TempDir,
        axum::http::HeaderMap,
        serde_json::Value,
    ) {
        let dir = TempDir::new().unwrap();
        let store = DeviceStore::at(dir.path());
        let db = Database::memory().unwrap();
        db.save_provider("codex", &provider("alpha", "Alpha", "model-a"))
            .unwrap();
        db.save_provider("codex", &provider("beta", "Beta", "model-b"))
            .unwrap();
        let mut headers = axum::http::HeaderMap::new();
        headers.insert(
            "session-id",
            HeaderValue::from_static("4f0b5153-4e66-4f10-83c5-f798998aaf10"),
        );
        let body = json!({"model": "client-model", "input": "hello"});
        (db, store, dir, headers, body)
    }

    #[test]
    fn session_route_switches_an_existing_thread_on_the_next_request() {
        let (db, store, _dir, headers, body) = fixture();
        let session = "4f0b5153-4e66-4f10-83c5-f798998aaf10";

        set_route(&db, &store, &format!("codex_{session}"), "alpha", "model-a").unwrap();
        let first = resolve_request(&db, &store, &headers, &body)
            .unwrap()
            .expect("first route");
        assert_eq!(first.provider.id, "alpha");
        assert_eq!(first.upstream_model, "model-a");
        assert_eq!(first.original_model, "client-model");

        set_route(&db, &store, session, "beta", "model-b").unwrap();
        let second = resolve_request(&db, &store, &headers, &body)
            .unwrap()
            .expect("updated route");
        assert_eq!(second.provider.id, "beta");
        assert_eq!(second.upstream_model, "model-b");

        clear_route(&store, session).unwrap();
        assert!(resolve_request(&db, &store, &headers, &body)
            .unwrap()
            .is_none());
    }

    #[test]
    fn routes_are_isolated_by_thread_and_provider_model_must_exist() {
        let (db, store, _dir, headers, body) = fixture();
        set_route(&db, &store, "codex_thread-a", "alpha", "model-a").unwrap();

        assert!(resolve_request(&db, &store, &headers, &body)
            .unwrap()
            .is_none());
        assert!(set_route(&db, &store, "thread-b", "beta", "model-a").is_err());
        assert_eq!(routes(&store).unwrap().len(), 1);
    }

    #[test]
    fn model_targets_include_configured_codex_models() {
        let (db, _store, _dir, _headers, _body) = fixture();
        let targets = model_targets(&db).unwrap();
        assert!(targets
            .iter()
            .any(|target| target.provider_id == "alpha" && target.upstream_model == "model-a"));
        assert!(targets
            .iter()
            .any(|target| target.provider_id == "beta" && target.upstream_model == "model-b"));
    }
}
