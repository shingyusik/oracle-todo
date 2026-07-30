use std::fs;

use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use health_engine::infrastructure::sqlite::SqliteHealthRepository;
use http_body_util::BodyExt;
use ledger_engine::infrastructure::sqlite::SqliteLedgerRepository;
use raven_api::{AuthMode, RavenApiConfig, router};
use serde_json::Value;
use todo_engine::application::service::{CreateArea, TodoService};
use todo_engine::infrastructure::sqlite::{SqliteTodoRepository, connect, init_schema};
use tower::ServiceExt;
use uuid::{Uuid, Variant, Version};

struct DashboardFixture {
    _temp: tempfile::TempDir,
    config: RavenApiConfig,
}

impl DashboardFixture {
    fn new() -> Self {
        let temp = tempfile::tempdir().unwrap();
        let config = RavenApiConfig {
            todo_db: temp.path().join("todo.sqlite"),
            ledger_db: temp.path().join("ledger.sqlite"),
            health_db: temp.path().join("health.sqlite"),
            health_media_dir: temp.path().join("media"),
            auth: AuthMode::UiSession {
                token: "test".into(),
            },
        };
        Self {
            _temp: temp,
            config,
        }
    }

    fn todo(&self) {
        let connection = connect(self.config.todo_db.to_str().unwrap()).unwrap();
        init_schema(&connection).unwrap();
    }

    fn ledger(&self) {
        SqliteLedgerRepository::open(&self.config.ledger_db).unwrap();
    }

    fn health(&self) {
        SqliteHealthRepository::open(&self.config.health_db).unwrap();
    }

    fn all(&self) {
        self.todo();
        self.ledger();
        self.health();
    }

    fn app(&self) -> axum::Router {
        router(self.config.clone()).unwrap()
    }
}

async fn get(app: axum::Router) -> (StatusCode, String, Value) {
    let response = app
        .oneshot(
            Request::get("/api/v1/dashboard")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let content_type = response.headers()[header::CONTENT_TYPE]
        .to_str()
        .unwrap()
        .to_string();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        content_type,
        serde_json::from_slice(&bytes).unwrap(),
    )
}

fn assert_request_id(value: &Value) {
    let request_id = value["request_id"].as_str().unwrap();
    let uuid = Uuid::parse_str(request_id).unwrap();
    assert_eq!(uuid.get_version(), Some(Version::Random));
    assert_eq!(uuid.get_variant(), Variant::RFC4122);
}

#[tokio::test(flavor = "current_thread")]
async fn successful_domains_survive_a_missing_health_database() {
    let fixture = DashboardFixture::new();
    fixture.todo();
    fixture.ledger();

    let (status, content_type, body) = get(fixture.app()).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(content_type, "application/json");
    assert_eq!(body["todo"]["status"], "ok");
    assert_eq!(body["ledger"]["status"], "ok");
    assert_eq!(body["health"]["status"], "error");
    assert_eq!(
        body["health"]["request_id"].as_str(),
        body["request_id"].as_str()
    );
    assert_request_id(&body);
}

#[tokio::test]
async fn two_or_all_domain_failures_are_still_a_safe_success_envelope() {
    let two = DashboardFixture::new();
    two.todo();
    let (_, _, body) = get(two.app()).await;
    assert_eq!(body["todo"]["status"], "ok");
    assert_eq!(body["ledger"]["status"], "error");
    assert_eq!(body["health"]["status"], "error");

    let all = DashboardFixture::new();
    let (_, _, body) = get(all.app()).await;
    for domain in ["todo", "ledger", "health"] {
        assert_eq!(body[domain]["status"], "error");
        assert_eq!(
            body[domain]["request_id"].as_str(),
            body["request_id"].as_str()
        );
        assert_eq!(body[domain]["code"], "domain_unavailable");
        assert_eq!(
            body[domain]["message"],
            "This data is currently unavailable."
        );
    }
    assert_eq!(body["recent_activity"], serde_json::json!([]));
}

#[tokio::test]
async fn missing_or_corrupt_storage_is_read_only_and_isolated() {
    let missing = DashboardFixture::new();
    let media = missing.config.health_media_dir.clone();
    let todo = missing.config.todo_db.clone();
    let ledger = missing.config.ledger_db.clone();
    let health = missing.config.health_db.clone();
    let _ = get(missing.app()).await;
    assert!(!todo.exists());
    assert!(!ledger.exists());
    assert!(!health.exists());
    assert!(!media.exists());

    let corrupt = DashboardFixture::new();
    corrupt.todo();
    corrupt.health();
    fs::write(&corrupt.config.ledger_db, b"not sqlite").unwrap();
    let (status, _, body) = get(corrupt.app()).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["todo"]["status"], "ok");
    assert_eq!(body["ledger"]["status"], "error");
    assert_eq!(body["health"]["status"], "ok");
    assert!(!format!("{body:?}").contains(corrupt._temp.path().to_str().unwrap()));

    let corrupt = DashboardFixture::new();
    corrupt.ledger();
    corrupt.health();
    fs::write(&corrupt.config.todo_db, b"not sqlite").unwrap();
    let (status, _, body) = get(corrupt.app()).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["todo"]["status"], "error");
    assert_eq!(body["ledger"]["status"], "ok");
    assert_eq!(body["health"]["status"], "ok");

    let future = DashboardFixture::new();
    future.all();
    let connection = connect(future.config.todo_db.to_str().unwrap()).unwrap();
    connection.pragma_update(None, "user_version", 999).unwrap();
    drop(connection);
    let (_, _, body) = get(future.app()).await;
    assert_eq!(body["todo"]["status"], "error");
    assert_eq!(body["ledger"]["status"], "ok");
    assert_eq!(body["health"]["status"], "ok");
}

#[tokio::test]
async fn recent_activity_is_bounded_and_never_contains_audit_payloads() {
    let fixture = DashboardFixture::new();
    fixture.all();
    let connection = connect(fixture.config.todo_db.to_str().unwrap()).unwrap();
    let mut service = TodoService::persistent(SqliteTodoRepository::new(connection));
    for index in 0..25 {
        service
            .create_area(CreateArea {
                title: format!("private-title-{index}"),
                review_cycle: Some("weekly".into()),
                standard: Some("private-standard".into()),
                note: Some("private-note".into()),
                tags: vec!["private-tag".into()],
            })
            .unwrap();
    }

    let (_, _, body) = get(fixture.app()).await;
    let activity = body["recent_activity"].as_array().unwrap();
    assert_eq!(activity.len(), 20);
    let encoded = serde_json::to_string(activity).unwrap();
    assert!(!encoded.contains("private-title"));
    assert!(!encoded.contains("private-standard"));
    assert!(activity.iter().all(|item| {
        item.as_object().unwrap().keys().collect::<Vec<_>>()
            == ["action", "domain", "record_id", "timestamp"]
    }));
}
