use std::fs;

use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use http_body_util::BodyExt;
use raven_api::{AuthMode, RavenApiConfig, UiSessionToken, ui_router};
use tower::ServiceExt;

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
    let ui = temp.path().join("ui");
    fs::create_dir(&ui).unwrap();
    fs::write(ui.join("index.html"), "<main>Raven</main>").unwrap();
    fs::write(ui.join("app.js"), "export const raven = true;").unwrap();
    fs::write(ui.join("mark.png"), b"\x89PNG\r\n\x1a\n").unwrap();
    let token = UiSessionToken::generate().unwrap();
    let config = config(&token, temp.path());
    let app = ui_router(config, &ui, token).unwrap();
    (temp, app)
}

#[tokio::test]
async fn bootstrap_sets_strict_http_only_session_cookie_used_by_api() {
    let (_temp, app) = fixture();
    let response = app
        .clone()
        .oneshot(
            Request::get("/__raven/session")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::SEE_OTHER);
    assert_eq!(response.headers()[header::LOCATION], "/");
    let cookie = response.headers()[header::SET_COOKIE].to_str().unwrap();
    assert!(cookie.starts_with("raven_session="));
    assert!(cookie.contains("; HttpOnly"));
    assert!(cookie.contains("; SameSite=Strict"));
    assert!(cookie.contains("; Path=/"));
    assert!(!cookie.contains("Domain="));

    let cookie = cookie.split(';').next().unwrap();
    assert_eq!(cookie.len(), "raven_session=".len() + 64);
    let authorized = app
        .clone()
        .oneshot(
            Request::get("/api/v1/dashboard")
                .header(header::COOKIE, cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(authorized.status(), StatusCode::OK);

    for request in [
        Request::get("/api/v1/dashboard")
            .body(Body::empty())
            .unwrap(),
        Request::get("/api/v1/dashboard")
            .header("x-raven-session", cookie)
            .body(Body::empty())
            .unwrap(),
        Request::get("/api/v1/dashboard")
            .header(header::COOKIE, "raven_session=wrong")
            .body(Body::empty())
            .unwrap(),
        Request::get("/api/v1/dashboard")
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
        app.oneshot(Request::get("/healthz").body(Body::empty()).unwrap())
            .await
            .unwrap()
            .status(),
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
        let response = app
            .clone()
            .oneshot(Request::get(path).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), status, "{path}");
        assert_eq!(response.headers()[header::CONTENT_TYPE], content_type);
        assert_eq!(
            response.into_body().collect().await.unwrap().to_bytes(),
            body
        );
    }

    let response = app
        .oneshot(
            Request::get("/api/v1/not-a-route")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_ne!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn rejects_encoded_dot_and_symlink_traversal() {
    let (temp, app) = fixture();
    fs::write(temp.path().join("secret.txt"), "secret").unwrap();

    for path in ["/../secret.txt", "/%2e%2e/secret.txt", "/..%2fsecret.txt"] {
        let response = app
            .clone()
            .oneshot(Request::get(path).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert!(!response.status().is_success(), "{path}");
        let body = response.into_body().collect().await.unwrap().to_bytes();
        assert!(!body.windows(6).any(|window| window == b"secret"));
    }

    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(temp.path().join("secret.txt"), temp.path().join("ui/leak"))
            .unwrap();
        let response = app
            .oneshot(Request::get("/leak").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert!(!response.status().is_success());
    }
}

#[test]
fn missing_or_incomplete_ui_artifact_is_rejected() {
    let temp = tempfile::tempdir().unwrap();
    let token = UiSessionToken::generate().unwrap();
    let missing_config = config(&token, temp.path());
    assert!(ui_router(missing_config, temp.path().join("missing"), token).is_err());
    let empty = temp.path().join("empty");
    fs::create_dir(&empty).unwrap();
    let token = UiSessionToken::generate().unwrap();
    let empty_config = config(&token, temp.path());
    assert!(ui_router(empty_config, empty, token).is_err());
}
