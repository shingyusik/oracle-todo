use oracle_todo::application::error::TodoError;
use oracle_todo::application::service::{CreateArea, ProposeProject, ProposeTask, TodoService};
use oracle_todo::domain::{Actor, ItemStatus, ItemType, TodoItem, terminal_status};
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

#[test]
fn oracle_task_requires_approval_before_activation() {
    let mut service = TodoService::in_memory();
    let item = service
        .propose_task("앱 열고 DB 확인", Default::default())
        .unwrap();

    assert_eq!(item.status, ItemStatus::Proposed);

    let error = service.activate(&item.id, None).unwrap_err();
    assert_eq!(
        error,
        TodoError::Policy("Agent-created items must be approved before activation".to_string())
    );

    let approved = service.approve(&item.id, None).unwrap();
    let active = service.activate(&approved.id, None).unwrap();
    assert_eq!(active.status, ItemStatus::Active);
}

#[test]
fn area_creation_is_active_and_cannot_complete() {
    let mut service = TodoService::in_memory();
    let area = service
        .create_area(CreateArea {
            title: "재정".to_string(),
            review_cycle: Some("weekly".to_string()),
            standard: None,
        })
        .unwrap();

    assert_eq!(area.item_type, ItemType::Area);
    assert_eq!(area.status, ItemStatus::Active);
    assert!(!terminal_status(area.status));

    let error = service.complete(&area.id, None).unwrap_err();
    assert_eq!(
        error,
        TodoError::Policy("Areas cannot be completed; pause or archive them".to_string())
    );
}

#[test]
fn project_requires_definition_of_done_before_activation() {
    let mut service = TodoService::in_memory();
    let project = service
        .propose_project(ProposeProject {
            title: "가계부 자동화 안정화".to_string(),
            area: None,
            definition_of_done: None,
            outcome: None,
            due: None,
            actor: Actor::User,
        })
        .unwrap();

    let error = service.activate(&project.id, None).unwrap_err();
    assert_eq!(
        error,
        TodoError::Policy("Project requires definition_of_done before activation".to_string())
    );
}

#[test]
fn completing_terminal_item_is_rejected() {
    let mut service = TodoService::in_memory();
    let item = service
        .propose_task(
            "완료",
            ProposeTask {
                actor: Actor::User,
                ..Default::default()
            },
        )
        .unwrap();

    service.complete(&item.id, None).unwrap();
    let error = service.complete(&item.id, None).unwrap_err();

    assert_eq!(
        error,
        TodoError::Policy("Already terminal: completed".to_string())
    );
}

#[test]
fn every_mutation_records_event() {
    let mut service = TodoService::in_memory();
    service
        .create_area(CreateArea {
            title: "재정".to_string(),
            review_cycle: None,
            standard: None,
        })
        .unwrap();
    service
        .propose_project(ProposeProject {
            title: "프로젝트".to_string(),
            area: None,
            definition_of_done: Some("완료 조건".to_string()),
            outcome: None,
            due: None,
            actor: Actor::User,
        })
        .unwrap();
    let item = service.propose_task("테스트", Default::default()).unwrap();
    let approved = service.approve(&item.id, None).unwrap();
    let active = service.activate(&approved.id, None).unwrap();
    service.complete(&active.id, None).unwrap();

    let actions: Vec<String> = service
        .events()
        .iter()
        .map(|event| event.action.clone())
        .collect();

    assert_eq!(
        actions,
        vec![
            "create_area".to_string(),
            "propose_project".to_string(),
            "propose_task".to_string(),
            "approve".to_string(),
            "activate".to_string(),
            "complete".to_string(),
        ]
    );
}
