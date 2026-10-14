use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use http_body_util::BodyExt;
use raven_api::{AuthMode, RavenApiConfig, router};
use rusqlite::Connection;
use serde_json::{Value, json};
use tower::ServiceExt;

fn app(home: &std::path::Path) -> axum::Router {
    router(RavenApiConfig {
        todo_db: home.join("todo.sqlite"),
        ledger_db: home.join("ledger.sqlite"),
        health_db: home.join("health.sqlite"),
        health_media_dir: home.join("media/health"),
        local_offset: time::UtcOffset::UTC,
        auth: AuthMode::UiSession {
            token: "test".into(),
        },
    })
    .unwrap()
}

async fn subscribe(app: &axum::Router) -> Body {
    let response = app
        .clone()
        .oneshot(
            Request::get("/api/v1/changes")
                .header(header::COOKIE, "raven_session=test")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response.headers()[header::CONTENT_TYPE],
        "text/event-stream"
    );
    assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
    response.into_body()
}

async fn event(body: &mut Body) -> Value {
    tokio::time::timeout(std::time::Duration::from_secs(4), async {
        loop {
            let frame = body.frame().await.unwrap().unwrap();
            if let Ok(data) = frame.into_data() {
                let text = std::str::from_utf8(&data).unwrap();
                if let Some(line) = text.lines().find_map(|line| line.strip_prefix("data: ")) {
                    return serde_json::from_str(line).unwrap();
                }
            }
        }
    })
    .await
    .expect("change notification timed out")
}

#[tokio::test]
async fn changes_require_authentication_and_never_create_missing_stores() {
    let home = tempfile::tempdir().unwrap();
    let app = app(home.path());
    let denied = app
        .clone()
        .oneshot(Request::get("/api/v1/changes").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(denied.status(), StatusCode::UNAUTHORIZED);
    let mut body = subscribe(&app).await;
    assert_eq!(
        event(&mut body).await,
        json!({"domains":["todo","ledger","health"]})
    );
    assert_eq!(std::fs::read_dir(home.path()).unwrap().count(), 0);
    let writer = Connection::open(home.path().join("health.sqlite")).unwrap();
    writer
        .execute_batch("CREATE TABLE records (id INTEGER);")
        .unwrap();
    assert_eq!(event(&mut body).await, json!({"domains":["health"]}));
}

#[tokio::test]
async fn separate_connections_notify_every_subscriber_and_reconnect_resyncs_all_domains() {
    let home = tempfile::tempdir().unwrap();
    let writers: Vec<_> = ["todo", "ledger", "health"]
        .iter()
        .map(|domain| {
            let connection =
                Connection::open(home.path().join(format!("{domain}.sqlite"))).unwrap();
            connection
                .execute_batch("PRAGMA journal_mode=WAL; CREATE TABLE records (id INTEGER);")
                .unwrap();
            connection
        })
        .collect();
    let app = app(home.path());
    let mut first = subscribe(&app).await;
    let mut second = subscribe(&app).await;
    event(&mut first).await;
    event(&mut second).await;
    for (index, domain) in ["todo", "ledger", "health"].iter().enumerate() {
        writers[index]
            .execute("INSERT INTO records VALUES (1)", [])
            .unwrap();
        assert_eq!(event(&mut first).await, json!({"domains":[domain]}));
        assert_eq!(event(&mut second).await, json!({"domains":[domain]}));
    }
    let mut reconnected = subscribe(&app).await;
    assert_eq!(
        event(&mut reconnected).await,
        json!({"domains":["todo","ledger","health"]})
    );
}

#[tokio::test]
async fn rollback_and_unchanged_stores_emit_no_change() {
    let home = tempfile::tempdir().unwrap();
    let writer = Connection::open(home.path().join("todo.sqlite")).unwrap();
    writer
        .execute_batch("CREATE TABLE records (id INTEGER);")
        .unwrap();
    let app = app(home.path());
    let mut body = subscribe(&app).await;
    event(&mut body).await;
    writer
        .execute_batch("BEGIN; INSERT INTO records VALUES (1); ROLLBACK;")
        .unwrap();
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(1300), body.frame())
            .await
            .is_err()
    );
}
