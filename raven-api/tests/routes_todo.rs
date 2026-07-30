use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use raven_api::{AuthMode, RavenApiConfig, router};
use serde_json::Value;
use tower::ServiceExt;

#[tokio::test]
async fn todo_items_are_nested_under_v1_without_router_side_effects() {
    let temp = tempfile::tempdir().unwrap();
    let home = temp.path().join("raven");
    let config = RavenApiConfig {
        todo_db: home.join("todo.sqlite"),
        ledger_db: home.join("ledger.sqlite"),
        health_db: home.join("health.sqlite"),
        health_media_dir: home.join("media"),
        auth: AuthMode::UiSession {
            token: "test".into(),
        },
    };
    let app = router(config).unwrap();
    assert!(!home.exists());
    let response = app
        .oneshot(
            Request::get("/api/v1/todo/items")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn oversized_todo_json_uses_the_common_payload_envelope() {
    let temp = tempfile::tempdir().unwrap();
    let app = router(RavenApiConfig {
        todo_db: temp.path().join("todo.sqlite"),
        ledger_db: temp.path().join("ledger.sqlite"),
        health_db: temp.path().join("health.sqlite"),
        health_media_dir: temp.path().join("media"),
        auth: AuthMode::UiSession {
            token: "test".into(),
        },
    })
    .unwrap();
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
    let app = router(RavenApiConfig {
        todo_db: temp.path().join("todo.sqlite"),
        ledger_db: temp.path().join("ledger.sqlite"),
        health_db: temp.path().join("health.sqlite"),
        health_media_dir: temp.path().join("media"),
        auth: AuthMode::UiSession {
            token: "test".into(),
        },
    })
    .unwrap();
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
