use todo_engine::application::ports::ListFilter;
use todo_engine::application::service::{ProposeGoal, TodoService};
use todo_engine::domain::Actor;
use todo_engine::infrastructure::sqlite::{SqliteTodoRepository, connect, init_schema};

fn goal(horizon: &str, scheduled: &str, parent_id: Option<&str>) -> ProposeGoal {
    ProposeGoal {
        title: format!("{horizon} goal {scheduled}"),
        horizon: horizon.to_string(),
        scheduled: scheduled.to_string(),
        parent_id: parent_id.map(ToString::to_string),
        actor: Actor::User,
        note: None,
    }
}

// Stand up a persistent service over a temp SQLite home (mirrors goal_roundtrip.rs's
// connect/init_schema/SqliteTodoRepository setup) and wrap it with
// TodoService::persistent so the assertions exercise the real list_items path.
fn persistent_service() -> (tempfile::TempDir, TodoService) {
    let dir = tempfile::tempdir().expect("create test home");
    let db_path = dir.path().join("todo.sqlite");
    let conn = connect(db_path.to_str().expect("utf-8 db path")).unwrap();
    init_schema(&conn).unwrap();
    let repo = SqliteTodoRepository::new(conn);
    (dir, TodoService::persistent(repo))
}

// VIEW-01: list filtering by horizon / parent_id / (horizon, scheduled) is proven
// against the PERSISTENT SQLite store, confirming repo.rs honors the new
// apply_list_filter predicates (RESEARCH A3), not just the in-memory path.
#[test]
fn persistent_list_items_honors_horizon_parent_and_period_filters() {
    let (_home, mut service) = persistent_service();

    let year = service
        .propose_goal(goal("year", "2026-01-01", None))
        .unwrap();
    let month = service
        .propose_goal(goal("month", "2026-06-01", None))
        .unwrap();
    let week = service
        .propose_goal(goal("week", "2026-06-08", None))
        .unwrap();
    // A child goal nested under the month goal (week is strictly finer than month).
    let child = service
        .propose_goal(goal("week", "2026-06-01", Some(&month.id)))
        .unwrap();

    // Filter by horizon: only the two week goals come back (top-level week + child).
    let weeks = service
        .list_items(ListFilter {
            horizon: Some("week".to_string()),
            ..Default::default()
        })
        .unwrap();
    let mut week_ids: Vec<&str> = weeks.iter().map(|item| item.id.as_str()).collect();
    week_ids.sort_unstable();
    let mut expected_week_ids = vec![week.id.as_str(), child.id.as_str()];
    expected_week_ids.sort_unstable();
    assert_eq!(week_ids, expected_week_ids);

    // Filter by parent_id: only the child nested under the month goal.
    let children = service
        .list_items(ListFilter {
            parent_id: Some(month.id.clone()),
            ..Default::default()
        })
        .unwrap();
    assert_eq!(children.len(), 1);
    assert_eq!(children[0].id, child.id);

    // Filter by exact (horizon, scheduled) period: exactly the month goal.
    let period = service
        .list_items(ListFilter {
            horizon: Some("month".to_string()),
            scheduled: Some("2026-06-01".to_string()),
            ..Default::default()
        })
        .unwrap();
    assert_eq!(period.len(), 1);
    assert_eq!(period[0].id, month.id);

    // Sanity: the year goal exists but is excluded by every filter above.
    let all_years = service
        .list_items(ListFilter {
            horizon: Some("year".to_string()),
            ..Default::default()
        })
        .unwrap();
    assert_eq!(all_years.len(), 1);
    assert_eq!(all_years[0].id, year.id);
}
