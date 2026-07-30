use std::env;
use std::fmt;
use std::path::Path;

use axum::extract::{Request, State};
use axum::http::{HeaderMap, header};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use subtle::ConstantTimeEq;

use crate::{ApiError, AuthMode, RavenApiState};

const MIN_TOKEN_BYTES: usize = 16;
const MAX_TOKEN_BYTES: usize = 4 * 1024;
const SESSION_HEADER: &str = "x-raven-session";

#[derive(Clone, PartialEq, Eq)]
pub struct SecretToken(Vec<u8>);

impl SecretToken {
    pub fn new(value: impl AsRef<[u8]>) -> Result<Self, AuthConfigError> {
        validate_token(value.as_ref())?;
        Ok(Self(value.as_ref().to_vec()))
    }

    fn matches(&self, candidate: &[u8]) -> bool {
        candidate.len() == self.0.len() && bool::from(candidate.ct_eq(&self.0))
    }
}

impl AuthMode {
    pub fn bearer(token: SecretToken) -> Self {
        Self::Bearer {
            token: String::from_utf8(token.0).expect("validated Raven tokens are ASCII"),
        }
    }
}

impl fmt::Debug for SecretToken {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("SecretToken(<redacted>)")
    }
}

#[derive(Debug, thiserror::Error)]
pub enum AuthConfigError {
    #[error("exactly one API token source is required")]
    MissingSource,
    #[error("RAVEN_API_TOKEN and RAVEN_API_TOKEN_FILE cannot both be set")]
    ConflictingSources,
    #[error("API token is invalid")]
    InvalidToken,
    #[error("API token file is not secure or readable")]
    InvalidTokenFile,
}

pub fn load_bearer(
    token: Option<&str>,
    token_file: Option<&Path>,
) -> Result<SecretToken, AuthConfigError> {
    match (token, token_file) {
        (Some(_), Some(_)) => Err(AuthConfigError::ConflictingSources),
        (None, None) => Err(AuthConfigError::MissingSource),
        (Some(value), None) => SecretToken::new(value),
        (None, Some(path)) => {
            let bytes = crate::auth_permissions::read_secure_token_file(path)?;
            let token = strip_one_line_ending(bytes);
            SecretToken::new(token)
        }
    }
}

pub fn load_bearer_from_env() -> Result<SecretToken, AuthConfigError> {
    let token = match env::var("RAVEN_API_TOKEN") {
        Ok(value) => Some(value),
        Err(env::VarError::NotPresent) => None,
        Err(env::VarError::NotUnicode(_)) => return Err(AuthConfigError::InvalidToken),
    };
    let token_file = env::var_os("RAVEN_API_TOKEN_FILE").map(std::path::PathBuf::from);
    load_bearer(token.as_deref(), token_file.as_deref())
}

pub(crate) fn validate_mode(mode: &AuthMode) -> Result<(), AuthConfigError> {
    match mode {
        AuthMode::Bearer { token } => SecretToken::new(token).map(|_| ()),
        AuthMode::UiSession { token }
            if !token.is_empty()
                && token.len() <= MAX_TOKEN_BYTES
                && token.as_bytes().iter().all(|byte| byte.is_ascii_graphic()) =>
        {
            Ok(())
        }
        AuthMode::UiSession { .. } => Err(AuthConfigError::InvalidToken),
    }
}

pub async fn authenticate(
    State(state): State<RavenApiState>,
    request: Request,
    next: Next,
) -> Response {
    if request.uri().path() == "/healthz" {
        return next.run(request).await;
    }

    let valid = match state.auth() {
        AuthMode::Bearer { token } => credential(request.headers(), header::AUTHORIZATION)
            .and_then(|value| value.strip_prefix(b"Bearer "))
            .is_some_and(|candidate| {
                SecretToken::new(token).is_ok_and(|expected| expected.matches(candidate))
            }),
        AuthMode::UiSession { token } => credential(
            request.headers(),
            axum::http::HeaderName::from_static(SESSION_HEADER),
        )
        .is_some_and(|candidate| {
            !candidate.is_empty() && SecretToken(token.as_bytes().to_vec()).matches(candidate)
        }),
    };

    if valid {
        next.run(request).await
    } else {
        let mut response = ApiError::unauthorized().into_response();
        response.headers_mut().insert(
            header::WWW_AUTHENTICATE,
            axum::http::HeaderValue::from_static("Bearer"),
        );
        response
    }
}

fn credential(headers: &HeaderMap, name: impl axum::http::header::AsHeaderName) -> Option<&[u8]> {
    let mut values = headers.get_all(name).iter();
    let value = values.next()?;
    if values.next().is_some() {
        return None;
    }
    Some(value.as_bytes())
}

fn validate_token(value: &[u8]) -> Result<(), AuthConfigError> {
    if !(MIN_TOKEN_BYTES..=MAX_TOKEN_BYTES).contains(&value.len())
        || !value.iter().all(|byte| byte.is_ascii_graphic())
    {
        return Err(AuthConfigError::InvalidToken);
    }
    Ok(())
}

fn strip_one_line_ending(mut value: Vec<u8>) -> Vec<u8> {
    if value.ends_with(b"\r\n") {
        value.truncate(value.len() - 2);
    } else if value.ends_with(b"\n") {
        value.pop();
    }
    value
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_debug_is_redacted() {
        let token = SecretToken::new("0123456789abcdef").unwrap();
        assert_eq!(format!("{token:?}"), "SecretToken(<redacted>)");
    }
}
