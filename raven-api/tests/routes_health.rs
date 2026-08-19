use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use http_body_util::BodyExt;
use raven_api::{AuthMode, RavenApiConfig, router};
use serde_json::{Value, json};
use std::path::{Path as FilePath, PathBuf};
use tower::ServiceExt;

const PNG: &[u8] = &[
    0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, b'I', b'H', b'D', b'R', 0, 0, 0,
    1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0x1f, 0x15, 0xc4, 0x89, 0, 0, 0, 10, b'I', b'D', b'A', b'T',
    0x78, 0x9c, 0x63, 0, 1, 0, 0, 5, 0, 1, 0x0d, 0x0a, 0x2d, 0xb4, 0, 0, 0, 0, b'I', b'E', b'N',
    b'D', 0xae, 0x42, 0x60, 0x82,
];
const JPEG: &[u8] = &[
    0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0, 1, 0, 1, 1, 1, 0x11, 0, 0xff,
    0xda, 0, 8, 1, 1, 0, 0, 0x3f, 0, 0, 0xff, 0xd9,
];
const WEBP: &[u8] = &[
    b'R', b'I', b'F', b'F', 14, 0, 0, 0, b'W', b'E', b'B', b'P', b'V', b'P', b'8', b'L', 1, 0, 0,
    0, 0, 0,
];

fn app() -> (tempfile::TempDir, axum::Router) {
    let temp = tempfile::tempdir().unwrap();
    let config = RavenApiConfig {
        todo_db: temp.path().join("todo.sqlite"),
        ledger_db: temp.path().join("ledger.sqlite"),
        health_db: temp.path().join("health.sqlite"),
        health_media_dir: temp.path().join("media"),
        local_offset: time::UtcOffset::from_hms(9, 0, 0).unwrap(),
        auth: AuthMode::UiSession {
            token: "test".into(),
        },
    };
    (temp, authenticated(router(config).unwrap()))
}

fn authenticated(app: axum::Router) -> axum::Router {
    app.layer(axum::middleware::from_fn(
        |mut request: Request<Body>, next: axum::middleware::Next| async move {
            request
                .headers_mut()
                .insert(header::COOKIE, "raven_session=test".parse().unwrap());
            next.run(request).await
        },
    ))
}

async fn body(response: axum::response::Response) -> Value {
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    serde_json::from_slice(&bytes).unwrap()
}

async fn create_diet(app: &axum::Router) -> Value {
    let request = Request::post("/api/v1/health/diet")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "occurred_at": "2026-07-31T01:00:00Z",
                "meal_type": "lunch",
                "food_name": "Salad",
                "tags": ["vegetable"]
            })
            .to_string(),
        ))
        .unwrap();
    let response = app.clone().oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    body(response).await
}

async fn get_diet(app: &axum::Router, id: &str) -> Value {
    let response = app
        .clone()
        .oneshot(
            Request::get(format!("/api/v1/health/diet/{id}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    body(response).await
}

async fn get_diet_audit(app: &axum::Router, id: &str) -> Value {
    let response = app
        .clone()
        .oneshot(
            Request::get(format!("/api/v1/health/audit/diet_entry/{id}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    body(response).await
}

fn media_entries(root: &FilePath) -> Vec<PathBuf> {
    let mut entries = std::fs::read_dir(root)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .collect::<Vec<_>>();
    entries.sort();
    entries
}

#[tokio::test]
async fn daily_metric_upsert_returns_changed_rows() {
    let (_temp, app) = app();
    let request = Request::post("/api/v1/health/metrics/daily")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "metrics": [{
                    "occurred_at": "2026-07-31T01:00:00Z",
                    "details": {
                        "kind": "weight",
                        "value": 71.5,
                        "unit": "kg"
                    }
                }]
            })
            .to_string(),
        ))
        .unwrap();
    let response = app.oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(body(response).await["items"].as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn media_upload_rejects_paths_and_oversized_bytes() {
    let (_temp, app) = app();
    let path = Request::post("/api/v1/health/diet/with-image")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(r#"{"path":"/tmp/private.jpg"}"#))
        .unwrap();
    assert_eq!(
        app.clone().oneshot(path).await.unwrap().status(),
        StatusCode::UNSUPPORTED_MEDIA_TYPE
    );

    let oversized = Request::post("/api/v1/health/diet/with-image")
        .header(header::CONTENT_TYPE, "image/jpeg")
        .body(Body::from(vec![0_u8; 10 * 1024 * 1024 + 1]))
        .unwrap();
    assert_eq!(
        app.oneshot(oversized).await.unwrap().status(),
        StatusCode::PAYLOAD_TOO_LARGE
    );
}

#[tokio::test]
async fn diet_image_is_created_atomically_from_bounded_raw_bytes() {
    let (_temp, app) = app();
    let metadata = json!({
        "occurred_at": "2026-07-31T01:00:00Z",
        "meal_type": "lunch",
        "food_name": "Salad",
        "tags": ["vegetable"]
    })
    .to_string();
    let request = Request::post("/api/v1/health/diet/with-image")
        .header(header::CONTENT_TYPE, "image/png")
        .header("x-raven-diet-metadata", metadata)
        .body(Body::from(PNG))
        .unwrap();
    let response = app.oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    assert!(body(response).await["media_id"].is_string());
}

#[tokio::test]
async fn diet_image_metadata_rejects_unknown_fields() {
    let (_temp, app) = app();
    let request = Request::post("/api/v1/health/diet/with-image")
        .header(header::CONTENT_TYPE, "image/png")
        .header(
            "x-raven-diet-metadata",
            r#"{"occurred_at":"2026-07-31T01:00:00Z","meal_type":"lunch","food_name":"Salad","path":"/tmp/private.png"}"#,
        )
        .body(Body::from(PNG))
        .unwrap();
    assert_eq!(
        app.oneshot(request).await.unwrap().status(),
        StatusCode::BAD_REQUEST
    );
}

#[tokio::test]
async fn diet_metadata_header_is_bounded_before_json_parsing() {
    let (_temp, app) = app();
    let request = Request::post("/api/v1/health/diet/with-image")
        .header(header::CONTENT_TYPE, "image/png")
        .header("x-raven-diet-metadata", "x".repeat(8 * 1024 + 1))
        .body(Body::from(PNG))
        .unwrap();
    let response = app.oneshot(request).await.unwrap();
    assert_eq!(
        response.status(),
        StatusCode::REQUEST_HEADER_FIELDS_TOO_LARGE
    );
    let error = body(response).await;
    assert_eq!(error["code"], "header_too_large");
    assert!(error["request_id"].is_string());
}

#[tokio::test]
async fn service_detected_media_mismatch_is_unsupported_media() {
    let (_temp, app) = app();
    let metadata = json!({
        "occurred_at": "2026-07-31T01:00:00Z",
        "meal_type": "lunch",
        "food_name": "Salad"
    })
    .to_string();
    let request = Request::post("/api/v1/health/diet/with-image")
        .header(header::CONTENT_TYPE, "image/jpeg")
        .header("x-raven-diet-metadata", metadata)
        .body(Body::from(PNG))
        .unwrap();
    let response = app.oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::UNSUPPORTED_MEDIA_TYPE);
    assert_eq!(response.headers()[header::CONTENT_TYPE], "application/json");
    let error = body(response).await;
    assert_eq!(error["code"], "unsupported_media_type");
    assert!(error["request_id"].is_string());
}

#[tokio::test]
async fn diet_image_update_replaces_supported_images_and_removes_image() {
    let (temp, app) = app();
    let created = create_diet(&app).await;
    let id = created["id"].as_str().unwrap();
    let stale_updated_at = created["updated_at"].as_str().unwrap().to_string();
    let mut updated_at = created["updated_at"].as_str().unwrap().to_string();
    let mut media_id = None::<String>;

    for (content_type, bytes, food_name) in [
        ("image/png", PNG, "PNG Salad"),
        ("image/jpeg", JPEG, "JPEG Salad"),
        ("image/webp", WEBP, "WebP Salad"),
    ] {
        let metadata = json!({
            "food_name": food_name,
            "expected_updated_at": updated_at,
            "reason": "replace meal photo"
        })
        .to_string();
        let response = app
            .clone()
            .oneshot(
                Request::patch(format!("/api/v1/health/diet/{id}/with-image"))
                    .header(header::CONTENT_TYPE, content_type)
                    .header("x-raven-diet-metadata", metadata)
                    .body(Body::from(bytes))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let updated = body(response).await;
        assert_eq!(updated["food_name"], food_name);
        assert!(updated["media_id"].is_string());
        assert_ne!(updated["media_id"].as_str(), media_id.as_deref());
        media_id = updated["media_id"].as_str().map(str::to_string);
        updated_at = updated["updated_at"].as_str().unwrap().to_string();
    }

    let audit = get_diet_audit(&app, id).await;
    let latest = audit["items"].as_array().unwrap().last().unwrap();
    assert_eq!(latest["action"], "update");
    assert_eq!(latest["reason"], "replace meal photo");

    let before_stale = get_diet(&app, id).await;
    let media_before_stale = media_entries(&temp.path().join("media"));
    let stale = app
        .clone()
        .oneshot(
            Request::patch(format!("/api/v1/health/diet/{id}/with-image"))
                .header(header::CONTENT_TYPE, "image/png")
                .header(
                    "x-raven-diet-metadata",
                    json!({
                        "food_name": "Stale Salad",
                        "expected_updated_at": stale_updated_at,
                        "reason": "stale replacement"
                    })
                    .to_string(),
                )
                .body(Body::from(PNG))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(stale.status(), StatusCode::CONFLICT);
    assert_eq!(get_diet(&app, id).await, before_stale);
    assert_eq!(
        media_entries(&temp.path().join("media")),
        media_before_stale
    );
    assert_eq!(get_diet_audit(&app, id).await, audit);

    let response = app
        .clone()
        .oneshot(
            Request::patch(format!("/api/v1/health/diet/{id}"))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({
                        "remove_image": true,
                        "expected_updated_at": updated_at,
                        "reason": "remove meal photo"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert!(body(response).await["media_id"].is_null());
}

#[tokio::test]
async fn diet_image_update_rejects_invalid_uploads_without_changing_entry() {
    let (temp, app) = app();
    let created = create_diet(&app).await;
    let id = created["id"].as_str().unwrap();
    let media = temp.path().join("media");
    let initial_media = media_entries(&media);
    let initial_audit = get_diet_audit(&app, id).await;
    let metadata = json!({"food_name": "Changed"}).to_string();
    let cases = [
        (
            "application/octet-stream",
            metadata.clone(),
            PNG.to_vec(),
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
        ),
        (
            "image/png",
            metadata.clone(),
            Vec::new(),
            StatusCode::BAD_REQUEST,
        ),
        (
            "image/png",
            "{".to_string(),
            PNG.to_vec(),
            StatusCode::BAD_REQUEST,
        ),
        (
            "image/png",
            json!({"food_name": "Changed", "remove_image": true}).to_string(),
            PNG.to_vec(),
            StatusCode::BAD_REQUEST,
        ),
    ];

    for (content_type, metadata, bytes, expected_status) in cases {
        let response = app
            .clone()
            .oneshot(
                Request::patch(format!("/api/v1/health/diet/{id}/with-image"))
                    .header(header::CONTENT_TYPE, content_type)
                    .header("x-raven-diet-metadata", metadata)
                    .body(Body::from(bytes))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), expected_status);
        assert_eq!(get_diet(&app, id).await, created);
        assert_eq!(media_entries(&media), initial_media);
        assert_eq!(get_diet_audit(&app, id).await, initial_audit);
    }

    let response = app
        .clone()
        .oneshot(
            Request::patch(format!("/api/v1/health/diet/{id}/with-image"))
                .header(header::CONTENT_TYPE, "image/png")
                .header("x-raven-diet-metadata", metadata)
                .body(Body::from(vec![0_u8; 10 * 1024 * 1024 + 1]))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(get_diet(&app, id).await, created);
    assert_eq!(media_entries(&media), initial_media);
    assert_eq!(get_diet_audit(&app, id).await, initial_audit);
}

#[tokio::test]
async fn health_event_lifecycle_roundtrip_uses_service_policy() {
    let (_temp, app) = app();
    let create = Request::post("/api/v1/health/events")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "occurred_at": "2026-07-31T01:00:00Z",
                "details": {
                    "kind": "bowel",
                    "bristol_scale": 4
                }
            })
            .to_string(),
        ))
        .unwrap();
    let id = body(app.clone().oneshot(create).await.unwrap()).await["id"]
        .as_str()
        .unwrap()
        .to_string();
    for action in ["archive", "restore", "archive"] {
        let response = app
            .clone()
            .oneshot(
                Request::post(format!("/api/v1/health/events/{id}/{action}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }
    let purge = Request::delete(format!("/api/v1/health/events/{id}/purge"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({"confirmation": id}).to_string()))
        .unwrap();
    assert_eq!(
        app.oneshot(purge).await.unwrap().status(),
        StatusCode::NO_CONTENT
    );
}
