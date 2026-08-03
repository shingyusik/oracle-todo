use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use http_body_util::BodyExt;
use raven_api::{AuthMode, RavenApiConfig, router};
use serde_json::{Value, json};
use tower::ServiceExt;

const SESSION: &str = "preference-test-session";

fn app() -> (tempfile::TempDir, axum::Router) {
    let temp = tempfile::tempdir().unwrap();
    let config = RavenApiConfig {
        todo_db: temp.path().join("todo.sqlite"),
        ledger_db: temp.path().join("ledger.sqlite"),
        health_db: temp.path().join("health.sqlite"),
        health_media_dir: temp.path().join("media"),
        local_offset: time::UtcOffset::UTC,
        auth: AuthMode::UiSession {
            token: SESSION.into(),
        },
    };
    (temp, router(config).unwrap())
}

fn request(method: &str, path: &str, body: Body) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(path)
        .header(header::COOKIE, format!("raven_session={SESSION}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(body)
        .unwrap()
}

async fn json_body(response: axum::response::Response) -> Value {
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    serde_json::from_slice(&bytes).unwrap()
}

#[tokio::test]
async fn required_namespaces_round_trip_exact_json_without_collisions() {
    let (_temp, app) = app();
    let cases = [
        (
            "planner.v1",
            json!({"filters": ["active"], "nested": {"x": 1}}),
        ),
        ("ledger.table.v1", json!({"columns": ["date", "amount"]})),
        ("health.timeline.v1", json!({"days": 30, "categories": []})),
    ];

    for (key, value) in &cases {
        let response = app
            .clone()
            .oneshot(request(
                "PUT",
                &format!("/api/v1/preferences/{key}"),
                Body::from(json!({"value": value}).to_string()),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(json_body(response).await, *value);
    }

    for (key, value) in cases {
        let response = app
            .clone()
            .oneshot(request(
                "GET",
                &format!("/api/v1/preferences/{key}"),
                Body::empty(),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(json_body(response).await, value);
    }
}

#[tokio::test]
async fn workspace_views_reads_legacy_value_and_prefers_canonical_value() {
    let (temp, app) = app();
    let db = temp.path().join("todo.sqlite");
    let legacy = json!({"view": "board"});
    let canonical = json!({"view": "list"});

    backend::api::write_preference(&db, "workspace-views.v1", &legacy).unwrap();

    let response = app
        .clone()
        .oneshot(request(
            "GET",
            "/api/v1/preferences/workspace.views.v1",
            Body::empty(),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(json_body(response).await, legacy);

    backend::api::write_preference(&db, "workspace.views.v1", &canonical).unwrap();

    let response = app
        .oneshot(request(
            "GET",
            "/api/v1/preferences/workspace.views.v1",
            Body::empty(),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(json_body(response).await, canonical);
}

#[tokio::test]
async fn missing_read_returns_null_without_creating_storage() {
    let (temp, app) = app();
    let db = temp.path().join("todo.sqlite");
    let response = app
        .clone()
        .oneshot(request(
            "GET",
            "/api/v1/preferences/planner.v1",
            Body::empty(),
        ))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(json_body(response).await, Value::Null);
    assert!(!db.exists());

    std::fs::write(&db, []).unwrap();
    let response = app
        .oneshot(request(
            "GET",
            "/api/v1/preferences/planner.v1",
            Body::empty(),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(json_body(response).await, Value::Null);
    assert_eq!(std::fs::read(&db).unwrap(), Vec::<u8>::new());
}

#[tokio::test]
async fn malformed_or_unapproved_keys_use_validation_envelope() {
    let (_temp, app) = app();
    let long = format!("planner.{}", "a".repeat(96));
    let paths = [
        "/api/v1/preferences/planner.".to_owned(),
        "/api/v1/preferences/unknown.v1".to_owned(),
        "/api/v1/preferences/Planner.v1".to_owned(),
        "/api/v1/preferences/planner%2Ev1".to_owned(),
        "/api/v1/preferences/planner%252Ev1".to_owned(),
        "/api/v1/preferences/planner.v1%00".to_owned(),
        "/api/v1/preferences/planner.v1%2Fhidden".to_owned(),
        "/api/v1/preferences/planner.v1'OR'1".to_owned(),
        "/api/v1/preferences/planner/foo".to_owned(),
        "/api/v1/preferences/".to_owned(),
        "/api/v1/preferences".to_owned(),
        format!("/api/v1/preferences/{long}"),
    ];

    for path in paths {
        let response = app
            .clone()
            .oneshot(request("GET", &path, Body::empty()))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST, "{path}");
        let error = json_body(response).await;
        assert_eq!(error["code"], "validation_error", "{path}");
        assert!(error["request_id"].is_string(), "{path}");
    }
}

#[tokio::test]
async fn put_requires_bounded_json_object() {
    let (_temp, app) = app();
    let cases = [
        (
            request(
                "PUT",
                "/api/v1/preferences/planner.v1",
                Body::from(json!({"value": "not-an-object"}).to_string()),
            ),
            StatusCode::BAD_REQUEST,
            "validation_error",
        ),
        (
            Request::put("/api/v1/preferences/planner.v1")
                .header(header::COOKIE, format!("raven_session={SESSION}"))
                .body(Body::from(r#"{"value":{}}"#))
                .unwrap(),
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "unsupported_media_type",
        ),
        (
            request(
                "PUT",
                "/api/v1/preferences/planner.v1",
                Body::from(format!(
                    r#"{{"value":{{"x":"{}"}}}}"#,
                    "x".repeat(17 * 1024)
                )),
            ),
            StatusCode::PAYLOAD_TOO_LARGE,
            "payload_too_large",
        ),
    ];

    for (request, status, code) in cases {
        let response = app.clone().oneshot(request).await.unwrap();
        assert_eq!(response.status(), status);
        assert_eq!(json_body(response).await["code"], code);
    }
}

#[tokio::test]
async fn concurrent_writes_remain_atomic_and_namespaced() {
    let (_temp, app) = app();
    let planner = request(
        "PUT",
        "/api/v1/preferences/planner.v1",
        Body::from(r#"{"value":{"selected":"today"}}"#),
    );
    let ledger = request(
        "PUT",
        "/api/v1/preferences/ledger.table.v1",
        Body::from(r#"{"value":{"selected":"amount"}}"#),
    );
    let (planner, ledger) = tokio::join!(app.clone().oneshot(planner), app.clone().oneshot(ledger));
    assert_eq!(planner.unwrap().status(), StatusCode::OK);
    assert_eq!(ledger.unwrap().status(), StatusCode::OK);

    for (key, selected) in [("planner.v1", "today"), ("ledger.table.v1", "amount")] {
        let response = app
            .clone()
            .oneshot(request(
                "GET",
                &format!("/api/v1/preferences/{key}"),
                Body::empty(),
            ))
            .await
            .unwrap();
        assert_eq!(json_body(response).await["selected"], selected);
    }
}

#[tokio::test]
async fn preferences_require_authentication() {
    let (_temp, app) = app();
    let response = app
        .oneshot(
            Request::get("/api/v1/preferences/planner.v1")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(json_body(response).await["code"], "unauthorized");
}

#[tokio::test]
async fn corrupt_store_returns_safe_internal_envelope() {
    let (temp, app) = app();
    std::fs::write(temp.path().join("todo.sqlite"), b"not sqlite").unwrap();
    let response = app
        .oneshot(request(
            "GET",
            "/api/v1/preferences/planner.v1",
            Body::empty(),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    let error = json_body(response).await;
    assert_eq!(error["code"], "internal_error");
    let serialized = error.to_string();
    assert!(!serialized.contains(temp.path().to_str().unwrap()));
    assert!(!serialized.contains("sqlite"));
}
