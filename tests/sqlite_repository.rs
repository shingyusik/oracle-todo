use oracle_todo::infrastructure::sqlite::{connect, init_schema, user_version};

#[test]
fn init_schema_creates_items_and_events_tables() {
    let conn = connect(":memory:").unwrap();
    init_schema(&conn).unwrap();

    let tables: Vec<String> = conn
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .unwrap()
        .query_map([], |row| row.get::<_, String>(0))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();

    assert!(tables.contains(&"items".to_string()));
    assert!(tables.contains(&"events".to_string()));
    assert_eq!(user_version(&conn).unwrap(), 1);
}
