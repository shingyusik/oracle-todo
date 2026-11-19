mod auth;
mod auth_permissions;
mod changes;
mod config;
mod dto;
mod error;
pub mod mcp;
mod routes;
mod server;
mod state;
mod system;
pub mod version;

use axum::Json;
use axum::Router;
use axum::http::StatusCode;
use axum::middleware;
use axum::routing::{any, get};
use serde_json::json;

pub use auth::{AuthConfigError, SecretToken, UiSessionToken, load_bearer, load_bearer_from_env};
pub use config::{AuthMode, RavenApiConfig, ServerBind};
pub use dto::dashboard::{
    DashboardResponse, DomainProjection, HealthDashboard, LedgerDashboard, RecentActivityItem,
    TodoDashboard,
};
pub use error::{ApiError, ApiErrorBody};
pub use routes::health::{health_table_lookups, health_table_page_json, parse_health_table_query};
pub use routes::ledger::{ledger_table_lookups, parse_ledger_table_query};
pub use server::{
    BindError, UiArtifact, UiPublicOriginError, serve, serve_listener, ui_router,
    ui_router_with_updates, validate_bind, validate_ui_public_origin,
};
pub use state::RavenApiState;
pub use system::{
    GithubReleases, ReleaseFetch, ReleaseFetchError, ReleaseFuture, ReleaseInfo, ReleaseSource,
    RestartSignal, UiUpdates, UpdateSettings,
};

pub fn router(config: RavenApiConfig) -> anyhow::Result<Router> {
    build_router(config, version::RELEASE_VERSION, None)
}

pub(crate) fn build_router(
    mut config: RavenApiConfig,
    version: &str,
    system: Option<Router<RavenApiState>>,
) -> anyhow::Result<Router> {
    auth::validate_mode(&config.auth)?;
    auth::protect_mode(&mut config.auth);
    let state = RavenApiState::new(config);
    let api = Router::new()
        .route("/v1/changes", get(changes::events))
        .route(
            "/v1/preferences",
            get(routes::preferences::invalid_route).put(routes::preferences::invalid_route),
        )
        .route(
            "/v1/preferences/",
            get(routes::preferences::invalid_route).put(routes::preferences::invalid_route),
        )
        .nest("/v1/dashboard", routes::dashboard::router())
        .nest("/v1/preferences", routes::preferences::router())
        .nest("/v1/todo", routes::todo::router(&state)?)
        .nest("/v1/ledger", routes::ledger::router())
        .nest("/v1/health", routes::health::router());
    let api = match system {
        Some(system) => api.nest("/v1/system", system),
        None => api,
    }
    .fallback(not_found);
    let health = Json(json!({ "status": "ok", "version": version }));
    Ok(Router::new()
        .route("/healthz", get(move || std::future::ready(health.clone())))
        .route("/api", any(not_found))
        .route("/api/", any(not_found))
        .nest("/api", api)
        .route("/healthz/", any(not_found))
        .route("/healthz/*path", any(not_found))
        .layer(middleware::from_fn(routes::limit_query))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            auth::authenticate,
        ))
        .with_state(state))
}

async fn not_found() -> StatusCode {
    StatusCode::NOT_FOUND
}
