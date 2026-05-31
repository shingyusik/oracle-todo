use oracle_todo::domain::{Actor, ItemStatus, ItemType, TodoItem};

#[test]
fn oracle_task_starts_proposed() {
    let item = TodoItem::new_task("앱 열고 DB 확인", Actor::Oracle);

    assert_eq!(item.item_type, ItemType::Task);
    assert_eq!(item.status, ItemStatus::Proposed);
    assert_eq!(item.proposed_by, Actor::Oracle);
}

#[test]
fn user_task_starts_approved() {
    let item = TodoItem::new_task("직접 입력한 일", Actor::User);

    assert_eq!(item.status, ItemStatus::Approved);
    assert_eq!(item.approved_by, Some(Actor::User));
    assert!(item.approved_at.is_some());
}
