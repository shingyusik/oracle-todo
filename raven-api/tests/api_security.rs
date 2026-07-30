use std::fs;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};

use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use http_body_util::BodyExt;
use raven_api::{AuthMode, RavenApiConfig, load_bearer, router, validate_bind};
use serde_json::Value;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tower::ServiceExt;

const TOKEN: &str = "correct-token-value";

fn app() -> axum::Router {
    router(config(AuthMode::Bearer {
        token: TOKEN.to_owned(),
    }))
    .unwrap()
}

fn config(auth: AuthMode) -> RavenApiConfig {
    let temp = tempfile::tempdir().unwrap();
    RavenApiConfig {
        todo_db: temp.path().join("todo.sqlite"),
        ledger_db: temp.path().join("ledger.sqlite"),
        health_db: temp.path().join("health.sqlite"),
        health_media_dir: temp.path().join("media"),
        local_offset: time::UtcOffset::from_hms(9, 0, 0).unwrap(),
        auth,
    }
}

async fn request(request: Request<Body>) -> (StatusCode, axum::http::HeaderMap, Value) {
    let response = app().oneshot(request).await.unwrap();
    let status = response.status();
    let headers = response.headers().clone();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let body = serde_json::from_slice(&bytes).unwrap();
    (status, headers, body)
}

#[tokio::test]
async fn bearer_auth_rejects_missing_malformed_multiple_and_wrong_credentials() {
    let requests = [
        Request::get("/api/v1/dashboard")
            .body(Body::empty())
            .unwrap(),
        Request::get("/api/v1/dashboard")
            .header(header::AUTHORIZATION, "Basic abc")
            .body(Body::empty())
            .unwrap(),
        Request::get("/api/v1/dashboard")
            .header(header::AUTHORIZATION, "Bearer wrong-token-value")
            .body(Body::empty())
            .unwrap(),
        Request::get("/api/v1/dashboard")
            .header(header::AUTHORIZATION, format!("Bearer {TOKEN} extra"))
            .body(Body::empty())
            .unwrap(),
        Request::get("/api/v1/dashboard")
            .header(header::AUTHORIZATION, format!("Bearer {TOKEN}"))
            .header(header::AUTHORIZATION, format!("Bearer {TOKEN}"))
            .body(Body::empty())
            .unwrap(),
    ];

    for candidate in requests {
        let (status, headers, body) = request(candidate).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
        assert_eq!(headers[header::WWW_AUTHENTICATE], "Bearer");
        assert_eq!(body["code"], "unauthorized");
        assert!(body["request_id"].is_string());
        assert_eq!(body["fields"], serde_json::json!({}));
        assert!(!body.to_string().contains(TOKEN));
    }
}

#[tokio::test]
async fn exact_bearer_token_passes_and_only_healthz_is_exempt() {
    let (status, _, _) = request(
        Request::get("/api/v1/dashboard")
            .header(header::AUTHORIZATION, format!("Bearer {TOKEN}"))
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    for uri in ["/healthz", "/healthz?probe=1"] {
        let (status, _, body) = request(Request::get(uri).body(Body::empty()).unwrap()).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body, serde_json::json!({"status":"ok"}));
    }

    for uri in ["/healthz/", "/api/v1/healthz"] {
        let (status, _, _) = request(Request::get(uri).body(Body::empty()).unwrap()).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }
}

#[tokio::test]
async fn ui_session_mode_is_not_an_unauthenticated_fallback() {
    let app = router(config(AuthMode::UiSession {
        token: "session-verifier".into(),
    }))
    .unwrap();
    let missing = app
        .clone()
        .oneshot(
            Request::get("/api/v1/dashboard")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(missing.status(), StatusCode::UNAUTHORIZED);

    let valid = app
        .oneshot(
            Request::get("/api/v1/dashboard")
                .header(header::COOKIE, "raven_session=session-verifier")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(valid.status(), StatusCode::OK);
}

#[test]
fn injected_auth_modes_are_validated_before_router_creation() {
    assert!(
        router(config(AuthMode::Bearer {
            token: "short".into(),
        }))
        .is_err()
    );
    assert!(
        router(config(AuthMode::UiSession {
            token: String::new(),
        }))
        .is_err()
    );
}

#[test]
fn token_sources_and_values_are_strict() {
    assert!(load_bearer(None, None).is_err());
    assert!(load_bearer(Some("0123456789abcdef"), None).is_ok());
    assert!(load_bearer(Some("short"), None).is_err());
    assert!(load_bearer(Some("0123456789abcde "), None).is_err());
    assert!(load_bearer(Some("0123456789abcde\n"), None).is_err());
    assert!(load_bearer(Some(&"x".repeat(4097)), None).is_err());

    let temp = tempfile::tempdir().unwrap();
    let file = temp.path().join("token");
    fs::write(&file, format!("{TOKEN}\n")).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&file, fs::Permissions::from_mode(0o600)).unwrap();
    }
    assert!(load_bearer(None, Some(&file)).is_ok());
    assert!(load_bearer(Some(TOKEN), Some(&file)).is_err());

    fs::write(&file, format!("{TOKEN}\nsecond-line")).unwrap();
    assert!(load_bearer(None, Some(&file)).is_err());
    fs::write(&file, "x".repeat(4097)).unwrap();
    assert!(load_bearer(None, Some(&file)).is_err());
}

#[cfg(unix)]
#[test]
fn unix_token_file_rejects_broad_permissions_and_symlinks() {
    use std::os::unix::fs::{PermissionsExt, symlink};

    let temp = tempfile::tempdir().unwrap();
    let file = temp.path().join("token");
    fs::write(&file, TOKEN).unwrap();
    fs::set_permissions(&file, fs::Permissions::from_mode(0o640)).unwrap();
    assert!(load_bearer(None, Some(&file)).is_err());

    fs::set_permissions(&file, fs::Permissions::from_mode(0o600)).unwrap();
    let link = temp.path().join("token-link");
    symlink(&file, &link).unwrap();
    assert!(load_bearer(None, Some(&link)).is_err());
}

#[test]
fn bind_validation_accepts_only_loopback_without_override() {
    for ip in [
        IpAddr::V4(Ipv4Addr::LOCALHOST),
        IpAddr::V6(Ipv6Addr::LOCALHOST),
    ] {
        assert!(validate_bind(SocketAddr::new(ip, 3002), false).is_ok());
    }
    for ip in [
        IpAddr::V4(Ipv4Addr::UNSPECIFIED),
        IpAddr::V4(Ipv4Addr::new(10, 0, 0, 1)),
        IpAddr::V4(Ipv4Addr::new(8, 8, 8, 8)),
        IpAddr::V6(Ipv6Addr::UNSPECIFIED),
        "fe80::1".parse().unwrap(),
        "2001:4860:4860::8888".parse().unwrap(),
    ] {
        let addr = SocketAddr::new(ip, 3002);
        assert!(validate_bind(addr, false).is_err());
        assert!(validate_bind(addr, true).is_ok());
    }
}

#[tokio::test]
async fn server_starts_on_an_ephemeral_loopback_listener() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server = tokio::spawn(raven_api::serve_listener(
        config(AuthMode::Bearer {
            token: TOKEN.to_owned(),
        }),
        listener,
        false,
    ));

    let mut stream = tokio::net::TcpStream::connect(addr).await.unwrap();
    stream
        .write_all(b"GET /healthz HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
        .await
        .unwrap();
    let mut response = Vec::new();
    stream.read_to_end(&mut response).await.unwrap();
    assert!(
        String::from_utf8(response)
            .unwrap()
            .starts_with("HTTP/1.1 200 OK")
    );
    server.abort();
}
