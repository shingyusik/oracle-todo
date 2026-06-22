use todo_engine::application::error::TodoError;
use todo_engine::application::service::{ProposeGoal, TodoService, UpdateItem};
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

// SC3a: horizon inversion / equality and parent cycles are rejected with Policy.
#[test]
fn goal_nesting_rejects_horizon_inversion_and_cycle() {
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

    // Manufacture a cycle: month-goal B parents to year-goal A, then point A->B.
    let a = service
        .propose_goal(goal(Actor::User, "year", "2028-01-01", None))
        .unwrap();
    let b = service
        .propose_goal(goal(Actor::User, "month", "2028-06-01", Some(&a.id)))
        .unwrap();
    // update_item validates parent is a non-terminal Goal but not the nesting
    // chain, so it can introduce the cyclic A->B->A edge for this guard test.
    service
        .update_item(
            &a.id,
            UpdateItem {
                parent_id: Some(b.id.clone()),
                ..Default::default()
            },
        )
        .unwrap();
    // 2024-01-01 is a Monday (canonical week start).
    let cycle = service
        .propose_goal(goal(Actor::User, "week", "2024-01-01", Some(&b.id)))
        .unwrap_err();
    assert!(matches!(cycle, TodoError::Policy(_)));
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
