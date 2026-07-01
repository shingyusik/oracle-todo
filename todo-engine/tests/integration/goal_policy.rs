use todo_engine::application::error::TodoError;
use todo_engine::application::service::{ProposeGoal, ProposeProject, TodoService, UpdateItem};
use todo_engine::domain::{Actor, ItemStatus};

fn goal(actor: Actor, horizon: &str, scheduled: &str, parent_id: Option<&str>) -> ProposeGoal {
    ProposeGoal {
        title: format!("{horizon} goal {scheduled}"),
        horizon: horizon.to_string(),
        scheduled: scheduled.to_string(),
        parent_id: parent_id.map(ToString::to_string),
        actor,
        note: None,
    }
}

// SC1: actor drives status and every create writes a propose_goal audit event.
#[test]
fn agent_goal_is_proposed_user_goal_is_approved_and_audited() {
    let mut service = TodoService::in_memory();

    let agent_goal = service
        .propose_goal(goal(Actor::Agent, "year", "2026-01-01", None))
        .unwrap();
    assert_eq!(agent_goal.status, ItemStatus::Proposed);
    assert_eq!(service.events().last().unwrap().action, "propose_goal");

    let user_goal = service
        .propose_goal(goal(Actor::User, "month", "2026-06-01", None))
        .unwrap();
    assert_eq!(user_goal.status, ItemStatus::Approved);
    assert_eq!(service.events().last().unwrap().action, "propose_goal");
}

// SC2: anchor validation strict-rejects "today", unparseable, and non-canonical.
#[test]
fn goal_anchor_rejects_today_unparseable_and_non_canonical() {
    let mut service = TodoService::in_memory();

    let today = service
        .propose_goal(goal(Actor::User, "year", "today", None))
        .unwrap_err();
    assert!(matches!(today, TodoError::Validation(_)));

    let unparseable = service
        .propose_goal(goal(Actor::User, "month", "not-a-date", None))
        .unwrap_err();
    assert!(matches!(unparseable, TodoError::Validation(_)));

    // Year horizon requires Jan 1; Feb 1 is not the canonical period start.
    let non_canonical = service
        .propose_goal(goal(Actor::User, "year", "2026-02-01", None))
        .unwrap_err();
    assert!(matches!(non_canonical, TodoError::Validation(_)));

    // Empty anchor is also rejected.
    let empty = service
        .propose_goal(goal(Actor::User, "year", "   ", None))
        .unwrap_err();
    assert!(matches!(empty, TodoError::Validation(_)));
}

// SC3a: horizon inversion / equality and invalid parent updates are rejected with Policy.
#[test]
fn goal_nesting_rejects_horizon_inversion_and_parent_updates() {
    let mut service = TodoService::in_memory();

    // A week-goal parent cannot host a month-goal child (parent not strictly coarser).
    let week_parent = service
        .propose_goal(goal(Actor::User, "week", "2025-12-29", None))
        .unwrap();
    let inversion = service
        .propose_goal(goal(
            Actor::User,
            "month",
            "2026-06-01",
            Some(&week_parent.id),
        ))
        .unwrap_err();
    assert!(matches!(inversion, TodoError::Policy(_)));

    // Equal horizon parent is also rejected (strict coarser-than).
    let year_parent = service
        .propose_goal(goal(Actor::User, "year", "2026-01-01", None))
        .unwrap();
    let equal = service
        .propose_goal(goal(
            Actor::User,
            "year",
            "2027-01-01",
            Some(&year_parent.id),
        ))
        .unwrap_err();
    assert!(matches!(equal, TodoError::Policy(_)));

    // update_item uses the same nesting policy and rejects pointing A under B.
    let a = service
        .propose_goal(goal(Actor::User, "year", "2028-01-01", None))
        .unwrap();
    let b = service
        .propose_goal(goal(Actor::User, "month", "2028-06-01", Some(&a.id)))
        .unwrap();
    let invalid_parent_update = service
        .update_item(
            &a.id,
            UpdateItem {
                parent_id: Some(b.id.clone()),
                ..Default::default()
            },
        )
        .unwrap_err();
    assert!(matches!(invalid_parent_update, TodoError::Policy(_)));
}

// SC3b: a duplicate (horizon, canonical scheduled, parent_id) triple is rejected.
#[test]
fn goal_duplicate_triple_is_rejected() {
    let mut service = TodoService::in_memory();

    service
        .propose_goal(goal(Actor::User, "month", "2026-06-01", None))
        .unwrap();
    let duplicate = service
        .propose_goal(goal(Actor::User, "month", "2026-06-01", None))
        .unwrap_err();
    assert!(matches!(duplicate, TodoError::Policy(_)));
}

// SC4 (positive): linking a task to a goal via the audited update_item path sets
// parent_id + scheduled (LINK-01/LINK-02) and emits an `update_item` event (CORE-01).
#[test]
fn link_task_to_goal_sets_parent_and_scheduled_via_audited_path() {
    let mut service = TodoService::in_memory();

    let goal = service
        .propose_goal(goal(Actor::User, "month", "2026-06-01", None))
        .unwrap();
    let task = service
        .propose_task(
            "decomposed task",
            todo_engine::application::service::ProposeTask {
                actor: Actor::User,
                ..Default::default()
            },
        )
        .unwrap();

    let linked = service
        .update_item(
            &task.id,
            UpdateItem {
                parent_id: Some(goal.id.clone()),
                scheduled: Some("2026-06-08".to_string()),
                ..Default::default()
            },
        )
        .unwrap();

    assert_eq!(linked.parent_id.as_deref(), Some(goal.id.as_str()));
    assert_eq!(linked.scheduled.as_deref(), Some("2026-06-08"));
    assert_eq!(service.events().last().unwrap().action, "update_item");
}

// SC4 (negative, non-Goal parent): linking a task to a non-Goal item is rejected
// with Policy ("Goal parent must be goal: ..") via ensure_relation.
#[test]
fn link_task_to_non_goal_parent_is_rejected() {
    let mut service = TodoService::in_memory();

    let project = service
        .propose_project(ProposeProject {
            title: "a project".to_string(),
            area: None,
            definition_of_done: None,
            outcome: None,
            due: None,
            actor: Actor::User,
            note: None,
        })
        .unwrap();
    let task = service
        .propose_task(
            "task",
            todo_engine::application::service::ProposeTask {
                actor: Actor::User,
                ..Default::default()
            },
        )
        .unwrap();

    let error = service
        .update_item(
            &task.id,
            UpdateItem {
                parent_id: Some(project.id.clone()),
                ..Default::default()
            },
        )
        .unwrap_err();

    match error {
        TodoError::Policy(message) => assert!(
            message.contains("Goal parent must be goal"),
            "unexpected policy message: {message}"
        ),
        other => panic!("expected Policy error, got {other:?}"),
    }
}

// SC4 (negative, terminal parent): linking a task to a terminal goal is rejected
// with Policy ("Goal parent is terminal: ..") via ensure_relation.
#[test]
fn link_task_to_terminal_goal_parent_is_rejected() {
    let mut service = TodoService::in_memory();

    let goal = service
        .propose_goal(goal(Actor::User, "month", "2026-06-01", None))
        .unwrap();
    // Drive the goal to a terminal status before attempting the link.
    let dropped = service.drop(&goal.id, Some("no longer pursued")).unwrap();
    assert_eq!(dropped.status, ItemStatus::Dropped);

    let task = service
        .propose_task(
            "task",
            todo_engine::application::service::ProposeTask {
                actor: Actor::User,
                ..Default::default()
            },
        )
        .unwrap();

    let error = service
        .update_item(
            &task.id,
            UpdateItem {
                parent_id: Some(goal.id.clone()),
                ..Default::default()
            },
        )
        .unwrap_err();

    match error {
        TodoError::Policy(message) => assert!(
            message.contains("terminal"),
            "unexpected policy message: {message}"
        ),
        other => panic!("expected Policy error, got {other:?}"),
    }
}
