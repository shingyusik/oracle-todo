use todo_engine::application::service::{CreateArea, ProposeProject, TodoService};
use todo_engine::domain::Actor;

#[test]
fn every_mutation_records_event() {
    let mut service = TodoService::in_memory();
    service
        .create_area(CreateArea {
            title: "재정".to_string(),
            review_cycle: None,
            standard: None,
            note: None,
            tags: Vec::new(),
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
            tags: Vec::new(),
        })
        .unwrap();
    let item = service.propose_task("테스트", Default::default()).unwrap();
    let completed = service.complete(&item.id, None).unwrap();
    service
        .reopen(&completed.id, Some("planner checkbox"))
        .unwrap();

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
            "complete".to_string(),
            "reopen".to_string(),
        ]
    );
}

fn system_event(service: &mut TodoService) -> todo_engine::domain::TodoItem {
    service
        .propose_event_with_reason(
            todo_engine::application::service::ProposeEvent {
                title: "가져온 일정".to_string(),
                actor: Actor::System,
                scheduled: Some("2026-07-14".to_string()),
                ..Default::default()
            },
            Some("google_calendar_sync"),
        )
        .unwrap()
}

fn last_event(service: &TodoService) -> (Actor, String, Option<String>) {
    let event = service.events().last().unwrap();
    (event.actor, event.action.clone(), event.reason.clone())
}

#[test]
fn propose_event_with_reason_records_reason() {
    let mut service = TodoService::in_memory();
    system_event(&mut service);
    assert_eq!(
        last_event(&service),
        (
            Actor::System,
            "propose_event".to_string(),
            Some("google_calendar_sync".to_string())
        )
    );
}

#[test]
fn update_item_if_current_as_records_actor_and_reason() {
    let mut service = TodoService::in_memory();
    let item = system_event(&mut service);
    let updated = service
        .update_item_if_current_as(
            &item.id,
            todo_engine::application::service::UpdateItem {
                title: Some("바뀐 일정".to_string()),
                reason: Some("google_calendar_sync".to_string()),
                ..Default::default()
            },
            Some(item.updated_at),
            Actor::System,
        )
        .unwrap();
    assert_eq!(updated.title, "바뀐 일정");
    assert_eq!(
        last_event(&service),
        (
            Actor::System,
            "update_item".to_string(),
            Some("google_calendar_sync".to_string())
        )
    );

    service
        .update_item(
            &item.id,
            todo_engine::application::service::UpdateItem {
                title: Some("사용자 수정".to_string()),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(last_event(&service).0, Actor::User);
}

#[test]
fn archive_as_records_actor_and_reason() {
    let mut service = TodoService::in_memory();
    let item = system_event(&mut service);
    let archived = service
        .archive_as(&item.id, Actor::System, Some("google_calendar_deleted"))
        .unwrap();
    assert_eq!(archived.status, todo_engine::domain::ItemStatus::Archived);
    assert_eq!(
        last_event(&service),
        (
            Actor::System,
            "archive".to_string(),
            Some("google_calendar_deleted".to_string())
        )
    );

    let other = system_event(&mut service);
    service.archive(&other.id, None).unwrap();
    assert_eq!(last_event(&service).0, Actor::User);
}
