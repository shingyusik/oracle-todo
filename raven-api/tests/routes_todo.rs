use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use http_body_util::BodyExt;
use raven_api::{AuthMode, RavenApiConfig, router};
use serde_json::{Value, json};
use tower::ServiceExt;

fn authenticated(app: axum::Router) -> axum::Router {
    app.layer(axum::middleware::from_fn(
        |mut request: Request<Body>, next: axum::middleware::Next| async move {
            request
                .headers_mut()
                .insert(header::COOKIE, "raven_session=test".parse().unwrap());
            next.run(request).await
        },
    ))
}

fn test_app() -> (tempfile::TempDir, axum::Router) {
    let temp = tempfile::tempdir().unwrap();
    let app = router(RavenApiConfig {
        todo_db: temp.path().join("todo.sqlite"),
        ledger_db: temp.path().join("ledger.sqlite"),
        health_db: temp.path().join("health.sqlite"),
        health_media_dir: temp.path().join("media"),
        local_offset: time::UtcOffset::from_hms(9, 0, 0).unwrap(),
        auth: AuthMode::UiSession {
            token: "test".into(),
        },
    })
    .unwrap();
    (temp, authenticated(app))
}

fn table_query(scope: &str, context: Value) -> Value {
    json!({
        "scope": scope,
        "offset": 0,
        "limit": 50,
        "filter_mode": "and",
        "filters": [],
        "sorts": [],
        "group_by": "none",
        "group_settings": {
            "sort": "manual",
            "hide_empty": true,
            "manual_order": [],
            "hidden_group_keys": []
        },
        "context": context
    })
}

async fn post_json(app: &axum::Router, path: &str, value: Value) -> axum::response::Response {
    app.clone()
        .oneshot(
            Request::post(path)
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(value.to_string()))
                .unwrap(),
        )
        .await
        .unwrap()
}

async fn json_body(response: axum::response::Response) -> Value {
    serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap()
}

#[tokio::test]
async fn todo_table_query_serves_workspace_planner_and_linked_scopes() {
    let (_temp, app) = test_app();
    let task = post_json(
        &app,
        "/api/v1/todo/tasks/propose",
        json!({"title":"Visible task","scheduled":"2026-08-22","tags":["focus"]}),
    )
    .await;
    assert_eq!(task.status(), StatusCode::OK);

    for scope in ["area", "project", "goal", "routine", "task", "event"] {
        let response = post_json(
            &app,
            "/api/v1/todo/table/query",
            table_query(&format!("workspace.{scope}"), json!({})),
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK, "{scope}");
        let page = json_body(response).await;
        assert_eq!(page.as_object().unwrap().len(), 2);
        assert!(page["items"].is_array());
        assert!(page.get("next_offset").is_some());
    }

    for scope in [
        "yearly-period-goals",
        "yearly-month-goals",
        "monthly-period-goals",
        "monthly-calendar",
        "monthly-week-goals",
        "weekly-month-goals",
        "weekly-week-goals",
        "weekly-day-grid",
        "daily-today",
        "daily-overdue",
        "daily-unscheduled",
    ] {
        let response = post_json(
            &app,
            "/api/v1/todo/table/query",
            table_query(
                &format!("planner.{scope}"),
                json!({"from":"2026-08-01","to":"2026-08-31"}),
            ),
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK, "{scope}");
    }

    let project = json_body(
        post_json(
            &app,
            "/api/v1/todo/projects/propose",
            json!({"title":"Parent","definition_of_done":"Done"}),
        )
        .await,
    )
    .await;
    let linked = post_json(
        &app,
        "/api/v1/todo/table/query",
        table_query(
            "linked.project.task",
            json!({"parent_type":"project","parent_id":project["id"]}),
        ),
    )
    .await;
    assert_eq!(linked.status(), StatusCode::OK);

    let task_page = json_body(
        post_json(
            &app,
            "/api/v1/todo/table/query",
            table_query("workspace.task", json!({})),
        )
        .await,
    )
    .await;
    let row = &task_page["items"][0];
    assert_eq!(row.as_object().unwrap().len(), 4);
    assert!(row["key"].is_string());
    assert!(row.get("group_key").is_some());
    assert!(row.get("group_label").is_some());
    assert_eq!(row["record"]["type"], "task");
    assert_eq!(row["record"]["title"], "Visible task");

    let mut configured = table_query("workspace.task", json!({"reference_date":"2026-08-22"}));
    configured["filter_mode"] = json!("or");
    configured["filters"] = json!([{
        "field":"title","operator":"contains","value":{"text":"Visible"}
    }]);
    configured["sorts"] = json!([{"field":"updated","direction":"desc"}]);
    configured["group_by"] = json!("tag");
    configured["group_settings"] = json!({
        "sort":"alphabetical","hide_empty":false,
        "manual_order":["focus"],"hidden_group_keys":[]
    });
    let configured = json_body(post_json(&app, "/api/v1/todo/table/query", configured).await).await;
    assert_eq!(configured["items"][0]["group_key"], "focus");
    assert_eq!(configured["items"][0]["group_label"], "focus");
}

#[tokio::test]
async fn todo_table_query_is_strict_bounded_and_safe() {
    let (_temp, app) = test_app();
    let mut cases = Vec::new();
    cases.push(table_query("workspace.task", json!({"from":"2026-08-01"})));
    cases.push(table_query(
        "planner.daily-today",
        json!({"from":"2026-08-22","to":"2026-08-22","path":"C:\\secret.sqlite"}),
    ));
    cases.push(table_query(
        "linked.project.task",
        json!({"parent_type":"area","parent_id":"private-item"}),
    ));
    for (field, value) in [("limit", json!(51)), ("offset", json!(u32::MAX))] {
        let mut query = table_query("workspace.task", json!({}));
        query[field] = value;
        cases.push(query);
    }
    let mut invalid_rule = table_query("workspace.task", json!({}));
    invalid_rule["filters"] = json!([{
        "field":"title","operator":"is_before","value":{"text":"SELECT private"},
        "extra":true
    }]);
    cases.push(invalid_rule);
    let mut relative = table_query("workspace.task", json!({}));
    relative["filters"] = json!([{
        "field":"due","operator":"is_relative_to_today",
        "value":{"relative":{"amount":"1","unit":"day"}}
    }]);
    cases.push(relative);
    let mut invalid_sort = table_query("workspace.area", json!({}));
    invalid_sort["sorts"] = json!([{"field":"due","direction":"asc"}]);
    cases.push(invalid_sort);
    let mut invalid_group = table_query("workspace.area", json!({}));
    invalid_group["group_by"] = json!("month");
    cases.push(invalid_group);
    let mut invalid_operator = table_query("workspace.task", json!({}));
    invalid_operator["filters"] = json!([{
        "field":"title","operator":"matches_regex","value":{"text":"private"}
    }]);
    cases.push(invalid_operator);
    let mut invalid_value = table_query("workspace.task", json!({}));
    invalid_value["filters"] = json!([{
        "field":"title","operator":"contains","value":{"range":{"start":"a","end":"z"}}
    }]);
    cases.push(invalid_value);

    for query in cases {
        let response = post_json(&app, "/api/v1/todo/table/query", query).await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let error = json_body(response).await;
        assert_eq!(error["code"], "validation_error");
        assert_eq!(error["message"], "The request is invalid.");
        let rendered = error.to_string();
        assert!(!rendered.contains("secret.sqlite"));
        assert!(!rendered.contains("SELECT"));
        assert!(!rendered.contains("private-item"));
    }

    let oversized = Request::post("/api/v1/todo/table/query")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from("x".repeat(129 * 1024)))
        .unwrap();
    assert_eq!(
        app.oneshot(oversized).await.unwrap().status(),
        StatusCode::PAYLOAD_TOO_LARGE
    );
}

#[tokio::test]
async fn todo_table_query_defaults_to_the_bounded_first_page_and_parses_exact_local_dates() {
    let (_temp, app) = test_app();
    let mut defaulted = table_query("workspace.task", json!({}));
    defaulted.as_object_mut().unwrap().remove("offset");
    defaulted.as_object_mut().unwrap().remove("limit");
    assert_eq!(
        post_json(&app, "/api/v1/todo/table/query", defaulted)
            .await
            .status(),
        StatusCode::OK
    );

    let invalid = table_query(
        "planner.daily-today",
        json!({"from":"2026-8-2","to":"2026-08-22"}),
    );
    assert_eq!(
        post_json(&app, "/api/v1/todo/table/query", invalid)
            .await
            .status(),
        StatusCode::BAD_REQUEST
    );
}

#[tokio::test]
async fn todo_table_lookups_are_compact_scoped_and_legacy_items_stay_an_array() {
    let (_temp, app) = test_app();
    for (path, body) in [
        (
            "/api/v1/todo/areas",
            json!({"title":"Work","tags":["home"]}),
        ),
        (
            "/api/v1/todo/tasks/propose",
            json!({"title":"Buy milk","area":"Work","tags":["errand"]}),
        ),
    ] {
        assert_eq!(post_json(&app, path, body).await.status(), StatusCode::OK);
    }

    let lookups = app
        .clone()
        .oneshot(
            Request::get("/api/v1/todo/table/lookups?scope=workspace.task")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(lookups.status(), StatusCode::OK);
    let value = json_body(lookups).await;
    assert_eq!(value.as_object().unwrap().len(), 1);
    assert_eq!(value["items"].as_array().unwrap().len(), 2);
    for item in value["items"].as_array().unwrap() {
        assert_eq!(
            item.as_object()
                .unwrap()
                .keys()
                .map(String::as_str)
                .collect::<Vec<_>>(),
            ["id", "tags", "title", "type"]
        );
    }
    assert!(
        value["items"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item["type"] == "task")
    );

    for (scope, included, excluded) in [
        ("workspace.goal", "area", "task"),
        ("planner.daily-today", "task", "goal"),
        ("linked.project.task", "task", "event"),
    ] {
        let response = app
            .clone()
            .oneshot(
                Request::get(format!("/api/v1/todo/table/lookups?scope={scope}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK, "{scope}");
        let items = json_body(response).await["items"]
            .as_array()
            .unwrap()
            .clone();
        assert!(items.iter().any(|item| item["type"] == included), "{scope}");
        assert!(
            !items.iter().any(|item| item["type"] == excluded),
            "{scope}"
        );
    }

    let invalid = app
        .clone()
        .oneshot(
            Request::get("/api/v1/todo/table/lookups?scope=workspace.task&path=secret")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(invalid.status(), StatusCode::BAD_REQUEST);
    assert!(!json_body(invalid).await.to_string().contains("secret"));

    let legacy = app
        .oneshot(
            Request::get("/api/v1/todo/items")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(legacy.status(), StatusCode::OK);
    let legacy = json_body(legacy).await;
    assert!(legacy.is_array());
    let task = legacy
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["type"] == "task")
        .unwrap();
    for field in ["id", "type", "title", "status", "tags", "metadata_"] {
        assert!(task.get(field).is_some(), "legacy field {field}");
    }
}

fn hold_exclusive_todo_lock(
    db_path: std::path::PathBuf,
) -> (std::sync::mpsc::SyncSender<()>, std::thread::JoinHandle<()>) {
    let (ready_tx, ready_rx) = std::sync::mpsc::sync_channel(0);
    let (release_tx, release_rx) = std::sync::mpsc::sync_channel(0);
    let worker = std::thread::spawn(move || {
        let connection =
            todo_engine::infrastructure::sqlite::connect(db_path.to_str().unwrap()).unwrap();
        connection.execute_batch("BEGIN EXCLUSIVE").unwrap();
        ready_tx.send(()).unwrap();
        release_rx.recv().unwrap();
    });
    ready_rx.recv().unwrap();
    (release_tx, worker)
}

#[tokio::test]
async fn todo_items_are_nested_under_v1_without_router_side_effects() {
    let temp = tempfile::tempdir().unwrap();
    let home = temp.path().join("raven");
    let config = RavenApiConfig {
        todo_db: home.join("todo.sqlite"),
        ledger_db: home.join("ledger.sqlite"),
        health_db: home.join("health.sqlite"),
        health_media_dir: home.join("media"),
        local_offset: time::UtcOffset::from_hms(9, 0, 0).unwrap(),
        auth: AuthMode::UiSession {
            token: "test".into(),
        },
    };
    let app = authenticated(router(config).unwrap());
    assert!(!home.exists());
    let mut requests = tokio::task::JoinSet::new();
    for _ in 0..8 {
        let app = app.clone();
        requests.spawn(async move {
            app.oneshot(
                Request::get("/api/v1/todo/items")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap()
        });
    }
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        while let Some(response) = requests.join_next().await {
            assert_eq!(response.unwrap().status(), StatusCode::OK);
        }
    })
    .await
    .unwrap();
}

#[tokio::test]
async fn todo_memory_state_is_reused_across_cloned_raven_routers() {
    let temp = tempfile::tempdir().unwrap();
    let app = authenticated(
        router(RavenApiConfig {
            todo_db: ":memory:".into(),
            ledger_db: temp.path().join("ledger.sqlite"),
            health_db: temp.path().join("health.sqlite"),
            health_media_dir: temp.path().join("media"),
            local_offset: time::UtcOffset::from_hms(9, 0, 0).unwrap(),
            auth: AuthMode::UiSession {
                token: "test".into(),
            },
        })
        .unwrap(),
    );
    let created = app
        .clone()
        .oneshot(
            Request::post("/api/v1/todo/areas")
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"title":"Work","review_cycle":"weekly","standard":"Keep current"}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(created.status(), StatusCode::OK);

    let response = app
        .oneshot(
            Request::get("/api/v1/todo/items")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let items: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(items.as_array().unwrap().len(), 1);
    assert_eq!(items[0]["title"], "Work");
}

#[tokio::test]
async fn cancelled_first_todo_request_does_not_restart_initialization() {
    let temp = tempfile::tempdir().unwrap();
    let todo_db = temp.path().join("todo.sqlite");
    let (release, lock) = hold_exclusive_todo_lock(todo_db.clone());
    let app = authenticated(
        router(RavenApiConfig {
            todo_db: todo_db.clone(),
            ledger_db: temp.path().join("ledger.sqlite"),
            health_db: temp.path().join("health.sqlite"),
            health_media_dir: temp.path().join("media"),
            local_offset: time::UtcOffset::from_hms(9, 0, 0).unwrap(),
            auth: AuthMode::UiSession {
                token: "test".into(),
            },
        })
        .unwrap(),
    );
    let first = tokio::spawn(
        app.clone().oneshot(
            Request::get("/api/v1/todo/health")
                .body(Body::empty())
                .unwrap(),
        ),
    );
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    assert!(!first.is_finished());
    first.abort();
    assert!(first.await.unwrap_err().is_cancelled());
    release.send(()).unwrap();
    lock.join().unwrap();

    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            if todo_engine::infrastructure::sqlite::connect_read_only(todo_db.to_str().unwrap())
                .is_ok()
            {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();

    let (release, lock) = hold_exclusive_todo_lock(todo_db);
    let response = tokio::time::timeout(
        std::time::Duration::from_secs(1),
        app.oneshot(
            Request::get("/api/v1/todo/health")
                .body(Body::empty())
                .unwrap(),
        ),
    )
    .await;
    release.send(()).unwrap();
    lock.join().unwrap();
    assert_eq!(response.unwrap().unwrap().status(), StatusCode::OK);
}

#[tokio::test]
async fn oversized_todo_json_uses_the_common_payload_envelope() {
    let temp = tempfile::tempdir().unwrap();
    let app = authenticated(
        router(RavenApiConfig {
            todo_db: temp.path().join("todo.sqlite"),
            ledger_db: temp.path().join("ledger.sqlite"),
            health_db: temp.path().join("health.sqlite"),
            health_media_dir: temp.path().join("media"),
            local_offset: time::UtcOffset::from_hms(9, 0, 0).unwrap(),
            auth: AuthMode::UiSession {
                token: "test".into(),
            },
        })
        .unwrap(),
    );
    let response = app
        .oneshot(
            Request::post("/api/v1/todo/areas")
                .header("content-type", "application/json")
                .body(Body::from("x".repeat(129 * 1024)))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(response.headers()["content-type"], "application/json");
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let error: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(error["code"], "payload_too_large");
    assert!(error["request_id"].is_string());
}

#[tokio::test]
async fn todo_mutation_and_validation_error_remain_nested_and_normalized() {
    let temp = tempfile::tempdir().unwrap();
    let app = authenticated(
        router(RavenApiConfig {
            todo_db: temp.path().join("todo.sqlite"),
            ledger_db: temp.path().join("ledger.sqlite"),
            health_db: temp.path().join("health.sqlite"),
            health_media_dir: temp.path().join("media"),
            local_offset: time::UtcOffset::from_hms(9, 0, 0).unwrap(),
            auth: AuthMode::UiSession {
                token: "test".into(),
            },
        })
        .unwrap(),
    );
    let created = app
        .clone()
        .oneshot(
            Request::post("/api/v1/todo/areas")
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"title":"Work","review_cycle":"weekly","standard":"Keep current"}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(created.status(), StatusCode::OK);

    let parent = app
        .clone()
        .oneshot(
            Request::post("/api/v1/todo/goals/propose")
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"title":"Parent","horizon":"month","scheduled":"2026-08-01"}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(parent.status(), StatusCode::OK);
    let bytes = parent.into_body().collect().await.unwrap().to_bytes();
    let parent: Value = serde_json::from_slice(&bytes).unwrap();

    let invalid_goal = app
        .clone()
        .oneshot(
            Request::post("/api/v1/todo/goals/propose")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "title": "Child",
                        "horizon": "month",
                        "scheduled": "2026-08-01",
                        "parent_id": parent["id"],
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(invalid_goal.status(), StatusCode::BAD_REQUEST);
    let bytes = invalid_goal.into_body().collect().await.unwrap().to_bytes();
    let error: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(error["code"], "goal_parent_horizon_not_coarser");
    assert!(error["message"].as_str().unwrap().contains("horizon"));
    assert_eq!(error["fields"]["parent_horizon"], json!(["month"]));
    assert_eq!(error["fields"]["child_horizon"], json!(["month"]));
    assert!(error["request_id"].is_string());

    let invalid = app
        .oneshot(
            Request::post("/api/v1/todo/areas")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"title":"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(invalid.status(), StatusCode::BAD_REQUEST);
    let bytes = invalid.into_body().collect().await.unwrap().to_bytes();
    let error: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(error["code"], "validation_error");
    assert!(error["request_id"].is_string());
}
