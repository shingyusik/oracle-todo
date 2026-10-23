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
    assert!(valid_token(&sign(claims()), &key, &cfg).is_some());
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
        assert!(valid_token(&sign(claims), &key, &cfg).is_none(), "{field}");
    }
    let mut missing = claims();
    missing.as_object_mut().unwrap().remove("exp");
    assert!(valid_token(&sign(missing), &key, &cfg).is_none());
    let forged = encode(
        &Header::new(Algorithm::HS256),
        &claims(),
        &EncodingKey::from_secret(b"test-only-forgery"),
    )
    .unwrap();
    assert!(valid_token(&forged, &key, &cfg).is_none());
    let mut signed = sign(claims());
    signed.push('x');
    assert!(valid_token(&signed, &key, &cfg).is_none());
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

/// Serializes tests that reach denial log callsites, so a concurrent first registration cannot
/// cache them as disabled while the log capture test is running.
pub(in crate::mcp) static DENIAL_LOGS: Mutex<()> = Mutex::const_new(());

pub(in crate::mcp) const GATEWAY: &str = "test-gateway.access";
pub(in crate::mcp) const DIRECT: &str = "test-direct.access";
pub(in crate::mcp) const READER: &str = "test-reader.access";
pub(in crate::mcp) const SIX_SCOPES: &str = "raven.todo.read raven.ledger.read raven.health.read raven.todo.write raven.ledger.write raven.health.write";

/// Disposable Ed25519 key pair generated per test process, never an operational credential.
pub(in crate::mcp) fn ed25519() -> (EncodingKey, String) {
    let mut der = vec![
        0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04,
        0x20,
    ];
    let mut seed = [0u8; 32];
    getrandom::fill(&mut seed).unwrap();
    der.extend_from_slice(&seed);
    let key = EncodingKey::from_ed_der(&der);
    let jwk = Jwk::from_encoding_key(&key, Algorithm::EdDSA).unwrap();
    let jsonwebtoken::jwk::AlgorithmParameters::OctetKeyPair(params) = jwk.algorithm else {
        panic!("Ed25519 JWK expected");
    };
    (key, params.x)
}

static GATEWAY_KEY: std::sync::LazyLock<(EncodingKey, String)> = std::sync::LazyLock::new(ed25519);

fn caller_config() -> McpAccessConfig {
    config()
        .with_callers(
            Some(GATEWAY.into()),
            Some(GATEWAY_KEY.1.clone()),
            Some(format!(
                "{DIRECT}={} {READER}=raven.todo.read",
                SIX_SCOPES.replace(' ', ",")
            )),
        )
        .unwrap()
}

pub(in crate::mcp) fn access_token(common_name: Option<&str>) -> String {
    let mut claims = claims();
    if let Some(name) = common_name {
        claims["common_name"] = json!(name);
        claims["sub"] = json!("");
    } else {
        claims["email"] = json!("owner@example.com");
    }
    sign(claims)
}

pub(in crate::mcp) fn assertion_claims(scope: &str) -> Value {
    let now = time::OffsetDateTime::now_utc().unix_timestamp();
    json!({"aud":"https://mcp.example.com/mcp","client_id":"https://cursor.com/oauth/mcp-client.json","scope":scope,"iat":now,"exp":now+60})
}

pub(in crate::mcp) fn sign_assertion(claims: &Value, key: &EncodingKey) -> String {
    encode(&Header::new(Algorithm::EdDSA), claims, key).unwrap()
}

pub(in crate::mcp) fn scope_assertion(scope: &str) -> String {
    sign_assertion(&assertion_claims(scope), &GATEWAY_KEY.0)
}

pub(in crate::mcp) fn auth_and_token() -> (AccessAuth, String) {
    let key = EncodingKey::from_rsa_der(include_bytes!("test-key.der"));
    let mut jwk = Jwk::from_encoding_key(&key, Algorithm::RS256).unwrap();
    jwk.common.key_id = Some("test-key".into());
    let now = Instant::now();
    (
        AccessAuth {
            config: caller_config(),
            client: reqwest::Client::new(),
            keys: Arc::new(Mutex::new(Keys {
                set: JwkSet { keys: vec![jwk] },
                loaded: now,
                attempted: now,
            })),
        },
        access_token(Some(DIRECT)),
    )
}

#[test]
fn caller_configuration_is_required_and_strict() {
    let key = GATEWAY_KEY.1.clone();
    let with = |id: Option<&str>, key: Option<&str>, direct: Option<&str>| {
        config()
            .with_callers(
                id.map(Into::into),
                key.map(Into::into),
                direct.map(Into::into),
            )
            .is_ok()
    };
    assert!(with(Some(GATEWAY), Some(&key), None));
    assert!(with(None, None, Some("direct.access=raven.todo.read")));
    assert!(with(
        Some(GATEWAY),
        Some(&key),
        Some("a.access=raven.todo.read,raven.health.media b.access=raven.ledger.write")
    ));
    for (id, public, direct) in [
        (None, None, None),
        (None, None, Some("")),
        (Some(GATEWAY), None, None),
        (None, Some(key.as_str()), None),
        (Some(GATEWAY), Some("not-a-key"), None),
        (Some(GATEWAY), Some("AAAA"), None),
        (Some(""), Some(key.as_str()), None),
        (None, None, Some("direct.access")),
        (None, None, Some("direct.access=")),
        (None, None, Some("=raven.todo.read")),
        (None, None, Some("direct.access=raven.todo.admin")),
        (None, None, Some("direct.access=raven.todo.read,")),
        (
            None,
            None,
            Some("direct.access=raven.todo.read direct.access=raven.ledger.read"),
        ),
        (
            Some(GATEWAY),
            Some(key.as_str()),
            Some("test-gateway.access=raven.todo.read"),
        ),
    ] {
        assert!(!with(id, public, direct), "{id:?} {public:?} {direct:?}");
    }
}

#[tokio::test]
async fn remote_mcp_without_caller_allowlist_fails_closed_before_fetching_keys() {
    let temp = tempfile::tempdir().unwrap();
    let api = crate::RavenApiConfig {
        todo_db: temp.path().join("todo.sqlite"),
        ledger_db: temp.path().join("ledger.sqlite"),
        health_db: temp.path().join("health.sqlite"),
        health_media_dir: temp.path().join("media"),
        local_offset: time::UtcOffset::UTC,
        auth: crate::AuthMode::Bearer {
            token: "discarded-test-token".into(),
        },
    };
    let error = crate::mcp::router(api, config()).await.err().unwrap();
    assert_eq!(error.to_string(), "MCP caller allowlist required");
}

#[test]
fn scope_assertion_signature_audience_and_lifetime_are_enforced() {
    let key = DecodingKey::from_ed_components(&GATEWAY_KEY.1).unwrap();
    let audience = "https://mcp.example.com/mcp";
    let valid = |token: &str| valid_assertion(token, &key, audience);
    assert_eq!(
        valid(&scope_assertion("raven.todo.read raven.ledger.write")),
        Some(vec!["raven.todo.read".into(), "raven.ledger.write".into()])
    );
    let now = time::OffsetDateTime::now_utc().unix_timestamp();
    for (field, value) in [
        ("exp", json!(now - 120)),
        ("aud", json!("https://other.example.com/mcp")),
        ("aud", json!("https://mcp.example.com")),
        ("exp", json!(now + 600)),
        ("iat", json!(now + 300)),
        ("scope", json!(["raven.todo.read"])),
        ("client_id", json!("")),
    ] {
        let mut claims = assertion_claims("raven.todo.read");
        claims[field] = value;
        assert_eq!(valid(&scope_assertion_with(&claims)), None, "{field}");
    }
    for field in ["exp", "iat", "aud", "scope", "client_id"] {
        let mut claims = assertion_claims("raven.todo.read");
        claims.as_object_mut().unwrap().remove(field);
        assert_eq!(
            valid(&scope_assertion_with(&claims)),
            None,
            "missing {field}"
        );
    }
    let (other, _) = ed25519();
    let forged = sign_assertion(&assertion_claims("raven.todo.read"), &other);
    assert_eq!(valid(&forged), None);
    let mut tampered = scope_assertion("raven.todo.read");
    let last = tampered.pop().unwrap();
    tampered.push(if last == 'A' { 'B' } else { 'A' });
    assert_eq!(valid(&tampered), None);
    let hmac = encode(
        &Header::new(Algorithm::HS256),
        &assertion_claims("raven.todo.read"),
        &EncodingKey::from_secret(GATEWAY_KEY.1.as_bytes()),
    )
    .unwrap();
    assert_eq!(valid(&hmac), None);
    assert_eq!(valid(&sign(claims())), None);
}

fn scope_assertion_with(claims: &Value) -> String {
    sign_assertion(claims, &GATEWAY_KEY.0)
}

#[tokio::test]
async fn caller_allowlist_and_scope_assertion_decide_the_grant() {
    use axum::{
        Extension, Router,
        body::{Body, to_bytes},
        http::{HeaderMap, Request},
        middleware,
        routing::post,
    };
    use tower::ServiceExt;
    let _serial = DENIAL_LOGS.lock().await;
    let (auth, _) = auth_and_token();
    let app = Router::new()
        .route(
            "/mcp",
            post(
                |headers: HeaderMap, Extension(grant): Extension<Grant>| async move {
                    assert!(!headers.contains_key(SCOPE_ASSERTION));
                    format!("{} {}", grant.caller, grant.scopes.join(","))
                },
            ),
        )
        .layer(middleware::from_fn_with_state(auth, authenticate));
    let (other, _) = ed25519();
    let mut expired = assertion_claims(SIX_SCOPES);
    expired["exp"] = json!(1);
    let mut wrong_audience = assertion_claims(SIX_SCOPES);
    wrong_audience["aud"] = json!("https://other.example.com/mcp");
    let valid = scope_assertion(SIX_SCOPES);
    let forged = sign_assertion(&assertion_claims(SIX_SCOPES), &other);
    let expired = scope_assertion_with(&expired);
    let wrong_audience = scope_assertion_with(&wrong_audience);
    let gateway = access_token(Some(GATEWAY));
    let direct = access_token(Some(DIRECT));
    let reader = access_token(Some(READER));
    let unknown = access_token(Some("unknown.access"));
    let identity = access_token(None);
    let cases: Vec<(&str, Vec<&str>, StatusCode, Option<String>)> = vec![
        (
            &gateway,
            vec![&valid],
            StatusCode::OK,
            Some(format!("{GATEWAY} {}", SIX_SCOPES.replace(' ', ","))),
        ),
        (&gateway, vec![], StatusCode::FORBIDDEN, None),
        (&gateway, vec![&valid, &valid], StatusCode::FORBIDDEN, None),
        (&gateway, vec!["not-a-jwt"], StatusCode::FORBIDDEN, None),
        (&gateway, vec![&forged], StatusCode::FORBIDDEN, None),
        (&gateway, vec![&expired], StatusCode::FORBIDDEN, None),
        (&gateway, vec![&wrong_audience], StatusCode::FORBIDDEN, None),
        (&direct, vec![&valid], StatusCode::FORBIDDEN, None),
        (&reader, vec![&valid], StatusCode::FORBIDDEN, None),
        (
            &direct,
            vec![],
            StatusCode::OK,
            Some(format!("{DIRECT} {}", SIX_SCOPES.replace(' ', ","))),
        ),
        (
            &reader,
            vec![],
            StatusCode::OK,
            Some(format!("{READER} raven.todo.read")),
        ),
        (&unknown, vec![], StatusCode::FORBIDDEN, None),
        (&unknown, vec![&valid], StatusCode::FORBIDDEN, None),
        (&identity, vec![], StatusCode::FORBIDDEN, None),
        (&identity, vec![&valid], StatusCode::FORBIDDEN, None),
    ];
    for (index, (token, assertions, status, body)) in cases.into_iter().enumerate() {
        let mut request = Request::builder()
            .method("POST")
            .uri("/mcp")
            .header("host", "mcp.example.com")
            .header(ASSERTION, token);
        for assertion in assertions {
            request = request.header(SCOPE_ASSERTION, assertion);
        }
        let response = app
            .clone()
            .oneshot(request.body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), status, "case {index}");
        if let Some(body) = body {
            let bytes = to_bytes(response.into_body(), 4096).await.unwrap();
            assert_eq!(
                String::from_utf8(bytes.to_vec()).unwrap(),
                body,
                "case {index}"
            );
        }
    }
}
