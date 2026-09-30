use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use health_engine::application::error::HealthError;
use ledger_engine::application::error::LedgerError;
use serde::Serialize;
use serde_json::{Map, Value};
use todo_engine::application::error::TodoError;
use uuid::Uuid;

const INVALID_REQUEST: &str = "The request is invalid.";
const CONFLICT: &str = "The request conflicts with current state.";
const NOT_FOUND: &str = "The requested record was not found.";
const INTERNAL: &str = "An internal error occurred.";

#[derive(Debug, Serialize)]
pub struct ApiErrorBody {
    pub code: String,
    pub message: String,
    pub fields: Map<String, Value>,
    pub request_id: Uuid,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub committed: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub record_id: Option<Uuid>,
}

#[derive(Debug)]
enum ErrorKind {
    Unauthorized,
    Validation { field: Option<&'static str> },
    PayloadTooLarge,
    UriTooLong,
    HeaderTooLarge,
    UnsupportedMediaType,
    Conflict,
    NotFound,
    Internal,
    CleanupPending { record_id: String },
}

#[derive(Debug)]
pub struct ApiError {
    kind: ErrorKind,
}

impl ApiError {
    pub fn unauthorized() -> Self {
        Self {
            kind: ErrorKind::Unauthorized,
        }
    }

    pub fn validation(field: Option<&'static str>) -> Self {
        Self {
            kind: ErrorKind::Validation {
                field: field.filter(|value| safe_field_name(value)),
            },
        }
    }

    pub fn conflict() -> Self {
        Self {
            kind: ErrorKind::Conflict,
        }
    }

    pub fn payload_too_large() -> Self {
        Self {
            kind: ErrorKind::PayloadTooLarge,
        }
    }

    pub fn unsupported_media_type() -> Self {
        Self {
            kind: ErrorKind::UnsupportedMediaType,
        }
    }

    pub fn uri_too_long() -> Self {
        Self {
            kind: ErrorKind::UriTooLong,
        }
    }

    pub fn header_too_large() -> Self {
        Self {
            kind: ErrorKind::HeaderTooLarge,
        }
    }

    pub fn not_found() -> Self {
        Self {
            kind: ErrorKind::NotFound,
        }
    }

    pub fn internal(_source: impl Into<anyhow::Error>) -> Self {
        Self {
            kind: ErrorKind::Internal,
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let request_id = Uuid::new_v4();
        let mut committed = None;
        let mut record_id = None;
        let (status, code, message, fields) = match self.kind {
            ErrorKind::Unauthorized => (
                StatusCode::UNAUTHORIZED,
                "unauthorized",
                "Authentication is required.",
                Map::new(),
            ),
            ErrorKind::Validation { field } => (
                StatusCode::BAD_REQUEST,
                "validation_error",
                INVALID_REQUEST,
                invalid_fields(field),
            ),
            ErrorKind::Conflict => (StatusCode::CONFLICT, "conflict", CONFLICT, Map::new()),
            ErrorKind::PayloadTooLarge => (
                StatusCode::PAYLOAD_TOO_LARGE,
                "payload_too_large",
                INVALID_REQUEST,
                Map::new(),
            ),
            ErrorKind::UriTooLong => (
                StatusCode::URI_TOO_LONG,
                "uri_too_long",
                INVALID_REQUEST,
                Map::new(),
            ),
            ErrorKind::HeaderTooLarge => (
                StatusCode::REQUEST_HEADER_FIELDS_TOO_LARGE,
                "header_too_large",
                INVALID_REQUEST,
                Map::new(),
            ),
            ErrorKind::UnsupportedMediaType => (
                StatusCode::UNSUPPORTED_MEDIA_TYPE,
                "unsupported_media_type",
                INVALID_REQUEST,
                Map::new(),
            ),
            ErrorKind::NotFound => (StatusCode::NOT_FOUND, "not_found", NOT_FOUND, Map::new()),
            ErrorKind::CleanupPending { record_id: id } => {
                committed = Some(true);
                record_id = Uuid::parse_str(&id).ok();
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "cleanup_pending",
                    "Saved; media cleanup remains pending.",
                    Map::new(),
                )
            }
            ErrorKind::Internal => {
                tracing::error!(
                    request_id = %request_id,
                    classification = "internal_error",
                    "Raven API request failed"
                );
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "internal_error",
                    INTERNAL,
                    Map::new(),
                )
            }
        };
        (
            status,
            Json(ApiErrorBody {
                code: code.to_owned(),
                message: message.to_owned(),
                fields,
                request_id,
                committed,
                record_id,
            }),
        )
            .into_response()
    }
}

impl From<TodoError> for ApiError {
    fn from(error: TodoError) -> Self {
        match error {
            TodoError::GoalInvalidAnchor { .. }
            | TodoError::GoalParentHorizonNotCoarser { .. }
            | TodoError::Policy(_)
            | TodoError::Validation(_) => Self::validation(None),
            TodoError::NotFound(_) => Self::not_found(),
            TodoError::Conflict(_) => Self::conflict(),
            TodoError::Storage(_) | TodoError::Migration(_) | TodoError::Internal(_) => {
                Self::internal(anyhow::anyhow!("todo engine failure"))
            }
        }
    }
}

impl From<LedgerError> for ApiError {
    fn from(error: LedgerError) -> Self {
        match error {
            LedgerError::Validation { field, .. } => Self::validation(Some(field)),
            LedgerError::ConfirmationMismatch => Self::validation(None),
            LedgerError::NotFound(_) => Self::not_found(),
            LedgerError::Conflict(_) | LedgerError::Busy(_) => Self::conflict(),
            LedgerError::Storage(_) | LedgerError::Migration(_) => {
                Self::internal(anyhow::anyhow!("ledger engine failure"))
            }
        }
    }
}

impl From<HealthError> for ApiError {
    fn from(error: HealthError) -> Self {
        match error {
            HealthError::Validation { field, .. } => Self::validation(Some(field)),
            HealthError::UnsupportedMedia => Self::unsupported_media_type(),
            HealthError::MediaTooLarge => Self::payload_too_large(),
            HealthError::NotFound(_) => Self::not_found(),
            HealthError::Conflict(_) | HealthError::Busy(_) => Self::conflict(),
            HealthError::Storage(_) | HealthError::Migration(_) | HealthError::Cleanup { .. } => {
                Self::internal(anyhow::anyhow!("health engine failure"))
            }
            HealthError::CleanupPending { record_id, .. } => Self {
                kind: ErrorKind::CleanupPending { record_id },
            },
        }
    }
}

fn safe_field_name(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
}

fn invalid_fields(field: Option<&'static str>) -> Map<String, Value> {
    field
        .map(|field| {
            let mut fields = Map::new();
            fields.insert(
                field.to_owned(),
                Value::Array(vec![Value::String("invalid".to_owned())]),
            );
            fields
        })
        .unwrap_or_default()
}
