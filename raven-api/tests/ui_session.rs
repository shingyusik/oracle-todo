use std::fs;

use axum::body::Body;
use axum::http::{HeaderValue, Request, StatusCode, header};
use http_body_util::BodyExt;
use raven_api::{AuthMode, RavenApiConfig, UiArtifact, UiSessionToken, ui_router};
use tower::ServiceExt;

const AUTHORITY: &str = "127.0.0.1:3002";

fn config(token: &UiSessionToken, home: &std::path::Path) -> RavenApiConfig {
    RavenApiConfig {
        todo_db: home.join("todo.sqlite"),
        ledger_db: home.join("ledger.sqlite"),
        health_db: home.join("health.sqlite"),
        health_media_dir: home.join("media/health"),
        local_offset: time::UtcOffset::from_hms(9, 0, 0).unwrap(),
        auth: AuthMode::ui_session(token),
    }
}

fn fixture() -> (tempfile::TempDir, axum::Router) {
    let temp = tempfile::tempdir().unwrap();
    let ui = temp.path().canonicalize().unwrap().join("ui");
    fs::create_dir(&ui).unwrap();
    fs::write(ui.join("index.html"), "<main>Raven</main>").unwrap();
    fs::write(ui.join("app.js"), "export const raven = true;").unwrap();
    fs::write(ui.join("mark.png"), b"\x89PNG\r\n\x1a\n").unwrap();
    let artifact = UiArtifact::load(&ui).unwrap();
    let token = UiSessionToken::generate().unwrap();
    let config = config(&token, temp.path());
    let app = ui_router(config, artifact, token, AUTHORITY.parse().unwrap()).unwrap();
    (temp, app)
}

fn get(path: &str) -> Request<Body> {
    Request::get(path)
        .header(header::HOST, AUTHORITY)
        .body(Body::empty())
        .unwrap()
}

#[tokio::test]
async fn bootstrap_sets_strict_http_only_session_cookie_used_by_api() {
    let (_temp, app) = fixture();
    let response = app.clone().oneshot(get("/__raven/session")).await.unwrap();
    assert_eq!(response.status(), StatusCode::SEE_OTHER);
    assert_eq!(response.headers()[header::LOCATION], "/");
    let cookie = response.headers()[header::SET_COOKIE].to_str().unwrap();
    assert!(cookie.starts_with("raven_session="));
    assert!(cookie.contains("; HttpOnly"));
    assert!(cookie.contains("; SameSite=Strict"));
    assert!(cookie.contains("; Path=/"));
    assert!(!cookie.contains("Domain="));
    assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");

    let cookie = cookie.split(';').next().unwrap();
    assert_eq!(cookie.len(), "raven_session=".len() + 64);
    let authorized = app
        .clone()
        .oneshot(
            Request::get("/api/v1/dashboard")
                .header(header::HOST, AUTHORITY)
                .header(header::COOKIE, cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(authorized.status(), StatusCode::OK);

    for request in [
        Request::get("/api/v1/dashboard")
            .header(header::HOST, AUTHORITY)
            .body(Body::empty())
            .unwrap(),
        Request::get("/api/v1/dashboard")
            .header(header::HOST, AUTHORITY)
            .header("x-raven-session", cookie)
            .body(Body::empty())
            .unwrap(),
        Request::get("/api/v1/dashboard")
            .header(header::HOST, AUTHORITY)
            .header(header::COOKIE, "raven_session=wrong")
            .body(Body::empty())
            .unwrap(),
        Request::get("/api/v1/dashboard")
            .header(header::HOST, AUTHORITY)
            .header(header::COOKIE, format!("{cookie}; raven_session=duplicate"))
            .body(Body::empty())
            .unwrap(),
    ] {
        assert_eq!(
            app.clone().oneshot(request).await.unwrap().status(),
            StatusCode::UNAUTHORIZED
        );
    }

    assert_eq!(
        app.oneshot(get("/healthz")).await.unwrap().status(),
        StatusCode::OK
    );
}

#[tokio::test]
async fn serves_assets_with_mime_and_spa_fallback_without_shadowing_api() {
    let (_temp, app) = fixture();
    for (path, status, content_type, body) in [
        (
            "/",
            StatusCode::OK,
            "text/html; charset=utf-8",
            "<main>Raven</main>",
        ),
        (
            "/app.js",
            StatusCode::OK,
            "text/javascript; charset=utf-8",
            "export const raven = true;",
        ),
        (
            "/ledger/transactions",
            StatusCode::OK,
            "text/html; charset=utf-8",
            "<main>Raven</main>",
        ),
    ] {
        let response = app.clone().oneshot(get(path)).await.unwrap();
        assert_eq!(response.status(), status, "{path}");
        assert_eq!(response.headers()[header::CONTENT_TYPE], content_type);
        assert_eq!(
            response.into_body().collect().await.unwrap().to_bytes(),
            body
        );
    }

    let response = app.oneshot(get("/api/v1/not-a-route")).await.unwrap();
    assert_ne!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn rejects_encoded_dot_and_symlink_traversal() {
    let (temp, app) = fixture();
    fs::write(temp.path().join("secret.txt"), "secret").unwrap();

    for path in ["/../secret.txt", "/%2e%2e/secret.txt", "/..%2fsecret.txt"] {
        let response = app.clone().oneshot(get(path)).await.unwrap();
        assert!(!response.status().is_success(), "{path}");
        let body = response.into_body().collect().await.unwrap().to_bytes();
        assert!(!body.windows(6).any(|window| window == b"secret"));
    }
}

#[test]
fn missing_or_incomplete_ui_artifact_is_rejected() {
    let temp = tempfile::tempdir().unwrap();
    assert!(UiArtifact::load(temp.path().join("missing")).is_err());
    let empty = temp.path().join("empty");
    fs::create_dir(&empty).unwrap();
    assert!(UiArtifact::load(empty).is_err());
}

#[tokio::test]
async fn rejects_missing_duplicate_host_and_rebinding_authorities_on_every_surface() {
    let (_temp, app) = fixture();
    let cases = [
        Request::get("/__raven/session")
            .body(Body::empty())
            .unwrap(),
        Request::get("/__raven/session")
            .header(header::HOST, AUTHORITY)
            .header(header::HOST, AUTHORITY)
            .body(Body::empty())
            .unwrap(),
        Request::get("/__raven/session")
            .header(header::HOST, "attacker.example:3002")
            .body(Body::empty())
            .unwrap(),
        Request::get("/__raven/session")
            .header(header::HOST, "127.0.0.1:3002, attacker.example")
            .body(Body::empty())
            .unwrap(),
        Request::get("/")
            .header(header::HOST, "localhost:3002")
            .body(Body::empty())
            .unwrap(),
        Request::get("/api/v1/dashboard")
            .header(header::HOST, "127.0.0.1:3003")
            .body(Body::empty())
            .unwrap(),
        Request::get("/__raven/session")
            .header(header::HOST, AUTHORITY)
            .header(header::ORIGIN, "http://attacker.example:3002")
            .body(Body::empty())
            .unwrap(),
        Request::get("/__raven/session")
            .header(header::HOST, AUTHORITY)
            .header(header::ORIGIN, "null")
            .body(Body::empty())
            .unwrap(),
        Request::get("/__raven/session")
            .header(header::HOST, AUTHORITY)
            .header(header::ORIGIN, format!("http://{AUTHORITY}"))
            .header(header::ORIGIN, format!("http://{AUTHORITY}"))
            .body(Body::empty())
            .unwrap(),
    ];

    for request in cases {
        let response = app.clone().oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::MISDIRECTED_REQUEST);
        assert!(!response.headers().contains_key(header::SET_COOKIE));
    }

    let valid = app
        .oneshot(
            Request::get("/__raven/session")
                .header(header::HOST, AUTHORITY)
                .header(header::ORIGIN, format!("http://{AUTHORITY}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(valid.status(), StatusCode::SEE_OTHER);
}

#[tokio::test]
async fn unknown_api_and_health_descendants_require_session_without_spa_fallback() {
    let (_temp, app) = fixture();
    for path in [
        "/api",
        "/api/",
        "/api/v1",
        "/api/v1/",
        "/api/v1/not-a-route",
        "/healthz/",
        "/healthz/anything",
    ] {
        assert_eq!(
            app.clone().oneshot(get(path)).await.unwrap().status(),
            StatusCode::UNAUTHORIZED,
            "{path}"
        );
    }
    for path in ["/__raven", "/__raven/", "/__raven/not-a-route"] {
        assert_eq!(
            app.clone().oneshot(get(path)).await.unwrap().status(),
            StatusCode::NOT_FOUND,
            "{path}"
        );
    }
    assert_eq!(
        app.clone().oneshot(get("/healthz")).await.unwrap().status(),
        StatusCode::OK
    );

    let bootstrap = app.clone().oneshot(get("/__raven/session")).await.unwrap();
    let cookie = bootstrap.headers()[header::SET_COOKIE]
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap();
    for path in ["/api", "/api/v1/not-a-route", "/healthz/"] {
        let response = app
            .clone()
            .oneshot(
                Request::get(path)
                    .header(header::HOST, AUTHORITY)
                    .header(header::COOKIE, cookie)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND, "{path}");
    }
}

#[tokio::test]
async fn snapshot_survives_post_start_replacement_and_head_matches_get_metadata() {
    let (temp, app) = fixture();
    let asset = temp.path().join("ui/app.js");
    fs::write(&asset, "replaced").unwrap();
    #[cfg(unix)]
    {
        fs::write(temp.path().join("secret.txt"), "secret").unwrap();
        fs::remove_file(&asset).unwrap();
        std::os::unix::fs::symlink(temp.path().join("secret.txt"), &asset).unwrap();
    }

    let get_response = app.clone().oneshot(get("/app.js")).await.unwrap();
    assert_eq!(get_response.status(), StatusCode::OK);
    assert_eq!(get_response.headers()[header::CACHE_CONTROL], "no-store");
    let length = get_response.headers()[header::CONTENT_LENGTH].clone();
    let body = get_response.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(body, "export const raven = true;");
    assert_eq!(
        length,
        HeaderValue::from_str(&body.len().to_string()).unwrap()
    );

    let head = app
        .oneshot(
            Request::head("/app.js")
                .header(header::HOST, AUTHORITY)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(head.status(), StatusCode::OK);
    assert_eq!(head.headers()[header::CONTENT_LENGTH], length);
    assert_eq!(head.headers()[header::CACHE_CONTROL], "no-store");
    assert!(
        head.into_body()
            .collect()
            .await
            .unwrap()
            .to_bytes()
            .is_empty()
    );
}

#[test]
fn artifact_snapshot_rejects_symlinks_and_oversized_files() {
    let temp = tempfile::tempdir().unwrap();
    let ui = temp.path().join("ui");
    fs::create_dir(&ui).unwrap();
    fs::write(ui.join("index.html"), "Raven").unwrap();

    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(temp.path(), ui.join("linked")).unwrap();
        assert!(UiArtifact::load(&ui).is_err());
        fs::remove_file(ui.join("linked")).unwrap();
    }

    let large = fs::File::create(ui.join("large.js")).unwrap();
    large.set_len(17 * 1024 * 1024).unwrap();
    assert!(UiArtifact::load(ui).is_err());
}

#[test]
fn ui_router_rejects_a_non_loopback_authority() {
    let temp = tempfile::tempdir().unwrap();
    let ui = temp.path().canonicalize().unwrap().join("ui");
    fs::create_dir(&ui).unwrap();
    fs::write(ui.join("index.html"), "Raven").unwrap();
    let artifact = UiArtifact::load(ui).unwrap();
    let token = UiSessionToken::generate().unwrap();
    let config = config(&token, temp.path());

    assert!(ui_router(config, artifact, token, "0.0.0.0:3002".parse().unwrap()).is_err());
}
