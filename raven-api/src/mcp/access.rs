use axum::{
    extract::{Request, State},
    http::{HeaderName, StatusCode, Uri, header},
    middleware::Next,
    response::{IntoResponse, Response},
};
use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode, decode_header, jwk::JwkSet};
use std::{
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::sync::Mutex;

const ASSERTION: HeaderName = HeaderName::from_static("cf-access-jwt-assertion");
const KEY_TTL: Duration = Duration::from_secs(600);
const REFRESH_COOLDOWN: Duration = Duration::from_secs(30);
const MAX_JWKS_BYTES: usize = 256 * 1024;
const MAX_JWT_BYTES: usize = 16 * 1024;

#[derive(Clone)]
pub struct McpAccessConfig {
    pub(super) origin: String,
    issuer: String,
    audience: String,
}

impl std::fmt::Debug for McpAccessConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("McpAccessConfig(<redacted>)")
    }
}

#[derive(Debug, thiserror::Error)]
#[error("MCP Access configuration is invalid")]
pub struct McpAccessConfigError;

impl McpAccessConfig {
    pub fn new(
        origin: String,
        issuer: String,
        audience: String,
    ) -> Result<Self, McpAccessConfigError> {
        crate::validate_ui_public_origin(&origin, "127.0.0.1:3003".parse().unwrap())
            .map_err(|_| McpAccessConfigError)?;
        let public: Uri = origin.parse().map_err(|_| McpAccessConfigError)?;
        if public
            .authority()
            .is_none_or(|authority| origin != format!("https://{authority}"))
        {
            return Err(McpAccessConfigError);
        }
        let uri: Uri = issuer.parse().map_err(|_| McpAccessConfigError)?;
        if uri.scheme_str() != Some("https")
            || uri.port().is_some()
            || uri
                .path_and_query()
                .is_some_and(|part| part.as_str() != "/")
            || issuer.ends_with('/')
            || uri.host().is_none_or(|host| {
                !host.ends_with(".cloudflareaccess.com")
                    || host != host.to_ascii_lowercase()
                    || host.contains('@')
            })
            || audience.is_empty()
            || audience.len() > 512
            || !audience.bytes().all(|byte| byte.is_ascii_graphic())
        {
            return Err(McpAccessConfigError);
        }
        Ok(Self {
            origin,
            issuer,
            audience,
        })
    }
}

struct Keys {
    set: JwkSet,
    loaded: Instant,
    attempted: Instant,
}

#[derive(Clone)]
pub(super) struct AccessAuth {
    config: McpAccessConfig,
    client: reqwest::Client,
    keys: Arc<Mutex<Keys>>,
}

impl AccessAuth {
    pub(super) fn origin(&self) -> &str {
        &self.config.origin
    }
    pub(super) async fn load(config: McpAccessConfig) -> anyhow::Result<Self> {
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(5))
            .build()?;
        let set = fetch(&client, &config.issuer)
            .await
            .map_err(|_| anyhow::anyhow!("MCP Access signing keys unavailable"))?;
        let now = Instant::now();
        Ok(Self {
            config,
            client,
            keys: Arc::new(Mutex::new(Keys {
                set,
                loaded: now,
                attempted: now,
            })),
        })
    }

    async fn verify(&self, token: &str) -> bool {
        if token.is_empty() || token.len() > MAX_JWT_BYTES {
            return false;
        }
        let Ok(header) = decode_header(token) else {
            return false;
        };
        if header.alg != Algorithm::RS256 {
            return false;
        }
        let Some(kid) = header.kid else {
            return false;
        };
        let mut keys = self.keys.lock().await;
        if keys.loaded.elapsed() >= KEY_TTL || keys.set.find(&kid).is_none() {
            if keys.attempted.elapsed() >= REFRESH_COOLDOWN {
                keys.attempted = Instant::now();
                if let Ok(set) = fetch(&self.client, &self.config.issuer).await {
                    keys.set = set;
                    keys.loaded = Instant::now();
                }
            }
            if keys.loaded.elapsed() >= KEY_TTL {
                return false;
            }
        }
        let Some(jwk) = keys.set.find(&kid) else {
            return false;
        };
        let Ok(key) = DecodingKey::from_jwk(jwk) else {
            return false;
        };
        valid_token(token, &key, &self.config)
    }
}

fn valid_token(token: &str, key: &DecodingKey, config: &McpAccessConfig) -> bool {
    let mut validation = Validation::new(Algorithm::RS256);
    validation.leeway = 0;
    validation.validate_nbf = true;
    validation.set_required_spec_claims(&["exp", "iss", "aud"]);
    validation.set_issuer(&[&config.issuer]);
    validation.set_audience(&[&config.audience]);
    decode::<serde_json::Value>(token, key, &validation).is_ok()
}

async fn fetch(client: &reqwest::Client, issuer: &str) -> Result<JwkSet, ()> {
    let mut response = client
        .get(format!("{issuer}/cdn-cgi/access/certs"))
        .send()
        .await
        .map_err(|_| ())?
        .error_for_status()
        .map_err(|_| ())?;
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| ())? {
        if bytes.len().saturating_add(chunk.len()) > MAX_JWKS_BYTES {
            return Err(());
        }
        bytes.extend_from_slice(&chunk);
    }
    let set: JwkSet = serde_json::from_slice(&bytes).map_err(|_| ())?;
    if set.keys.is_empty() || set.keys.len() > 64 {
        return Err(());
    }
    let mut ids = std::collections::HashSet::new();
    for key in &set.keys {
        if key
            .common
            .key_id
            .as_ref()
            .is_none_or(|id| id.is_empty() || !ids.insert(id.clone()))
        {
            return Err(());
        }
    }
    Ok(set)
}

pub(super) async fn authenticate(
    State(auth): State<AccessAuth>,
    mut request: Request,
    next: Next,
) -> Response {
    let origin: Uri = auth.config.origin.parse().expect("validated origin");
    let authority = origin.authority().unwrap().as_str();
    let headers = request.headers();
    let host = single(headers, header::HOST);
    if host != Some(authority)
        || request
            .uri()
            .authority()
            .is_some_and(|value| value.as_str() != authority)
    {
        return StatusCode::MISDIRECTED_REQUEST.into_response();
    }
    if headers.contains_key(header::ORIGIN)
        && single(headers, header::ORIGIN) != Some(auth.config.origin.as_str())
    {
        return StatusCode::FORBIDDEN.into_response();
    }
    let valid = match single(headers, ASSERTION) {
        Some(token) => auth.verify(token).await,
        None => false,
    };
    if !valid {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    // Credentials must not enter SDK request metadata or tool handlers.
    for name in [
        ASSERTION,
        header::AUTHORIZATION,
        header::COOKIE,
        HeaderName::from_static("cf-access-client-secret"),
        HeaderName::from_static("cf-access-client-id"),
    ] {
        request.headers_mut().remove(name);
    }
    next.run(request).await
}

fn single(headers: &axum::http::HeaderMap, name: HeaderName) -> Option<&str> {
    let mut values = headers.get_all(name).iter();
    let value = values.next()?.to_str().ok()?;
    if values.next().is_some() || value.is_empty() {
        return None;
    }
    Some(value)
}

#[cfg(test)]
pub(super) mod tests;
