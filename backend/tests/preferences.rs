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
