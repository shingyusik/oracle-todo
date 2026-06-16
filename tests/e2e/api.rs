use axum::body::Body;
use http_body_util::BodyExt;
use oracle_todo::interfaces::api::router;
use serde_json::{Value, json};
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
    assert_eq!(item["proposed_by"], "oracle");

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

    assert_eq!(response.status(), 400);
    let body = body_json(response).await;
    assert!(body["detail"].as_str().unwrap().contains("missing"));
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
async fn today_export_returns_markdown_text() {
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

    assert_eq!(response.status(), 200);
    let content_type = response.headers().get(http::header::CONTENT_TYPE).unwrap();
    assert_eq!(content_type, "text/markdown; charset=utf-8");
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let markdown = String::from_utf8(body.to_vec()).unwrap();
    assert!(markdown.starts_with("# Today\n\n"));
    assert!(markdown.contains("- [ ] **오늘 보기** `task approved scheduled:today`"));
    assert!(markdown.contains("미래 보기"));
}
