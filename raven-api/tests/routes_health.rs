use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use http_body_util::BodyExt;
use raven_api::{AuthMode, RavenApiConfig, router};
use serde_json::{Value, json};
use tower::ServiceExt;

const PNG: &[u8] = &[
    0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, b'I', b'H', b'D', b'R', 0, 0, 0,
    1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0x1f, 0x15, 0xc4, 0x89, 0, 0, 0, 10, b'I', b'D', b'A', b'T',
    0x78, 0x9c, 0x63, 0, 1, 0, 0, 5, 0, 1, 0x0d, 0x0a, 0x2d, 0xb4, 0, 0, 0, 0, b'I', b'E', b'N',
    b'D', 0xae, 0x42, 0x60, 0x82,
];

fn app() -> (tempfile::TempDir, axum::Router) {
    let temp = tempfile::tempdir().unwrap();
    let config = RavenApiConfig {
        todo_db: temp.path().join("todo.sqlite"),
        ledger_db: temp.path().join("ledger.sqlite"),
        health_db: temp.path().join("health.sqlite"),
        health_media_dir: temp.path().join("media"),
        auth: AuthMode::UiSession {
            token: "test".into(),
        },
    };
    (temp, router(config).unwrap())
}

async fn body(response: axum::response::Response) -> Value {
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    serde_json::from_slice(&bytes).unwrap()
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
