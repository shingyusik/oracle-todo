use std::sync::{Arc, Barrier};
use time::{Duration, OffsetDateTime};
use todo_engine::application::error::TodoError;
use todo_engine::application::ports::TodoStore;
use todo_engine::application::service::{ProposeTask, TodoService, UpdateItem};
use todo_engine::domain::{Actor, TodoEvent};
use todo_engine::infrastructure::sqlite::{SqliteTodoRepository, connect, init_schema};

#[test]
fn stale_update_preserves_item_and_audit() {
    let mut service = TodoService::in_memory();
    let item = service
        .propose_task("original", ProposeTask::default())
        .unwrap();
    let updated = service
        .update_item_if_current(
            &item.id,
            UpdateItem {
                title: Some("winner".into()),
                ..Default::default()
            },
            Some(item.updated_at),
        )
        .unwrap();
    let event_count = service.events().len();
    let error = service
        .update_item_if_current(
            &item.id,
            UpdateItem {
                title: Some("stale".into()),
                ..Default::default()
            },
            Some(item.updated_at),
        )
        .unwrap_err();
    assert!(matches!(error, TodoError::Conflict(_)));
    assert_eq!(service.get(&item.id).unwrap(), updated);
    assert_eq!(service.events().len(), event_count);
}

#[test]
fn concurrent_snapshot_writers_commit_exactly_one_item_and_audit() {
    let home = tempfile::tempdir().unwrap();
    let path = home.path().join("todo.sqlite");
    let conn = connect(path.to_str().unwrap()).unwrap();
    init_schema(&conn).unwrap();
    let mut service = TodoService::persistent(SqliteTodoRepository::new(conn));
    let item = service
        .propose_task("original", ProposeTask::default())
        .unwrap();
    let barrier = Arc::new(Barrier::new(2));
    let workers: Vec<_> = (0..2)
        .map(|writer| {
            let path = path.clone();
            let mut snapshot = item.clone();
            let expected = item.updated_at;
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                let conn = connect(path.to_str().unwrap()).unwrap();
                conn.busy_timeout(std::time::Duration::from_secs(5))
                    .unwrap();
                let mut repo = SqliteTodoRepository::new(conn);
                snapshot.title = format!("writer-{writer}");
                snapshot.updated_at = expected + Duration::seconds(writer + 1);
                let event = TodoEvent {
                    id: format!("event-{writer}"),
                    at: OffsetDateTime::now_utc(),
                    actor: Actor::User,
                    action: "update_item".into(),
                    object_type: "task".into(),
                    object_id: snapshot.id.clone(),
                    before: None,
                    after: Some(serde_json::to_value(&snapshot).unwrap()),
                    reason: None,
                };
                barrier.wait();
                repo.save_item_and_event_if_current(&snapshot, &event, expected)
            })
        })
        .collect();
    let results: Vec<_> = workers
        .into_iter()
        .map(|worker| worker.join().unwrap())
        .collect();
    assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
    assert_eq!(
        results
            .iter()
            .filter(|result| matches!(result, Err(TodoError::Conflict(_))))
            .count(),
        1
    );
    let conn = connect(path.to_str().unwrap()).unwrap();
    let events: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM events WHERE action = 'update_item'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(events, 1);
    let title: String = conn
        .query_row("SELECT title FROM items WHERE id = ?1", [&item.id], |row| {
            row.get(0)
        })
        .unwrap();
    let audit_title: String = conn
        .query_row(
            "SELECT json_extract(after, '$.title') FROM events WHERE action = 'update_item'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(title, audit_title);
}
