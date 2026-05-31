use axum::body::Body;
use http_body_util::BodyExt;
use oracle_todo::interfaces::api::router;
use serde_json::json;
use tower::ServiceExt;

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
}
