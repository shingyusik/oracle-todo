mod config;
mod dto;
mod error;
mod routes;
mod state;

use axum::Json;
use axum::Router;
use axum::middleware;
use axum::routing::get;
use serde_json::{Value, json};

pub use config::{AuthMode, RavenApiConfig};
pub use dto::dashboard::{
    DashboardResponse, DomainProjection, HealthDashboard, LedgerDashboard, RecentActivityItem,
    TodoDashboard,
};
pub use error::{ApiError, ApiErrorBody};
pub use state::RavenApiState;

pub fn router(config: RavenApiConfig) -> anyhow::Result<Router> {
    let state = RavenApiState::new(config);
    Ok(Router::new()
        .route("/healthz", get(healthz))
        .nest("/api/v1/dashboard", routes::dashboard::router())
        .nest("/api/v1/todo", routes::todo::router(&state)?)
        .nest("/api/v1/ledger", routes::ledger::router())
        .nest("/api/v1/health", routes::health::router())
        .layer(middleware::from_fn(routes::limit_query))
        .with_state(state))
}

async fn healthz() -> Json<Value> {
    Json(json!({ "status": "ok" }))
}
