use oracle_todo::application::service::{ProposeRoutine, TodoService};
use oracle_todo::domain::{Actor, ItemStatus, ItemType};

fn occurrence_keys(items: &[oracle_todo::domain::TodoItem]) -> Vec<String> {
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
fn weekday_sets_and_ranges_match_python_behavior() {
    let mut service = TodoService::in_memory();
    let routine = service
        .propose_routine(ProposeRoutine {
            title: "운동".to_string(),
            actor: Actor::User,
            recurrence_rule: Some("월수금".to_string()),
            materialization_policy: "per_occurrence".to_string(),
            area: None,
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
fn recurrence_matrix_matches_existing_python_cases() {
    let cases = [
        (
            "every week on Monday",
            "2026-05-26",
            7,
            1,
            vec!["2026-05-25", "2026-06-01"],
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
fn pausing_and_resuming_routine_cascades_generated_task_state() {
    let mut service = TodoService::in_memory();
    let routine = service
        .propose_routine(ProposeRoutine {
            title: "매일 스트레칭".to_string(),
            actor: Actor::User,
            recurrence_rule: Some("daily".to_string()),
            materialization_policy: "single_open".to_string(),
            area: None,
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
}
