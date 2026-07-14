use crate::support::TestHome;
use axum::body::Body;
use http_body_util::BodyExt;
use serde_json::{Value, json};
use todo_engine::infrastructure::sqlite::init_schema;
use todo_engine::interfaces::api::router;
use tower::ServiceExt;

async fn body_json(response: http::Response<Body>) -> Value {
    let body = response.into_body().collect().await.unwrap().to_bytes();
    serde_json::from_slice(&body).unwrap()
}

async fn json_request(
    app: axum::Router,
    method: &str,
    uri: impl Into<String>,
    body: Value,
) -> http::Response<Body> {
    http_request(app, method, uri, Body::from(body.to_string())).await
}

async fn empty_request(
    app: axum::Router,
    method: &str,
    uri: impl Into<String>,
) -> http::Response<Body> {
    http_request(app, method, uri, Body::empty()).await
}

async fn http_request(
    app: axum::Router,
    method: &str,
    uri: impl Into<String>,
    body: Body,
) -> http::Response<Body> {
    app.oneshot(
        http::Request::builder()
            .method(method)
            .uri(uri.into())
            .header("content-type", "application/json")
            .body(body)
            .unwrap(),
    )
    .await
    .unwrap()
}

#[tokio::test]
async fn health_returns_ok() {
    let app = router(":memory:").unwrap();
    let response = app
        .oneshot(
            http::Request::builder()
                .uri("/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), 200);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(&body[..], br#"{"ok":true}"#);
}

#[tokio::test]
async fn task_propose_and_items_use_same_service_path() {
    let tmp = tempfile::tempdir().unwrap();
    let db_path = tmp.path().join("todo.sqlite");
    let app = router(&db_path).unwrap();
    let response = app
        .oneshot(
            http::Request::builder()
                .method("POST")
                .uri("/tasks/propose")
                .header("content-type", "application/json")
                .body(Body::from(json!({"title":"DB 확인"}).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), 200);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let item: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(item["title"], "DB 확인");
    assert_eq!(item["status"], "proposed");
    assert_eq!(item["proposed_by"], "agent");

    let fresh_app = router(&db_path).unwrap();
    let response = fresh_app
        .oneshot(
            http::Request::builder()
                .uri("/items")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let items: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(items.as_array().unwrap().len(), 1);
    assert_eq!(items[0]["title"], "DB 확인");
}

#[tokio::test]
async fn parallel_item_reads_do_not_rerun_schema_migration() {
    let tmp = tempfile::tempdir().unwrap();
    let db_path = tmp.path().join("todo.sqlite");
    let app = router(&db_path).unwrap();

    let handles = (0..24).map(|index| {
        let app = app.clone();
        let uri = match index % 6 {
            0 => "/items?type=area",
            1 => "/items?type=project",
            2 => "/items?type=routine",
            3 => "/items?type=task",
            4 => "/items?type=event",
            _ => "/items?type=goal",
        };

        tokio::spawn(async move { empty_request(app, "GET", uri).await.status() })
    });

    for handle in handles {
        assert_eq!(handle.await.unwrap(), 200);
    }
}

#[tokio::test]
async fn memory_router_keeps_state_for_multiple_requests() {
    let app = router(":memory:").unwrap();
    let response = app
        .clone()
        .oneshot(
            http::Request::builder()
                .method("POST")
                .uri("/tasks/propose")
                .header("content-type", "application/json")
                .body(Body::from(json!({"title":"메모리 유지"}).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), 200);

    let response = app
        .oneshot(
            http::Request::builder()
                .uri("/items")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    let items = body_json(response).await;
    assert_eq!(items.as_array().unwrap().len(), 1);
    assert_eq!(items[0]["title"], "메모리 유지");
}

#[tokio::test]
async fn file_router_keeps_state_for_multiple_requests() {
    let tmp = tempfile::tempdir().unwrap();
    let db_path = tmp.path().join("todo.sqlite");
    let app = router(&db_path).unwrap();
    let response = app
        .clone()
        .oneshot(
            http::Request::builder()
                .method("POST")
                .uri("/tasks/propose")
                .header("content-type", "application/json")
                .body(Body::from(json!({"title":"메모리 유지"}).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), 200);

    let response = app
        .oneshot(
            http::Request::builder()
                .uri("/items")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    let items = body_json(response).await;
    assert_eq!(items.as_array().unwrap().len(), 1);
    assert_eq!(items[0]["title"], "메모리 유지");
}

#[tokio::test]
async fn api_create_and_patch_round_trips_tags() {
    let app = router(":memory:").unwrap();

    let response = json_request(
        app.clone(),
        "POST",
        "/tasks/propose",
        serde_json::json!({
            "title": "Draft planner",
            "actor": "user",
            "tags": ["deep-work", "planning", "deep-work", ""]
        }),
    )
    .await;
    assert_eq!(response.status(), 200);
    let created = body_json(response).await;

    assert_eq!(
        created["tags"],
        serde_json::json!(["deep-work", "planning"])
    );

    let id = created["id"].as_str().expect("created item id");
    let response = json_request(
        app,
        "PATCH",
        format!("/items/{id}"),
        serde_json::json!({
            "tags": ["home", "admin"]
        }),
    )
    .await;
    assert_eq!(response.status(), 200);
    let patched = body_json(response).await;

    assert_eq!(patched["tags"], serde_json::json!(["home", "admin"]));
}

#[tokio::test]
async fn create_area_returns_active_area() {
    let app = router(":memory:").unwrap();
    let response = app
        .oneshot(
            http::Request::builder()
                .method("POST")
                .uri("/areas")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({"title":"재정","review_cycle":"weekly","standard":"월 1회 점검"})
                        .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), 200);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let item: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(item["type"], "area");
    assert_eq!(item["title"], "재정");
    assert_eq!(item["status"], "active");
    assert_eq!(item["review_cycle"], "weekly");
    assert_eq!(item["standard"], "월 1회 점검");
}

#[tokio::test]
async fn approve_and_complete_items_return_mutated_items() {
    let tmp = tempfile::tempdir().unwrap();
    let db_path = tmp.path().join("todo.sqlite");
    let app = router(&db_path).unwrap();
    let response = app
        .oneshot(
            http::Request::builder()
                .method("POST")
                .uri("/tasks/propose")
                .header("content-type", "application/json")
                .body(Body::from(json!({"title":"승인 후 완료"}).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let item: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let id = item["id"].as_str().unwrap();

    let app = router(&db_path).unwrap();
    let response = app
        .oneshot(
            http::Request::builder()
                .method("POST")
                .uri(format!("/items/{id}/approve"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let item: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(item["id"], id);
    assert_eq!(item["status"], "approved");
    assert_eq!(item["approved_by"], "user");

    let app = router(&db_path).unwrap();
    let response = app
        .oneshot(
            http::Request::builder()
                .method("POST")
                .uri(format!("/items/{id}/complete"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let item: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(item["id"], id);
    assert_eq!(item["status"], "completed");
    assert!(!item["completed_at"].is_null());

    let app = router(&db_path).unwrap();
    let response = empty_request(app, "POST", format!("/items/{id}/reopen")).await;
    assert_eq!(response.status(), 200);
    let item = body_json(response).await;
    assert_eq!(item["id"], id);
    assert_eq!(item["status"], "active");
    assert!(item["completed_at"].is_null());

    let app = router(&db_path).unwrap();
    let response = empty_request(app, "POST", format!("/items/{id}/reopen")).await;
    assert_eq!(response.status(), 400);
    let error = body_json(response).await;
    assert_eq!(error["code"], "policy_error");
    assert_eq!(error["detail"], "Cannot reopen task in status active");
}

#[tokio::test]
async fn items_query_filters_and_orders_items() {
    let tmp = tempfile::tempdir().unwrap();
    let db_path = tmp.path().join("todo.sqlite");
    let mut ids = Vec::new();
    for title in ["첫 번째", "두 번째"] {
        let app = router(&db_path).unwrap();
        let response = app
            .oneshot(
                http::Request::builder()
                    .method("POST")
                    .uri("/tasks/propose")
                    .header("content-type", "application/json")
                    .body(Body::from(json!({"title":title}).to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), 200);
        ids.push(
            body_json(response).await["id"]
                .as_str()
                .unwrap()
                .to_string(),
        );
    }
    let conn = rusqlite::Connection::open(&db_path).unwrap();
    conn.execute(
        "UPDATE items SET created_at = ?1 WHERE id = ?2",
        ("2026-05-31T12:00:00Z", ids[0].as_str()),
    )
    .unwrap();
    conn.execute(
        "UPDATE items SET created_at = ?1 WHERE id = ?2",
        ("2026-05-31T12:00:01Z", ids[1].as_str()),
    )
    .unwrap();

    let app = router(&db_path).unwrap();
    let response = app
        .oneshot(
            http::Request::builder()
                .uri("/items?status=proposed&type=task")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    let items = body_json(response).await;
    assert_eq!(items.as_array().unwrap().len(), 2);
    assert_eq!(items[0]["title"], "두 번째");
    assert_eq!(items[1]["title"], "첫 번째");

    let app = router(&db_path).unwrap();
    let response = app
        .oneshot(
            http::Request::builder()
                .uri("/items?status=&type=&include_archived=1")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    let items = body_json(response).await;
    assert_eq!(items.as_array().unwrap().len(), 2);
}

#[tokio::test]
async fn operational_propose_routes_return_persisted_items() {
    let tmp = tempfile::tempdir().unwrap();
    let db_path = tmp.path().join("todo.sqlite");

    let response = json_request(
        router(&db_path).unwrap(),
        "POST",
        "/areas",
        json!({"title":"운영"}),
    )
    .await;
    assert_eq!(response.status(), 200);

    let response = json_request(
        router(&db_path).unwrap(),
        "POST",
        "/projects/propose",
        json!({
            "title":"Rust cutover",
            "area":"운영",
            "definition_of_done":"copied DB smoke passes",
            "outcome":"safe cutover",
            "due":"2026-06-10",
            "actor":"user"
        }),
    )
    .await;
    assert_eq!(response.status(), 200);
    let project = body_json(response).await;
    assert_eq!(project["type"], "project");
    assert_eq!(project["status"], "approved");
    assert_eq!(project["definition_of_done"], "copied DB smoke passes");

    let response = json_request(
        router(&db_path).unwrap(),
        "POST",
        "/routines/propose",
        json!({
            "title":"매일 점검",
            "area":"운영",
            "recurrence_rule":"daily",
            "materialization_policy":"single_open",
            "actor":"user"
        }),
    )
    .await;
    assert_eq!(response.status(), 200);
    let routine = body_json(response).await;
    assert_eq!(routine["type"], "routine");
    assert_eq!(routine["recurrence_rule"], "daily");

    let response = json_request(
        router(&db_path).unwrap(),
        "POST",
        "/events/propose",
        json!({
            "title":"운영 회의",
            "scheduled":"2026-06-01 10:00",
            "area":"운영",
            "location":"회의실",
            "participants":["팀"],
            "commitment_type":"meeting",
            "actor":"user"
        }),
    )
    .await;
    assert_eq!(response.status(), 200);
    let event = body_json(response).await;
    assert_eq!(event["type"], "event");
    assert_eq!(event["status"], "approved");
    assert_eq!(event["metadata_"]["location"], "회의실");
    assert_eq!(event["metadata_"]["participants"][0], "팀");

    let response = json_request(
        router(&db_path).unwrap(),
        "POST",
        "/goals/propose",
        json!({
            "title":"6월 운영 목표",
            "horizon":"month",
            "scheduled":"2026-06-01",
            "actor":"user",
            "note":"월간 운영 안정화"
        }),
    )
    .await;
    assert_eq!(response.status(), 200);
    let goal = body_json(response).await;
    assert_eq!(goal["type"], "goal");
    assert_eq!(goal["status"], "approved");
    assert_eq!(goal["horizon"], "month");
    assert_eq!(goal["scheduled"], "2026-06-01");
    assert_eq!(goal["note"], "월간 운영 안정화");

    let response = empty_request(router(&db_path).unwrap(), "GET", "/items?type=project").await;
    assert_eq!(response.status(), 200);
    let items = body_json(response).await;
    assert_eq!(items.as_array().unwrap().len(), 1);
    assert_eq!(items[0]["title"], "Rust cutover");
}

#[tokio::test]
async fn operational_transition_routes_return_mutated_items() {
    let tmp = tempfile::tempdir().unwrap();
    let db_path = tmp.path().join("todo.sqlite");

    let response = json_request(
        router(&db_path).unwrap(),
        "POST",
        "/tasks/propose",
        json!({"title":"활성화", "actor":"user"}),
    )
    .await;
    assert_eq!(response.status(), 200);
    let item = body_json(response).await;
    let active_id = item["id"].as_str().unwrap();

    let response = json_request(
        router(&db_path).unwrap(),
        "POST",
        format!("/items/{active_id}/activate"),
        json!({"reason":"start"}),
    )
    .await;
    assert_eq!(response.status(), 200);
    assert_eq!(body_json(response).await["status"], "active");

    let response = json_request(
        router(&db_path).unwrap(),
        "POST",
        format!("/items/{active_id}/pause"),
        json!({"reason":"blocked"}),
    )
    .await;
    assert_eq!(response.status(), 200);
    assert_eq!(body_json(response).await["status"], "paused");

    let response = json_request(
        router(&db_path).unwrap(),
        "POST",
        format!("/items/{active_id}/resume"),
        json!({"reason":"clear"}),
    )
    .await;
    assert_eq!(response.status(), 200);
    assert_eq!(body_json(response).await["status"], "active");

    for (title, route, status) in [
        ("보관", "archive", "archived"),
        ("폐기", "drop", "dropped"),
        ("취소", "cancel", "cancelled"),
    ] {
        let response = json_request(
            router(&db_path).unwrap(),
            "POST",
            "/tasks/propose",
            json!({"title":title, "actor":"user"}),
        )
        .await;
        assert_eq!(response.status(), 200);
        let item = body_json(response).await;
        let id = item["id"].as_str().unwrap();
        let response = json_request(
            router(&db_path).unwrap(),
            "POST",
            format!("/items/{id}/{route}"),
            json!({"reason":"terminal"}),
        )
        .await;
        assert_eq!(response.status(), 200);
        assert_eq!(body_json(response).await["status"], status);
    }
}

#[tokio::test]
async fn patch_item_and_archive_endpoint_use_persisted_state() {
    let tmp = tempfile::tempdir().unwrap();
    let db_path = tmp.path().join("todo.sqlite");

    let response = json_request(
        router(&db_path).unwrap(),
        "POST",
        "/tasks/propose",
        json!({"title":"수정 전", "actor":"user"}),
    )
    .await;
    assert_eq!(response.status(), 200);
    let item = body_json(response).await;
    let id = item["id"].as_str().unwrap();

    let response = json_request(
        router(&db_path).unwrap(),
        "PATCH",
        format!("/items/{id}"),
        json!({
            "title":"수정 후",
            "description":"API update",
            "priority":3,
            "reason":"patch"
        }),
    )
    .await;
    assert_eq!(response.status(), 200);
    let item = body_json(response).await;
    assert_eq!(item["title"], "수정 후");
    assert_eq!(item["description"], "API update");
    assert_eq!(item["priority"], 3);

    let response = empty_request(router(&db_path).unwrap(), "GET", "/items?query=API").await;
    assert_eq!(response.status(), 200);
    let items = body_json(response).await;
    assert_eq!(items.as_array().unwrap().len(), 1);
    assert_eq!(items[0]["id"], id);

    let response = json_request(
        router(&db_path).unwrap(),
        "POST",
        format!("/items/{id}/archive"),
        json!({}),
    )
    .await;
    assert_eq!(response.status(), 200);

    let response = empty_request(router(&db_path).unwrap(), "GET", "/items/archive").await;
    assert_eq!(response.status(), 200);
    let items = body_json(response).await;
    assert_eq!(items.as_array().unwrap().len(), 1);
    assert_eq!(items[0]["title"], "수정 후");
}

#[tokio::test]
async fn api_patch_updates_goal_horizon_with_valid_anchor() {
    let home = TestHome::new();
    let db_path = home.db_path();
    init_schema(&rusqlite::Connection::open(&db_path).unwrap()).unwrap();

    let response = json_request(
        router(&db_path).unwrap(),
        "POST",
        "/goals/propose",
        json!({
            "title":"분기 목표",
            "horizon":"month",
            "scheduled":"2026-07-01",
            "actor":"user"
        }),
    )
    .await;
    assert_eq!(response.status(), 200);
    let goal = body_json(response).await;
    let goal_id = goal["id"].as_str().unwrap();

    let response = json_request(
        router(&db_path).unwrap(),
        "PATCH",
        format!("/items/{goal_id}"),
        json!({
            "horizon":"year",
            "scheduled":"2026-01-01"
        }),
    )
    .await;
    assert_eq!(response.status(), 200);
    let goal = body_json(response).await;
    assert_eq!(goal["horizon"], "year");
    assert_eq!(goal["scheduled"], "2026-01-01");
}

#[tokio::test]
async fn api_patch_rejects_invalid_goal_horizon_anchor() {
    let home = TestHome::new();
    let db_path = home.db_path();
    init_schema(&rusqlite::Connection::open(&db_path).unwrap()).unwrap();

    let response = json_request(
        router(&db_path).unwrap(),
        "POST",
        "/goals/propose",
        json!({
            "title":"분기 목표",
            "horizon":"month",
            "scheduled":"2026-07-01",
            "actor":"user"
        }),
    )
    .await;
    assert_eq!(response.status(), 200);
    let goal = body_json(response).await;
    let goal_id = goal["id"].as_str().unwrap();

    let response = json_request(
        router(&db_path).unwrap(),
        "PATCH",
        format!("/items/{goal_id}"),
        json!({"horizon":"year"}),
    )
    .await;
    assert_eq!(response.status(), 400);
    let body = body_json(response).await;
    assert_eq!(body["code"], "goal_invalid_anchor");
    assert_eq!(body["horizon"], "year");
    assert_eq!(body["scheduled"], "2026-07-01");
    assert!(
        body["detail"]
            .as_str()
            .unwrap()
            .contains("canonical start of its year period")
    );
}

#[tokio::test]
async fn api_patch_rejects_invalid_goal_parent() {
    let home = TestHome::new();
    let db_path = home.db_path();
    init_schema(&rusqlite::Connection::open(&db_path).unwrap()).unwrap();

    let response = json_request(
        router(&db_path).unwrap(),
        "POST",
        "/goals/propose",
        json!({
            "title":"월간 부모 목표",
            "horizon":"month",
            "scheduled":"2026-07-01",
            "actor":"user"
        }),
    )
    .await;
    assert_eq!(response.status(), 200);
    let month_goal = body_json(response).await;
    let month_goal_id = month_goal["id"].as_str().unwrap();

    let response = json_request(
        router(&db_path).unwrap(),
        "POST",
        "/goals/propose",
        json!({
            "title":"주간 자식 목표",
            "horizon":"week",
            "scheduled":"2026-07-06",
            "parent_id": month_goal_id,
            "actor":"user"
        }),
    )
    .await;
    assert_eq!(response.status(), 200);
    let week_goal = body_json(response).await;
    let week_goal_id = week_goal["id"].as_str().unwrap();

    let response = json_request(
        router(&db_path).unwrap(),
        "PATCH",
        format!("/items/{week_goal_id}"),
        json!({
            "horizon": "year",
            "scheduled": "2026-01-01"
        }),
    )
    .await;
    assert_eq!(response.status(), 400);
    let body = body_json(response).await;
    assert_eq!(body["code"], "goal_parent_horizon_not_coarser");
    assert_eq!(body["parent_horizon"], "month");
    assert_eq!(body["child_horizon"], "year");
    assert!(
        body["detail"]
            .as_str()
            .unwrap()
            .contains("strictly coarser")
    );
}

#[tokio::test]
async fn api_propose_rejects_goal_parent_horizon_equal_to_child() {
    let home = TestHome::new();
    let db_path = home.db_path();
    init_schema(&rusqlite::Connection::open(&db_path).unwrap()).unwrap();

    let response = json_request(
        router(&db_path).unwrap(),
        "POST",
        "/goals/propose",
        json!({
            "title":"연간 부모 목표",
            "horizon":"year",
            "scheduled":"2026-01-01",
            "actor":"user"
        }),
    )
    .await;
    assert_eq!(response.status(), 200);
    let parent = body_json(response).await;

    let response = json_request(
        router(&db_path).unwrap(),
        "POST",
        "/goals/propose",
        json!({
            "title":"동일 기간 자식 목표",
            "horizon":"year",
            "scheduled":"2027-01-01",
            "parent_id": parent["id"].as_str().unwrap(),
            "actor":"user"
        }),
    )
    .await;
    assert_eq!(response.status(), 400);
    let body = body_json(response).await;
    assert_eq!(body["code"], "goal_parent_horizon_not_coarser");
    assert_eq!(body["parent_horizon"], "year");
    assert_eq!(body["child_horizon"], "year");
    assert!(
        body["detail"]
            .as_str()
            .unwrap()
            .contains("strictly coarser")
    );
}

#[tokio::test]
async fn api_patch_updates_event_metadata() {
    let home = TestHome::new();
    let db_path = home.db_path();
    init_schema(&rusqlite::Connection::open(&db_path).unwrap()).unwrap();

    let response = json_request(
        router(&db_path).unwrap(),
        "POST",
        "/events/propose",
        json!({
            "title":"점검 미팅",
            "scheduled":"2026-07-01T09:00:00Z",
            "actor":"user",
            "commitment_type":"meeting"
        }),
    )
    .await;
    assert_eq!(response.status(), 200);
    let event = body_json(response).await;
    let event_id = event["id"].as_str().unwrap();

    let response = json_request(
        router(&db_path).unwrap(),
        "PATCH",
        format!("/items/{event_id}"),
        json!({
            "location":"회의실",
            "participants":["나", "팀"],
            "commitment_type":"review"
        }),
    )
    .await;
    assert_eq!(response.status(), 200);
    let event = body_json(response).await;
    assert_eq!(event["metadata_"]["location"], "회의실");
    assert_eq!(event["metadata_"]["participants"][0], "나");
    assert_eq!(event["metadata_"]["participants"][1], "팀");
    assert_eq!(event["metadata_"]["commitment_type"], "review");
}

#[tokio::test]
async fn api_patch_rejects_event_metadata_for_non_event_items() {
    let home = TestHome::new();
    let db_path = home.db_path();
    init_schema(&rusqlite::Connection::open(&db_path).unwrap()).unwrap();

    let response = json_request(
        router(&db_path).unwrap(),
        "POST",
        "/tasks/propose",
        json!({
            "title":"일반 작업",
            "actor":"user"
        }),
    )
    .await;
    assert_eq!(response.status(), 200);
    let task = body_json(response).await;
    let task_id = task["id"].as_str().unwrap();

    let response = json_request(
        router(&db_path).unwrap(),
        "PATCH",
        format!("/items/{task_id}"),
        json!({"location":"회의실"}),
    )
    .await;
    assert_eq!(response.status(), 400);
    let body = body_json(response).await;
    assert!(
        body["detail"]
            .as_str()
            .unwrap()
            .contains("Event metadata fields can only be updated on event items")
    );
}

#[tokio::test]
async fn service_errors_return_detail_body() {
    let app = router(":memory:").unwrap();
    let response = app
        .oneshot(
            http::Request::builder()
                .method("POST")
                .uri("/items/missing/approve")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), 404);
    let body = body_json(response).await;
    assert!(body["detail"].as_str().unwrap().contains("missing"));
}

#[tokio::test]
async fn goal_query_filters_and_parent_patch_reach_service_layer() {
    let tmp = tempfile::tempdir().unwrap();
    let db_path = tmp.path().join("todo.sqlite");

    let response = json_request(
        router(&db_path).unwrap(),
        "POST",
        "/goals/propose",
        json!({
            "title":"2026 목표",
            "horizon":"year",
            "scheduled":"2026-01-01",
            "actor":"user"
        }),
    )
    .await;
    assert_eq!(response.status(), 200);
    let year_goal = body_json(response).await;
    let year_goal_id = year_goal["id"].as_str().unwrap();

    let response = json_request(
        router(&db_path).unwrap(),
        "POST",
        "/goals/propose",
        json!({
            "title":"6월 목표",
            "horizon":"month",
            "scheduled":"2026-06-01",
            "parent_id": year_goal_id,
            "actor":"user"
        }),
    )
    .await;
    assert_eq!(response.status(), 200);
    let month_goal = body_json(response).await;
    let month_goal_id = month_goal["id"].as_str().unwrap();

    let response = empty_request(
        router(&db_path).unwrap(),
        "GET",
        format!("/items?type=goal&parent_id={year_goal_id}"),
    )
    .await;
    assert_eq!(response.status(), 200);
    let items = body_json(response).await;
    assert_eq!(items.as_array().unwrap().len(), 1);
    assert_eq!(items[0]["id"], month_goal_id);

    let response = empty_request(
        router(&db_path).unwrap(),
        "GET",
        "/items?type=goal&horizon=month&scheduled=2026-06-01",
    )
    .await;
    assert_eq!(response.status(), 200);
    let items = body_json(response).await;
    assert_eq!(items.as_array().unwrap().len(), 1);
    assert_eq!(items[0]["id"], month_goal_id);

    let response = json_request(
        router(&db_path).unwrap(),
        "POST",
        "/tasks/propose",
        json!({"title":"목표에 연결", "actor":"user"}),
    )
    .await;
    assert_eq!(response.status(), 200);
    let task = body_json(response).await;
    let task_id = task["id"].as_str().unwrap();

    let response = json_request(
        router(&db_path).unwrap(),
        "PATCH",
        format!("/items/{task_id}"),
        json!({
            "parent_id": month_goal_id,
            "scheduled": "2026-06-08"
        }),
    )
    .await;
    assert_eq!(response.status(), 200);
    let task = body_json(response).await;
    assert_eq!(task["parent_id"], month_goal_id);
    assert_eq!(task["scheduled"], "2026-06-08");
}

#[tokio::test]
async fn request_validation_errors_return_detail_body() {
    let app = router(":memory:").unwrap();
    let response = app
        .oneshot(
            http::Request::builder()
                .method("POST")
                .uri("/tasks/propose")
                .header("content-type", "application/json")
                .body(Body::from(json!({}).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), 400);
    let body = body_json(response).await;
    assert!(body["detail"].as_str().unwrap().contains("title"));
}

#[tokio::test]
async fn goal_propose_returns_proposed_item() {
    let tmp = tempfile::tempdir().unwrap();
    let db_path = tmp.path().join("todo.sqlite");

    let response = json_request(
        router(&db_path).unwrap(),
        "POST",
        "/goals/propose",
        json!({"title":"Q3 OKR","horizon":"month","scheduled":"2026-06-01"}),
    )
    .await;
    assert_eq!(response.status(), 200);
    let item = body_json(response).await;
    // Mirrors the CLI assertion (goal_propose_prints_proposed_json) => state parity.
    assert_eq!(item["type"], "goal");
    assert_eq!(item["status"], "proposed");
    assert_eq!(item["proposed_by"], "agent");
    // SC4 non-bypass: no body field sets status; an agent-created goal cannot
    // be created `active` directly — the service state machine returns `proposed`.
    assert_ne!(item["status"], "active");
}

#[tokio::test]
async fn view_routes_return_json() {
    let tmp = tempfile::tempdir().unwrap();
    let db_path = tmp.path().join("todo.sqlite");

    let response = empty_request(
        router(&db_path).unwrap(),
        "GET",
        "/views/agenda?date=2026-06-26",
    )
    .await;
    assert_eq!(response.status(), 200);
    let agenda = body_json(response).await;
    assert!(agenda.is_array(), "agenda body must be a JSON array");

    let response = empty_request(
        router(&db_path).unwrap(),
        "GET",
        "/views/date-range?from=2026-06-01&to=2026-06-30",
    )
    .await;
    assert_eq!(response.status(), 200);
    let range = body_json(response).await;
    assert!(range.is_array(), "date-range body must be a JSON array");

    // Same PeriodView shape (period_key + roots) the CLI emits => view parity.
    let response = empty_request(
        router(&db_path).unwrap(),
        "GET",
        "/views/period?horizon=month&period=2026-06-01",
    )
    .await;
    assert_eq!(response.status(), 200);
    let period = body_json(response).await;
    assert!(
        period["period_key"].is_string(),
        "period body must carry period_key"
    );
    assert!(
        period["roots"].is_array(),
        "period body must carry a roots array"
    );
}

#[tokio::test]
async fn patch_item_parent_id_links_and_is_not_null() {
    let tmp = tempfile::tempdir().unwrap();
    let db_path = tmp.path().join("todo.sqlite");

    let response = json_request(
        router(&db_path).unwrap(),
        "POST",
        "/goals/propose",
        json!({"title":"분기 목표","horizon":"month","scheduled":"2026-06-01"}),
    )
    .await;
    assert_eq!(response.status(), 200);
    let goal = body_json(response).await;
    let goal_id = goal["id"].as_str().unwrap().to_string();

    let response = json_request(
        router(&db_path).unwrap(),
        "POST",
        "/tasks/propose",
        json!({"title":"목표에 연결할 일"}),
    )
    .await;
    assert_eq!(response.status(), 200);
    let task = body_json(response).await;
    let task_id = task["id"].as_str().unwrap().to_string();

    let response = json_request(
        router(&db_path).unwrap(),
        "PATCH",
        format!("/items/{task_id}"),
        json!({"parent_id": goal_id, "scheduled":"2026-06-29"}),
    )
    .await;
    assert_eq!(response.status(), 200);
    let linked = body_json(response).await;
    // Pitfall-1 regression guard: parent_id must be the goal id, NOT null
    // (locks the handlers.rs:212 de-hardcode against a silent revert).
    assert!(!linked["parent_id"].is_null());
    assert_eq!(linked["parent_id"], goal_id);
    assert_eq!(linked["scheduled"], "2026-06-29");
}

#[tokio::test]
async fn view_period_bad_horizon_returns_400() {
    let tmp = tempfile::tempdir().unwrap();
    let db_path = tmp.path().join("todo.sqlite");

    // Present-but-invalid horizon => TodoError::Validation => HTTP 400 with a
    // detail body. Pairs with the CLI exit-2 test => SC3 rejection parity.
    let response = empty_request(
        router(&db_path).unwrap(),
        "GET",
        "/views/period?horizon=bogus&period=2026-06-01",
    )
    .await;
    assert_eq!(response.status(), 400);
    let body = body_json(response).await;
    assert!(body["detail"].is_string(), "400 body must carry a detail");
}

#[tokio::test]
async fn exports_today_md_route_is_not_available() {
    let tmp = tempfile::tempdir().unwrap();
    let db_path = tmp.path().join("todo.sqlite");
    let app = router(&db_path).unwrap();
    let response = app
        .oneshot(
            http::Request::builder()
                .method("POST")
                .uri("/tasks/propose")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({"title":"오늘 보기","actor":"user","scheduled":"today"}).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), 200);

    let app = router(&db_path).unwrap();
    let response = app
        .oneshot(
            http::Request::builder()
                .method("POST")
                .uri("/tasks/propose")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({"title":"미래 보기","actor":"user","scheduled":"2999-01-01"})
                        .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), 200);

    let app = router(&db_path).unwrap();
    let response = app
        .oneshot(
            http::Request::builder()
                .uri("/exports/today.md")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), 404);
}
