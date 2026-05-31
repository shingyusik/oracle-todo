use oracle_todo::domain::{Actor, ItemStatus, ItemType, TodoItem};
use time::macros::datetime;

#[test]
fn oracle_task_starts_proposed() {
    let now = datetime!(2026-05-31 12:00 UTC);
    let item = TodoItem::new_task("task_fixed", "앱 열고 DB 확인", Actor::Oracle, now);

    assert_eq!(item.id, "task_fixed");
    assert_eq!(item.item_type, ItemType::Task);
    assert_eq!(item.status, ItemStatus::Proposed);
    assert_eq!(item.proposed_by, Actor::Oracle);
    assert_eq!(item.created_at, now);
    assert_eq!(item.updated_at, now);
}

#[test]
fn user_task_starts_approved() {
    let now = datetime!(2026-05-31 12:00 UTC);
    let item = TodoItem::new_task("task_user", "직접 입력한 일", Actor::User, now);

    assert_eq!(item.status, ItemStatus::Approved);
    assert_eq!(item.approved_by, Some(Actor::User));
    assert_eq!(item.approved_at, Some(now));
}
