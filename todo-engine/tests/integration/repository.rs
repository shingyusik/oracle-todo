use todo_engine::application::ports::{EventRepository, ListFilter, TodoRepository, TodoStore};
use todo_engine::application::service::TodoService;
use todo_engine::domain::{Actor, ItemStatus, ItemType, TodoEvent, TodoItem};
use todo_engine::infrastructure::sqlite::SqliteTodoRepository;
use todo_engine::infrastructure::sqlite::{connect, init_schema, user_version};
use time::{OffsetDateTime, macros::datetime};

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

#[test]
fn schema_rejects_null_primary_ids() {
    let conn = connect(":memory:").unwrap();
    init_schema(&conn).unwrap();

    let item_result = conn.execute(
        "INSERT INTO items (id, type, title, status, proposed_by, created_at, updated_at) VALUES (NULL, 'task', 'bad', 'proposed', 'oracle', '2026-06-01T00:00:00Z', '2026-06-01T00:00:00Z')",
        [],
    );
    let event_result = conn.execute(
        "INSERT INTO events (id, at, actor, action, object_type, object_id) VALUES (NULL, '2026-06-01T00:00:00Z', 'oracle', 'bad', 'task', 'task_1')",
        [],
    );

    assert!(item_result.is_err());
    assert!(event_result.is_err());
}

#[test]
fn failed_schema_init_does_not_mark_database_version() {
    let conn = connect(":memory:").unwrap();
    conn.execute_batch(
        r#"
        CREATE TABLE items (
            id TEXT NOT NULL PRIMARY KEY,
            type TEXT NOT NULL,
            title TEXT NOT NULL,
            status TEXT NOT NULL,
            routine_id TEXT,
            occurrence_key TEXT,
            proposed_by TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        INSERT INTO items (id, type, title, status, routine_id, occurrence_key, proposed_by, created_at, updated_at)
        VALUES
            ('task_1', 'task', 'one', 'proposed', 'rtn_1', '2026-06-01', 'oracle', '2026-06-01T00:00:00Z', '2026-06-01T00:00:00Z'),
            ('task_2', 'task', 'two', 'proposed', 'rtn_1', '2026-06-01', 'oracle', '2026-06-01T00:00:00Z', '2026-06-01T00:00:00Z');
        "#,
    )
    .unwrap();

    let result = init_schema(&conn);

    assert!(result.is_err());
    assert_eq!(user_version(&conn).unwrap(), 0);
}

#[test]
fn saving_item_and_event_persists_to_sqlite() {
    let conn = connect(":memory:").unwrap();
    init_schema(&conn).unwrap();
    let mut repo = SqliteTodoRepository::new(conn);
    let now = datetime!(2026-06-01 00:00 UTC);
    let mut item = TodoItem::new_task("task_test", "테스트", Actor::Oracle, now);
    item.note = Some("간단 메모".to_string());

    repo.save_item(&item).unwrap();
    let fetched = repo.get_item(&item.id).unwrap().unwrap();

    assert_eq!(fetched.title, "테스트");
    assert_eq!(fetched.note.as_deref(), Some("간단 메모"));
    assert_eq!(fetched.status, ItemStatus::Proposed);
    assert_eq!(repo.list_items(ListFilter::default()).unwrap().len(), 1);

    let event = TodoEvent {
        id: "evt_test".to_string(),
        at: OffsetDateTime::now_utc(),
        actor: Actor::Oracle,
        action: "propose_task".to_string(),
        object_type: "task".to_string(),
        object_id: item.id.clone(),
        before: None,
        after: Some(serde_json::to_value(&item).unwrap()),
        reason: None,
    };
    repo.save_event(&event).unwrap();
    assert_eq!(repo.list_events_for_item(&item.id).unwrap().len(), 1);
}

#[test]
fn sqlite_backed_service_persists_items_and_events() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("todo.sqlite");
    let db_path = db_path.to_str().unwrap();
    let conn = connect(db_path).unwrap();
    init_schema(&conn).unwrap();
    let repo = SqliteTodoRepository::new(conn);
    let mut service = TodoService::persistent(repo);

    let item = service
        .propose_task("저장되는 태스크", Default::default())
        .unwrap();
    service.approve(&item.id, Some("확인")).unwrap();

    let conn = connect(db_path).unwrap();
    init_schema(&conn).unwrap();
    let mut repo = SqliteTodoRepository::new(conn);

    assert_eq!(
        repo.get_item(&item.id).unwrap().unwrap().title,
        "저장되는 태스크"
    );
    assert_eq!(repo.list_events_for_item(&item.id).unwrap().len(), 2);
}

#[test]
fn persistent_service_uses_current_clock_across_instances() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("todo.sqlite");
    let db_path = db_path.to_str().unwrap();
    let before = OffsetDateTime::now_utc() - time::Duration::seconds(1);

    let conn = connect(db_path).unwrap();
    init_schema(&conn).unwrap();
    let mut first_service = TodoService::persistent(SqliteTodoRepository::new(conn));
    let first = first_service
        .propose_task("첫 저장", Default::default())
        .unwrap();

    let conn = connect(db_path).unwrap();
    init_schema(&conn).unwrap();
    let mut second_service = TodoService::persistent(SqliteTodoRepository::new(conn));
    let second = second_service
        .propose_task("둘째 저장", Default::default())
        .unwrap();
    let after = OffsetDateTime::now_utc() + time::Duration::seconds(1);

    assert!(first.created_at >= before);
    assert!(second.created_at >= before);
    assert!(first.created_at <= after);
    assert!(second.created_at <= after);
    assert_ne!(first.created_at, datetime!(2026-05-31 12:00 UTC));
    assert_ne!(second.created_at, datetime!(2026-05-31 12:00 UTC));
}

#[test]
fn duplicate_event_ids_are_rejected() {
    let conn = connect(":memory:").unwrap();
    init_schema(&conn).unwrap();
    let mut repo = SqliteTodoRepository::new(conn);
    let now = datetime!(2026-06-01 00:00 UTC);
    let event = TodoEvent {
        id: "evt_test".to_string(),
        at: now,
        actor: Actor::Oracle,
        action: "propose_task".to_string(),
        object_type: "task".to_string(),
        object_id: "task_test".to_string(),
        before: None,
        after: None,
        reason: None,
    };

    repo.save_event(&event).unwrap();
    let mut changed = event.clone();
    changed.action = "rewritten".to_string();

    assert!(repo.save_event(&changed).is_err());
}

#[test]
fn item_and_event_are_saved_atomically() {
    let conn = connect(":memory:").unwrap();
    init_schema(&conn).unwrap();
    let mut repo = SqliteTodoRepository::new(conn);
    let now = datetime!(2026-06-01 00:00 UTC);
    let existing = TodoEvent {
        id: "evt_conflict".to_string(),
        at: now,
        actor: Actor::Oracle,
        action: "existing".to_string(),
        object_type: "task".to_string(),
        object_id: "task_existing".to_string(),
        before: None,
        after: None,
        reason: None,
    };
    let item = TodoItem::new_task("task_conflict", "충돌", Actor::Oracle, now);
    let conflicting = TodoEvent {
        object_id: item.id.clone(),
        action: "propose_task".to_string(),
        ..existing.clone()
    };

    repo.save_event(&existing).unwrap();
    assert!(repo.save_item_and_event(&item, &conflicting).is_err());

    assert!(repo.get_item(&item.id).unwrap().is_none());
}

#[test]
fn item_upsert_preserves_original_created_at() {
    let conn = connect(":memory:").unwrap();
    init_schema(&conn).unwrap();
    let mut repo = SqliteTodoRepository::new(conn);
    let original = datetime!(2026-06-01 00:00 UTC);
    let rewritten = datetime!(2026-06-02 00:00 UTC);
    let mut item = TodoItem::new_task("task_test", "테스트", Actor::Oracle, original);

    repo.save_item(&item).unwrap();
    item.title = "수정".to_string();
    item.created_at = rewritten;
    item.updated_at = rewritten;
    repo.save_item(&item).unwrap();
    let fetched = repo.get_item(&item.id).unwrap().unwrap();

    assert_eq!(fetched.title, "수정");
    assert_eq!(fetched.created_at, original);
    assert_eq!(fetched.updated_at, rewritten);
}

#[test]
fn list_items_honors_core_filters_and_hides_archived_by_default() {
    let conn = connect(":memory:").unwrap();
    init_schema(&conn).unwrap();
    let mut repo = SqliteTodoRepository::new(conn);
    let now = datetime!(2026-06-01 00:00 UTC);
    let mut active = TodoItem::new_task("task_active", "활성", Actor::Oracle, now);
    active.status = ItemStatus::Active;
    active.area_id = Some("area_1".to_string());
    let mut archived = TodoItem::new_task("task_archived", "보관", Actor::Oracle, now);
    archived.status = ItemStatus::Archived;
    let area = TodoItem::new("area_1", ItemType::Area, "재정", Actor::User, now);

    repo.save_item(&area).unwrap();
    repo.save_item(&active).unwrap();
    repo.save_item(&archived).unwrap();

    assert_eq!(repo.list_items(ListFilter::default()).unwrap().len(), 2);
    assert_eq!(
        repo.list_items(ListFilter {
            status: Some(ItemStatus::Active),
            ..Default::default()
        })
        .unwrap()
        .iter()
        .map(|item| item.id.as_str())
        .collect::<Vec<_>>(),
        vec!["task_active"]
    );
    assert_eq!(
        repo.list_items(ListFilter {
            item_type: Some(ItemType::Area),
            include_archived: true,
            ..Default::default()
        })
        .unwrap()
        .iter()
        .map(|item| item.id.as_str())
        .collect::<Vec<_>>(),
        vec!["area_1"]
    );
    assert_eq!(
        repo.list_items(ListFilter {
            area_id: Some("area_1".to_string()),
            include_archived: true,
            ..Default::default()
        })
        .unwrap()
        .iter()
        .map(|item| item.id.as_str())
        .collect::<Vec<_>>(),
        vec!["task_active"]
    );
    assert_eq!(
        repo.list_items(ListFilter {
            query: Some("활".to_string()),
            include_archived: true,
            ..Default::default()
        })
        .unwrap()
        .iter()
        .map(|item| item.id.as_str())
        .collect::<Vec<_>>(),
        vec!["task_active"]
    );
    assert_eq!(
        repo.list_items(ListFilter {
            status: Some(ItemStatus::Archived),
            ..Default::default()
        })
        .unwrap()
        .iter()
        .map(|item| item.id.as_str())
        .collect::<Vec<_>>(),
        vec!["task_archived"]
    );
}

#[test]
fn repository_writes_canonical_enum_names() {
    let dir = tempfile::TempDir::new().unwrap();
    let db_path = dir.path().join("todo.sqlite");
    let conn = connect(db_path.to_str().unwrap()).unwrap();
    init_schema(&conn).unwrap();
    let now = datetime!(2026-06-01 00:00 UTC);
    let item = TodoItem::new_task("task_enum_format", "저장 포맷 확인", Actor::Oracle, now);
    let event = TodoEvent {
        id: "evt_enum_format".to_string(),
        at: now,
        actor: Actor::Oracle,
        action: "propose_task".to_string(),
        object_type: item.item_type.as_str().to_string(),
        object_id: item.id.clone(),
        before: None,
        after: None,
        reason: None,
    };

    let mut repo = SqliteTodoRepository::new(conn);
    repo.save_item_and_event(&item, &event).unwrap();
    drop(repo);

    let conn = connect(db_path.to_str().unwrap()).unwrap();
    let item_row = conn
        .query_row(
            "SELECT type, status, proposed_by FROM items WHERE id = ?1",
            ["task_enum_format"],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .unwrap();
    let event_row = conn
        .query_row(
            "SELECT actor, object_type FROM events WHERE id = ?1",
            ["evt_enum_format"],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .unwrap();

    assert_eq!(
        item_row,
        (
            "task".to_string(),
            "proposed".to_string(),
            "oracle".to_string()
        )
    );
    assert_eq!(event_row, ("oracle".to_string(), "task".to_string()));
}

#[test]
fn schema_init_adds_missing_columns() {
    let conn = connect(":memory:").unwrap();
    conn.execute_batch(
        r#"
        CREATE TABLE items (
            id TEXT NOT NULL PRIMARY KEY,
            type TEXT NOT NULL,
            title TEXT NOT NULL,
            status TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        "#,
    )
    .unwrap();

    init_schema(&conn).unwrap();
    let columns: Vec<String> = conn
        .prepare("PRAGMA table_info(items)")
        .unwrap()
        .query_map([], |row| row.get::<_, String>(1))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();

    assert!(columns.contains(&"materialization_policy".to_string()));
    assert!(columns.contains(&"last_materialized_at".to_string()));
    assert!(columns.contains(&"note".to_string()));
    assert_eq!(user_version(&conn).unwrap(), 1);
}
