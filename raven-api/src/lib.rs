mod config;
mod error;
mod state;

use axum::Json;
use axum::Router;
use axum::routing::get;
use serde_json::{Value, json};

pub use config::{AuthMode, RavenApiConfig};
pub use error::{ApiError, ApiErrorBody};
pub use state::RavenApiState;

pub fn router(config: RavenApiConfig) -> anyhow::Result<Router> {
    let state = RavenApiState::new(config);
    Ok(Router::new()
        .route("/healthz", get(healthz))
        .with_state(state))
}

async fn healthz() -> Json<Value> {
    Json(json!({ "status": "ok" }))
}
