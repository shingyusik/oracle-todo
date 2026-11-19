use std::fs;
use std::sync::Arc;

use axum::body::Body;
use axum::http::{Method, Request, StatusCode, header};
use http_body_util::BodyExt;
use raven_api::retention::{RetentionPaths, Trigger};
use raven_api::{
    AuthMode, GithubReleases, RavenApiConfig, Retention, UiArtifact, UiSessionToken, UiUpdates,
    UpdateSettings, router_with_retention, ui_router_with_retention,
};
use serde_json::{Value, json};
use tower::ServiceExt;

#[path = "support/retention_fixture.rs"]
mod fixture;

use fixture::FixtureHome;

const TOKEN: &str = "correct-token-value";
const HOST: &str = "127.0.0.1:3002";
const ORIGIN: &str = "http://127.0.0.1:3002";

fn config(fixture: &FixtureHome, auth: AuthMode) -> RavenApiConfig {
    RavenApiConfig {
        todo_db: fixture.todo_db(),
        ledger_db: fixture.ledger_db(),
        health_db: fixture.health_db(),
        health_media_dir: fixture.media_dir(),
        local_offset: time::UtcOffset::from_hms(9, 0, 0).unwrap(),
        auth,
    }
}

fn retention(config: &RavenApiConfig) -> Retention {
    Retention::builder(RetentionPaths::from_config(config), config.local_offset)
        .env_disabled(false)
        .free_space(Arc::new(|_| Ok(u64::MAX)))
        .build()
}

fn bearer_app(fixture: &FixtureHome) -> axum::Router {
    let config = config(
        fixture,
        AuthMode::Bearer {
            token: TOKEN.to_owned(),
        },
    );
    let retention = retention(&config);
    router_with_retention(config, retention).unwrap()
}

fn bearer(method: Method, uri: &str) -> axum::http::request::Builder {
    Request::builder()
        .method(method)
        .uri(uri)
        .header(header::HOST, HOST)
        .header(header::AUTHORIZATION, format!("Bearer {TOKEN}"))
}

async fn send(app: &axum::Router, request: Request<Body>) -> (StatusCode, Value) {
    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let body = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes).unwrap()
    };
    (status, body)
}

fn run_request(origin: Option<&str>, maintenance: Option<&str>) -> Request<Body> {
    let mut builder = bearer(Method::POST, "/api/v1/maintenance/retention/run");
    if let Some(origin) = origin {
        builder = builder.header(header::ORIGIN, origin);
    }
    if let Some(value) = maintenance {
        builder = builder.header("x-raven-maintenance", value);
    }
    builder.body(Body::empty()).unwrap()
}

#[tokio::test]
async fn status_reports_defaults_and_settings_round_trip() {
    let fixture = FixtureHome::empty();
    let app = bearer_app(&fixture);
    let (status, body) = send(
        &app,
        bearer(Method::GET, "/api/v1/maintenance/retention")
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body,
        json!({
            "settings": {"enabled": true, "retention_days": 30, "backup_keep": 3},
            "env_override": null,
            "schedule": {"interval_hours": 24, "scheduler_active": false, "next_run_at": null},
            "last_run": null,
        })
    );

    let put = |body: Value| {
        bearer(Method::PUT, "/api/v1/maintenance/retention")
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(body.to_string()))
            .unwrap()
    };
    let (status, body) = send(&app, put(json!({"enabled": false, "retention_days": 60}))).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body["settings"],
        json!({"enabled": false, "retention_days": 60, "backup_keep": 3})
    );
    let (status, body) = send(
        &app,
        put(json!({"enabled": true, "retention_days": 30, "backup_keep": 5})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["settings"]["backup_keep"], 5);

    let (status, body) = send(&app, put(json!({"enabled": true, "retention_days": 6}))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["code"], "validation_error");
    assert_eq!(body["fields"], json!({"retention_days": ["invalid"]}));
    let (status, body) = send(
        &app,
        put(json!({"enabled": true, "retention_days": 30, "backup_keep": 31})),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["fields"], json!({"backup_keep": ["invalid"]}));
    for invalid in [
        json!({"enabled": true, "retention_days": 30, "extra": 1}),
        json!({"retention_days": 30}),
        json!({"enabled": "yes", "retention_days": 30}),
    ] {
        let (status, _) = send(&app, put(invalid)).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
    }
}

#[tokio::test]
async fn routes_require_authentication() {
    let fixture = FixtureHome::empty();
    let app = bearer_app(&fixture);
    for (method, uri) in [
        (Method::GET, "/api/v1/maintenance/retention"),
        (Method::PUT, "/api/v1/maintenance/retention"),
        (Method::GET, "/api/v1/maintenance/retention/preview"),
        (Method::POST, "/api/v1/maintenance/retention/run"),
    ] {
        let (status, body) = send(
            &app,
            Request::builder()
                .method(method.clone())
                .uri(uri)
                .header(header::HOST, HOST)
                .header(header::ORIGIN, ORIGIN)
                .header("x-raven-maintenance", "1")
                .body(Body::empty())
                .unwrap(),
        )
        .await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "{method} {uri}");
        assert_eq!(body["code"], "unauthorized");
    }
    assert!(fs::read_dir(&fixture.home).unwrap().next().is_none());
}

#[tokio::test]
async fn preview_is_read_only_bounded_and_validates_limit() {
    let fixture = FixtureHome::empty();
    let app = bearer_app(&fixture);
    let (status, body) = send(
        &app,
        bearer(Method::GET, "/api/v1/maintenance/retention/preview")
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["retention_days"], 30);
    for domain in ["todo", "ledger", "health"] {
        assert_eq!(
            body["domains"][domain],
            json!({"status": "not_initialized", "counts": {}, "skipped": {}, "items": [], "truncated": false})
        );
    }
    assert!(
        fs::read_dir(&fixture.home).unwrap().next().is_none(),
        "preview creates no stores or maintenance files"
    );
    for uri in [
        "/api/v1/maintenance/retention/preview?limit=0",
        "/api/v1/maintenance/retention/preview?limit=201",
        "/api/v1/maintenance/retention/preview?limit=x",
        "/api/v1/maintenance/retention/preview?other=1",
    ] {
        let (status, body) =
            send(&app, bearer(Method::GET, uri).body(Body::empty()).unwrap()).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{uri}");
        assert_eq!(body["code"], "validation_error");
    }

    let seeded_home = FixtureHome::initialized();
    let seeded = fixture::seed(&seeded_home);
    let app = bearer_app(&seeded_home);
    let (status, body) = send(
        &app,
        bearer(Method::GET, "/api/v1/maintenance/retention/preview?limit=1")
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let todo = &body["domains"]["todo"];
    assert_eq!(todo["status"], "ok");
    assert_eq!(todo["counts"], json!({"todo_item": 2}));
    assert_eq!(todo["truncated"], true);
    assert_eq!(todo["items"].as_array().unwrap().len(), 1);
    let item = &todo["items"][0];
    assert_eq!(item["kind"], "todo_item");
    assert!(
        seeded
            .todo_old
            .contains(&item["id"].as_str().unwrap().to_owned())
    );
    assert!(item["label"].as_str().unwrap().starts_with("synthetic-old"));
    assert!(item["archived_at"].as_str().unwrap().ends_with('Z'));
    assert!(!seeded_home.home.join("maintenance").exists());
    assert!(!seeded_home.home.join("backups").exists());
}

#[tokio::test]
async fn run_requires_exact_origin_and_maintenance_header() {
    let fixture = FixtureHome::initialized();
    fixture::seed(&fixture);
    let app = bearer_app(&fixture);
    for (origin, header) in [
        (None, Some("1")),
        (Some(ORIGIN), None),
        (Some(ORIGIN), Some("true")),
        (Some("http://127.0.0.1:3003"), Some("1")),
        (Some("http://evil.example"), Some("1")),
        (Some("null"), Some("1")),
    ] {
        let (status, body) = send(&app, run_request(origin, header)).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{origin:?} {header:?}");
        assert_eq!(body["code"], "forbidden");
    }
    assert!(
        !fixture.home.join("backups").exists(),
        "rejected runs purge nothing"
    );

    let (status, body) = send(&app, run_request(Some(ORIGIN), Some("1"))).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["skipped"], Value::Null);
    let last = &body["last_run"];
    assert_eq!(last["trigger"], "api");
    assert_eq!(last["outcome"], "ok");
    assert_eq!(last["domains"]["todo"]["purged"], json!({"todo_item": 2}));
    assert!(last["backup"]["name"].as_str().unwrap().ends_with('Z'));

    let (status, body) = send(
        &app,
        bearer(Method::GET, "/api/v1/maintenance/retention")
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["last_run"], *last);
}

#[tokio::test]
async fn concurrent_run_is_rejected_with_retention_in_progress() {
    let fixture = FixtureHome::initialized();
    let app = bearer_app(&fixture);
    let maintenance = fixture.home.join("maintenance");
    fs::create_dir_all(&maintenance).unwrap();
    let held = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(maintenance.join("retention.lock"))
        .unwrap();
    held.try_lock().unwrap();
    let (status, body) = send(&app, run_request(Some(ORIGIN), Some("1"))).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(body["code"], "retention_in_progress");
    drop(held);
    let (status, _) = send(&app, run_request(Some(ORIGIN), Some("1"))).await;
    assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn ui_router_serves_retention_with_session_and_exact_origin() {
    let fixture = FixtureHome::initialized();
    fixture::seed(&fixture);
    let ui = fixture.dir.path().canonicalize().unwrap().join("ui");
    fs::create_dir(&ui).unwrap();
    fs::write(ui.join("index.html"), "<main>Raven</main>").unwrap();
    let token = UiSessionToken::generate().unwrap();
    let config = config(&fixture, AuthMode::ui_session(&token));
    let retention = retention(&config);
    let updates = UiUpdates::new(
        UpdateSettings::compiled(),
        Arc::new(GithubReleases::new(None).unwrap()),
    );
    let app = ui_router_with_retention(
        config,
        UiArtifact::load(&ui).unwrap(),
        token,
        HOST.parse().unwrap(),
        None,
        updates,
        retention.clone(),
    )
    .unwrap();
    let cookie = app
        .clone()
        .oneshot(
            Request::get("/__raven/session")
                .header(header::HOST, HOST)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap()
        .headers()[header::SET_COOKIE]
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_owned();
    let ui_request = |method: Method, uri: &str, with_cookie: bool| {
        let builder = Request::builder()
            .method(method)
            .uri(uri)
            .header(header::HOST, HOST);
        if with_cookie {
            builder.header(header::COOKIE, cookie.clone())
        } else {
            builder
        }
    };

    let (status, _) = send(
        &app,
        ui_request(Method::GET, "/api/v1/maintenance/retention", false)
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let (status, body) = send(
        &app,
        ui_request(Method::GET, "/api/v1/maintenance/retention", true)
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["settings"]["retention_days"], 30);

    let (status, _) = send(
        &app,
        ui_request(Method::POST, "/api/v1/maintenance/retention/run", true)
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "origin is required");
    let (status, _) = send(
        &app,
        ui_request(Method::POST, "/api/v1/maintenance/retention/run", true)
            .header(header::ORIGIN, ORIGIN)
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "maintenance header is required"
    );
    let (status, _) = send(
        &app,
        ui_request(Method::POST, "/api/v1/maintenance/retention/run", false)
            .header(header::ORIGIN, ORIGIN)
            .header("x-raven-maintenance", "1")
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED, "session is required");
    let (status, body) = send(
        &app,
        ui_request(Method::POST, "/api/v1/maintenance/retention/run", true)
            .header(header::ORIGIN, ORIGIN)
            .header("x-raven-maintenance", "1")
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["last_run"]["trigger"], "api");
    assert_eq!(retention.last_run().unwrap().unwrap().trigger, "api");
    // The shared runtime sees the same record a scheduler run would update.
    let again = retention.run(Trigger::Cli).unwrap();
    assert_eq!(again.last_run.unwrap().outcome, "nothing_due");
}

#[tokio::test]
async fn default_routers_include_retention_routes() {
    let fixture = FixtureHome::empty();
    let app = raven_api::router(config(
        &fixture,
        AuthMode::Bearer {
            token: TOKEN.to_owned(),
        },
    ))
    .unwrap();
    let (status, body) = send(
        &app,
        bearer(Method::GET, "/api/v1/maintenance/retention")
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["schedule"]["scheduler_active"], false);
}
