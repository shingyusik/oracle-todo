use time::OffsetDateTime;
use time::macros::datetime;
use todo_engine::domain::{Actor, ItemStatus, ItemType, TodoItem};

const NOW: OffsetDateTime = datetime!(2026 - 05 - 31 12:00 UTC);

#[test]
fn user_item_is_auto_approved() {
    let item = TodoItem::new("t1", ItemType::Task, "X", Actor::User, NOW);
    assert_eq!(item.status, ItemStatus::Approved);
    assert_eq!(item.approved_by, Some(Actor::User));
    assert_eq!(item.approved_at, Some(NOW));
}

#[test]
fn agent_item_starts_proposed() {
    let item = TodoItem::new("t1", ItemType::Task, "X", Actor::Agent, NOW);
    assert_eq!(item.status, ItemStatus::Proposed);
    assert_eq!(item.approved_by, None);
    assert_eq!(item.approved_at, None);
    assert_eq!(item.proposed_by, Actor::Agent);
}

#[test]
fn defaults_are_sane() {
    let item = TodoItem::new("t1", ItemType::Task, "X", Actor::User, NOW);
    assert_eq!(item.materialization_policy, "single_open");
    assert!(item.metadata.is_empty());
    assert!(item.second_brain_refs.is_empty());
    assert_eq!(item.created_at, NOW);
    assert_eq!(item.updated_at, NOW);
}

#[test]
fn new_task_is_a_task() {
    assert_eq!(
        TodoItem::new_task("t1", "X", Actor::User, NOW).item_type,
        ItemType::Task
    );
    assert_eq!(
        TodoItem::new_task("t1", "X", Actor::Agent, NOW).status,
        ItemStatus::Proposed
    );
}

#[test]
fn item_type_round_trips_every_variant() {
    for t in [
        ItemType::Area,
        ItemType::Project,
        ItemType::Routine,
        ItemType::Task,
        ItemType::Event,
        ItemType::Review,
        ItemType::ArchiveItem,
        ItemType::Goal,
    ] {
        assert_eq!(t.as_str().parse::<ItemType>().unwrap(), t);
    }
    assert!("folder".parse::<ItemType>().is_err());
}

#[test]
fn actor_round_trips_every_variant() {
    for a in [Actor::User, Actor::Agent, Actor::System] {
        assert_eq!(a.as_str().parse::<Actor>().unwrap(), a);
    }
    assert!("robot".parse::<Actor>().is_err());
}

#[test]
fn timestamps_serialize_as_rfc3339() {
    let item = TodoItem::new_task("t1", "X", Actor::User, NOW);
    let json = serde_json::to_value(&item).unwrap();
    assert_eq!(json["created_at"], "2026-05-31T12:00:00Z");
    assert_eq!(json["updated_at"], "2026-05-31T12:00:00Z");
    assert_eq!(json["approved_at"], "2026-05-31T12:00:00Z");
}
