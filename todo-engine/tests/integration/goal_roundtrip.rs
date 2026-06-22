use time::macros::datetime;
use todo_engine::application::ports::TodoRepository;
use todo_engine::domain::{Actor, ItemType, TodoItem};
use todo_engine::infrastructure::sqlite::{SqliteTodoRepository, connect, init_schema};

// SC3: a `goal`-typed row round-trips through the SQLite mapping (write then read)
// without error on the current binary, carrying the reserved horizon/scheduled
// anchoring columns intact. The round-trip flows through
// item_type_sqlite_value -> as_str (write) and parse_item_type -> FromStr (read),
// not serde.
#[test]
fn goal_item_round_trips_through_sqlite() {
    let conn = connect(":memory:").unwrap();
    init_schema(&conn).unwrap();
    let mut repo = SqliteTodoRepository::new(conn);

    let mut item = TodoItem::new(
        "goal_1",
        ItemType::Goal,
        "2026 plan",
        Actor::User,
        datetime!(2026-06-01 00:00 UTC),
    );
    item.horizon = Some("year".to_string());
    item.scheduled = Some("2026-01-01".to_string());

    repo.save_item(&item).unwrap();
    let fetched = repo.get_item(&item.id).unwrap().unwrap();

    assert_eq!(fetched.item_type, ItemType::Goal);
    assert_eq!(fetched.id, "goal_1");
    assert_eq!(fetched.title, "2026 plan");
    assert_eq!(fetched.horizon.as_deref(), Some("year"));
    assert_eq!(fetched.scheduled.as_deref(), Some("2026-01-01"));
}
