use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use raven_api::{AuthMode, RavenApiConfig, router};
use tower::ServiceExt;

fn app(home: &std::path::Path) -> axum::Router {
    router(RavenApiConfig {
        todo_db: home.join("todo.sqlite"),
        ledger_db: home.join("ledger.sqlite"),
        health_db: home.join("health.sqlite"),
        health_media_dir: home.join("media/health"),
        local_offset: time::UtcOffset::from_hms(9, 0, 0).unwrap(),
        auth: AuthMode::UiSession {
            token: "test".into(),
        },
    })
    .unwrap()
}

#[tokio::test]
async fn domain_reads_never_initialize_a_home_and_legacy_settings_are_gone() {
    let temp = tempfile::tempdir().unwrap();
    let home = temp.path().join("missing");
    let app = app(&home);
    for path in [
        "/api/v1/todo/items",
        "/api/v1/ledger/entries",
        "/api/v1/health/diet",
    ] {
        let response = app
            .clone()
            .oneshot(
                Request::get(path)
                    .header(header::COOKIE, "raven_session=test")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert!(!response.status().is_success(), "{path}");
        assert!(!home.exists(), "{path} created a data home");
    }
    let response = app
        .oneshot(
            Request::get("/api/v1/todo/settings/planner")
                .header(header::COOKIE, "raven_session=test")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    assert!(!home.exists());
}

#[tokio::test]
async fn todo_read_rejects_future_schema_without_modifying_it() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("todo.sqlite");
    let db = todo_engine::infrastructure::sqlite::connect(path.to_str().unwrap()).unwrap();
    db.execute_batch("PRAGMA user_version=999;").unwrap();
    drop(db);
    let before = std::fs::read(&path).unwrap();
    let response = app(temp.path())
        .oneshot(
            Request::get("/api/v1/todo/items")
                .header(header::COOKIE, "raven_session=test")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert!(!response.status().is_success());
    assert_eq!(std::fs::read(path).unwrap(), before);
}
