use todo_engine::application::error::TodoError;
use todo_engine::application::service::{CreateArea, ProposeProject, ProposeTask, TodoService};
use todo_engine::domain::{Actor, ItemStatus, ItemType, terminal_status};

#[test]
fn area_titles_resolve_in_service() {
    let mut service = TodoService::in_memory();
    let area = service
        .create_area(CreateArea {
            title: "재정".to_string(),
            review_cycle: None,
            standard: None,
            note: None,
        })
        .unwrap();

    let task = service
        .propose_task(
            "DB 확인",
            ProposeTask {
                actor: Actor::User,
                area: Some("재정".to_string()),
                ..Default::default()
            },
        )
        .unwrap();

    assert_eq!(task.area_id.as_deref(), Some(area.id.as_str()));
}

#[test]
fn agent_task_requires_approval_before_activation() {
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
            note: None,
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
            note: None,
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
fn update_item_changes_core_fields_and_records_event() {
    let mut service = TodoService::in_memory();
    let item = service.propose_task("옛 제목", Default::default()).unwrap();

    let updated = service
        .update_item(
            &item.id,
            todo_engine::application::service::UpdateItem {
                title: Some("새 제목".to_string()),
                description: Some("설명".to_string()),
                due: Some("2026-05-31".to_string()),
                scheduled: Some("today".to_string()),
                priority: Some(3),
                reason: Some("정리".to_string()),
                ..Default::default()
            },
        )
        .unwrap();

    assert_eq!(updated.title, "새 제목");
    assert_eq!(updated.description.as_deref(), Some("설명"));
    assert_eq!(updated.due.as_deref(), Some("2026-05-31"));
    assert_eq!(updated.scheduled.as_deref(), Some("today"));
    assert_eq!(updated.priority, Some(3));
    assert_eq!(service.events().last().unwrap().action, "update_item");
}

#[test]
fn update_rejects_terminal_items_and_invalid_materialization_policy() {
    let mut service = TodoService::in_memory();
    let item = service.propose_task("완료", Default::default()).unwrap();
    service.complete(&item.id, None).unwrap();

    let error = service
        .update_item(
            &item.id,
            todo_engine::application::service::UpdateItem {
                title: Some("수정".to_string()),
                ..Default::default()
            },
        )
        .unwrap_err();

    assert_eq!(
        error,
        TodoError::Policy("Cannot update terminal item: completed".to_string())
    );

    let item = service.propose_task("정책", Default::default()).unwrap();
    let error = service
        .update_item(
            &item.id,
            todo_engine::application::service::UpdateItem {
                materialization_policy: Some("many".to_string()),
                ..Default::default()
            },
        )
        .unwrap_err();

    assert_eq!(
        error,
        TodoError::Policy("Unsupported materialization_policy: many".to_string())
    );
}

#[test]
fn list_items_status_filter_can_show_terminal_items() {
    let mut service = TodoService::in_memory();
    let item = service.propose_task("보관", Default::default()).unwrap();
    service.archive(&item.id, None).unwrap();

    let archived = service
        .list_items(todo_engine::application::ports::ListFilter {
            status: Some(ItemStatus::Archived),
            ..Default::default()
        })
        .unwrap();

    assert_eq!(
        archived
            .iter()
            .map(|item| item.id.as_str())
            .collect::<Vec<_>>(),
        vec![item.id]
    );
}

#[test]
fn relationships_must_reference_expected_item_types() {
    let mut service = TodoService::in_memory();
    let area = service
        .create_area(CreateArea {
            title: "재정".to_string(),
            review_cycle: None,
            standard: None,
            note: None,
        })
        .unwrap();
    let project = service
        .propose_project(ProposeProject {
            title: "정리".to_string(),
            area: None,
            definition_of_done: Some("완료".to_string()),
            outcome: None,
            due: None,
            actor: Actor::User,
            note: None,
        })
        .unwrap();
    let task = service.propose_task("검증", Default::default()).unwrap();

    let error = service
        .propose_task(
            "잘못된 프로젝트",
            ProposeTask {
                project_id: Some(area.id.clone()),
                ..Default::default()
            },
        )
        .unwrap_err();
    assert_eq!(
        error,
        TodoError::Policy(format!("Project must be project: {}", area.id))
    );

    let error = service
        .update_item(
            &task.id,
            todo_engine::application::service::UpdateItem {
                routine_id: Some(project.id.clone()),
                ..Default::default()
            },
        )
        .unwrap_err();
    assert_eq!(
        error,
        TodoError::Policy(format!("Routine must be routine: {}", project.id))
    );
}
