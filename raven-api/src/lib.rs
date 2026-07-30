mod auth;
mod auth_permissions;
mod config;
mod dto;
mod error;
mod routes;
mod server;
mod state;

use axum::Json;
use axum::Router;
use axum::middleware;
use axum::routing::get;
use serde_json::{Value, json};

pub use auth::{AuthConfigError, SecretToken, UiSessionToken, load_bearer, load_bearer_from_env};
pub use config::{AuthMode, RavenApiConfig, ServerBind};
pub use dto::dashboard::{
    DashboardResponse, DomainProjection, HealthDashboard, LedgerDashboard, RecentActivityItem,
    TodoDashboard,
};
pub use error::{ApiError, ApiErrorBody};
pub use server::{BindError, serve, serve_listener, ui_router, validate_bind};
pub use state::RavenApiState;

pub fn router(mut config: RavenApiConfig) -> anyhow::Result<Router> {
    auth::validate_mode(&config.auth)?;
    auth::protect_mode(&mut config.auth);
    let state = RavenApiState::new(config);
    Ok(Router::new()
        .route("/healthz", get(healthz))
        .route(
            "/api/v1/preferences",
            get(routes::preferences::invalid_route).put(routes::preferences::invalid_route),
        )
        .route(
            "/api/v1/preferences/",
            get(routes::preferences::invalid_route).put(routes::preferences::invalid_route),
        )
        .nest("/api/v1/dashboard", routes::dashboard::router())
        .nest("/api/v1/preferences", routes::preferences::router())
        .nest("/api/v1/todo", routes::todo::router(&state)?)
        .nest("/api/v1/ledger", routes::ledger::router())
        .nest("/api/v1/health", routes::health::router())
        .layer(middleware::from_fn(routes::limit_query))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            auth::authenticate,
        ))
        .with_state(state))
}

async fn healthz() -> Json<Value> {
    Json(json!({ "status": "ok" }))
}
