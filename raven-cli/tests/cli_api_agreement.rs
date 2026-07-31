use std::path::Path;
use std::process::{Command, Output};

use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use http_body_util::BodyExt;
use raven_api::{AuthMode, RavenApiConfig, router};
use serde_json::{Value, json};
use tower::ServiceExt;

const SESSION: &str = "agreement-test-session";

fn raven(home: &Path, args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_raven"))
        .env("RAVEN_CONSOLE_LOG", "off")
        .args(["--home", home.to_str().unwrap()])
        .args(args)
        .output()
        .unwrap()
}

fn cli_success(home: &Path, args: &[&str]) -> Value {
    let output = raven(home, args);
    assert!(
        output.status.success(),
        "{args:?}\n{}",
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).unwrap()
}

fn app(home: &Path) -> axum::Router {
    router(RavenApiConfig {
        todo_db: home.join("todo.sqlite"),
        ledger_db: home.join("ledger.sqlite"),
        health_db: home.join("health.sqlite"),
        health_media_dir: home.join("media/health"),
        local_offset: time::UtcOffset::UTC,
        auth: AuthMode::UiSession {
            token: SESSION.into(),
        },
    })
    .unwrap()
}

fn json_request(method: &str, path: &str, value: Value) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(path)
        .header(header::COOKIE, format!("raven_session={SESSION}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(value.to_string()))
        .unwrap()
}

async fn error(response: axum::response::Response) -> Value {
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    serde_json::from_slice(&bytes).unwrap()
}

#[tokio::test]
async fn cli_and_api_error_classes_agree_for_each_domain() {
    let temp = tempfile::tempdir().unwrap();
    let home = temp.path();
    assert!(raven(home, &["init"]).status.success());
    cli_success(
        home,
        &[
            "ledger",
            "currency",
            "create",
            "--code",
            "KRW",
            "--name",
            "Won",
            "--symbol",
            "won",
            "--decimal-places",
            "0",
        ],
    );
    cli_success(
        home,
        &["ledger", "account-category", "create", "--name", "Cash"],
    );
    cli_success(
        home,
        &[
            "ledger",
            "account",
            "create",
            "--name",
            "wallet",
            "--category",
            "Cash",
            "--currency",
            "KRW",
            "--opening-balance",
            "0",
        ],
    );
    let app = app(home);

    let ledger_cli = raven(
        home,
        &[
            "ledger",
            "entry",
            "add",
            "--date",
            "2026-07-31",
            "--written-at",
            "2026-07-31T00:00:00Z",
            "--type",
            "transfer_out",
            "--amount",
            "1",
            "--currency",
            "KRW",
            "--account",
            "wallet",
            "--content",
            "invalid transfer row",
        ],
    );
    let ledger_http = app
        .clone()
        .oneshot(json_request(
            "POST",
            "/api/v1/ledger/entries",
            json!({
                "date": "2026-07-31",
                "written_at": "2026-07-31T00:00:00Z",
                "content": "invalid transfer row",
                "account": "wallet",
                "entry_type": "transfer_out",
                "amount": "1",
                "currency": "KRW"
            }),
        ))
        .await
        .unwrap();
    assert_eq!(ledger_cli.status.code(), Some(2));
    assert_eq!(ledger_http.status(), StatusCode::BAD_REQUEST);
    assert_eq!(error(ledger_http).await["code"], "validation_error");

    let todo_cli = raven(home, &["todo", "complete", "missing_item"]);
    let todo_http = app
        .clone()
        .oneshot(json_request(
            "POST",
            "/api/v1/todo/items/missing_item/complete",
            json!({}),
        ))
        .await
        .unwrap();
    assert_eq!(todo_cli.status.code(), Some(4));
    assert_eq!(todo_http.status(), StatusCode::NOT_FOUND);
    assert_eq!(error(todo_http).await["code"], "not_found");

    let diet = cli_success(
        home,
        &[
            "health",
            "diet",
            "add",
            "--at",
            "2026-07-31T12:00:00Z",
            "--meal",
            "lunch",
            "--food",
            "Original",
        ],
    );
    let id = diet["id"].as_str().unwrap();
    let stale = diet["updated_at"].as_str().unwrap();
    cli_success(home, &["health", "diet", "update", id, "--food", "Current"]);
    let health_cli = raven(
        home,
        &[
            "health",
            "diet",
            "update",
            id,
            "--food",
            "Stale",
            "--expected-updated-at",
            stale,
        ],
    );
    let health_http = app
        .oneshot(json_request(
            "PATCH",
            &format!("/api/v1/health/diet/{id}"),
            json!({
                "food_name": "Stale",
                "expected_updated_at": stale
            }),
        ))
        .await
        .unwrap();
    assert_eq!(health_cli.status.code(), Some(2));
    assert_eq!(health_http.status(), StatusCode::CONFLICT);
    assert_eq!(error(health_http).await["code"], "conflict");
}
