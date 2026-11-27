use std::sync::Arc;

use axum::body::Body;
use axum::http::{Method, Request, StatusCode, header};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;

use crate::google_calendar::client::GoogleApiError;
use crate::google_calendar::testing::{FakeGoogle, TEST_CLIENT_JSON};
use crate::{
    AuthMode, GithubReleases, GoogleCalendar, RavenApiConfig, Retention, UiArtifact,
    UiSessionToken, UiUpdates, UpdateSettings,
};

const HOST: &str = "127.0.0.1:3101";
const ORIGIN: &str = "http://127.0.0.1:3101";
const BASE: &str = "/api/v1/integrations/google-calendar";
const TOKEN: &str = "correct-token-value";

struct Fixture {
    dir: tempfile::TempDir,
    fake: FakeGoogle,
}

impl Fixture {
    fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path().join("home");
        std::fs::create_dir(&home).unwrap();
        let todo = home.join("todo.sqlite");
        todo_engine::infrastructure::sqlite::init_schema(
            &todo_engine::infrastructure::sqlite::connect(todo.to_str().unwrap()).unwrap(),
        )
        .unwrap();
        let client = dir.path().join("client.json");
        std::fs::write(&client, TEST_CLIENT_JSON).unwrap();
        let fixture = Self {
            dir,
            fake: FakeGoogle::new(),
        };
        fixture.calendar().set_oauth_client(&client).unwrap();
        fixture
    }

    fn home(&self) -> std::path::PathBuf {
        self.dir.path().join("home")
    }

    fn config(&self, auth: AuthMode) -> RavenApiConfig {
        let home = self.home();
        RavenApiConfig {
            todo_db: home.join("todo.sqlite"),
            ledger_db: home.join("ledger.sqlite"),
            health_db: home.join("health.sqlite"),
            health_media_dir: home.join("media").join("health"),
            local_offset: time::UtcOffset::from_hms(9, 0, 0).unwrap(),
            auth,
        }
    }

    fn calendar(&self) -> GoogleCalendar {
        let home = self.home();
        self.fake
            .builder(&home, home.join("todo.sqlite"))
            .build()
            .unwrap()
    }

    fn retention(config: &RavenApiConfig) -> Retention {
        Retention::builder(
            crate::retention::RetentionPaths::from_config(config),
            config.local_offset,
        )
        .env_disabled(true)
        .build()
    }

    async fn ui(&self) -> (axum::Router, String) {
        let ui = self.dir.path().canonicalize().unwrap().join("ui");
        std::fs::create_dir_all(&ui).unwrap();
        std::fs::write(ui.join("index.html"), "<main>Raven</main>").unwrap();
        let token = UiSessionToken::generate().unwrap();
        let config = self.config(AuthMode::ui_session(&token));
        let retention = Self::retention(&config);
        let app = crate::ui_router_with_integrations(
            config,
            UiArtifact::load(&ui).unwrap(),
            token,
            HOST.parse().unwrap(),
            None,
            UiUpdates::new(
                UpdateSettings::compiled(),
                Arc::new(GithubReleases::new(None).unwrap()),
            ),
            retention,
            self.calendar(),
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
        (app, cookie)
    }

    fn bearer(&self) -> axum::Router {
        let config = self.config(AuthMode::Bearer {
            token: TOKEN.to_owned(),
        });
        let retention = Self::retention(&config);
        crate::router_with_integrations(config, retention, self.calendar()).unwrap()
    }
}

struct Reply {
    status: StatusCode,
    no_store: bool,
    text: String,
}

impl Reply {
    fn json(&self) -> Value {
        serde_json::from_str(&self.text).unwrap_or(Value::Null)
    }
}

async fn send(app: &axum::Router, request: Request<Body>) -> Reply {
    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let no_store = response
        .headers()
        .get(header::CACHE_CONTROL)
        .is_some_and(|value| value == "no-store");
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    Reply {
        status,
        no_store,
        text: String::from_utf8_lossy(&bytes).into_owned(),
    }
}

fn ui_get(cookie: &str, uri: &str) -> Request<Body> {
    Request::get(uri)
        .header(header::HOST, HOST)
        .header(header::COOKIE, cookie)
        .body(Body::empty())
        .unwrap()
}

fn ui_write(cookie: &str, method: Method, uri: &str, body: Value) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(uri)
        .header(header::HOST, HOST)
        .header(header::COOKIE, cookie)
        .header(header::ORIGIN, ORIGIN)
        .header("x-raven-integration", "1")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body.to_string()))
        .unwrap()
}

fn query_value(url: &str, key: &str) -> String {
    reqwest::Url::parse(url)
        .unwrap()
        .query_pairs()
        .find(|(name, _)| name == key)
        .unwrap()
        .1
        .into_owned()
}

#[tokio::test]
async fn ui_flow_connect_callback_select_preview_sync_settings_disconnect() {
    let fixture = Fixture::new();
    let (app, cookie) = fixture.ui().await;

    let reply = send(
        &app,
        Request::get(BASE)
            .header(header::HOST, HOST)
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(reply.status, StatusCode::UNAUTHORIZED);

    let reply = send(&app, ui_get(&cookie, BASE)).await;
    assert_eq!(reply.status, StatusCode::OK);
    assert!(reply.no_store);
    let status = reply.json();
    assert_eq!(status["configured"], true);
    assert_eq!(status["connection"], "disconnected");
    assert_eq!(status["calendar"], Value::Null);
    assert_eq!(status["env_override"], Value::Null);
    assert_eq!(status["first_sync_pending"], false);
    assert_eq!(status["settings"]["poll_interval_secs"], 120);
    assert_eq!(status["schedule"]["scheduler_active"], false);
    assert_eq!(status["links"], json!({"total": 0, "error": 0}));

    let reply = send(
        &app,
        ui_write(&cookie, Method::POST, &format!("{BASE}/sync"), json!({})),
    )
    .await;
    assert_eq!(reply.status, StatusCode::CONFLICT);
    assert!(reply.no_store);
    assert_eq!(reply.json()["code"], "google_calendar_not_connected");

    // Origin and integration header are both required.
    let mut missing_header = ui_write(&cookie, Method::POST, &format!("{BASE}/connect"), json!({}));
    missing_header.headers_mut().remove("x-raven-integration");
    assert_eq!(
        send(&app, missing_header).await.status,
        StatusCode::FORBIDDEN
    );

    let reply = send(
        &app,
        ui_write(&cookie, Method::POST, &format!("{BASE}/connect"), json!({})),
    )
    .await;
    assert_eq!(reply.status, StatusCode::OK, "{}", reply.text);
    let start = reply.json();
    let url = start["authorization_url"].as_str().unwrap();
    assert!(start["expires_at"].is_string());
    assert_eq!(
        query_value(url, "redirect_uri"),
        format!("http://{HOST}/__raven/google-calendar/callback")
    );
    let state = query_value(url, "state");

    // The callback is unauthenticated (no cookie) and single-use.
    let callback = format!("/__raven/google-calendar/callback?state={state}&code=good-code");
    let unauthenticated = |uri: &str| {
        Request::get(uri)
            .header(header::HOST, HOST)
            .body(Body::empty())
            .unwrap()
    };
    let reply = send(&app, unauthenticated(&callback)).await;
    assert_eq!(reply.status, StatusCode::OK);
    assert!(reply.no_store);
    assert!(reply.text.contains("/?google_calendar=connected"));
    assert!(!reply.text.contains(&state));
    let reply = send(&app, unauthenticated(&callback)).await;
    assert_eq!(reply.status, StatusCode::BAD_REQUEST);
    assert!(reply.text.contains("/?google_calendar=error"));

    let reply = send(&app, ui_get(&cookie, &format!("{BASE}/calendars"))).await;
    assert_eq!(reply.status, StatusCode::OK);
    assert_eq!(
        reply.json(),
        json!({"calendars": [{
            "id": "primary@example.test",
            "summary": "Primary",
            "primary": true,
            "access_role": "owner",
            "time_zone": "Asia/Seoul"
        }]})
    );

    let reply = send(&app, ui_get(&cookie, &format!("{BASE}/preview"))).await;
    assert_eq!(reply.status, StatusCode::CONFLICT);
    assert_eq!(
        reply.json()["code"],
        "google_calendar_calendar_not_selected"
    );

    let choose = |body: Value| ui_write(&cookie, Method::POST, &format!("{BASE}/calendar"), body);
    let reply = send(&app, choose(json!({"select": "readonly@example.test"}))).await;
    assert_eq!(reply.status, StatusCode::BAD_REQUEST);
    let reply = send(
        &app,
        choose(json!({"select": "a", "create": {"summary": "b"}})),
    )
    .await;
    assert_eq!(reply.status, StatusCode::BAD_REQUEST);
    let reply = send(&app, choose(json!({"select": "primary@example.test"}))).await;
    assert_eq!(reply.status, StatusCode::OK);
    let status = reply.json();
    assert_eq!(status["connection"], "connected");
    assert_eq!(status["calendar"]["id"], "primary@example.test");
    assert_eq!(status["calendar"]["summary"], "Primary");
    assert_eq!(status["first_sync_pending"], true);

    let reply = send(&app, ui_get(&cookie, &format!("{BASE}/preview"))).await;
    assert_eq!(reply.status, StatusCode::OK);
    assert_eq!(reply.json()["counts"]["google_created"], 0);
    assert_eq!(reply.json()["first_sync"], true);

    let reply = send(
        &app,
        ui_write(
            &cookie,
            Method::POST,
            &format!("{BASE}/sync"),
            json!({"dry_run": false, "allow_mass_delete": false}),
        ),
    )
    .await;
    assert_eq!(reply.status, StatusCode::OK);
    let report = reply.json();
    assert_eq!(report["dry_run"], false);
    assert_eq!(report["last_sync"]["trigger"], "api");
    assert_eq!(report["last_sync"]["outcome"], "nothing_to_do");

    let reply = send(
        &app,
        ui_write(
            &cookie,
            Method::PUT,
            BASE,
            json!({"enabled": true, "sync_note": false, "poll_interval_secs": 300, "default_duration_minutes": 30}),
        ),
    )
    .await;
    assert_eq!(reply.status, StatusCode::OK);
    let settings = &reply.json()["settings"];
    assert_eq!(settings["enabled"], true);
    assert_eq!(settings["sync_note"], false);
    assert_eq!(settings["poll_interval_secs"], 300);
    assert_eq!(settings["default_duration_minutes"], 30);
    for bad in [
        json!({"default_duration_minutes": 0}),
        json!({"default_duration_minutes": 1441}),
        json!({"poll_interval_secs": 59}),
        json!({"unknown": true}),
    ] {
        let reply = send(&app, ui_write(&cookie, Method::PUT, BASE, bad.clone())).await;
        assert_eq!(reply.status, StatusCode::BAD_REQUEST, "{bad}");
        assert_eq!(reply.json()["code"], "validation_error");
    }

    fixture
        .fake
        .fail_next("list_calendars", GoogleApiError::Server);
    let reply = send(&app, ui_get(&cookie, &format!("{BASE}/calendars"))).await;
    assert_eq!(reply.status, StatusCode::BAD_GATEWAY);
    assert_eq!(reply.json()["code"], "upstream_unavailable");

    let reply = send(
        &app,
        ui_write(
            &cookie,
            Method::POST,
            &format!("{BASE}/disconnect"),
            json!({"forget_links": false}),
        ),
    )
    .await;
    assert_eq!(reply.status, StatusCode::OK);
    assert_eq!(reply.json()["connection"], "disconnected");
}

#[tokio::test]
async fn ui_connect_complete_accepts_a_pasted_redirect_url_once() {
    let fixture = Fixture::new();
    let (app, cookie) = fixture.ui().await;
    let start = send(
        &app,
        ui_write(&cookie, Method::POST, &format!("{BASE}/connect"), json!({})),
    )
    .await
    .json();
    let state = query_value(start["authorization_url"].as_str().unwrap(), "state");
    let pasted = format!(
        "http://127.0.0.1:3101/__raven/google-calendar/callback?state={state}&code=good-code&scope=x"
    );
    let complete = || {
        ui_write(
            &cookie,
            Method::POST,
            &format!("{BASE}/connect/complete"),
            json!({"redirect_url": pasted}),
        )
    };
    let reply = send(&app, complete()).await;
    assert_eq!(reply.status, StatusCode::OK, "{}", reply.text);
    assert_eq!(reply.json()["connection"], "connected");
    let reply = send(&app, complete()).await;
    assert_eq!(reply.status, StatusCode::BAD_REQUEST, "single use");
    assert_eq!(reply.json()["fields"]["state"], json!(["invalid"]));
}

#[tokio::test]
async fn bearer_api_serves_integration_routes_without_connect_or_callback() {
    let fixture = Fixture::new();
    let app = fixture.bearer();
    let bearer = |method: Method, uri: &str| {
        Request::builder()
            .method(method)
            .uri(uri)
            .header(header::HOST, "127.0.0.1:3002")
            .header(header::AUTHORIZATION, format!("Bearer {TOKEN}"))
    };
    let reply = send(&app, bearer(Method::GET, BASE).body(Body::empty()).unwrap()).await;
    assert_eq!(reply.status, StatusCode::OK);
    assert!(reply.no_store);
    for uri in [
        format!("{BASE}/connect"),
        format!("{BASE}/connect/complete"),
    ] {
        let reply = send(
            &app,
            bearer(Method::POST, &uri)
                .header(header::ORIGIN, "http://127.0.0.1:3002")
                .header("x-raven-integration", "1")
                .body(Body::from("{}"))
                .unwrap(),
        )
        .await;
        assert_eq!(reply.status, StatusCode::NOT_FOUND, "{uri}");
    }
    let reply = send(
        &app,
        bearer(
            Method::GET,
            "/__raven/google-calendar/callback?state=a&code=b",
        )
        .body(Body::empty())
        .unwrap(),
    )
    .await;
    assert_eq!(reply.status, StatusCode::NOT_FOUND);
    // The bearer API derives the expected Origin from its Host.
    let sync = |origin: &str| {
        bearer(Method::POST, &format!("{BASE}/sync"))
            .header(header::ORIGIN, origin)
            .header("x-raven-integration", "1")
            .body(Body::empty())
            .unwrap()
    };
    let reply = send(&app, sync("http://127.0.0.1:3002")).await;
    assert_eq!(reply.status, StatusCode::CONFLICT);
    assert_eq!(reply.json()["code"], "google_calendar_not_connected");
    let reply = send(&app, sync("http://evil.example")).await;
    assert_eq!(reply.status, StatusCode::FORBIDDEN);
    assert!(
        !fixture
            .home()
            .join("integrations")
            .join("google-calendar")
            .join("sync.sqlite")
            .exists()
    );
}
