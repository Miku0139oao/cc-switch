use serde::Serialize;

use crate::app_config::AppType;

/// One backend-owned source of truth for what each desktop client can do.
/// The frontend mirrors this shape only for optimistic rendering; commands and
/// mode transitions always enforce the backend value.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppCapabilities {
    pub app_type: String,
    pub direct: bool,
    pub route: bool,
    pub stack: bool,
    pub failover: bool,
    pub launch_scoped: bool,
    pub model_catalog: ModelCatalogCapability,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ModelCatalogCapability {
    Dynamic,
    Configurable,
    Fixed,
}

pub fn for_app(app: &AppType) -> AppCapabilities {
    let spec = app.spec();
    let model_catalog = match app {
        AppType::Claude | AppType::Codex | AppType::ClaudeDesktop => {
            ModelCatalogCapability::Dynamic
        }
        AppType::Agy => ModelCatalogCapability::Fixed,
        _ => ModelCatalogCapability::Configurable,
    };
    AppCapabilities {
        app_type: app.as_str().to_string(),
        direct: true,
        route: spec.route_mode,
        stack: spec.stack,
        failover: spec.local_proxy,
        launch_scoped: matches!(app, AppType::Agy),
        model_catalog,
    }
}

pub fn all() -> Vec<AppCapabilities> {
    AppType::all().map(|app| for_app(&app)).collect()
}
