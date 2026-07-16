use todo_engine::application::error::TodoError;
use todo_engine::application::ports::ListFilter;
use todo_engine::application::service::{ProposeProject, ProposeRoutine, TodoService, UpdateItem};
use todo_engine::domain::{Actor, ItemStatus, ItemType, TodoItem, terminal_status};

fn routine(service: &mut TodoService, policy: &str) -> TodoItem {
    service
        .propose_routine(ProposeRoutine {
            title: "물 마시기".to_string(),
            actor: Actor::User,
            recurrence_rule: Some("daily".to_string()),
            materialization_policy: policy.to_string(),
            future_occurrences: 7,
            area: None,
            project_id: None,
            description: None,
            priority: None,
            note: None,
            tags: Vec::new(),
        })
        .unwrap()
}

fn tasks(service: &mut TodoService, routine_id: &str) -> Vec<TodoItem> {
    service
        .list_items(ListFilter {
            item_type: Some(ItemType::Task),
            routine_id: Some(routine_id.to_string()),
            include_archived: true,
            ..Default::default()
        })
        .unwrap()
}

fn occurrence_keys(items: &[TodoItem]) -> Vec<String> {
    items
        .iter()
        .map(|item| item.occurrence_key.clone().unwrap())
        .collect()
}

#[test]
fn materialization_fills_the_default_future_occurrence_target() {
    let mut service = TodoService::in_memory();
    let routine = routine(&mut service, "per_occurrence");

    service.materialize_routines("2026-05-31").unwrap();

    assert_eq!(
        occurrence_keys(&tasks(&mut service, &routine.id)),
        vec![
            "2026-05-31",
            "2026-06-01",
            "2026-06-02",
            "2026-06-03",
            "2026-06-04",
            "2026-06-05",
            "2026-06-06",
        ]
    );
}

#[test]
fn single_open_materialization_creates_only_one_task() {
    let mut service = TodoService::in_memory();
    let routine = routine(&mut service, "single_open");

    service.materialize_routines("2026-05-31").unwrap();

    assert_eq!(tasks(&mut service, &routine.id).len(), 1);
}

#[test]
fn materialization_snapshots_the_routine_task_template() {
    let mut service = TodoService::in_memory();
    let project = service
        .propose_project(ProposeProject {
            title: "수분 섭취".to_string(),
            definition_of_done: Some("매일 충분히 마신다".to_string()),
            actor: Actor::User,
            ..Default::default()
        })
        .unwrap();
    let routine = service
        .propose_routine(ProposeRoutine {
            title: "물 마시기".to_string(),
            actor: Actor::User,
            recurrence_rule: Some("daily".to_string()),
            materialization_policy: "single_open".to_string(),
            future_occurrences: 7,
            area: None,
            project_id: Some(project.id.clone()),
            description: Some("500ml를 마신다".to_string()),
            priority: Some(2),
            note: Some("찬물 제외".to_string()),
            tags: vec!["health".to_string()],
        })
        .unwrap();

    service.materialize_routines("2026-05-31").unwrap();

    let task = tasks(&mut service, &routine.id).remove(0);
    assert_eq!(task.description.as_deref(), Some("500ml를 마신다"));
    assert_eq!(task.note.as_deref(), Some("찬물 제외"));
    assert_eq!(task.priority, Some(2));
    assert_eq!(task.tags, vec!["health"]);
    assert_eq!(task.project_id.as_deref(), Some(project.id.as_str()));
    assert_eq!(task.scheduled.as_deref(), task.occurrence_key.as_deref());
    assert_eq!(task.routine_id.as_deref(), Some(routine.id.as_str()));
}

#[test]
fn completion_replenishes_after_the_latest_generated_occurrence() {
    let mut service = TodoService::in_memory();
    let routine = routine(&mut service, "per_occurrence");
    service.materialize_routines("2026-05-31").unwrap();
    let first = tasks(&mut service, &routine.id).remove(0);

    service.complete(&first.id, None).unwrap();

    let tasks = tasks(&mut service, &routine.id);
    assert_eq!(tasks.len(), 8);
    assert_eq!(
        tasks
            .iter()
            .filter(|task| !terminal_status(task.status))
            .count(),
        7
    );
    assert_eq!(
        tasks.last().unwrap().occurrence_key.as_deref(),
        Some("2026-06-07")
    );
}

#[test]
fn reducing_the_target_keeps_existing_tasks_and_pauses_replenishment() {
    let mut service = TodoService::in_memory();
    let routine = routine(&mut service, "per_occurrence");
    service.materialize_routines("2026-05-31").unwrap();
    service
        .update_item(
            &routine.id,
            UpdateItem {
                future_occurrences: Some(3),
                ..Default::default()
            },
        )
        .unwrap();
    let first = tasks(&mut service, &routine.id).remove(0);

    service.complete(&first.id, None).unwrap();

    let tasks = tasks(&mut service, &routine.id);
    assert_eq!(tasks.len(), 7);
    assert_eq!(
        tasks
            .iter()
            .filter(|task| !terminal_status(task.status))
            .count(),
        6
    );
}

#[test]
fn manual_materialization_increases_one_routine_target() {
    let mut service = TodoService::in_memory();
    let target = routine(&mut service, "per_occurrence");
    let bystander = routine(&mut service, "per_occurrence");
    service.materialize_routines("2026-05-31").unwrap();

    let created = service
        .materialize_routine(&target.id, "2026-05-31", Some(9))
        .unwrap();

    assert_eq!(created.len(), 2);
    assert_eq!(service.get(&target.id).unwrap().future_occurrences, 9);
    assert_eq!(tasks(&mut service, &target.id).len(), 9);
    assert_eq!(tasks(&mut service, &bystander.id).len(), 7);
}

#[test]
fn materialization_validates_target_and_named_routine() {
    let mut service = TodoService::in_memory();
    let routine = routine(&mut service, "per_occurrence");

    assert_eq!(
        service
            .materialize_routine(&routine.id, "2026-05-31", Some(0))
            .unwrap_err(),
        TodoError::Validation("future_occurrences must be between 1 and 365: 0".to_string())
    );
    assert_eq!(
        service
            .materialize_routine(&routine.id, "2026-05-31", Some(366))
            .unwrap_err(),
        TodoError::Validation("future_occurrences must be between 1 and 365: 366".to_string())
    );
    assert_eq!(
        service
            .materialize_routine("rtn_missing", "2026-05-31", Some(7))
            .unwrap_err(),
        TodoError::NotFound("rtn_missing".to_string())
    );
}

#[test]
fn paused_routine_waits_until_resume_to_replenish() {
    let mut service = TodoService::in_memory();
    let routine = routine(&mut service, "per_occurrence");
    service.materialize_routines("2026-05-31").unwrap();
    service.pause(&routine.id, None).unwrap();
    let first = tasks(&mut service, &routine.id).remove(0);

    service.complete(&first.id, None).unwrap();

    assert_eq!(tasks(&mut service, &routine.id).len(), 7);
    service.resume(&routine.id, None).unwrap();
    assert_eq!(tasks(&mut service, &routine.id).len(), 8);
    assert_eq!(
        tasks(&mut service, &routine.id)
            .iter()
            .filter(|task| !terminal_status(task.status))
            .count(),
        7
    );
}

#[test]
fn invalid_recurrence_fails_before_materialization() {
    let mut service = TodoService::in_memory();
    let mut routine = routine(&mut service, "per_occurrence");
    routine = service
        .update_item(
            &routine.id,
            UpdateItem {
                recurrence_rule: Some("every dayzz".to_string()),
                ..Default::default()
            },
        )
        .unwrap();

    assert_eq!(
        service
            .materialize_routine(&routine.id, "2026-05-31", None)
            .unwrap_err(),
        TodoError::Policy("Unsupported recurrence_rule: every dayzz".to_string())
    );
    assert_eq!(service.get(&routine.id).unwrap().status, ItemStatus::Active);
}

#[test]
fn completion_records_occurrence_history_before_replenishing() {
    let mut service = TodoService::in_memory();
    let routine = routine(&mut service, "single_open");
    service.materialize_routines("2026-05-31").unwrap();
    let task = tasks(&mut service, &routine.id).remove(0);

    service.complete(&task.id, Some("완료")).unwrap();

    let updated = service.get(&routine.id).unwrap();
    assert_eq!(
        updated.metadata["occurrences"][task.occurrence_key.as_ref().unwrap()]["status"],
        "completed"
    );
    assert_eq!(tasks(&mut service, &routine.id).len(), 2);
}
