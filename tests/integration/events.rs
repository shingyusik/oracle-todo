use oracle_todo::application::service::{CreateArea, ProposeProject, TodoService};
use oracle_todo::domain::Actor;

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
