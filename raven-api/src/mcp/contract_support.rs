//! Contract-test support: the real MCP HTTP router (Access middleware, scope policy and
//! streamable HTTP transport) over local stores. A disposable test-only RSA key replaces the
//! Cloudflare issuer, so no network is used. Never enabled by the `raven` binary.
use jsonwebtoken::{Algorithm, EncodingKey, Header, encode, jwk::Jwk, jwk::JwkSet};

use super::{access, policy};
use crate::RavenApiConfig;

/// `Host` every contract request must send; it matches the configured public origin.
pub const HOST: &str = "mcp.example.com";
const ISSUER: &str = "https://contract-test.cloudflareaccess.com";
const AUDIENCE: &str = "contract-test-audience";
const CALLER: &str = "contract-test.access";

/// Router plus a `cf-access-jwt-assertion` value for a direct caller holding every scope.
pub struct LocalMcp {
    pub router: axum::Router,
    pub assertion: String,
}

pub fn local_router(config: RavenApiConfig) -> anyhow::Result<LocalMcp> {
    let access =
        super::McpAccessConfig::new(format!("https://{HOST}"), ISSUER.into(), AUDIENCE.into())?
            .with_callers(
                None,
                None,
                Some(format!("{CALLER}={}", policy::SCOPES.join(","))),
            )?;
    // Disposable test-only key, never an operational credential.
    let key = EncodingKey::from_rsa_der(include_bytes!("access/test-key.der"));
    let mut jwk = Jwk::from_encoding_key(&key, Algorithm::RS256)?;
    jwk.common.key_id = Some("contract-test-key".into());
    let mut header = Header::new(Algorithm::RS256);
    header.kid = jwk.common.key_id.clone();
    let exp = time::OffsetDateTime::now_utc().unix_timestamp() + 3600;
    let assertion = encode(
        &header,
        &serde_json::json!({"iss":ISSUER,"aud":[AUDIENCE],"exp":exp,"sub":"","common_name":CALLER}),
        &key,
    )?;
    let auth = access::AccessAuth::with_keys(access, JwkSet { keys: vec![jwk] });
    Ok(LocalMcp {
        router: super::router_with_auth(config, auth)?,
        assertion,
    })
}
