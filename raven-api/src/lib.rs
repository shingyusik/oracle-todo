mod auth;
mod auth_permissions;
mod changes;
mod config;
mod dto;
mod error;
pub(crate) mod fsutil;
pub mod google_calendar;
pub mod mcp;
pub mod retention;
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
pub use google_calendar::GoogleCalendar;
pub use retention::Retention;
pub use routes::health::{health_table_lookups, health_table_page_json, parse_health_table_query};
pub use routes::ledger::{ledger_table_lookups, parse_ledger_table_query};
pub use server::{
    BindError, UiArtifact, UiPublicOriginError, serve, serve_listener,
    serve_listener_with_integrations, serve_listener_with_retention, ui_router,
    ui_router_with_integrations, ui_router_with_retention, ui_router_with_updates, validate_bind,
    validate_ui_public_origin,
};
pub use state::RavenApiState;
pub use system::{
    GithubReleases, ReleaseFetch, ReleaseFetchError, ReleaseFuture, ReleaseInfo, ReleaseSource,
    RestartSignal, UiUpdates, UpdateSettings,
};

/// Standalone bearer API, including the retention maintenance routes.
pub fn router(config: RavenApiConfig) -> anyhow::Result<Router> {
    let retention = Retention::from_config(&config);
    router_with_retention(config, retention)
}

/// Like [`router`], sharing a retention runtime (and its scheduler status) with the caller.
pub fn router_with_retention(
    config: RavenApiConfig,
    retention: Retention,
) -> anyhow::Result<Router> {
    let google_calendar = GoogleCalendar::from_config(&config)?;
    router_with_integrations(config, retention, google_calendar)
}

/// Like [`router`], sharing the retention and Google Calendar runtimes with the caller.
/// The bearer API exposes no Google Calendar connect routes.
pub fn router_with_integrations(
    config: RavenApiConfig,
    retention: Retention,
    google_calendar: GoogleCalendar,
) -> anyhow::Result<Router> {
    build_router(
        config,
        version::RELEASE_VERSION,
        None,
        Some(retention),
        Some(routes::google_calendar::router(google_calendar, None)),
    )
}

pub(crate) fn build_router(
    mut config: RavenApiConfig,
    version: &str,
    system: Option<Router<RavenApiState>>,
    maintenance: Option<Retention>,
    google_calendar: Option<Router<RavenApiState>>,
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
    };
    let api = match maintenance {
        Some(retention) => api.nest("/v1/maintenance", routes::maintenance::router(retention)),
        None => api,
    };
    let api = match google_calendar {
        Some(routes) => api.nest("/v1/integrations/google-calendar", routes),
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
