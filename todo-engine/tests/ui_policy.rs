use todo_engine::application::service::{
    CreateArea, ProposeRoutine, ProposeTask, TodoService, UpdateItem,
};

#[test]
fn task_mutations_reject_fields_and_lifecycle_outside_ui_policy_without_writes() {
    let mut service = TodoService::in_memory();
    let task = service
        .propose_task("task", ProposeTask::default())
        .unwrap();
    let before = service.events().len();
    for patch in [
        UpdateItem {
            outcome: Some("unsupported".into()),
            ..Default::default()
        },
        UpdateItem {
            priority: Some(11),
            ..Default::default()
        },
        UpdateItem {
            scheduled: Some("invalid".into()),
            ..Default::default()
        },
        UpdateItem {
            description: Some("use note".into()),
            ..Default::default()
        },
        UpdateItem {
            routine_id: Some("manual".into()),
            ..Default::default()
        },
    ] {
        assert!(service.update_item(&task.id, patch).is_err());
        assert_eq!(service.get(&task.id).unwrap(), task);
        assert_eq!(service.events().len(), before);
    }
    assert!(service.pause(&task.id, None).is_err());
}

#[test]
fn creation_and_recurrence_changes_share_supported_policy() {
    let mut service = TodoService::in_memory();
    assert!(
        service
            .create_area(CreateArea {
                title: "area".into(),
                review_cycle: Some("sometimes".into()),
                ..Default::default()
            })
            .is_err()
    );
    assert!(
        service
            .propose_task(
                "task",
                ProposeTask {
                    routine_id: Some("manual".into()),
                    ..Default::default()
                }
            )
            .is_err()
    );
    for rule in [
        "RRULE:FREQ=MONTHLY;BYMONTHDAY=1,15",
        "RRULE:FREQ=DAILY;INTERVAL=366",
        "RRULE:FREQ=DAILY;BYDAY=MO",
        "RRULE:FREQ=WEEKLY;BYMONTHDAY=1",
        "RRULE:FREQ=MONTHLY;BYMONTH=2",
        "RRULE:FREQ=YEARLY;BYDAY=MO",
    ] {
        assert!(
            service
                .propose_routine(ProposeRoutine {
                    title: "routine".into(),
                    recurrence_rule: Some(rule.into()),
                    ..Default::default()
                })
                .is_err()
        );
    }
    let routine = service
        .propose_routine(ProposeRoutine {
            title: "routine".into(),
            recurrence_rule: Some("RRULE:FREQ=DAILY".into()),
            ..Default::default()
        })
        .unwrap();
    assert!(
        service
            .update_item(
                &routine.id,
                UpdateItem {
                    recurrence_rule: Some("invalid".into()),
                    ..Default::default()
                }
            )
            .is_err()
    );
    assert!(
        service
            .update_item(
                &routine.id,
                UpdateItem {
                    future_occurrences: Some(3),
                    ..Default::default()
                }
            )
            .is_err()
    );
}

#[test]
fn note_updates_preserve_legacy_description_and_metadata_and_audit_reason() {
    use todo_engine::application::ports::TodoRepository;
    use todo_engine::infrastructure::sqlite::{SqliteTodoRepository, connect, init_schema};
    let conn = connect(":memory:").unwrap();
    init_schema(&conn).unwrap();
    let mut legacy = TodoService::in_memory()
        .propose_task("legacy", ProposeTask::default())
        .unwrap();
    legacy.description = Some("historical description".into());
    legacy
        .metadata
        .insert("custom".into(), serde_json::json!("preserved"));
    let mut repository = SqliteTodoRepository::new(conn);
    repository.save_item(&legacy).unwrap();
    let mut service = TodoService::persistent(repository);
    let updated = service
        .update_item(
            &legacy.id,
            UpdateItem {
                note: Some("new note".into()),
                reason: Some("explanation".into()),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(updated.description, legacy.description);
    assert_eq!(updated.metadata["custom"], "preserved");
    assert_eq!(
        service.item_history(&legacy.id, 0, 1).unwrap().0[0]
            .reason
            .as_deref(),
        Some("explanation")
    );
    assert_eq!(
        service.events().last().unwrap().reason.as_deref(),
        Some("explanation")
    );
}
