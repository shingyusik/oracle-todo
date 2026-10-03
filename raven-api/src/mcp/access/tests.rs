use super::*;
use jsonwebtoken::{EncodingKey, Header, encode, jwk::Jwk};
use serde_json::{Value, json};

fn config() -> McpAccessConfig {
    McpAccessConfig::new(
        "https://mcp.example.com".into(),
        "https://test.cloudflareaccess.com".into(),
        "test-audience".into(),
    )
    .unwrap()
}

fn claims() -> Value {
    json!({"iss":"https://test.cloudflareaccess.com","aud":["test-audience"],"exp":time::OffsetDateTime::now_utc().unix_timestamp()+300,"sub":"test-only-user"})
}

fn sign(claims: Value) -> String {
    // Disposable test-only key, never an operational credential.
    let key = EncodingKey::from_rsa_der(include_bytes!("test-key.der"));
    let mut header = Header::new(Algorithm::RS256);
    header.kid = Some("test-key".into());
    encode(&header, &claims, &key).unwrap()
}

#[test]
fn rejects_forged_expired_and_wrong_application_tokens() {
    let key = DecodingKey::from_rsa_der(include_bytes!("test-public.der"));
    let cfg = config();
    assert!(valid_token(&sign(claims()), &key, &cfg));
    for (field, value) in [
        ("exp", json!(1)),
        ("aud", json!(["other-app"])),
        ("iss", json!("https://other.cloudflareaccess.com")),
        (
            "nbf",
            json!(time::OffsetDateTime::now_utc().unix_timestamp() + 300),
        ),
    ] {
        let mut claims = claims();
        claims[field] = value;
        assert!(!valid_token(&sign(claims), &key, &cfg), "{field}");
    }
    let mut missing = claims();
    missing.as_object_mut().unwrap().remove("exp");
    assert!(!valid_token(&sign(missing), &key, &cfg));
    let forged = encode(
        &Header::new(Algorithm::HS256),
        &claims(),
        &EncodingKey::from_secret(b"test-only-forgery"),
    )
    .unwrap();
    assert!(!valid_token(&forged, &key, &cfg));
    let mut signed = sign(claims());
    signed.push('x');
    assert!(!valid_token(&signed, &key, &cfg));
}

#[test]
fn access_config_rejects_urls_that_could_redirect_or_fetch_untrusted_keys() {
    for issuer in [
        "http://test.cloudflareaccess.com",
        "https://test.cloudflareaccess.com/",
        "https://test.cloudflareaccess.com/path",
        "https://test.cloudflareaccess.com:443",
        "https://test.cloudflareaccess.com?secret=value",
        "https://test.cloudflareaccess.com@evil.example",
        "https://test.cloudflareaccess.com.evil.example",
    ] {
        assert!(
            McpAccessConfig::new(
                "https://mcp.example.com".into(),
                issuer.into(),
                "aud".into()
            )
            .is_err(),
            "{issuer}"
        );
    }
}

#[test]
fn public_origin_must_be_canonical_for_exact_origin_comparison() {
    assert!(
        McpAccessConfig::new(
            "https://mcp.example.com/".into(),
            "https://test.cloudflareaccess.com".into(),
            "aud".into()
        )
        .is_err()
    );
}

pub(in crate::mcp) fn auth_and_token() -> (AccessAuth, String) {
    let key = EncodingKey::from_rsa_der(include_bytes!("test-key.der"));
    let mut jwk = Jwk::from_encoding_key(&key, Algorithm::RS256).unwrap();
    jwk.common.key_id = Some("test-key".into());
    let now = Instant::now();
    (
        AccessAuth {
            config: config(),
            client: reqwest::Client::new(),
            keys: Arc::new(Mutex::new(Keys {
                set: JwkSet { keys: vec![jwk] },
                loaded: now,
                attempted: now,
            })),
        },
        sign(claims()),
    )
}

#[tokio::test]
async fn host_origin_and_duplicate_headers_are_rejected_and_credentials_are_stripped() {
    use axum::{
        Router,
        body::Body,
        http::{HeaderMap, Request},
        middleware,
        routing::post,
    };
    use tower::ServiceExt;
    let (auth, token) = auth_and_token();
    let app = Router::new()
        .route(
            "/mcp",
            post(|headers: HeaderMap| async move {
                assert!(!headers.contains_key(ASSERTION));
                assert!(!headers.contains_key(header::AUTHORIZATION));
                assert!(!headers.contains_key(header::COOKIE));
                assert!(!headers.contains_key("cf-access-client-secret"));
                StatusCode::OK
            }),
        )
        .layer(middleware::from_fn_with_state(auth, authenticate));
    for (host, origin, duplicate, expected) in [
        ("mcp.example.com", None, false, StatusCode::OK),
        (
            "mcp.example.com",
            Some("https://mcp.example.com"),
            false,
            StatusCode::OK,
        ),
        ("evil.example", None, false, StatusCode::MISDIRECTED_REQUEST),
        (
            "mcp.example.com",
            Some("https://evil.example"),
            false,
            StatusCode::FORBIDDEN,
        ),
        ("mcp.example.com", None, true, StatusCode::UNAUTHORIZED),
    ] {
        let mut request = Request::builder()
            .method("POST")
            .uri("/mcp")
            .header("host", host)
            .header(ASSERTION, &token)
            .header(header::AUTHORIZATION, "Bearer test-only-secret")
            .header(header::COOKIE, "test-only-cookie")
            .header("cf-access-client-secret", "test-only-secret");
        if let Some(origin) = origin {
            request = request.header(header::ORIGIN, origin);
        }
        if duplicate {
            request = request.header(ASSERTION, &token);
        }
        assert_eq!(
            app.clone()
                .oneshot(request.body(Body::empty()).unwrap())
                .await
                .unwrap()
                .status(),
            expected
        );
    }
}
