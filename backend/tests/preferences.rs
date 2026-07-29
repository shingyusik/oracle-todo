use backend::preferences::{get, init_schema, put};
use rusqlite::Connection;
use serde_json::json;

#[test]
fn planner_preferences_round_trip() {
    let mut connection = Connection::open_in_memory().unwrap();

    init_schema(&connection).unwrap();
    put(&mut connection, "planner.v1", &json!({"filterMode": "or"})).unwrap();

    assert_eq!(
        get(&connection, "planner.v1").unwrap(),
        Some(json!({"filterMode": "or"}))
    );
}

#[test]
fn workspace_view_preferences_round_trip_independently() {
    let mut connection = Connection::open_in_memory().unwrap();

    init_schema(&connection).unwrap();
    put(
        &mut connection,
        "workspace-views.v1",
        &json!({"workspace.task": {"tabs": []}}),
    )
    .unwrap();

    assert_eq!(
        get(&connection, "workspace-views.v1").unwrap(),
        Some(json!({"workspace.task": {"tabs": []}}))
    );
    assert_eq!(get(&connection, "planner.v1").unwrap(), None);
}
