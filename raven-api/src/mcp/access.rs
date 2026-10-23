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
const SCOPE_ASSERTION: HeaderName = HeaderName::from_static("raven-scope-assertion");
const KEY_TTL: Duration = Duration::from_secs(600);
const REFRESH_COOLDOWN: Duration = Duration::from_secs(30);
const MAX_JWKS_BYTES: usize = 256 * 1024;
const MAX_JWT_BYTES: usize = 16 * 1024;
const ASSERTION_LEEWAY: i64 = 30;
const MAX_ASSERTION_LIFETIME: i64 = 120;

#[derive(Clone)]
pub struct McpAccessConfig {
    pub(super) origin: String,
    issuer: String,
    audience: String,
    callers: Callers,
}

/// Access service tokens allowed to call MCP, identified by `common_name` (Client ID).
#[derive(Clone, Default)]
struct Callers {
    gateway: Option<(String, DecodingKey)>,
    direct: std::collections::HashMap<String, Vec<String>>,
}

/// Caller and OAuth scopes of one authenticated MCP request.
#[derive(Clone)]
pub(super) struct Grant {
    pub(super) caller: String,
    /// OAuth client ID from the gateway assertion; `None` for direct service tokens.
    pub(super) client_id: Option<String>,
    pub(super) scopes: Vec<String>,
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
            callers: Callers::default(),
        })
    }

    /// Set the caller allowlist. The gateway service token must send a scope assertion signed
    /// by `gateway_public_key` (base64url Ed25519, JWK `x`). `service_clients` lists direct
    /// service tokens as whitespace-separated `<client-id>=<scope>[,<scope>...]`.
    pub fn with_callers(
        mut self,
        gateway_client_id: Option<String>,
        gateway_public_key: Option<String>,
        service_clients: Option<String>,
    ) -> Result<Self, McpAccessConfigError> {
        let valid_id = |id: &str| {
            !id.is_empty()
                && id.len() <= 256
                && id
                    .bytes()
                    .all(|byte| byte.is_ascii_graphic() && !b"=,".contains(&byte))
        };
        let mut callers = Callers::default();
        match (gateway_client_id, gateway_public_key) {
            (Some(id), Some(public)) if valid_id(&id) => {
                let raw = base64::Engine::decode(
                    &base64::engine::general_purpose::URL_SAFE_NO_PAD,
                    &public,
                )
                .map_err(|_| McpAccessConfigError)?;
                if raw.len() != 32 {
                    return Err(McpAccessConfigError);
                }
                let key =
                    DecodingKey::from_ed_components(&public).map_err(|_| McpAccessConfigError)?;
                callers.gateway = Some((id, key));
            }
            (None, None) => {}
            _ => return Err(McpAccessConfigError),
        }
        for entry in service_clients.as_deref().unwrap_or("").split_whitespace() {
            let (id, scopes) = entry.split_once('=').ok_or(McpAccessConfigError)?;
            let scopes: Vec<String> = scopes.split(',').map(str::to_owned).collect();
            if !valid_id(id)
                || scopes
                    .iter()
                    .any(|scope| !super::policy::SCOPES.contains(&scope.as_str()))
                || callers
                    .gateway
                    .as_ref()
                    .is_some_and(|(gateway, _)| gateway == id)
                || callers.direct.insert(id.to_owned(), scopes).is_some()
            {
                return Err(McpAccessConfigError);
            }
        }
        // `raven mcp` reports this as a clean exit-2 validation error before startup;
        // `AccessAuth::load` repeats the check as the fail-closed backstop.
        if callers.gateway.is_none() && callers.direct.is_empty() {
            return Err(McpAccessConfigError);
        }
        self.callers = callers;
        Ok(self)
    }
}

impl Callers {
    fn grant(
        &self,
        caller: &str,
        headers: &axum::http::HeaderMap,
        audience: &str,
    ) -> Result<(Option<String>, Vec<String>), &'static str> {
        if let Some((gateway, key)) = &self.gateway
            && gateway == caller
        {
            let token = single(headers, SCOPE_ASSERTION).ok_or("scope assertion missing")?;
            let (client_id, scopes) =
                valid_assertion(token, key, audience).ok_or("scope assertion invalid")?;
            return Ok((Some(client_id), scopes));
        }
        if headers.contains_key(SCOPE_ASSERTION) {
            return Err("scope assertion from non-gateway caller");
        }
        let scopes = self.direct.get(caller).cloned().ok_or("unknown caller")?;
        Ok((None, scopes))
    }
}

#[derive(serde::Deserialize)]
struct ScopeClaims {
    scope: String,
    client_id: String,
    iat: i64,
    exp: i64,
}

/// Returns the client ID and scopes of a gateway assertion: EdDSA, exact audience,
/// short positive lifetime.
fn valid_assertion(
    token: &str,
    key: &DecodingKey,
    audience: &str,
) -> Option<(String, Vec<String>)> {
    if token.len() > MAX_JWT_BYTES {
        return None;
    }
    let mut validation = Validation::new(Algorithm::EdDSA);
    validation.leeway = ASSERTION_LEEWAY as u64;
    validation.set_required_spec_claims(&["exp", "aud"]);
    validation.set_audience(&[audience]);
    let claims = decode::<ScopeClaims>(token, key, &validation).ok()?.claims;
    let now = time::OffsetDateTime::now_utc().unix_timestamp();
    let lifetime = claims.exp.saturating_sub(claims.iat);
    if claims.client_id.is_empty()
        || claims.iat > now.saturating_add(ASSERTION_LEEWAY)
        || !(1..=MAX_ASSERTION_LIFETIME).contains(&lifetime)
    {
        return None;
    }
    let scopes = claims.scope.split_whitespace().map(str::to_owned).collect();
    Some((claims.client_id, scopes))
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
    /// Fixed key set: never refreshed from the issuer and never stale.
    fixed: bool,
}

impl AccessAuth {
    pub(super) fn origin(&self) -> &str {
        &self.config.origin
    }
    pub(super) async fn load(config: McpAccessConfig) -> anyhow::Result<Self> {
        // Backstop for library callers that skip `with_callers`: never serve without an
        // allowlist. `with_callers` gives the CLI its own exit-2 validation error.
        if config.callers.gateway.is_none() && config.callers.direct.is_empty() {
            anyhow::bail!("MCP caller allowlist required");
        }
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
            fixed: false,
        })
    }

    /// Contract tests only: trust a fixed key set and never contact the issuer. Unknown kids
    /// are rejected and the keys never expire.
    #[cfg(feature = "contract-test-support")]
    pub(super) fn with_keys(config: McpAccessConfig, set: JwkSet) -> Self {
        let now = Instant::now();
        Self {
            config,
            client: reqwest::Client::new(),
            keys: Arc::new(Mutex::new(Keys {
                set,
                loaded: now,
                attempted: now,
            })),
            fixed: true,
        }
    }

    async fn verify(&self, token: &str) -> Option<serde_json::Value> {
        if token.is_empty() || token.len() > MAX_JWT_BYTES {
            return None;
        }
        let header = decode_header(token).ok()?;
        if header.alg != Algorithm::RS256 {
            return None;
        }
        let kid = header.kid?;
        let mut keys = self.keys.lock().await;
        if !self.fixed && (keys.loaded.elapsed() >= KEY_TTL || keys.set.find(&kid).is_none()) {
            if keys.attempted.elapsed() >= REFRESH_COOLDOWN {
                keys.attempted = Instant::now();
                if let Ok(set) = fetch(&self.client, &self.config.issuer).await {
                    keys.set = set;
                    keys.loaded = Instant::now();
                }
            }
            if keys.loaded.elapsed() >= KEY_TTL {
                return None;
            }
        }
        let key = DecodingKey::from_jwk(keys.set.find(&kid)?).ok()?;
        valid_token(token, &key, &self.config)
    }
}

fn valid_token(
    token: &str,
    key: &DecodingKey,
    config: &McpAccessConfig,
) -> Option<serde_json::Value> {
    let mut validation = Validation::new(Algorithm::RS256);
    validation.leeway = 0;
    validation.validate_nbf = true;
    validation.set_required_spec_claims(&["exp", "iss", "aud"]);
    validation.set_issuer(&[&config.issuer]);
    validation.set_audience(&[&config.audience]);
    decode::<serde_json::Value>(token, key, &validation)
        .ok()
        .map(|data| data.claims)
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
    let claims = match single(headers, ASSERTION) {
        Some(token) => auth.verify(token).await,
        None => None,
    };
    let Some(claims) = claims else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    // Only service tokens carry common_name; identity logins are not MCP callers.
    let caller = claims["common_name"].as_str().unwrap_or("").to_owned();
    let audience = format!("{}/mcp", auth.config.origin);
    if caller.is_empty() {
        tracing::warn!(caller = "none", "MCP request denied: unknown caller");
        return StatusCode::FORBIDDEN.into_response();
    }
    let (client_id, scopes) = match auth.config.callers.grant(&caller, headers, &audience) {
        Ok(grant) => grant,
        Err(reason) => {
            // A rejected assertion is unverified, so its client_id is not trusted or logged.
            tracing::warn!(caller = %caller, "MCP request denied: {reason}");
            return StatusCode::FORBIDDEN.into_response();
        }
    };
    tracing::debug!(
        caller = %caller,
        client_id = client_id.as_deref().unwrap_or("none"),
        "MCP request authorized"
    );
    request.extensions_mut().insert(Grant {
        caller,
        client_id,
        scopes,
    });
    // Credentials must not enter SDK request metadata or tool handlers.
    for name in [
        ASSERTION,
        SCOPE_ASSERTION,
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
