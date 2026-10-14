use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use raven_api::{AuthMode, RavenApiConfig, router};
use std::process::Command;
use tower::ServiceExt;

#[test]
fn cli_mutation_notifies_an_independent_ui_router() {
    let home = tempfile::tempdir().unwrap();
    let run = |args: &[&str]| {
        let output = Command::new(env!("CARGO_BIN_EXE_raven"))
            .args(["--home", home.path().to_str().unwrap()])
            .args(args)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    };
    run(&["init"]);
    tokio::runtime::Runtime::new().unwrap().block_on(async {
        let app = router(RavenApiConfig {
            todo_db: home.path().join("todo.sqlite"),
            ledger_db: home.path().join("ledger.sqlite"),
            health_db: home.path().join("health.sqlite"),
            health_media_dir: home.path().join("media/health"),
            local_offset: time::UtcOffset::UTC,
            auth: AuthMode::UiSession {
                token: "test".into(),
            },
        })
        .unwrap();
        let response = app
            .oneshot(
                Request::get("/api/v1/changes")
                    .header("cookie", "raven_session=test")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let mut body = response.into_body();
        tokio::time::timeout(std::time::Duration::from_secs(4), body.frame())
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        run(&["todo", "task", "create", "External CLI task"]);
        let frame = tokio::time::timeout(std::time::Duration::from_secs(4), body.frame())
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        let data = frame.into_data().unwrap();
        let text = std::str::from_utf8(&data).unwrap();
        assert!(text.contains("event: changes"), "{text}");
        assert!(text.contains(r#"{"domains":["todo"]}"#), "{text}");
    });
}
