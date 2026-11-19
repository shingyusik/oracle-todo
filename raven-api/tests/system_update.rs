use std::collections::VecDeque;
use std::fs;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::body::Body;
use axum::http::{Method, Request, StatusCode, header};
use http_body_util::BodyExt;
use raven_api::{
    AuthMode, RavenApiConfig, ReleaseFetch, ReleaseFetchError, ReleaseFuture, ReleaseInfo,
    ReleaseSource, RestartSignal, UiArtifact, UiSessionToken, UiUpdates, UpdateSettings,
    ui_router_with_updates,
};
use serde_json::{Value, json};
use tower::ServiceExt;

const AUTHORITY: &str = "127.0.0.1:3002";
const LOCAL_ORIGIN: &str = "http://127.0.0.1:3002";
const PUBLIC_AUTHORITY: &str = "raven.b-sir.xyz";
const PUBLIC_ORIGIN: &str = "https://raven.b-sir.xyz";
const ACCESS_ASSERTION: &str = "validated-by-cloudflared";
const TARGET: &str = "aarch64-apple-darwin";

#[derive(Default)]
struct FakeReleases {
    responses: Mutex<VecDeque<Result<ReleaseFetch, ReleaseFetchError>>>,
    calls: Mutex<usize>,
}

impl ReleaseSource for FakeReleases {
    fn latest<'a>(&'a self, _etag: Option<&'a str>) -> ReleaseFuture<'a> {
        *self.calls.lock().unwrap() += 1;
        let response = self
            .responses
            .lock()
            .unwrap()
            .pop_front()
            .unwrap_or(Err(ReleaseFetchError));
        Box::pin(async move { response })
    }
}

fn release(version: &str) -> Result<ReleaseFetch, ReleaseFetchError> {
    Ok(ReleaseFetch::Fetched {
        etag: Some("\"etag\"".into()),
        release: ReleaseInfo {
            tag_name: format!("v{version}"),
            html_url: Some(format!(
                "https://github.com/shingyusik/oracle-todo/releases/tag/v{version}"
            )),
            assets: vec![
                format!("raven-{version}-{TARGET}.tar.gz"),
                format!("raven-ui-{version}.tar.gz"),
                "SHA256SUMS".into(),
            ],
        },
    })
}

struct Fixture {
    _temp: tempfile::TempDir,
    app: axum::Router,
    source: Arc<FakeReleases>,
    restart: RestartSignal,
}

fn fixture(
    supported: bool,
    releases: Vec<Result<ReleaseFetch, ReleaseFetchError>>,
    public_origin: Option<&str>,
) -> Fixture {
    let temp = tempfile::tempdir().unwrap();
    let ui = temp.path().canonicalize().unwrap().join("ui");
    fs::create_dir(&ui).unwrap();
    fs::write(ui.join("index.html"), "<main>Raven</main>").unwrap();
    let token = UiSessionToken::generate().unwrap();
    let config = RavenApiConfig {
        todo_db: temp.path().join("todo.sqlite"),
        ledger_db: temp.path().join("ledger.sqlite"),
        health_db: temp.path().join("health.sqlite"),
        health_media_dir: temp.path().join("media/health"),
        local_offset: time::UtcOffset::from_hms(9, 0, 0).unwrap(),
        auth: AuthMode::ui_session(&token),
    };
    let source = Arc::new(FakeReleases {
        responses: Mutex::new(releases.into()),
        calls: Mutex::new(0),
    });
    let updates = UiUpdates::new(
        UpdateSettings {
            current_version: "0.1.0".into(),
            ui_version: Some("0.1.0".into()),
            supported,
            target: TARGET.into(),
        },
        source.clone(),
    );
    let restart = updates.restart_signal();
    let app = ui_router_with_updates(
        config,
        UiArtifact::load(&ui).unwrap(),
        token,
        AUTHORITY.parse().unwrap(),
        public_origin,
        updates,
    )
    .unwrap();
    Fixture {
        _temp: temp,
        app,
        source,
        restart,
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Surface {
    Local,
    Public,
}

impl Surface {
    fn host(self) -> &'static str {
        match self {
            Self::Local => AUTHORITY,
            Self::Public => PUBLIC_AUTHORITY,
        }
    }

    fn origin(self) -> &'static str {
        match self {
            Self::Local => LOCAL_ORIGIN,
            Self::Public => PUBLIC_ORIGIN,
        }
    }

    fn request(self, method: Method, uri: &str) -> axum::http::request::Builder {
        let builder = Request::builder()
            .method(method)
            .uri(uri)
            .header(header::HOST, self.host());
        match self {
            Self::Local => builder,
            Self::Public => builder.header("cf-access-jwt-assertion", ACCESS_ASSERTION),
        }
    }
}

async fn cookie(app: &axum::Router, surface: Surface) -> String {
    let response = app
        .clone()
        .oneshot(
            surface
                .request(Method::GET, "/__raven/session")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    response.headers()[header::SET_COOKIE]
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_owned()
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

async fn version(app: &axum::Router, surface: Surface, cookie: &str, uri: &str) -> Value {
    let (status, body) = send(
        app,
        surface
            .request(Method::GET, uri)
            .header(header::COOKIE, cookie)
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    body
}

fn update_request(surface: Surface, cookie: &str) -> axum::http::request::Builder {
    surface
        .request(Method::POST, "/api/v1/system/update")
        .header(header::COOKIE, cookie)
        .header(header::ORIGIN, surface.origin())
        .header("x-raven-update", "1")
        .header(header::CONTENT_TYPE, "application/json")
}

fn body(target: &str) -> Body {
    Body::from(json!({ "target_version": target }).to_string())
}

async fn assert_restart_requested(restart: &RestartSignal) {
    tokio::time::timeout(Duration::from_secs(1), restart.requested())
        .await
        .expect("accepted update signals a restart");
}

#[tokio::test]
async fn healthz_reports_the_installed_bundle_version_without_auth() {
    let fixture = fixture(true, vec![], None);
    let (status, body) = send(
        &fixture.app,
        Surface::Local
            .request(Method::GET, "/healthz")
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, json!({"status": "ok", "version": "0.1.0"}));
}

#[tokio::test]
async fn version_requires_a_session_and_reports_the_cached_release() {
    let fixture = fixture(true, vec![release("0.2.0")], None);
    let (status, body) = send(
        &fixture.app,
        Surface::Local
            .request(Method::GET, "/api/v1/system/version")
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body["code"], "unauthorized");
    assert_eq!(*fixture.source.calls.lock().unwrap(), 0);

    let cookie = cookie(&fixture.app, Surface::Local).await;
    let body = version(
        &fixture.app,
        Surface::Local,
        &cookie,
        "/api/v1/system/version",
    )
    .await;
    let checked_at = body["checked_at"].as_str().unwrap().to_owned();
    assert!(
        time::OffsetDateTime::parse(&checked_at, &time::format_description::well_known::Rfc3339)
            .is_ok()
    );
    assert_eq!(
        body,
        json!({
            "current_version": "0.1.0",
            "ui_version": "0.1.0",
            "latest_version": "0.2.0",
            "update_available": true,
            "update_supported": true,
            "checked_at": checked_at,
            "check_error": null,
            "release_url": "https://github.com/shingyusik/oracle-todo/releases/tag/v0.2.0",
        })
    );

    version(
        &fixture.app,
        Surface::Local,
        &cookie,
        "/api/v1/system/version",
    )
    .await;
    version(
        &fixture.app,
        Surface::Local,
        &cookie,
        "/api/v1/system/version?refresh=1",
    )
    .await;
    assert_eq!(
        *fixture.source.calls.lock().unwrap(),
        1,
        "cache and refresh rate limit hold"
    );
}

#[tokio::test]
async fn failed_checks_report_unavailable_without_details() {
    let fixture = fixture(true, vec![Err(ReleaseFetchError)], None);
    let cookie = cookie(&fixture.app, Surface::Local).await;
    let body = version(
        &fixture.app,
        Surface::Local,
        &cookie,
        "/api/v1/system/version",
    )
    .await;
    assert_eq!(body["check_error"], "unavailable");
    assert_eq!(body["latest_version"], Value::Null);
    assert_eq!(body["checked_at"], Value::Null);
    assert_eq!(body["release_url"], Value::Null);
    assert_eq!(body["update_available"], false);
}

#[tokio::test]
async fn accepted_update_returns_202_and_signals_restart_on_both_surfaces() {
    for surface in [Surface::Local, Surface::Public] {
        let fixture = fixture(true, vec![release("0.2.0")], Some(PUBLIC_ORIGIN));
        let cookie = cookie(&fixture.app, surface).await;
        version(&fixture.app, surface, &cookie, "/api/v1/system/version").await;

        let (status, response) = send(
            &fixture.app,
            update_request(surface, &cookie)
                .body(body("0.2.0"))
                .unwrap(),
        )
        .await;
        assert_eq!(status, StatusCode::ACCEPTED, "{surface:?} {response}");
        assert_eq!(
            response,
            json!({"status": "restarting", "target_version": "0.2.0"})
        );
        assert_restart_requested(&fixture.restart).await;

        let (status, response) = send(
            &fixture.app,
            update_request(surface, &cookie)
                .body(body("0.2.0"))
                .unwrap(),
        )
        .await;
        assert_eq!(status, StatusCode::CONFLICT, "{surface:?}");
        assert_eq!(response["code"], "update_in_progress");
    }
}

#[tokio::test]
async fn update_rejects_targets_other_than_the_cached_newer_release() {
    let fixture = fixture(true, vec![release("0.2.0")], None);
    let cookie = cookie(&fixture.app, Surface::Local).await;

    let (status, response) = send(
        &fixture.app,
        update_request(Surface::Local, &cookie)
            .body(body("0.2.0"))
            .unwrap(),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::UNPROCESSABLE_ENTITY,
        "no cached release"
    );
    assert_eq!(response["code"], "update_not_available");
    assert_eq!(
        *fixture.source.calls.lock().unwrap(),
        0,
        "POST never checks GitHub"
    );

    version(
        &fixture.app,
        Surface::Local,
        &cookie,
        "/api/v1/system/version",
    )
    .await;
    for target in ["0.1.0", "0.0.9", "0.3.0", "v0.2.0"] {
        let (status, response) = send(
            &fixture.app,
            update_request(Surface::Local, &cookie)
                .body(body(target))
                .unwrap(),
        )
        .await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{target}");
        assert_eq!(response["code"], "update_not_available");
    }
}

#[tokio::test]
async fn equal_release_is_not_offered_or_accepted() {
    let fixture = fixture(true, vec![release("0.1.0")], None);
    let cookie = cookie(&fixture.app, Surface::Local).await;
    let body_value = version(
        &fixture.app,
        Surface::Local,
        &cookie,
        "/api/v1/system/version",
    )
    .await;
    assert_eq!(body_value["latest_version"], "0.1.0");
    assert_eq!(body_value["update_available"], false);
    let (status, _) = send(
        &fixture.app,
        update_request(Surface::Local, &cookie)
            .body(body("0.1.0"))
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn update_without_a_supervisor_is_unsupported() {
    let fixture = fixture(false, vec![release("0.2.0")], None);
    let cookie = cookie(&fixture.app, Surface::Local).await;
    let status_body = version(
        &fixture.app,
        Surface::Local,
        &cookie,
        "/api/v1/system/version",
    )
    .await;
    assert_eq!(status_body["update_supported"], false);
    assert_eq!(status_body["update_available"], true);

    let (status, response) = send(
        &fixture.app,
        update_request(Surface::Local, &cookie)
            .body(body("0.2.0"))
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_IMPLEMENTED);
    assert_eq!(response["code"], "update_unsupported");
}

#[tokio::test]
async fn update_requires_session_exact_origin_and_update_header() {
    for surface in [Surface::Local, Surface::Public] {
        let fixture = fixture(true, vec![release("0.2.0")], Some(PUBLIC_ORIGIN));
        let cookie = cookie(&fixture.app, surface).await;
        version(&fixture.app, surface, &cookie, "/api/v1/system/version").await;

        let base = || {
            surface
                .request(Method::POST, "/api/v1/system/update")
                .header(header::CONTENT_TYPE, "application/json")
        };
        let missing_origin_status = match surface {
            Surface::Local => StatusCode::FORBIDDEN,
            Surface::Public => StatusCode::MISDIRECTED_REQUEST,
        };
        let cases = [
            (
                "no session",
                base()
                    .header(header::ORIGIN, surface.origin())
                    .header("x-raven-update", "1"),
                StatusCode::UNAUTHORIZED,
            ),
            (
                "no origin",
                base()
                    .header(header::COOKIE, &cookie)
                    .header("x-raven-update", "1"),
                missing_origin_status,
            ),
            (
                "foreign origin",
                base()
                    .header(header::COOKIE, &cookie)
                    .header(header::ORIGIN, "https://evil.example")
                    .header("x-raven-update", "1"),
                StatusCode::MISDIRECTED_REQUEST,
            ),
            (
                "other surface origin",
                base()
                    .header(header::COOKIE, &cookie)
                    .header(
                        header::ORIGIN,
                        match surface {
                            Surface::Local => PUBLIC_ORIGIN,
                            Surface::Public => LOCAL_ORIGIN,
                        },
                    )
                    .header("x-raven-update", "1"),
                StatusCode::MISDIRECTED_REQUEST,
            ),
            (
                "no update header",
                base()
                    .header(header::COOKIE, &cookie)
                    .header(header::ORIGIN, surface.origin()),
                StatusCode::FORBIDDEN,
            ),
            (
                "wrong update header",
                base()
                    .header(header::COOKIE, &cookie)
                    .header(header::ORIGIN, surface.origin())
                    .header("x-raven-update", "true"),
                StatusCode::FORBIDDEN,
            ),
            (
                "duplicate update header",
                base()
                    .header(header::COOKIE, &cookie)
                    .header(header::ORIGIN, surface.origin())
                    .header("x-raven-update", "1")
                    .header("x-raven-update", "1"),
                StatusCode::FORBIDDEN,
            ),
        ];
        for (name, request, expected) in cases {
            let (status, response) = send(&fixture.app, request.body(body("0.2.0")).unwrap()).await;
            assert_eq!(status, expected, "{surface:?} {name}");
            if expected == StatusCode::FORBIDDEN {
                assert_eq!(response["code"], "forbidden", "{surface:?} {name}");
            }
        }

        for (name, payload) in [
            ("missing target", "{}"),
            ("extra field", r#"{"target_version":"0.2.0","force":true}"#),
            ("not json", "0.2.0"),
            ("wrong type", r#"{"target_version":2}"#),
        ] {
            let (status, response) = send(
                &fixture.app,
                update_request(surface, &cookie)
                    .body(Body::from(payload))
                    .unwrap(),
            )
            .await;
            assert_eq!(status, StatusCode::BAD_REQUEST, "{surface:?} {name}");
            assert_eq!(response["code"], "validation_error");
        }

        let (status, _) = send(
            &fixture.app,
            update_request(surface, &cookie)
                .body(body("0.2.0"))
                .unwrap(),
        )
        .await;
        assert_eq!(
            status,
            StatusCode::ACCEPTED,
            "{surface:?}: rejected requests must not consume the update"
        );
    }
}

#[tokio::test]
async fn public_version_requires_access_assertion_and_session() {
    let fixture = fixture(true, vec![release("0.2.0")], Some(PUBLIC_ORIGIN));
    let cookie = cookie(&fixture.app, Surface::Public).await;
    let (status, _) = send(
        &fixture.app,
        Request::get("/api/v1/system/version")
            .header(header::HOST, PUBLIC_AUTHORITY)
            .header(header::COOKIE, &cookie)
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::MISDIRECTED_REQUEST);
    let body = version(
        &fixture.app,
        Surface::Public,
        &cookie,
        "/api/v1/system/version",
    )
    .await;
    assert_eq!(body["update_available"], true);
}

#[tokio::test]
async fn system_routes_do_not_accept_other_methods_or_descendants() {
    let fixture = fixture(true, vec![release("0.2.0")], None);
    let cookie = cookie(&fixture.app, Surface::Local).await;
    for (method, uri, expected) in [
        (
            Method::POST,
            "/api/v1/system/version",
            StatusCode::METHOD_NOT_ALLOWED,
        ),
        (
            Method::GET,
            "/api/v1/system/update",
            StatusCode::METHOD_NOT_ALLOWED,
        ),
        (Method::GET, "/api/v1/system", StatusCode::NOT_FOUND),
        (Method::GET, "/api/v1/system/other", StatusCode::NOT_FOUND),
    ] {
        let (status, _) = send(
            &fixture.app,
            Surface::Local
                .request(method.clone(), uri)
                .header(header::COOKIE, &cookie)
                .header(header::ORIGIN, LOCAL_ORIGIN)
                .header("x-raven-update", "1")
                .body(Body::empty())
                .unwrap(),
        )
        .await;
        assert_eq!(status, expected, "{method} {uri}");
    }
}
