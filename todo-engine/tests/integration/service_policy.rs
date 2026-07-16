use todo_engine::application::error::TodoError;
use todo_engine::application::service::{
    CreateArea, ProposeEvent, ProposeProject, ProposeRoutine, ProposeTask, TodoService,
};
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
            tags: Vec::new(),
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
fn agent_task_is_active_on_creation() {
    let mut service = TodoService::in_memory();
    let item = service
        .propose_task("앱 열고 DB 확인", Default::default())
        .unwrap();

    assert_eq!(item.status, ItemStatus::Active);
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
            tags: Vec::new(),
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
fn project_creation_requires_definition_of_done() {
    for definition_of_done in [None, Some("   ".to_string())] {
        let error = TodoService::in_memory()
            .propose_project(ProposeProject {
                title: "Project".to_string(),
                definition_of_done,
                ..Default::default()
            })
            .unwrap_err();

        assert_eq!(error.to_string(), "Project requires definition_of_done");
    }
}

#[test]
fn project_creation_trims_definition_and_is_active_for_every_actor() {
    for actor in [Actor::User, Actor::Agent] {
        let project = TodoService::in_memory()
            .propose_project(ProposeProject {
                title: "Project".to_string(),
                definition_of_done: Some("  Ship when tests pass  ".to_string()),
                actor,
                ..Default::default()
            })
            .unwrap();

        assert_eq!(
            project.definition_of_done.as_deref(),
            Some("Ship when tests pass")
        );
        assert_eq!(project.status, ItemStatus::Active);
    }
}

#[test]
fn routine_creation_requires_recurrence_rule() {
    for recurrence_rule in [None, Some("   ".to_string())] {
        let error = TodoService::in_memory()
            .propose_routine(ProposeRoutine {
                title: "Routine".to_string(),
                recurrence_rule,
                ..Default::default()
            })
            .unwrap_err();

        assert_eq!(error.to_string(), "Routine requires recurrence_rule");
    }
}

#[test]
fn routine_creation_trims_rule_and_is_active_for_every_actor() {
    for actor in [Actor::User, Actor::Agent] {
        let routine = TodoService::in_memory()
            .propose_routine(ProposeRoutine {
                title: "Routine".to_string(),
                recurrence_rule: Some("  RRULE:FREQ=DAILY  ".to_string()),
                actor,
                ..Default::default()
            })
            .unwrap();

        assert_eq!(routine.recurrence_rule.as_deref(), Some("RRULE:FREQ=DAILY"));
        assert_eq!(routine.status, ItemStatus::Active);
    }
}

#[test]
fn generated_routine_task_is_active_and_returns_to_active_after_resume() {
    let mut service = TodoService::in_memory();
    let routine = service
        .propose_routine(ProposeRoutine {
            title: "Daily review".to_string(),
            recurrence_rule: Some("daily".to_string()),
            actor: Actor::User,
            ..Default::default()
        })
        .unwrap();
    let task = service
        .materialize_routine(&routine.id, "2026-05-31", None)
        .unwrap()
        .remove(0);

    assert_eq!(task.status, ItemStatus::Active);
    service.pause(&routine.id, None).unwrap();
    assert_eq!(service.get(&task.id).unwrap().status, ItemStatus::Waiting);
    service.resume(&routine.id, None).unwrap();
    assert_eq!(service.get(&task.id).unwrap().status, ItemStatus::Active);
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
fn completed_task_can_be_reopened() {
    let mut service = TodoService::in_memory();
    let task = service
        .propose_task(
            "다시 할 일",
            ProposeTask {
                actor: Actor::User,
                ..Default::default()
            },
        )
        .unwrap();
    let completed = service.complete(&task.id, None).unwrap();
    assert!(completed.completed_at.is_some());

    let reopened = service.reopen(&task.id, Some("체크 해제")).unwrap();

    assert_eq!(reopened.status, ItemStatus::Active);
    assert!(reopened.completed_at.is_none());
    assert!(reopened.updated_at > completed.updated_at);
    assert_eq!(service.events().last().unwrap().action, "reopen");
    assert_eq!(
        service.events().last().unwrap().reason.as_deref(),
        Some("체크 해제")
    );
}

#[test]
fn completed_event_can_be_reopened() {
    let mut service = TodoService::in_memory();
    let event = service
        .propose_event(ProposeEvent {
            title: "다시 여는 일정".to_string(),
            actor: Actor::User,
            scheduled: Some("2026-07-14T10:00:00".to_string()),
            ..Default::default()
        })
        .unwrap();
    let completed = service.complete(&event.id, None).unwrap();

    let reopened = service.reopen(&event.id, Some("체크 해제")).unwrap();

    assert_eq!(reopened.item_type, ItemType::Event);
    assert_eq!(reopened.status, ItemStatus::Active);
    assert!(reopened.completed_at.is_none());
    assert!(reopened.updated_at > completed.updated_at);
    assert_eq!(service.events().last().unwrap().action, "reopen");
    assert_eq!(
        service.events().last().unwrap().reason.as_deref(),
        Some("체크 해제")
    );
}

#[test]
fn reopen_rejects_non_completed_task() {
    let mut service = TodoService::in_memory();
    let task = service
        .propose_task(
            "진행 중",
            ProposeTask {
                actor: Actor::User,
                ..Default::default()
            },
        )
        .unwrap();

    let error = service.reopen(&task.id, None).unwrap_err();

    assert_eq!(
        error,
        TodoError::Policy("Cannot reopen task in status active".to_string())
    );
}

#[test]
fn reopen_rejects_non_completed_event() {
    let mut service = TodoService::in_memory();
    let event = service
        .propose_event(ProposeEvent {
            title: "진행 중 일정".to_string(),
            actor: Actor::User,
            scheduled: Some("2026-07-14T10:00:00".to_string()),
            ..Default::default()
        })
        .unwrap();

    let error = service.reopen(&event.id, None).unwrap_err();

    assert_eq!(
        error,
        TodoError::Policy("Cannot reopen event in status active".to_string())
    );
}

#[test]
fn reopen_rejects_completed_unsupported_item() {
    let mut service = TodoService::in_memory();
    let project = service
        .propose_project(ProposeProject {
            title: "완료된 프로젝트".to_string(),
            area: None,
            definition_of_done: Some("Done when verified".to_owned()),
            outcome: None,
            due: None,
            actor: Actor::User,
            note: None,
            tags: Vec::new(),
        })
        .unwrap();
    service.complete(&project.id, None).unwrap();

    let error = service.reopen(&project.id, None).unwrap_err();

    assert_eq!(
        error,
        TodoError::Policy("Only completed tasks and events can be reopened".to_string())
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
fn update_item_empty_relation_clears_project() {
    let mut service = TodoService::in_memory();
    let project = service
        .propose_project(ProposeProject {
            title: "정리".to_string(),
            area: None,
            definition_of_done: Some("완료".to_string()),
            outcome: None,
            due: None,
            actor: Actor::User,
            note: None,
            tags: Vec::new(),
        })
        .unwrap();
    let task = service
        .propose_task(
            "검증",
            ProposeTask {
                actor: Actor::User,
                project_id: Some(project.id),
                ..Default::default()
            },
        )
        .unwrap();

    let updated = service
        .update_item(
            &task.id,
            todo_engine::application::service::UpdateItem {
                project_id: Some(String::new()),
                ..Default::default()
            },
        )
        .unwrap();

    assert_eq!(updated.project_id, None);
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
            tags: Vec::new(),
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
            tags: Vec::new(),
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
