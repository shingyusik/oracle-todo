use std::path::PathBuf;

use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use axum::response::IntoResponse;
use health_engine::application::error::HealthError;
use http_body_util::BodyExt;
use ledger_engine::application::error::LedgerError;
use raven_api::{ApiError, AuthMode, RavenApiConfig, router};
use serde_json::{Value, json};
use todo_engine::application::error::TodoError;
use tower::ServiceExt;
use uuid::{Uuid, Version};

async fn body(response: axum::response::Response) -> Value {
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    serde_json::from_slice(&bytes).unwrap()
}

async fn assert_error(
    error: ApiError,
    status: StatusCode,
    code: &str,
    message: &str,
    field: Option<&str>,
) {
    let response = error.into_response();
    assert_eq!(response.status(), status);
    assert_eq!(response.headers()[header::CONTENT_TYPE], "application/json");
    let body = body(response).await;
    assert_eq!(body["code"], code);
    assert_eq!(body["message"], message);
    assert!(body["fields"].is_object());
    if let Some(field) = field {
        assert_eq!(body["fields"][field], json!(["invalid"]));
    }
    let request_id = Uuid::parse_str(body["request_id"].as_str().unwrap()).unwrap();
    assert_eq!(request_id.get_version(), Some(Version::Random));
    assert_eq!(request_id.get_variant(), uuid::Variant::RFC4122);
}

#[tokio::test]
async fn engine_errors_use_stable_safe_envelopes() {
    assert_error(
        LedgerError::Validation {
            field: "amount",
            message: "secret 999.00\r\nx-injected: yes".into(),
        }
        .into(),
        StatusCode::BAD_REQUEST,
        "validation_error",
        "The request is invalid.",
        Some("amount"),
    )
    .await;
    assert_error(
        HealthError::Conflict("secret health value".into()).into(),
        StatusCode::CONFLICT,
        "conflict",
        "The request conflicts with current state.",
        None,
    )
    .await;
    assert_error(
        HealthError::UnsupportedMedia.into(),
        StatusCode::UNSUPPORTED_MEDIA_TYPE,
        "unsupported_media_type",
        "The request is invalid.",
        None,
    )
    .await;
    assert_error(
        HealthError::MediaTooLarge.into(),
        StatusCode::PAYLOAD_TOO_LARGE,
        "payload_too_large",
        "The request is invalid.",
        None,
    )
    .await;
    assert_error(
        TodoError::NotFound("/Users/private/todo.sqlite".into()).into(),
        StatusCode::NOT_FOUND,
        "not_found",
        "The requested record was not found.",
        None,
    )
    .await;
    assert_error(
        LedgerError::Storage(
            "SQL SELECT * FROM ledger_entries; token=top-secret /Users/private".into(),
        )
        .into(),
        StatusCode::INTERNAL_SERVER_ERROR,
        "internal_error",
        "An internal error occurred.",
        None,
    )
    .await;
}

#[tokio::test]
async fn hostile_error_text_never_reaches_json() {
    let response = ApiError::internal(anyhow::anyhow!(
        "SQL error at /Users/private: bearer top-secret\r\nX-Leak: true"
    ))
    .into_response();
    let serialized = serde_json::to_string(&body(response).await).unwrap();
    for secret in ["SQL", "/Users/private", "top-secret", "X-Leak"] {
        assert!(!serialized.contains(secret), "{secret} leaked");
    }
}

#[tokio::test]
async fn hostile_field_name_is_rejected() {
    let response = ApiError::from(LedgerError::Validation {
        field: "amount\r\nx-injected",
        message: "invalid".into(),
    })
    .into_response();
    let body = body(response).await;
    assert_eq!(body["fields"], json!({}));
}

#[tokio::test]
async fn config_debug_redacts_paths_and_auth_secrets() {
    let config = RavenApiConfig {
        todo_db: PathBuf::from("/secret/todo.sqlite"),
        ledger_db: PathBuf::from("/secret/ledger.sqlite"),
        health_db: PathBuf::from("/secret/health.sqlite"),
        health_media_dir: PathBuf::from("/secret/media"),
        auth: AuthMode::Bearer {
            token: "top-secret-token".into(),
        },
    };
    let debug = format!("{config:?}");
    for secret in ["/secret", "top-secret-token"] {
        assert!(!debug.contains(secret));
    }
}

#[tokio::test]
async fn router_creation_has_no_filesystem_side_effects() {
    let temp = tempfile::tempdir().unwrap();
    let home = temp.path().join("missing").join("raven");
    let config = RavenApiConfig {
        todo_db: home.join("todo.sqlite"),
        ledger_db: home.join("ledger.sqlite"),
        health_db: home.join("health.sqlite"),
        health_media_dir: home.join("media/health"),
        auth: AuthMode::UiSession {
            token: "session-secret".into(),
        },
    };

    let response = router(config)
        .unwrap()
        .oneshot(Request::get("/healthz").body(Body::empty()).unwrap())
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(body(response).await, json!({"status": "ok"}));
    assert!(!home.exists());
}
