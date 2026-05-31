use oracle_todo::application::error::TodoError;
use oracle_todo::application::service::{ProposeEvent, ProposeTask, TodoService};
use oracle_todo::domain::Actor;
use oracle_todo::exports::{render_items, today_tasks, write_exports};

#[test]
fn today_export_includes_today_tasks_and_excludes_future_tasks() {
    let mut service = TodoService::in_memory();
    let today = service
        .propose_task(
            "혼자 할 일",
            ProposeTask {
                actor: Actor::User,
                scheduled: Some("today".to_string()),
                ..Default::default()
            },
        )
        .unwrap();
    service
        .propose_task(
            "다음 주 할 일",
            ProposeTask {
                actor: Actor::User,
                scheduled: Some("2026-06-05".to_string()),
                ..Default::default()
            },
        )
        .unwrap();

    let items = today_tasks(
        &service.list_items(Default::default()).unwrap(),
        "2026-05-26",
    )
    .unwrap();
    let markdown = render_items("Today", &items);

    assert_eq!(items, vec![today]);
    assert!(markdown.contains("- [ ] **혼자 할 일** `task approved scheduled:today`"));
    assert!(!markdown.contains("다음 주 할 일"));
}

#[test]
fn event_propose_distinguishes_external_commitments() {
    let mut service = TodoService::in_memory();

    let event = service
        .propose_event(ProposeEvent {
            title: "병원 예약".to_string(),
            actor: Actor::Oracle,
            scheduled: Some("2026-06-01 15:00".to_string()),
            area: None,
            project_id: None,
            due: None,
            priority: None,
            description: Some("진료 예약".to_string()),
            location: Some("서울대병원".to_string()),
            participants: vec!["서울대병원".to_string()],
            commitment_type: "appointment".to_string(),
        })
        .unwrap();

    assert_eq!(event.item_type.as_str(), "event");
    assert_eq!(event.metadata["location"], "서울대병원");
    assert_eq!(event.metadata["participants"][0], "서울대병원");
}

#[test]
fn event_requires_non_blank_schedule() {
    let mut service = TodoService::in_memory();

    let error = service
        .propose_event(ProposeEvent {
            title: "빈 일정".to_string(),
            actor: Actor::Oracle,
            scheduled: Some("  ".to_string()),
            area: None,
            project_id: None,
            due: None,
            priority: None,
            description: None,
            location: None,
            participants: Vec::new(),
            commitment_type: "appointment".to_string(),
        })
        .unwrap_err();

    assert_eq!(
        error,
        TodoError::Policy("Event requires scheduled time".to_string())
    );
}

#[test]
fn write_exports_creates_expected_view_files() {
    let tmp = tempfile::tempdir().unwrap();
    let mut service = TodoService::in_memory();
    service
        .propose_task(
            "오늘 할 일",
            ProposeTask {
                actor: Actor::User,
                scheduled: Some("today".to_string()),
                ..Default::default()
            },
        )
        .unwrap();

    let paths = write_exports(
        &service.list_items(Default::default()).unwrap(),
        tmp.path(),
        "2026-05-26",
    )
    .unwrap();

    assert!(paths.iter().any(|path| path.ends_with("today.md")));
    assert!(tmp.path().join("today.md").exists());
}

#[test]
fn archive_export_includes_completed_items_from_default_listing() {
    let tmp = tempfile::tempdir().unwrap();
    let mut service = TodoService::in_memory();
    let task = service
        .propose_task(
            "끝난 일",
            ProposeTask {
                actor: Actor::User,
                ..Default::default()
            },
        )
        .unwrap();
    service.complete(&task.id, None).unwrap();

    write_exports(
        &service.list_items(Default::default()).unwrap(),
        tmp.path(),
        "2026-05-26",
    )
    .unwrap();

    let archive = std::fs::read_to_string(tmp.path().join("archive.md")).unwrap();

    assert!(archive.contains("끝난 일"));
}
