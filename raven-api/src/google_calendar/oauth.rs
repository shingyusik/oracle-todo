//! Google OAuth 2.0 for a "Desktop app" client: PKCE S256, authorization URL, code
//! exchange, refresh and revoke. Endpoints are hard-coded (the client file's
//! `auth_uri`/`token_uri` are ignored).

use std::fmt;
use std::time::Duration;

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use reqwest::header;
use reqwest::{StatusCode, Url};
use serde::Deserialize;
use sha2::{Digest, Sha256};

use super::client::{
    GFuture, GoogleApiError, REQUEST_TIMEOUT, execute, http_client, loopback_base, map_error,
    parse_json,
};
use super::secret::Secret;

pub const AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
pub const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
pub const REVOKE_URL: &str = "https://oauth2.googleapis.com/revoke";

pub const SCOPE_EVENTS: &str = "https://www.googleapis.com/auth/calendar.events";
pub const SCOPE_CALENDAR_LIST_READONLY: &str =
    "https://www.googleapis.com/auth/calendar.calendarlist.readonly";
pub const SCOPE_APP_CREATED: &str = "https://www.googleapis.com/auth/calendar.app.created";
/// Scopes requested on connect.
pub const SCOPES: [&str; 3] = [
    SCOPE_EVENTS,
    SCOPE_CALENDAR_LIST_READONLY,
    SCOPE_APP_CREATED,
];

const MAX_CLIENT_FILE_BYTES: usize = 64 * 1024;
const MAX_TOKEN_BYTES: usize = 64 * 1024;
const RANDOM_BYTES: usize = 32;

pub trait OAuthApi: Send + Sync {
    fn exchange_code<'a>(
        &'a self,
        c: &'a OAuthClient,
        code: &'a Secret,
        verifier: &'a Secret,
        redirect_uri: &'a str,
    ) -> GFuture<'a, TokenGrant>;
    fn refresh<'a>(&'a self, c: &'a OAuthClient, refresh: &'a Secret) -> GFuture<'a, AccessGrant>;
    /// Revokes a refresh or access token. An already-invalid token counts as revoked.
    fn revoke<'a>(&'a self, token: &'a Secret) -> GFuture<'a, ()>;
}

/// Short-lived bearer token; kept in memory only.
#[derive(Clone, PartialEq, Eq)]
pub struct AccessToken(Secret);

impl AccessToken {
    pub fn new(token: Secret) -> Self {
        Self(token)
    }

    pub fn secret(&self) -> &Secret {
        &self.0
    }
}

impl fmt::Debug for AccessToken {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("AccessToken(<redacted>)")
    }
}

impl fmt::Display for AccessToken {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("<redacted>")
    }
}

/// Result of a refresh: a new access token, its lifetime as reported by Google and the
/// granted scopes (empty when Google omitted `scope`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AccessGrant {
    pub access_token: AccessToken,
    pub expires_in: Duration,
    pub scopes: Vec<String>,
}

/// Result of the authorization-code exchange.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TokenGrant {
    pub access: AccessGrant,
    pub refresh_token: Secret,
}

impl fmt::Display for TokenGrant {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("TokenGrant(<redacted>)")
    }
}

/// Google "Desktop app" OAuth client (`{"installed":{...}}`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OAuthClient {
    pub client_id: String,
    pub client_secret: Secret,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum OAuthClientError {
    #[error("OAuth client file is too large")]
    TooLarge,
    #[error("OAuth client file is not valid Google client JSON")]
    Invalid,
    #[error("OAuth client must be a Google \"Desktop app\" client")]
    NotDesktopClient,
}

#[derive(Deserialize)]
struct ClientFile {
    installed: Option<InstalledClient>,
}

#[derive(Deserialize)]
struct InstalledClient {
    client_id: String,
    client_secret: String,
}

impl OAuthClient {
    pub fn new(client_id: impl Into<String>, client_secret: Secret) -> Self {
        Self {
            client_id: client_id.into(),
            client_secret,
        }
    }

    /// Parses the downloaded client JSON. Only the `installed` (Desktop app) type is
    /// accepted; `web` and other types are rejected.
    pub fn from_json(bytes: &[u8]) -> Result<Self, OAuthClientError> {
        if bytes.len() > MAX_CLIENT_FILE_BYTES {
            return Err(OAuthClientError::TooLarge);
        }
        let value: serde_json::Value =
            serde_json::from_slice(bytes).map_err(|_| OAuthClientError::Invalid)?;
        let object = value.as_object().ok_or(OAuthClientError::Invalid)?;
        if !object.contains_key("installed") {
            return Err(OAuthClientError::NotDesktopClient);
        }
        let file: ClientFile =
            serde_json::from_value(value).map_err(|_| OAuthClientError::Invalid)?;
        let installed = file.installed.ok_or(OAuthClientError::Invalid)?;
        let client_id = installed.client_id.trim();
        let client_secret = installed.client_secret.trim();
        if client_id.is_empty()
            || client_secret.is_empty()
            || !client_id.is_ascii()
            || !client_secret.is_ascii()
        {
            return Err(OAuthClientError::Invalid);
        }
        Ok(Self::new(client_id, Secret::new(client_secret)))
    }
}

/// PKCE (RFC 7636) S256 pair.
#[derive(Debug, Clone)]
pub struct Pkce {
    pub verifier: Secret,
    pub challenge: String,
}

impl Pkce {
    /// 32 random bytes → 43-char base64url verifier.
    pub fn generate() -> Result<Self, getrandom::Error> {
        let verifier = random_token()?;
        Ok(Self {
            challenge: pkce_challenge(&verifier),
            verifier,
        })
    }
}

pub fn pkce_challenge(verifier: &Secret) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.expose().as_bytes()))
}

/// Random OAuth `state` (32 bytes, base64url). Compare with [`Secret::ct_eq`].
pub fn generate_state() -> Result<Secret, getrandom::Error> {
    random_token()
}

fn random_token() -> Result<Secret, getrandom::Error> {
    let mut bytes = [0_u8; RANDOM_BYTES];
    getrandom::fill(&mut bytes)?;
    Ok(Secret::new(URL_SAFE_NO_PAD.encode(bytes)))
}

/// Google consent URL (offline access, forced consent, incremental scopes, PKCE S256).
pub fn authorization_url(
    client: &OAuthClient,
    redirect_uri: &str,
    scopes: &[&str],
    state: &Secret,
    challenge: &str,
) -> String {
    let scope = scopes.join(" ");
    let mut url = Url::parse(AUTH_URL).expect("static Google auth URL");
    url.query_pairs_mut().extend_pairs([
        ("client_id", client.client_id.as_str()),
        ("redirect_uri", redirect_uri),
        ("response_type", "code"),
        ("scope", scope.as_str()),
        ("state", state.expose()),
        ("code_challenge", challenge),
        ("code_challenge_method", "S256"),
        ("access_type", "offline"),
        ("prompt", "consent"),
        ("include_granted_scopes", "true"),
    ]);
    url.into()
}

#[derive(Deserialize)]
struct TokenBody {
    access_token: String,
    expires_in: u64,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default)]
    scope: Option<String>,
    #[serde(default)]
    token_type: Option<String>,
}

impl TokenBody {
    fn into_access(self) -> Result<(AccessGrant, Option<String>), GoogleApiError> {
        if self.access_token.is_empty()
            || self
                .token_type
                .as_deref()
                .is_some_and(|kind| !kind.eq_ignore_ascii_case("bearer"))
        {
            return Err(GoogleApiError::InvalidResponse);
        }
        let scopes = self
            .scope
            .as_deref()
            .unwrap_or_default()
            .split_ascii_whitespace()
            .map(str::to_owned)
            .collect();
        Ok((
            AccessGrant {
                access_token: AccessToken::new(Secret::new(self.access_token)),
                expires_in: Duration::from_secs(self.expires_in),
                scopes,
            },
            self.refresh_token.filter(|token| !token.is_empty()),
        ))
    }
}

/// Real Google OAuth token/revoke client.
pub struct GoogleOAuthHttp {
    client: reqwest::Client,
    token_url: String,
    revoke_url: String,
}

impl GoogleOAuthHttp {
    pub fn new() -> anyhow::Result<Self> {
        Self::with_endpoints(TOKEN_URL, REVOKE_URL, REQUEST_TIMEOUT)
    }

    /// Honors a valid loopback override value of
    /// [`super::client::GOOGLE_API_URL_ENV`] (`<base>/token`, `<base>/revoke`).
    pub fn from_env(api_url: Option<String>) -> anyhow::Result<Self> {
        match api_url.as_deref().and_then(loopback_base) {
            Some(base) => Self::with_endpoints(
                &format!("{base}/token"),
                &format!("{base}/revoke"),
                REQUEST_TIMEOUT,
            ),
            None => Self::new(),
        }
    }

    pub(crate) fn with_endpoints(
        token_url: &str,
        revoke_url: &str,
        timeout: Duration,
    ) -> anyhow::Result<Self> {
        Ok(Self {
            client: http_client(timeout)?,
            token_url: token_url.to_owned(),
            revoke_url: revoke_url.to_owned(),
        })
    }

    async fn token_request(&self, form: &[(&str, &str)]) -> Result<TokenBody, GoogleApiError> {
        let request = self
            .client
            .post(&self.token_url)
            .header(header::ACCEPT, "application/json")
            .form(form);
        let (_, body) = execute(request, MAX_TOKEN_BYTES).await?;
        parse_json(&body)
    }

    async fn exchange_impl(
        &self,
        c: &OAuthClient,
        code: &Secret,
        verifier: &Secret,
        redirect_uri: &str,
    ) -> Result<TokenGrant, GoogleApiError> {
        let body = self
            .token_request(&[
                ("grant_type", "authorization_code"),
                ("code", code.expose()),
                ("code_verifier", verifier.expose()),
                ("redirect_uri", redirect_uri),
                ("client_id", &c.client_id),
                ("client_secret", c.client_secret.expose()),
            ])
            .await?;
        let (access, refresh_token) = body.into_access()?;
        Ok(TokenGrant {
            access,
            refresh_token: Secret::new(refresh_token.ok_or(GoogleApiError::InvalidResponse)?),
        })
    }

    async fn refresh_impl(
        &self,
        c: &OAuthClient,
        refresh: &Secret,
    ) -> Result<AccessGrant, GoogleApiError> {
        let body = self
            .token_request(&[
                ("grant_type", "refresh_token"),
                ("refresh_token", refresh.expose()),
                ("client_id", &c.client_id),
                ("client_secret", c.client_secret.expose()),
            ])
            .await?;
        Ok(body.into_access()?.0)
    }

    async fn revoke_impl(&self, token: &Secret) -> Result<(), GoogleApiError> {
        let response = self
            .client
            .post(&self.revoke_url)
            .form(&[("token", token.expose())])
            .send()
            .await
            .map_err(|_| GoogleApiError::Network)?;
        let status = response.status();
        if status.is_success() {
            return Ok(());
        }
        let headers = response.headers().clone();
        let body = response.bytes().await.unwrap_or_default();
        if status == StatusCode::BAD_REQUEST && body.len() <= MAX_TOKEN_BYTES {
            #[derive(Deserialize)]
            struct RevokeError {
                error: String,
            }
            if serde_json::from_slice::<RevokeError>(&body)
                .is_ok_and(|error| error.error == "invalid_token")
            {
                return Ok(());
            }
        }
        Err(map_error(status, &headers, &body))
    }
}

impl OAuthApi for GoogleOAuthHttp {
    fn exchange_code<'a>(
        &'a self,
        c: &'a OAuthClient,
        code: &'a Secret,
        verifier: &'a Secret,
        redirect_uri: &'a str,
    ) -> GFuture<'a, TokenGrant> {
        Box::pin(self.exchange_impl(c, code, verifier, redirect_uri))
    }

    fn refresh<'a>(&'a self, c: &'a OAuthClient, refresh: &'a Secret) -> GFuture<'a, AccessGrant> {
        Box::pin(self.refresh_impl(c, refresh))
    }

    fn revoke<'a>(&'a self, token: &'a Secret) -> GFuture<'a, ()> {
        Box::pin(self.revoke_impl(token))
    }
}

#[cfg(test)]
mod tests {
    use super::super::client::fake::{ok, response, serve};
    use super::*;

    const CLIENT_JSON: &str = r#"{"installed":{"client_id":"123.apps.googleusercontent.com","project_id":"p","auth_uri":"https://evil.example/auth","token_uri":"https://evil.example/token","client_secret":"GOCSPX-secret","redirect_uris":["http://localhost"]}}"#;

    fn oauth_client() -> OAuthClient {
        OAuthClient::from_json(CLIENT_JSON.as_bytes()).unwrap()
    }

    fn form(body: &str) -> Vec<(String, String)> {
        Url::parse(&format!("http://x/?{body}"))
            .unwrap()
            .query_pairs()
            .map(|(k, v)| (k.into_owned(), v.into_owned()))
            .collect()
    }

    fn field<'a>(pairs: &'a [(String, String)], key: &str) -> Option<&'a str> {
        pairs
            .iter()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v.as_str())
    }

    async fn oauth(
        responses: Vec<String>,
    ) -> (GoogleOAuthHttp, super::super::client::fake::Served) {
        let (base, handle) = serve(responses).await;
        let client = GoogleOAuthHttp::with_endpoints(
            &format!("{base}/token"),
            &format!("{base}/revoke"),
            Duration::from_secs(5),
        )
        .unwrap();
        (client, handle)
    }

    #[test]
    fn parses_desktop_client_json_and_ignores_endpoints() {
        let client = oauth_client();
        assert_eq!(client.client_id, "123.apps.googleusercontent.com");
        assert_eq!(client.client_secret.expose(), "GOCSPX-secret");
        assert!(!format!("{client:?}").contains("GOCSPX"));
    }

    #[test]
    fn rejects_non_desktop_and_malformed_client_json() {
        let web = r#"{"web":{"client_id":"a","client_secret":"b"}}"#;
        assert_eq!(
            OAuthClient::from_json(web.as_bytes()),
            Err(OAuthClientError::NotDesktopClient)
        );
        for invalid in [
            "not json",
            "[]",
            r#"{"installed":{"client_id":"a"}}"#,
            r#"{"installed":{"client_id":"","client_secret":"b"}}"#,
            r#"{"installed":{"client_id":"a","client_secret":"  "}}"#,
            r#"{"installed":"x"}"#,
        ] {
            assert_eq!(
                OAuthClient::from_json(invalid.as_bytes()),
                Err(OAuthClientError::Invalid),
                "{invalid}"
            );
        }
        let huge = vec![b' '; MAX_CLIENT_FILE_BYTES + 1];
        assert_eq!(
            OAuthClient::from_json(&huge),
            Err(OAuthClientError::TooLarge)
        );
    }

    #[test]
    fn pkce_challenge_is_s256_base64url() {
        // Expected value computed independently: base64url(sha256(verifier)), no padding.
        let verifier = Secret::new("dBjftJeZ4CVP-mJ0kS5Ox1N9jQZX-0IcYLpYgcHl3aQ");
        assert_eq!(
            pkce_challenge(&verifier),
            "q2f49BwZgUUGG-qN4QpbSM3oietpbKGLvOl3OKvCDnA"
        );
        let pkce = Pkce::generate().unwrap();
        assert_eq!(pkce.verifier.expose().len(), 43);
        assert_eq!(pkce.challenge, pkce_challenge(&pkce.verifier));
        assert!(!format!("{pkce:?}").contains(pkce.verifier.expose()));
        let state = generate_state().unwrap();
        assert_eq!(state.expose().len(), 43);
        assert!(!state.ct_eq(&generate_state().unwrap()));
    }

    #[test]
    fn authorization_url_carries_pkce_state_scopes_and_offline_consent() {
        let state = Secret::new("state-123");
        let url = authorization_url(
            &oauth_client(),
            "http://127.0.0.1:3001/__raven/google-calendar/callback",
            &SCOPES,
            &state,
            "challenge-abc",
        );

        assert!(
            url.starts_with("https://accounts.google.com/o/oauth2/v2/auth?"),
            "{url}"
        );
        let pairs: Vec<(String, String)> = Url::parse(&url)
            .unwrap()
            .query_pairs()
            .map(|(k, v)| (k.into_owned(), v.into_owned()))
            .collect();
        let expect = [
            ("client_id", "123.apps.googleusercontent.com"),
            (
                "redirect_uri",
                "http://127.0.0.1:3001/__raven/google-calendar/callback",
            ),
            ("response_type", "code"),
            ("state", "state-123"),
            ("code_challenge", "challenge-abc"),
            ("code_challenge_method", "S256"),
            ("access_type", "offline"),
            ("prompt", "consent"),
            ("include_granted_scopes", "true"),
        ];
        for (key, value) in expect {
            assert_eq!(field(&pairs, key), Some(value), "{key}");
        }
        assert_eq!(field(&pairs, "scope"), Some(SCOPES.join(" ").as_str()));
        assert!(!url.contains("GOCSPX"), "client secret leaked into URL");
    }

    #[tokio::test]
    async fn exchange_code_posts_pkce_form_and_parses_grant() {
        let body = r#"{"access_token":"ya29.access","expires_in":3599,"refresh_token":"1//refresh","scope":"https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.app.created","token_type":"Bearer"}"#;
        let (client, handle) = oauth(vec![ok(body)]).await;

        let grant = client
            .exchange_code(
                &oauth_client(),
                &Secret::new("4/code"),
                &Secret::new("verifier-xyz"),
                "http://127.0.0.1:1/cb",
            )
            .await
            .unwrap();

        assert_eq!(grant.access.access_token.secret().expose(), "ya29.access");
        assert_eq!(grant.access.expires_in, Duration::from_secs(3599));
        assert_eq!(grant.refresh_token.expose(), "1//refresh");
        assert_eq!(
            grant.access.scopes,
            [SCOPE_EVENTS, SCOPE_APP_CREATED].map(str::to_owned)
        );
        let debug = format!("{grant:?} {grant} {}", grant.access.access_token);
        for secret in ["ya29.access", "1//refresh", "GOCSPX"] {
            assert!(!debug.contains(secret), "{debug}");
        }
        let recorded = handle.await.unwrap().remove(0);
        assert!(recorded.request_line().starts_with("POST /token "));
        assert_eq!(
            recorded.header("content-type"),
            Some("application/x-www-form-urlencoded")
        );
        let pairs = form(&recorded.body);
        assert_eq!(field(&pairs, "grant_type"), Some("authorization_code"));
        assert_eq!(field(&pairs, "code"), Some("4/code"));
        assert_eq!(field(&pairs, "code_verifier"), Some("verifier-xyz"));
        assert_eq!(field(&pairs, "redirect_uri"), Some("http://127.0.0.1:1/cb"));
        assert_eq!(
            field(&pairs, "client_id"),
            Some("123.apps.googleusercontent.com")
        );
        assert_eq!(field(&pairs, "client_secret"), Some("GOCSPX-secret"));
    }

    #[tokio::test]
    async fn exchange_without_refresh_token_is_invalid_response() {
        let (client, _handle) = oauth(vec![ok(
            r#"{"access_token":"a","expires_in":10,"token_type":"Bearer"}"#,
        )])
        .await;

        let error = client
            .exchange_code(
                &oauth_client(),
                &Secret::new("c"),
                &Secret::new("v"),
                "http://127.0.0.1:1/cb",
            )
            .await
            .unwrap_err();

        assert_eq!(error, GoogleApiError::InvalidResponse);
    }

    #[tokio::test]
    async fn refresh_posts_refresh_grant_and_maps_invalid_grant() {
        let (client, handle) = oauth(vec![
            ok(r#"{"access_token":"ya29.new","expires_in":3600,"token_type":"Bearer"}"#),
            response(
                "400 Bad Request",
                &[],
                r#"{"error":"invalid_grant","error_description":"Token has been expired or revoked."}"#,
            ),
            response("401 Unauthorized", &[], r#"{"error":"invalid_client"}"#),
        ])
        .await;
        let refresh = Secret::new("1//refresh");

        let grant = client.refresh(&oauth_client(), &refresh).await.unwrap();
        let revoked = client.refresh(&oauth_client(), &refresh).await.unwrap_err();
        let bad_client = client.refresh(&oauth_client(), &refresh).await.unwrap_err();

        assert_eq!(grant.access_token.secret().expose(), "ya29.new");
        assert!(grant.scopes.is_empty());
        assert_eq!(revoked, GoogleApiError::InvalidGrant);
        assert_eq!(bad_client, GoogleApiError::Unauthorized);
        let recorded = handle.await.unwrap();
        let pairs = form(&recorded[0].body);
        assert_eq!(field(&pairs, "grant_type"), Some("refresh_token"));
        assert_eq!(field(&pairs, "refresh_token"), Some("1//refresh"));
    }

    #[tokio::test]
    async fn revoke_posts_token_as_form_field_and_tolerates_invalid_token() {
        let (client, handle) = oauth(vec![
            ok("{}"),
            response("400 Bad Request", &[], r#"{"error":"invalid_token"}"#),
            response("503 Service Unavailable", &[], ""),
        ])
        .await;
        let token = Secret::new("1//refresh+/=");

        client.revoke(&token).await.unwrap();
        client.revoke(&token).await.unwrap();
        assert_eq!(
            client.revoke(&token).await.unwrap_err(),
            GoogleApiError::Server
        );

        let recorded = handle.await.unwrap();
        assert!(recorded[0].request_line().starts_with("POST /revoke "));
        assert!(
            !recorded[0].request_line().contains("token="),
            "token in URL"
        );
        assert_eq!(
            recorded[0].header("content-type"),
            Some("application/x-www-form-urlencoded")
        );
        assert_eq!(
            form(&recorded[0].body),
            [("token".to_owned(), "1//refresh+/=".to_owned())]
        );
    }

    #[test]
    fn from_env_ignores_non_loopback_overrides() {
        let real = GoogleOAuthHttp::from_env(Some("https://evil.example".into())).unwrap();
        assert_eq!(
            (real.token_url.as_str(), real.revoke_url.as_str()),
            (TOKEN_URL, REVOKE_URL)
        );
        let fake = GoogleOAuthHttp::from_env(Some("http://127.0.0.1:9".into())).unwrap();
        assert_eq!(fake.token_url, "http://127.0.0.1:9/token");
        assert_eq!(fake.revoke_url, "http://127.0.0.1:9/revoke");
    }
}
