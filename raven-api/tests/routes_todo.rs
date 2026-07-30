use axum::body::Body;
use axum::http::{Request, StatusCode};
use raven_api::{AuthMode, RavenApiConfig, router};
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
