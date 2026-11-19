use std::collections::BTreeSet;
use std::path::Path;

use rusqlite::{Connection, params};
use time::format_description::well_known::Rfc3339;
use time::macros::{date, datetime};
use time::{Duration, OffsetDateTime};
use todo_engine::application::error::TodoError;
use todo_engine::application::ports::TodoStore;
use todo_engine::application::service::TodoService;
use todo_engine::infrastructure::sqlite::{SqliteTodoRepository, connect, init_schema};
use todo_engine::retention::{self, RetentionPlan, RetentionWindow};

const NOW: OffsetDateTime = datetime!(2026-11-19 12:00 UTC);

fn window() -> RetentionWindow {
    RetentionWindow {
        now: NOW,
        cutoff: NOW - Duration::days(30),
        local_today: date!(2026 - 11 - 19),
    }
}

fn days_ago(days: i64) -> String {
    (NOW - Duration::days(days)).format(&Rfc3339).unwrap()
}

struct Store {
    _dir: tempfile::TempDir,
    path: std::path::PathBuf,
    conn: Connection,
}

fn store() -> Store {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("todo.sqlite");
    let conn = connect(path.to_str().unwrap()).unwrap();
    init_schema(&conn).unwrap();
    Store {
        _dir: dir,
        path,
        conn,
    }
}

#[derive(Default)]
struct Row<'a> {
    id: &'a str,
    item_type: &'a str,
    status: &'a str,
    archived_at: Option<String>,
    updated_at: String,
    area_id: Option<&'a str>,
    project_id: Option<&'a str>,
    routine_id: Option<&'a str>,
    parent_id: Option<&'a str>,
    occurrence_key: Option<&'a str>,
    recurrence_rule: Option<&'a str>,
    generated: bool,
}

impl Store {
    fn insert(&self, row: Row<'_>) {
        let item_type = if row.item_type.is_empty() {
            "task"
        } else {
            row.item_type
        };
        let metadata = if row.generated {
            r#"{"generated_by":"routine"}"#
        } else {
            "{}"
        };
        self.conn
            .execute(
                "INSERT INTO items (id, type, title, status, area_id, project_id, routine_id,
                    parent_id, recurrence_rule, materialization_policy, future_occurrences,
                    occurrence_key, scheduled, proposed_by, archived_at, metadata,
                    created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'per_occurrence', 3, ?10, ?10,
                    'user', ?11, ?12, ?13, ?14)",
                params![
                    row.id,
                    item_type,
                    format!("synthetic {}", row.id),
                    row.status,
                    row.area_id,
                    row.project_id,
                    row.routine_id,
                    row.parent_id,
                    row.recurrence_rule,
                    row.occurrence_key,
                    row.archived_at,
                    metadata,
                    days_ago(400),
                    row.updated_at,
                ],
            )
            .unwrap();
    }

    fn archived(&self, id: &str, status: &str, days: i64) {
        self.insert(Row {
            id,
            status,
            archived_at: Some(days_ago(days)),
            updated_at: days_ago(days),
            ..Default::default()
        });
    }

    fn event(&self, id: &str, object_id: &str, action: &str) {
        self.conn
            .execute(
                "INSERT INTO events (id, at, actor, action, object_type, object_id, before, after, reason)
                 VALUES (?1, ?2, 'user', ?3, 'task', ?4, '{}', '{\"title\":\"x\"}', NULL)",
                params![id, days_ago(40), action, object_id],
            )
            .unwrap();
    }

    fn exists(&self, id: &str) -> bool {
        self.conn
            .query_row("SELECT COUNT(*) FROM items WHERE id = ?1", [id], |row| {
                row.get::<_, i64>(0)
            })
            .unwrap()
            == 1
    }

    fn plan(&self) -> RetentionPlan {
        retention::plan(&self.path, &window()).unwrap()
    }
}

fn candidate_ids(plan: &RetentionPlan) -> BTreeSet<String> {
    plan.candidates.iter().map(|c| c.id.clone()).collect()
}

fn ids(values: &[&str]) -> BTreeSet<String> {
    values.iter().map(|value| value.to_string()).collect()
}

#[test]
fn purges_items_past_the_window_and_keeps_recent_ones() {
    let store = store();
    store.archived("old", "archived", 31);
    store.archived("recent", "archived", 29);
    store.archived("old_cancelled", "cancelled", 31);

    let plan = store.plan();
    assert_eq!(candidate_ids(&plan), ids(&["old", "old_cancelled"]));
    let candidate = plan.candidates.iter().find(|c| c.id == "old").unwrap();
    assert_eq!(candidate.kind, "todo_item");
    assert_eq!(candidate.label, "synthetic old");
    assert_eq!(candidate.archived_at, NOW - Duration::days(31));

    let outcome = retention::apply(&store.path, &plan).unwrap();
    assert_eq!(outcome.purged.get("todo_item"), Some(&2));
    assert_eq!(outcome.media_cleanup_pending, 0);
    assert!(!store.exists("old"));
    assert!(!store.exists("old_cancelled"));
    assert!(store.exists("recent"));
}

#[test]
fn completed_missed_and_rejected_are_never_purged() {
    let store = store();
    for status in ["completed", "missed", "rejected", "active"] {
        store.archived(status, status, 400);
    }
    let plan = store.plan();
    assert!(plan.candidates.is_empty());
    assert!(plan.skipped.is_empty());
}

#[test]
fn archived_area_with_live_child_is_skipped_as_referenced() {
    let store = store();
    store.insert(Row {
        id: "area",
        item_type: "area",
        status: "archived",
        archived_at: Some(days_ago(60)),
        updated_at: days_ago(60),
        ..Default::default()
    });
    store.insert(Row {
        id: "done",
        status: "completed",
        updated_at: days_ago(60),
        area_id: Some("area"),
        ..Default::default()
    });

    let plan = store.plan();
    assert!(plan.candidates.is_empty());
    assert_eq!(plan.skipped.get("referenced"), Some(&1));
}

#[test]
fn archived_parent_and_child_are_purged_together() {
    let store = store();
    store.archived("parent", "archived", 45);
    store.insert(Row {
        id: "child",
        status: "dropped",
        archived_at: Some(days_ago(40)),
        updated_at: days_ago(40),
        parent_id: Some("parent"),
        ..Default::default()
    });
    // A grandchild that is not due keeps the whole chain alive.
    store.archived("other_parent", "archived", 45);
    store.insert(Row {
        id: "young_child",
        status: "archived",
        archived_at: Some(days_ago(5)),
        updated_at: days_ago(5),
        parent_id: Some("other_parent"),
        ..Default::default()
    });

    let plan = store.plan();
    assert_eq!(candidate_ids(&plan), ids(&["child", "parent"]));
    assert_eq!(plan.skipped.get("referenced"), Some(&1));

    let outcome = retention::apply(&store.path, &plan).unwrap();
    assert_eq!(outcome.purged.get("todo_item"), Some(&2));
    assert!(!store.exists("parent"));
    assert!(!store.exists("child"));
    assert!(store.exists("other_parent"));
}

#[test]
fn routine_anchor_and_future_occurrences_survive_and_materialization_does_not_duplicate() {
    let store = store();
    store.insert(Row {
        id: "routine",
        item_type: "routine",
        status: "active",
        updated_at: days_ago(100),
        recurrence_rule: Some("every 3 days"),
        ..Default::default()
    });
    for (id, key) in [
        ("anchor", "2026-09-01"),
        ("middle", "2026-09-04"),
        ("future", "2026-11-21"),
    ] {
        store.insert(Row {
            id,
            status: "archived",
            archived_at: Some(days_ago(60)),
            updated_at: days_ago(60),
            routine_id: Some("routine"),
            occurrence_key: Some(key),
            generated: true,
            ..Default::default()
        });
    }

    let plan = store.plan();
    assert_eq!(candidate_ids(&plan), ids(&["middle"]));
    assert_eq!(plan.skipped.get("routine_anchor"), Some(&1));
    assert_eq!(plan.skipped.get("future_occurrence"), Some(&1));
    retention::apply(&store.path, &plan).unwrap();

    let repository = SqliteTodoRepository::new(connect(store.path.to_str().unwrap()).unwrap());
    let mut service = TodoService::persistent(repository);
    service
        .materialize_routine("routine", "2026-11-19", None)
        .unwrap();
    let mut keys = store
        .conn
        .prepare(
            "SELECT occurrence_key FROM items WHERE routine_id = 'routine' ORDER BY occurrence_key",
        )
        .unwrap()
        .query_map([], |row| row.get::<_, String>(0))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    let unique = keys.iter().cloned().collect::<BTreeSet<_>>();
    assert_eq!(unique.len(), keys.len(), "no duplicate occurrence dates");
    keys.dedup();
    assert_eq!(
        keys,
        vec![
            "2026-09-01",
            "2026-11-21",
            "2026-11-24",
            "2026-11-27",
            "2026-11-30"
        ]
    );
}

#[test]
fn events_are_erased_and_exactly_one_tombstone_remains() {
    let store = store();
    store.archived("gone", "archived", 31);
    store.archived("kept", "archived", 1);
    store.event("evt_a", "gone", "propose_task");
    store.event("evt_b", "gone", "archive");
    store.event("evt_c", "kept", "propose_task");

    let plan = store.plan();
    retention::apply(&store.path, &plan).unwrap();

    let rows = store
        .conn
        .prepare("SELECT actor, action, object_type, before, after, reason FROM events WHERE object_id = 'gone'")
        .unwrap()
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, Option<String>>(5)?,
            ))
        })
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    assert_eq!(
        rows,
        vec![(
            "system".to_string(),
            "purge".to_string(),
            "task".to_string(),
            None,
            None,
            Some("retention".to_string()),
        )]
    );
    let kept_events: i64 = store
        .conn
        .query_row(
            "SELECT COUNT(*) FROM events WHERE object_id = 'kept'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(kept_events, 1);

    // Readers tolerate a tombstone whose item no longer exists.
    let mut repository = SqliteTodoRepository::new(connect(store.path.to_str().unwrap()).unwrap());
    let activity = repository.recent_activity(50).unwrap();
    assert!(activity.iter().all(|event| event.action != "purge"));
    assert_eq!(activity.len(), 1);
    let events = repository.list_events_for_item("gone").unwrap();
    assert_eq!(events.len(), 1);
    assert!(events[0].before.is_none() && events[0].after.is_none());
    assert_eq!(repository.item_history("gone", 0, 10).unwrap().len(), 1);
    let mut service = TodoService::persistent(repository);
    assert!(matches!(
        service.item_history("gone", 0, 10),
        Err(TodoError::NotFound(_))
    ));
    service.materialize_routines("2026-11-19").unwrap();
}

#[test]
fn legacy_dropped_item_without_archived_at_uses_updated_at() {
    let store = store();
    store.insert(Row {
        id: "legacy",
        status: "dropped",
        archived_at: None,
        updated_at: days_ago(31),
        ..Default::default()
    });
    store.insert(Row {
        id: "legacy_recent",
        status: "dropped",
        archived_at: None,
        updated_at: days_ago(29),
        ..Default::default()
    });
    // A later edit after archiving moves the clock forward.
    store.insert(Row {
        id: "edited",
        status: "archived",
        archived_at: Some(days_ago(90)),
        updated_at: days_ago(10),
        ..Default::default()
    });
    assert_eq!(candidate_ids(&store.plan()), ids(&["legacy"]));
}

#[test]
fn unparseable_timestamp_is_skipped() {
    let store = store();
    store.insert(Row {
        id: "bad_archived",
        status: "archived",
        archived_at: Some("last tuesday".to_string()),
        updated_at: days_ago(90),
        ..Default::default()
    });
    store.insert(Row {
        id: "bad_updated",
        status: "cancelled",
        archived_at: None,
        updated_at: "garbage".to_string(),
        ..Default::default()
    });
    let plan = store.plan();
    assert!(plan.candidates.is_empty());
    assert_eq!(plan.skipped.get("unparseable_timestamp"), Some(&2));
    let outcome = retention::apply(&store.path, &plan).unwrap();
    assert!(outcome.purged.is_empty());
    assert!(store.exists("bad_archived"));
}

#[test]
fn item_changed_after_planning_is_skipped() {
    let store = store();
    store.archived("restored", "archived", 31);
    store.archived("edited", "archived", 31);
    store.archived("deleted", "archived", 31);
    store.archived("stable", "archived", 31);
    store.archived("parent", "archived", 31);
    let plan = store.plan();
    assert_eq!(plan.candidates.len(), 5);

    store
        .conn
        .execute(
            "UPDATE items SET status = 'active' WHERE id = 'restored'",
            [],
        )
        .unwrap();
    store
        .conn
        .execute(
            "UPDATE items SET updated_at = ?1 WHERE id = 'edited'",
            [days_ago(5)],
        )
        .unwrap();
    store
        .conn
        .execute("DELETE FROM items WHERE id = 'deleted'", [])
        .unwrap();
    // A new live child now references a planned parent.
    store.insert(Row {
        id: "new_child",
        status: "active",
        updated_at: days_ago(0),
        parent_id: Some("parent"),
        ..Default::default()
    });

    let outcome = retention::apply(&store.path, &plan).unwrap();
    assert_eq!(outcome.purged.get("todo_item"), Some(&1));
    assert_eq!(outcome.skipped.get("changed_since_plan"), Some(&4));
    assert!(!store.exists("stable"));
    assert!(store.exists("restored"));
    assert!(store.exists("edited"));
    assert!(store.exists("parent"));
}

#[test]
fn large_purges_are_split_into_bounded_transactions() {
    let store = store();
    store.insert(Row {
        id: "project",
        item_type: "project",
        status: "archived",
        archived_at: Some(days_ago(50)),
        updated_at: days_ago(50),
        ..Default::default()
    });
    for index in 0..450 {
        let id = format!("task_{index:03}");
        store.insert(Row {
            id: &id,
            status: "dropped",
            archived_at: Some(days_ago(40)),
            updated_at: days_ago(40),
            project_id: Some("project"),
            ..Default::default()
        });
        store.event(&format!("evt_{index:03}"), &id, "drop");
    }
    let plan = store.plan();
    assert_eq!(plan.candidates.len(), 451);
    let outcome = retention::apply(&store.path, &plan).unwrap();
    assert_eq!(outcome.purged.get("todo_item"), Some(&451));
    let (items, tombstones): (i64, i64) = store
        .conn
        .query_row(
            "SELECT (SELECT COUNT(*) FROM items),
                    (SELECT COUNT(*) FROM events WHERE action = 'purge' AND reason = 'retention')",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!((items, tombstones), (0, 451));
}

#[test]
fn missing_or_uninitialized_store_yields_an_empty_plan_without_creating_it() {
    let dir = tempfile::tempdir().unwrap();
    let missing = dir.path().join("todo.sqlite");
    let plan = retention::plan(&missing, &window()).unwrap();
    assert!(plan.candidates.is_empty() && plan.skipped.is_empty());
    assert!(!missing.exists());
    let outcome = retention::apply(&missing, &plan).unwrap();
    assert!(outcome.purged.is_empty());
    assert!(!missing.exists());

    let blank = dir.path().join("blank.sqlite");
    Connection::open(&blank)
        .unwrap()
        .execute_batch("CREATE TABLE unrelated (x INTEGER);")
        .unwrap();
    let plan = retention::plan(&blank, &window()).unwrap();
    assert!(plan.candidates.is_empty());
    let conn = Connection::open(&blank).unwrap();
    let version: i64 = conn
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .unwrap();
    let has_items: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE name = 'items'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!((version, has_items), (0, 0));
    assert!(Path::new(&blank).exists());
}
