use std::path::{Path, PathBuf};
use std::time::Duration;

use axum::extract::State;
use axum::http::StatusCode;
use axum::routing::get;
use axum::{Json, Router};
use rusqlite::{Connection, OpenFlags};
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

fn get_preference(db_path: &Path, key: &str) -> Result<Json<Value>, StatusCode> {
    let value = read_preference(db_path, key).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(value.unwrap_or(Value::Null)))
}

fn put_preference(db_path: &Path, key: &str, body: &Value) -> Result<Json<Value>, StatusCode> {
    let Some(value) = body.get("value").filter(|value| value.is_object()) else {
        return Err(StatusCode::BAD_REQUEST);
    };
    write_preference(db_path, key, value).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(value.clone()))
}

pub fn read_preference(
    db_path: &Path,
    key: &str,
) -> Result<Option<Value>, preferences::PreferencesError> {
    match std::fs::metadata(db_path) {
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    }
    let connection = Connection::open_with_flags(db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    connection.busy_timeout(Duration::from_secs(5))?;
    let initialized: bool = connection.query_row(
        "SELECT EXISTS(
            SELECT 1 FROM sqlite_master
            WHERE type = 'table' AND name = 'workspace_preferences'
        )",
        [],
        |row| row.get(0),
    )?;
    if initialized {
        preferences::get(&connection, key)
    } else {
        Ok(None)
    }
}

pub fn write_preference(
    db_path: &Path,
    key: &str,
    value: &Value,
) -> Result<(), preferences::PreferencesError> {
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut connection = Connection::open(db_path)?;
    connection.busy_timeout(Duration::from_secs(5))?;
    preferences::init_schema(&connection)?;
    preferences::put(&mut connection, key, value)
}
