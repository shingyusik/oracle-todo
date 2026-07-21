use std::path::PathBuf;

use axum::extract::State;
use axum::http::StatusCode;
use axum::routing::get;
use axum::{Json, Router};
use rusqlite::Connection;
use serde_json::Value;

use crate::preferences;

const PLANNER_PREFERENCE_KEY: &str = "planner.v1";

pub fn router(db_path: PathBuf) -> Router {
    Router::new()
        .route("/settings/planner", get(get_planner).put(put_planner))
        .with_state(db_path)
}

async fn get_planner(State(db_path): State<PathBuf>) -> Result<Json<Value>, StatusCode> {
    let connection = open_preferences(&db_path)?;
    let value = preferences::get(&connection, PLANNER_PREFERENCE_KEY)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(value.unwrap_or(Value::Null)))
}

async fn put_planner(
    State(db_path): State<PathBuf>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, StatusCode> {
    let Some(value) = body.get("value").filter(|value| value.is_object()) else {
        return Err(StatusCode::BAD_REQUEST);
    };
    let mut connection = open_preferences(&db_path)?;
    preferences::put(&mut connection, PLANNER_PREFERENCE_KEY, value)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(value.clone()))
}

fn open_preferences(db_path: &PathBuf) -> Result<Connection, StatusCode> {
    let connection = Connection::open(db_path).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    preferences::init_schema(&connection).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(connection)
}
