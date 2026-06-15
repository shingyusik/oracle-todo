use oracle_todo::application::error::TodoError;
use oracle_todo::application::service::{CreateArea, ProposeProject, ProposeTask, TodoService};
use oracle_todo::domain::{Actor, ItemStatus, ItemType, TodoItem, terminal_status};
use std::str::FromStr;
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
fn actor_strings_round_trip_through_domain_parser() {
    assert_eq!(Actor::from_str("oracle").unwrap(), Actor::Oracle);
    assert_eq!(Actor::from_str("user").unwrap(), Actor::User);
    assert_eq!(Actor::from_str("system").unwrap(), Actor::System);
    assert!(Actor::from_str("robot").is_err());
}

#[test]
fn domain_enums_require_canonical_lowercase_names() {
    assert_eq!(ItemType::from_str("area").unwrap(), ItemType::Area);
    assert_eq!(
        ItemType::from_str("archive_item").unwrap(),
        ItemType::ArchiveItem
    );
    assert_eq!(ItemStatus::from_str("active").unwrap(), ItemStatus::Active);
    assert_eq!(
        ItemStatus::from_str("proposed").unwrap(),
        ItemStatus::Proposed
    );
    assert_eq!(Actor::from_str("oracle").unwrap(), Actor::Oracle);
    assert_eq!(Actor::from_str("system").unwrap(), Actor::System);
    assert!(ItemType::from_str("AREA").is_err());
    assert!(ItemStatus::from_str("ACTIVE").is_err());
    assert!(Actor::from_str("ORACLE").is_err());
}

#[test]
fn json_timestamps_are_rfc3339_strings() {
    let now = datetime!(2026-05-31 12:00 UTC);
    let item = TodoItem::new_task("task_json", "JSON 확인", Actor::User, now);

    let value = serde_json::to_value(item).unwrap();

    assert_eq!(value["created_at"], "2026-05-31T12:00:00Z");
    assert_eq!(value["updated_at"], "2026-05-31T12:00:00Z");
    assert_eq!(value["approved_at"], "2026-05-31T12:00:00Z");
}

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
fn every_mutation_records_event() {
    let mut service = TodoService::in_memory();
    service
        .create_area(CreateArea {
            title: "재정".to_string(),
            review_cycle: None,
            standard: None,
            note: None,
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
            note: None,
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

#[test]
fn update_item_changes_core_fields_and_records_event() {
    let mut service = TodoService::in_memory();
    let item = service.propose_task("옛 제목", Default::default()).unwrap();

    let updated = service
        .update_item(
            &item.id,
            oracle_todo::application::service::UpdateItem {
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
            oracle_todo::application::service::UpdateItem {
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
            oracle_todo::application::service::UpdateItem {
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
        .list_items(oracle_todo::application::ports::ListFilter {
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
            oracle_todo::application::service::UpdateItem {
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
