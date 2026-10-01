use super::*;

#[test]
fn current_item_status_choices_only_offer_reachable_changes() {
    use crate::domain::{Actor, ItemStatus, ItemType, TodoItem};
    for (kind, status, expected) in [
        (
            ItemType::Area,
            ItemStatus::Paused,
            serde_json::json!(["paused", "archived"]),
        ),
        (
            ItemType::Task,
            ItemStatus::Waiting,
            serde_json::json!(["waiting", "completed"]),
        ),
        (
            ItemType::Event,
            ItemStatus::Waiting,
            serde_json::json!(["waiting", "paused", "completed"]),
        ),
        (
            ItemType::Routine,
            ItemStatus::Paused,
            serde_json::json!(["paused", "completed"]),
        ),
    ] {
        let mut item = TodoItem::new(
            "legacy",
            kind,
            "legacy",
            Actor::User,
            time::OffsetDateTime::UNIX_EPOCH,
        );
        item.status = status;
        let value = options::value(None, Some(&item));
        assert_eq!(value["types"][0]["status_choices"], expected);
    }
}

#[test]
fn fixed_options_work_without_an_initialized_store() {
    let home = tempfile::tempdir().unwrap();
    run_raven_at(home.path(), ["raven todo", "options", "--type", "goal"]).unwrap();
    assert!(!db_path(home.path()).exists());
}

#[test]
fn table_query_rejects_fields_inapplicable_to_its_type_before_opening_a_store() {
    let home = tempfile::tempdir().unwrap();
    let body = serde_json::json!({
        "scope": "workspace.area", "context": {}, "group_by": "none",
        "group_settings": {"sort": "manual", "hide_empty": false, "manual_order": [], "hidden_group_keys": []},
        "filters": [{"field": "priority", "operator": "is", "value": {"text": "1"}}]
    });
    let error = run_raven_at(
        home.path(),
        ["raven todo", "table", "query", "--json", &body.to_string()],
    )
    .unwrap_err();
    assert!(matches!(
        error.downcast_ref::<TodoError>(),
        Some(TodoError::Validation(_))
    ));
    assert!(!db_path(home.path()).exists());
}

#[test]
fn clear_priority_removes_the_value_and_conflicts_with_a_replacement() {
    let home = tempfile::tempdir().unwrap();
    let item = service(home.path())
        .unwrap()
        .propose_task(
            "task",
            crate::application::service::ProposeTask {
                priority: Some(4),
                ..Default::default()
            },
        )
        .unwrap();
    run_raven_at(
        home.path(),
        ["raven todo", "update", &item.id, "--clear-priority"],
    )
    .unwrap();
    assert_eq!(
        read_service(home.path())
            .unwrap()
            .get(&item.id)
            .unwrap()
            .priority,
        None
    );
    assert!(
        Cli::try_parse_from([
            "todo-engine",
            "update",
            &item.id,
            "--clear-priority",
            "--priority",
            "3"
        ])
        .is_err()
    );
}

#[test]
fn help_lists_read_statuses_types_and_mutation_limits() {
    let mut command = Cli::command();
    let list = command
        .find_subcommand_mut("list")
        .unwrap()
        .render_long_help()
        .to_string();
    for value in [
        "active",
        "waiting",
        "paused",
        "completed",
        "cancelled",
        "dropped",
        "archived",
        "missed",
        "rejected",
        "goal",
        "review",
        "archive_item",
    ] {
        assert!(list.contains(value), "missing {value}");
    }
    let update = command
        .find_subcommand_mut("update")
        .unwrap()
        .render_long_help()
        .to_string();
    for value in [
        "week",
        "month",
        "year",
        "daily",
        "weekly",
        "monthly",
        "quarterly",
        "single_open",
        "per_occurrence",
        "1..10",
    ] {
        assert!(update.contains(value), "missing {value}");
    }
}

#[test]
fn options_limit_actions_to_the_item_type_and_current_status() {
    use crate::application::service::ProposeTask;
    let mut service = TodoService::in_memory();
    let task = service
        .propose_task("task", ProposeTask::default())
        .unwrap();
    let active = options::value(None, Some(&task));
    let names = |value: &serde_json::Value| {
        value["types"][0]["actions"]
            .as_array()
            .unwrap()
            .iter()
            .map(|action| action["action"].as_str().unwrap().to_owned())
            .collect::<Vec<_>>()
    };
    assert_eq!(names(&active), ["complete", "miss", "postpone", "archive"]);
    assert_eq!(
        active["types"][0]["status_choices"],
        serde_json::json!(["active", "completed"])
    );
    assert_eq!(
        active["enums"]["horizon"],
        serde_json::json!(["week", "month", "year"])
    );
    assert!(
        active["enums"]["read_statuses"]
            .as_array()
            .unwrap()
            .contains(&serde_json::json!("rejected"))
    );
    let completed = service.complete(&task.id, None).unwrap();
    let result = options::value(None, Some(&completed));
    assert_eq!(names(&result), ["reopen", "archive"]);
    assert_eq!(
        result["types"][0]["status_choices"],
        serde_json::json!(["completed", "active"])
    );
    assert_eq!(result["types"][0]["update_fields"], serde_json::json!([]));
    assert_eq!(
        names(&options::value(Some(ItemType::Area), None)),
        ["archive"]
    );
}

#[tokio::test]
async fn cli_table_queries_and_lookups_match_ui_json_envelopes() {
    use axum::{body::Body, http::Request};
    use http_body_util::BodyExt;
    use tower::ServiceExt;
    let home = tempfile::tempdir().unwrap();
    let mut service = service(home.path()).unwrap();
    let task = service
        .propose_task(
            "selected",
            crate::application::service::ProposeTask {
                priority: Some(3),
                ..Default::default()
            },
        )
        .unwrap();
    service.propose_task("other", Default::default()).unwrap();
    let body = serde_json::json!({
        "scope": "workspace.task", "context": {}, "group_by": "none", "limit": 1,
        "group_settings": {"sort": "manual", "hide_empty": false, "manual_order": [], "hidden_group_keys": []},
        "filters": [{"field": "title", "operator": "contains", "value": {"text": "select"}}],
        "sorts": [{"field": "priority", "direction": "desc"}]
    }).to_string();
    let cli = table::response(home.path(), TableCommand::Query { json: body.clone() }).unwrap();
    let router = crate::interfaces::api::raven_router(db_path(home.path()));
    let response = router
        .clone()
        .oneshot(
            Request::post("/table/query")
                .header("content-type", "application/json")
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), axum::http::StatusCode::OK);
    let api: serde_json::Value =
        serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap();
    assert_eq!(cli, api);
    assert_eq!(cli["items"][0]["record"]["id"], task.id);
    let cli = table::response(
        home.path(),
        TableCommand::Lookups {
            scope: crate::interfaces::api::decode_table_scope("workspace.task").unwrap(),
            id: None,
            horizon: None,
        },
    )
    .unwrap();
    let response = router
        .oneshot(
            Request::get("/table/lookups?scope=workspace.task")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), axum::http::StatusCode::OK);
    let api: serde_json::Value =
        serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap();
    assert_eq!(cli, api);
    assert!(cli["items"].is_array());
}
