use time::macros::date;
use todo_engine::application::error::TodoError;
use todo_engine::application::ports::ListFilter;
use todo_engine::application::service::{ProposeRoutine, ProposeTask, TodoService};
use todo_engine::domain::{Actor, ItemStatus, ItemType, RecurrenceError, occurrences};
use todo_engine::infrastructure::sqlite::{SqliteTodoRepository, connect, init_schema};

fn occurrence_keys(items: &[todo_engine::domain::TodoItem]) -> Vec<String> {
    items
        .iter()
        .map(|item| item.occurrence_key.clone().unwrap())
        .collect()
}

#[test]
fn per_occurrence_materialization_creates_bounded_unique_tasks() {
    let mut service = TodoService::in_memory();
    let routine = service
        .propose_routine(ProposeRoutine {
            title: "혈압 기록".to_string(),
            actor: Actor::User,
            recurrence_rule: Some("daily".to_string()),
            materialization_policy: "per_occurrence".to_string(),
            area: None,
            note: None,
            tags: Vec::new(),
        })
        .unwrap();
    service.activate(&routine.id, None).unwrap();

    let created = service.materialize_routines("2026-05-26", 2, 1).unwrap();
    let repeated = service.materialize_routines("2026-05-26", 2, 1).unwrap();

    assert!(repeated.is_empty());
    assert_eq!(
        occurrence_keys(&created),
        vec!["2026-05-25", "2026-05-26", "2026-05-27", "2026-05-28"]
    );
    assert_eq!(
        created
            .iter()
            .map(|task| task.scheduled.as_deref())
            .collect::<Vec<_>>(),
        vec![
            Some("2026-05-25"),
            Some("2026-05-26"),
            Some("2026-05-27"),
            Some("2026-05-28")
        ]
    );
    assert!(created.iter().all(|task| task.item_type == ItemType::Task));
    assert!(
        created
            .iter()
            .all(|task| task.status == ItemStatus::Approved)
    );
    assert!(created.iter().all(|task| task.proposed_by == Actor::System));
    assert!(
        created
            .iter()
            .all(|task| task.approved_by == Some(Actor::User))
    );
    assert!(
        created
            .iter()
            .all(|task| task.routine_id.as_deref() == Some(routine.id.as_str()))
    );
    assert!(created.iter().all(|task| {
        task.metadata
            .get("generated_by")
            .and_then(|value| value.as_str())
            == Some("routine")
    }));
}

#[test]
fn materialize_routine_targets_only_the_named_routine() {
    let mut service = TodoService::in_memory();
    let target = service
        .propose_routine(ProposeRoutine {
            title: "이불정리".to_string(),
            actor: Actor::User,
            recurrence_rule: Some("daily".to_string()),
            materialization_policy: "per_occurrence".to_string(),
            area: None,
            note: None,
            tags: Vec::new(),
        })
        .unwrap();
    service.activate(&target.id, None).unwrap();
    let bystander = service
        .propose_routine(ProposeRoutine {
            title: "혈압 기록".to_string(),
            actor: Actor::User,
            recurrence_rule: Some("daily".to_string()),
            materialization_policy: "per_occurrence".to_string(),
            area: None,
            note: None,
            tags: Vec::new(),
        })
        .unwrap();
    service.activate(&bystander.id, None).unwrap();

    let created = service
        .materialize_routine(&target.id, "2026-05-26", 2, 1)
        .unwrap();

    assert_eq!(
        occurrence_keys(&created),
        vec!["2026-05-25", "2026-05-26", "2026-05-27", "2026-05-28"]
    );
    assert!(
        created
            .iter()
            .all(|task| task.routine_id.as_deref() == Some(target.id.as_str()))
    );
    assert!(
        service
            .list_items(ListFilter {
                item_type: Some(ItemType::Task),
                routine_id: Some(bystander.id.clone()),
                ..Default::default()
            })
            .unwrap()
            .is_empty()
    );
    assert!(
        service
            .get(&bystander.id)
            .unwrap()
            .last_materialized_at
            .is_none()
    );

    let repeated = service
        .materialize_routine(&target.id, "2026-05-26", 2, 1)
        .unwrap();

    assert!(repeated.is_empty());
}

#[test]
fn materialize_routine_reports_routines_it_cannot_materialize() {
    let mut service = TodoService::in_memory();

    assert_eq!(
        service
            .materialize_routine("rtn_missing", "2026-05-26", 7, 1)
            .unwrap_err(),
        TodoError::NotFound("rtn_missing".to_string())
    );

    let task = service
        .propose_task("루틴 아님", ProposeTask::default())
        .unwrap();
    assert_eq!(
        service
            .materialize_routine(&task.id, "2026-05-26", 7, 1)
            .unwrap_err(),
        TodoError::Policy(format!("Routine must be routine: {}", task.id))
    );

    let routine = service
        .propose_routine(ProposeRoutine {
            title: "이불정리".to_string(),
            actor: Actor::User,
            recurrence_rule: Some("daily".to_string()),
            materialization_policy: "per_occurrence".to_string(),
            area: None,
            note: None,
            tags: Vec::new(),
        })
        .unwrap();

    assert_eq!(
        service
            .materialize_routine(&routine.id, "2026-05-26", 7, 1)
            .unwrap_err(),
        TodoError::Policy("Routine must be active to materialize: approved".to_string())
    );

    service.activate(&routine.id, None).unwrap();

    assert_eq!(
        service
            .materialize_routine(&routine.id, "2026-05-26", -1, 0)
            .unwrap_err(),
        TodoError::Validation("lookahead_days must be between 0 and 365: -1".to_string())
    );
}

#[test]
fn materialize_skips_an_occurrence_a_concurrent_writer_already_claimed() {
    // Two connections over one database, the shape the HTTP API runs in: it
    // opens a connection per request, so two requests can materialize the same
    // routine at once.
    let uri = "file:materialize_occurrence_race?mode=memory&cache=shared";
    let keeper = connect(uri).unwrap();
    init_schema(&keeper).unwrap();
    let mut service = TodoService::persistent(SqliteTodoRepository::new(connect(uri).unwrap()));

    let routine = service
        .propose_routine(ProposeRoutine {
            title: "이불정리".to_string(),
            actor: Actor::User,
            recurrence_rule: Some("daily".to_string()),
            materialization_policy: "per_occurrence".to_string(),
            area: None,
            note: None,
            tags: Vec::new(),
        })
        .unwrap();
    service.activate(&routine.id, None).unwrap();

    // Stands in for a materialize that commits between this run's existence
    // check and its insert. The row holds 2026-05-26, but carries no
    // `generated_by` marker, so the check cannot see it and the insert is forced
    // to race the unique index -- the same state the loser of a real race meets.
    keeper
        .execute(
            "INSERT INTO items (id, type, title, status, routine_id, occurrence_key,
                                proposed_by, created_at, updated_at)
             VALUES ('task_raced', 'task', 'raced', 'approved', ?1, '2026-05-26',
                     'system', '2026-05-26T00:00:00Z', '2026-05-26T00:00:00Z')",
            [&routine.id],
        )
        .unwrap();

    let created = service
        .materialize_routine(&routine.id, "2026-05-26", 1, 1)
        .unwrap();

    // The contested day is skipped, not raised: the occurrence exists, which is
    // what the check was after. The rest of the window still materializes.
    assert_eq!(occurrence_keys(&created), vec!["2026-05-25", "2026-05-27"]);
    assert!(
        service
            .get(&routine.id)
            .unwrap()
            .last_materialized_at
            .is_some()
    );
}

#[test]
fn materialization_window_is_capped_on_both_surfaces() {
    let mut service = TodoService::in_memory();
    let routine = service
        .propose_routine(ProposeRoutine {
            title: "이불정리".to_string(),
            actor: Actor::User,
            recurrence_rule: Some("daily".to_string()),
            materialization_policy: "per_occurrence".to_string(),
            area: None,
            note: None,
            tags: Vec::new(),
        })
        .unwrap();
    service.activate(&routine.id, None).unwrap();

    // One press must not be able to bury the item list: there is no bulk undo.
    assert_eq!(
        service
            .materialize_routine(&routine.id, "2026-05-26", 366, 0)
            .unwrap_err(),
        TodoError::Validation("lookahead_days must be between 0 and 365: 366".to_string())
    );
    assert_eq!(
        service
            .materialize_routine(&routine.id, "2026-05-26", 0, 366)
            .unwrap_err(),
        TodoError::Validation("catchup_days must be between 0 and 365: 366".to_string())
    );
    // The bulk sweep shares the guard, so the CLI cannot route around it.
    assert_eq!(
        service
            .materialize_routines("2026-05-26", 400, 0)
            .unwrap_err(),
        TodoError::Validation("lookahead_days must be between 0 and 365: 400".to_string())
    );
    assert_eq!(
        service
            .materialize_routines("2026-05-26", 0, -1)
            .unwrap_err(),
        TodoError::Validation("catchup_days must be between 0 and 365: -1".to_string())
    );

    // The cap itself is allowed.
    assert!(
        service
            .materialize_routine(&routine.id, "2026-05-26", 365, 365)
            .is_ok()
    );
}

#[test]
fn weekday_sets_and_ranges_match_expected_schedule() {
    let mut service = TodoService::in_memory();
    let routine = service
        .propose_routine(ProposeRoutine {
            title: "운동".to_string(),
            actor: Actor::User,
            recurrence_rule: Some("월수금".to_string()),
            materialization_policy: "per_occurrence".to_string(),
            area: None,
            note: None,
            tags: Vec::new(),
        })
        .unwrap();
    service.activate(&routine.id, None).unwrap();

    let created = service.materialize_routines("2026-05-26", 7, 0).unwrap();

    assert_eq!(
        occurrence_keys(&created),
        vec!["2026-05-27", "2026-05-29", "2026-06-01"]
    );
}

#[test]
fn recurrence_matrix_covers_supported_cases() {
    let cases = [
        (
            "every week on Monday",
            "2026-05-26",
            7,
            1,
            vec!["2026-05-25", "2026-06-01"],
        ),
        (
            "RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO",
            "2026-05-26",
            21,
            1,
            vec!["2026-05-25", "2026-06-08"],
        ),
        (
            "weekdays",
            "2026-05-26",
            7,
            0,
            vec![
                "2026-05-26",
                "2026-05-27",
                "2026-05-28",
                "2026-05-29",
                "2026-06-01",
                "2026-06-02",
            ],
        ),
        (
            "weekends",
            "2026-05-26",
            7,
            0,
            vec!["2026-05-30", "2026-05-31"],
        ),
        (
            "월-일",
            "2026-05-26",
            7,
            0,
            vec![
                "2026-05-26",
                "2026-05-27",
                "2026-05-28",
                "2026-05-29",
                "2026-05-30",
                "2026-05-31",
                "2026-06-01",
                "2026-06-02",
            ],
        ),
        (
            "Mon, Wed, Fri",
            "2026-05-26",
            7,
            0,
            vec!["2026-05-27", "2026-05-29", "2026-06-01"],
        ),
        (
            "every month on the 6th",
            "2026-05-26",
            40,
            0,
            vec!["2026-06-06"],
        ),
        (
            "every month on the last",
            "2026-05-26",
            40,
            0,
            vec!["2026-05-31", "2026-06-30"],
        ),
        (
            "every 2 days",
            "2026-05-26",
            6,
            0,
            vec!["2026-05-26", "2026-05-28", "2026-05-30", "2026-06-01"],
        ),
        (
            "every 5 weeks on Friday",
            "2026-05-26",
            40,
            0,
            vec!["2026-05-29", "2026-07-03"],
        ),
        ("every year", "2026-12-30", 5, 0, vec!["2027-01-01"]),
    ];

    for (rule, now, lookahead_days, catchup_days, expected) in cases {
        let mut service = TodoService::in_memory();
        let routine = service
            .propose_routine(ProposeRoutine {
                title: rule.to_string(),
                actor: Actor::User,
                recurrence_rule: Some(rule.to_string()),
                materialization_policy: "per_occurrence".to_string(),
                area: None,
                note: None,
                tags: Vec::new(),
            })
            .unwrap();
        service.activate(&routine.id, None).unwrap();

        let created = service
            .materialize_routines(now, lookahead_days, catchup_days)
            .unwrap();

        assert_eq!(occurrence_keys(&created), expected, "{rule}");
    }
}

#[test]
fn single_open_routine_respects_existing_manual_open_task() {
    let mut service = TodoService::in_memory();
    let routine = service
        .propose_routine(ProposeRoutine {
            title: "매일 확인".to_string(),
            actor: Actor::User,
            recurrence_rule: Some("daily".to_string()),
            materialization_policy: "single_open".to_string(),
            area: None,
            note: None,
            tags: Vec::new(),
        })
        .unwrap();
    service.activate(&routine.id, None).unwrap();
    service
        .propose_task(
            "직접 만든 루틴 태스크",
            ProposeTask {
                actor: Actor::User,
                routine_id: Some(routine.id.clone()),
                ..Default::default()
            },
        )
        .unwrap();

    let created = service.materialize_routines("2026-05-26", 0, 0).unwrap();

    assert!(created.is_empty());
}

#[test]
fn pausing_and_resuming_routine_cascades_generated_task_state() {
    let mut service = TodoService::in_memory();
    let routine = service
        .propose_routine(ProposeRoutine {
            title: "매일 스트레칭".to_string(),
            actor: Actor::User,
            recurrence_rule: Some("daily".to_string()),
            materialization_policy: "single_open".to_string(),
            area: None,
            note: None,
            tags: Vec::new(),
        })
        .unwrap();
    service.activate(&routine.id, None).unwrap();
    let task = service
        .materialize_routines("2026-05-26", 0, 0)
        .unwrap()
        .remove(0);

    let paused = service.pause(&routine.id, Some("잠시 중지")).unwrap();

    assert_eq!(paused.status, ItemStatus::Paused);
    assert_eq!(service.get(&task.id).unwrap().status, ItemStatus::Waiting);

    let resumed = service.resume(&routine.id, Some("다시 시작")).unwrap();

    assert_eq!(resumed.status, ItemStatus::Active);
    assert_eq!(service.get(&task.id).unwrap().status, ItemStatus::Approved);
    assert_eq!(
        service.get(&routine.id).unwrap().metadata["occurrences"]
            [task.occurrence_key.as_ref().unwrap()]["status"],
        "approved"
    );
    assert!(
        service
            .events()
            .iter()
            .any(|event| event.action == "routine_occurrence_approved")
    );
}

#[test]
fn malformed_recurrence_units_are_rejected() {
    let error =
        occurrences("every dayzz", date!(2026 - 05 - 26), date!(2026 - 05 - 30)).unwrap_err();

    assert_eq!(error, RecurrenceError::unsupported("every dayzz"));

    let mut service = TodoService::in_memory();
    let routine = service
        .propose_routine(ProposeRoutine {
            title: "깨진 루틴".to_string(),
            actor: Actor::User,
            recurrence_rule: Some("every dayzz".to_string()),
            materialization_policy: "per_occurrence".to_string(),
            area: None,
            note: None,
            tags: Vec::new(),
        })
        .unwrap();
    service.activate(&routine.id, None).unwrap();
    let error = service
        .materialize_routines("2026-05-26", 1, 0)
        .unwrap_err();

    assert_eq!(
        error,
        TodoError::Policy("Unsupported recurrence_rule: every dayzz".to_string())
    );
}

#[test]
fn completing_generated_task_updates_routine_occurrence_history() {
    let mut service = TodoService::in_memory();
    let routine = service
        .propose_routine(ProposeRoutine {
            title: "주간 리뷰".to_string(),
            actor: Actor::User,
            recurrence_rule: Some("weekly".to_string()),
            materialization_policy: "single_open".to_string(),
            area: None,
            note: None,
            tags: Vec::new(),
        })
        .unwrap();
    service.activate(&routine.id, None).unwrap();
    let task = service
        .materialize_routines("2026-05-26", 0, 0)
        .unwrap()
        .remove(0);

    service.complete(&task.id, Some("완료")).unwrap();

    let updated_routine = service.get(&routine.id).unwrap();
    let occurrence =
        &updated_routine.metadata["occurrences"][task.occurrence_key.as_ref().unwrap()];
    assert_eq!(occurrence["status"], "completed");
    assert_eq!(occurrence["task_id"], task.id);
    assert_eq!(occurrence["scheduled"], task.scheduled.unwrap());
    assert_eq!(
        updated_routine.metadata["last_occurrence"]["occurrence_key"],
        task.occurrence_key.unwrap()
    );
    assert!(
        service
            .events()
            .iter()
            .any(|event| event.action == "routine_occurrence_completed")
    );
}

#[test]
fn archiving_and_cancelling_routine_cascades_generated_tasks() {
    let mut archive_service = TodoService::in_memory();
    let routine = archive_service
        .propose_routine(ProposeRoutine {
            title: "주간 리뷰".to_string(),
            actor: Actor::User,
            recurrence_rule: Some("weekly".to_string()),
            materialization_policy: "single_open".to_string(),
            area: None,
            note: None,
            tags: Vec::new(),
        })
        .unwrap();
    archive_service.activate(&routine.id, None).unwrap();
    let task = archive_service
        .materialize_routines("2026-05-26", 0, 0)
        .unwrap()
        .remove(0);

    let archived_routine = archive_service
        .archive(&routine.id, Some("루틴 종료"))
        .unwrap();

    assert_eq!(
        archive_service.get(&task.id).unwrap().status,
        ItemStatus::Archived
    );
    assert_eq!(
        archived_routine.metadata["occurrences"][task.occurrence_key.as_ref().unwrap()]["status"],
        "archived"
    );
    assert_eq!(
        archive_service.get(&routine.id).unwrap().metadata["occurrences"]
            [task.occurrence_key.as_ref().unwrap()]["status"],
        "archived"
    );

    let mut cancel_service = TodoService::in_memory();
    let routine = cancel_service
        .propose_routine(ProposeRoutine {
            title: "격주 리뷰".to_string(),
            actor: Actor::User,
            recurrence_rule: Some("weekly".to_string()),
            materialization_policy: "single_open".to_string(),
            area: None,
            note: None,
            tags: Vec::new(),
        })
        .unwrap();
    cancel_service.activate(&routine.id, None).unwrap();
    let task = cancel_service
        .materialize_routines("2026-05-26", 0, 0)
        .unwrap()
        .remove(0);

    let cancelled_routine = cancel_service
        .cancel(&routine.id, Some("루틴 취소"))
        .unwrap();

    assert_eq!(
        cancel_service.get(&task.id).unwrap().status,
        ItemStatus::Cancelled
    );
    assert_eq!(
        cancelled_routine.metadata["occurrences"][task.occurrence_key.as_ref().unwrap()]["status"],
        "cancelled"
    );
    assert_eq!(
        cancel_service.get(&routine.id).unwrap().metadata["occurrences"]
            [task.occurrence_key.as_ref().unwrap()]["status"],
        "cancelled"
    );
}

#[test]
fn archiving_generated_task_updates_routine_occurrence_history() {
    let mut service = TodoService::in_memory();
    let routine = service
        .propose_routine(ProposeRoutine {
            title: "매일 정리".to_string(),
            actor: Actor::User,
            recurrence_rule: Some("daily".to_string()),
            materialization_policy: "single_open".to_string(),
            area: None,
            note: None,
            tags: Vec::new(),
        })
        .unwrap();
    service.activate(&routine.id, None).unwrap();
    let task = service
        .materialize_routines("2026-05-26", 0, 0)
        .unwrap()
        .remove(0);

    service.archive(&task.id, Some("건너뜀")).unwrap();

    let updated_routine = service.get(&routine.id).unwrap();
    assert_eq!(
        updated_routine.metadata["occurrences"][task.occurrence_key.as_ref().unwrap()]["status"],
        "archived"
    );
    assert!(
        service
            .events()
            .iter()
            .any(|event| event.action == "routine_occurrence_archived")
    );
}
