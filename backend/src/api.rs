use std::path::PathBuf;

use axum::extract::State;
use axum::http::StatusCode;
use axum::routing::get;
use axum::{Json, Router};
use rusqlite::Connection;
use serde_json::Value;

use crate::preferences;

const PLANNER_PREFERENCE_KEY: &str = "planner.v1";
const WORKSPACE_VIEWS_PREFERENCE_KEY: &str = "workspace-views.v1";

pub fn router(db_path: PathBuf) -> Router {
    Router::new()
        .route("/settings/planner", get(get_planner).put(put_planner))
        .route(
            "/settings/workspace-views",
            get(get_workspace_views).put(put_workspace_views),
        )
        .with_state(db_path)
}

async fn get_planner(State(db_path): State<PathBuf>) -> Result<Json<Value>, StatusCode> {
    get_preference(&db_path, PLANNER_PREFERENCE_KEY)
}

async fn put_planner(
    State(db_path): State<PathBuf>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, StatusCode> {
    put_preference(&db_path, PLANNER_PREFERENCE_KEY, &body)
}

async fn get_workspace_views(State(db_path): State<PathBuf>) -> Result<Json<Value>, StatusCode> {
    get_preference(&db_path, WORKSPACE_VIEWS_PREFERENCE_KEY)
}

async fn put_workspace_views(
    State(db_path): State<PathBuf>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, StatusCode> {
    put_preference(&db_path, WORKSPACE_VIEWS_PREFERENCE_KEY, &body)
}

fn get_preference(db_path: &PathBuf, key: &str) -> Result<Json<Value>, StatusCode> {
    let connection = open_preferences(db_path)?;
    let value =
        preferences::get(&connection, key).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(value.unwrap_or(Value::Null)))
}

fn put_preference(db_path: &PathBuf, key: &str, body: &Value) -> Result<Json<Value>, StatusCode> {
    let Some(value) = body.get("value").filter(|value| value.is_object()) else {
        return Err(StatusCode::BAD_REQUEST);
    };
    let mut connection = open_preferences(db_path)?;
    preferences::put(&mut connection, key, value).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(value.clone()))
}

fn open_preferences(db_path: &PathBuf) -> Result<Connection, StatusCode> {
    Connection::open(db_path).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}
