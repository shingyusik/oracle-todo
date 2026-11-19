use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use axum::Json;
use axum::Router;
use axum::body::Bytes;
use axum::extract::{Extension, State};
use axum::http::{HeaderMap, HeaderName, HeaderValue, StatusCode, Uri, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;
use tokio::sync::{Mutex, Notify};

use crate::ApiError;
use crate::version::{HOST_TARGET, RELEASE_VERSION, is_newer};

pub const GITHUB_LATEST_RELEASE_URL: &str =
    "https://api.github.com/repos/shingyusik/oracle-todo/releases/latest";
const CACHE_TTL: Duration = Duration::from_secs(6 * 60 * 60);
const MIN_CHECK_INTERVAL: Duration = Duration::from_secs(60);
const FETCH_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_RELEASE_BYTES: usize = 1024 * 1024;
const UPDATE_HEADER: HeaderName = HeaderName::from_static("x-raven-update");
const RELEASE_URL_PREFIX: &str = "https://github.com/";

/// Runtime facts about the installed Raven bundle.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpdateSettings {
    pub current_version: String,
    pub ui_version: Option<String>,
    pub supported: bool,
    pub target: String,
}

impl UpdateSettings {
    /// Compile-time version, no UI version and no update supervisor.
    pub fn compiled() -> Self {
        Self {
            current_version: RELEASE_VERSION.to_owned(),
            ui_version: None,
            supported: false,
            target: HOST_TARGET.to_owned(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReleaseInfo {
    pub tag_name: String,
    pub html_url: Option<String>,
    pub assets: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReleaseFetch {
    NotModified,
    Fetched {
        etag: Option<String>,
        release: ReleaseInfo,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("release check unavailable")]
pub struct ReleaseFetchError;

pub type ReleaseFuture<'a> =
    Pin<Box<dyn Future<Output = Result<ReleaseFetch, ReleaseFetchError>> + Send + 'a>>;

/// Source of the latest published Raven release; injectable so tests stay offline.
pub trait ReleaseSource: Send + Sync {
    fn latest<'a>(&'a self, etag: Option<&'a str>) -> ReleaseFuture<'a>;
}

/// GitHub `releases/latest` client.
pub struct GithubReleases {
    client: reqwest::Client,
    url: String,
    token: Option<String>,
}

impl GithubReleases {
    pub fn new(token: Option<String>) -> anyhow::Result<Self> {
        Self::with_endpoint(GITHUB_LATEST_RELEASE_URL, token, FETCH_TIMEOUT)
    }

    /// Like [`GithubReleases::new`], but honors the test-only `RAVEN_GITHUB_API_URL`
    /// override (plain-http loopback only, e.g. a local fake release server). Other
    /// values are ignored. The GitHub token is never sent to an override.
    pub fn from_env(token: Option<String>, api_url: Option<String>) -> anyhow::Result<Self> {
        match api_url.as_deref().and_then(loopback_latest_release_url) {
            Some(url) => Self::with_endpoint(&url, None, FETCH_TIMEOUT),
            None => Self::new(token),
        }
    }

    pub(crate) fn with_endpoint(
        url: &str,
        token: Option<String>,
        timeout: Duration,
    ) -> anyhow::Result<Self> {
        let client = reqwest::Client::builder()
            .timeout(timeout)
            .redirect(reqwest::redirect::Policy::limited(3))
            .build()?;
        Ok(Self {
            client,
            url: url.to_owned(),
            token: token.filter(|token| !token.is_empty()),
        })
    }

    async fn fetch(&self, etag: Option<&str>) -> Result<ReleaseFetch, ReleaseFetchError> {
        let mut request = self
            .client
            .get(&self.url)
            .header(header::USER_AGENT, "raven")
            .header(header::ACCEPT, "application/vnd.github+json")
            .header("x-github-api-version", "2022-11-28");
        if let Some(token) = &self.token {
            request = request.bearer_auth(token);
        }
        if let Some(etag) = etag {
            request = request.header(header::IF_NONE_MATCH, etag);
        }
        let mut response = request.send().await.map_err(|_| ReleaseFetchError)?;
        match response.status() {
            StatusCode::NOT_MODIFIED => return Ok(ReleaseFetch::NotModified),
            StatusCode::OK => {}
            _ => return Err(ReleaseFetchError),
        }
        let etag = response
            .headers()
            .get(header::ETAG)
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned);
        let mut body = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| ReleaseFetchError)? {
            if body.len() + chunk.len() > MAX_RELEASE_BYTES {
                return Err(ReleaseFetchError);
            }
            body.extend_from_slice(&chunk);
        }
        Ok(ReleaseFetch::Fetched {
            etag,
            release: parse_release(&body)?,
        })
    }
}

impl ReleaseSource for GithubReleases {
    fn latest<'a>(&'a self, etag: Option<&'a str>) -> ReleaseFuture<'a> {
        Box::pin(self.fetch(etag))
    }
}

fn loopback_latest_release_url(base: &str) -> Option<String> {
    let url = reqwest::Url::parse(base).ok()?;
    let host = url.host_str()?;
    let loopback = host == "localhost"
        || host
            .trim_start_matches('[')
            .trim_end_matches(']')
            .parse::<std::net::IpAddr>()
            .is_ok_and(|ip| ip.is_loopback());
    if url.scheme() != "http"
        || !loopback
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return None;
    }
    let base = url.as_str().trim_end_matches('/');
    Some(format!(
        "{base}/{}",
        GITHUB_LATEST_RELEASE_URL.trim_start_matches("https://api.github.com/")
    ))
}

#[derive(Deserialize)]
struct GithubRelease {
    tag_name: String,
    html_url: Option<String>,
    #[serde(default)]
    draft: bool,
    #[serde(default)]
    prerelease: bool,
    #[serde(default)]
    assets: Vec<GithubAsset>,
}

#[derive(Deserialize)]
struct GithubAsset {
    name: String,
}

pub(crate) fn parse_release(body: &[u8]) -> Result<ReleaseInfo, ReleaseFetchError> {
    let release: GithubRelease = serde_json::from_slice(body).map_err(|_| ReleaseFetchError)?;
    if release.draft || release.prerelease {
        return Err(ReleaseFetchError);
    }
    Ok(ReleaseInfo {
        tag_name: release.tag_name,
        html_url: release.html_url,
        assets: release.assets.into_iter().map(|asset| asset.name).collect(),
    })
}

/// Fires once when an accepted update asks the UI process to exit for the supervisor.
#[derive(Clone, Default)]
pub struct RestartSignal(Arc<Notify>);

impl RestartSignal {
    pub async fn requested(&self) {
        self.0.notified().await;
    }

    pub fn trigger(&self) {
        self.0.notify_one();
    }
}

/// Update state shared by the UI system routes.
#[derive(Clone)]
pub struct UiUpdates {
    inner: Arc<UpdateInner>,
}

struct UpdateInner {
    settings: UpdateSettings,
    source: Arc<dyn ReleaseSource>,
    cache: Mutex<ReleaseCache>,
    in_progress: AtomicBool,
    restart: RestartSignal,
}

#[derive(Default)]
struct ReleaseCache {
    latest: Option<CachedRelease>,
    etag: Option<String>,
    checked_at: Option<OffsetDateTime>,
    last_success: Option<Instant>,
    last_attempt: Option<Instant>,
    failed: bool,
}

struct CachedRelease {
    version: String,
    release_url: Option<String>,
    assets_ready: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(crate) struct VersionStatus {
    current_version: String,
    ui_version: Option<String>,
    latest_version: Option<String>,
    update_available: bool,
    update_supported: bool,
    checked_at: Option<String>,
    check_error: Option<&'static str>,
    release_url: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum UpdateRejection {
    Unsupported,
    InProgress,
    NotAvailable,
}

impl UiUpdates {
    pub fn new(settings: UpdateSettings, source: Arc<dyn ReleaseSource>) -> Self {
        Self {
            inner: Arc::new(UpdateInner {
                settings,
                source,
                cache: Mutex::new(ReleaseCache::default()),
                in_progress: AtomicBool::new(false),
                restart: RestartSignal::default(),
            }),
        }
    }

    pub fn restart_signal(&self) -> RestartSignal {
        self.inner.restart.clone()
    }

    pub fn current_version(&self) -> &str {
        &self.inner.settings.current_version
    }

    pub(crate) async fn status(
        &self,
        refresh: bool,
        now: Instant,
        wall: OffsetDateTime,
    ) -> VersionStatus {
        let mut cache = self.inner.cache.lock().await;
        let stale = cache
            .last_success
            .is_none_or(|at| now.saturating_duration_since(at) >= CACHE_TTL);
        let may_check = cache
            .last_attempt
            .is_none_or(|at| now.saturating_duration_since(at) >= MIN_CHECK_INTERVAL);
        if (refresh || stale) && may_check {
            cache.last_attempt = Some(now);
            let etag = cache.latest.as_ref().and(cache.etag.clone());
            match self.inner.source.latest(etag.as_deref()).await {
                Ok(ReleaseFetch::Fetched { etag, release }) => {
                    cache.latest = Some(self.cached_release(release));
                    cache.etag = etag;
                    cache.record_success(now, wall);
                }
                Ok(ReleaseFetch::NotModified) if cache.latest.is_some() => {
                    cache.record_success(now, wall);
                }
                Ok(ReleaseFetch::NotModified) | Err(_) => cache.failed = true,
            }
        }
        let settings = &self.inner.settings;
        VersionStatus {
            current_version: settings.current_version.clone(),
            ui_version: settings.ui_version.clone(),
            latest_version: cache.latest.as_ref().map(|latest| latest.version.clone()),
            update_available: self.available(&cache).is_some(),
            update_supported: settings.supported,
            checked_at: cache.checked_at.and_then(|at| at.format(&Rfc3339).ok()),
            check_error: cache.failed.then_some("unavailable"),
            release_url: cache
                .latest
                .as_ref()
                .and_then(|latest| latest.release_url.clone()),
        }
    }

    pub(crate) async fn request(&self, target: &str) -> Result<(), UpdateRejection> {
        if !self.inner.settings.supported {
            return Err(UpdateRejection::Unsupported);
        }
        if self.inner.in_progress.load(Ordering::SeqCst) {
            return Err(UpdateRejection::InProgress);
        }
        let cache = self.inner.cache.lock().await;
        if self.available(&cache) != Some(target) {
            return Err(UpdateRejection::NotAvailable);
        }
        if self
            .inner
            .in_progress
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return Err(UpdateRejection::InProgress);
        }
        tracing::info!(
            event = "ui_update_requested",
            from = %self.inner.settings.current_version,
            to = %target,
            "Raven UI update requested"
        );
        self.inner.restart.trigger();
        Ok(())
    }

    fn available<'a>(&self, cache: &'a ReleaseCache) -> Option<&'a str> {
        cache
            .latest
            .as_ref()
            .filter(|latest| {
                latest.assets_ready
                    && is_newer(&latest.version, &self.inner.settings.current_version)
            })
            .map(|latest| latest.version.as_str())
    }

    fn cached_release(&self, release: ReleaseInfo) -> CachedRelease {
        let version = release
            .tag_name
            .strip_prefix('v')
            .unwrap_or(&release.tag_name)
            .to_owned();
        let assets_ready = required_assets(&version, &self.inner.settings.target)
            .iter()
            .all(|required| release.assets.iter().any(|asset| asset == required));
        CachedRelease {
            version,
            release_url: release
                .html_url
                .filter(|url| url.starts_with(RELEASE_URL_PREFIX)),
            assets_ready,
        }
    }
}

impl ReleaseCache {
    fn record_success(&mut self, now: Instant, wall: OffsetDateTime) {
        self.failed = false;
        self.last_success = Some(now);
        self.checked_at = Some(wall);
    }
}

pub(crate) fn required_assets(version: &str, target: &str) -> [String; 3] {
    let extension = if target.contains("windows") {
        "zip"
    } else {
        "tar.gz"
    };
    [
        format!("raven-{version}-{target}.{extension}"),
        format!("raven-ui-{version}.tar.gz"),
        "SHA256SUMS".to_owned(),
    ]
}

/// The exact Origin of the authority that served the request, set by the UI authority layer.
#[derive(Clone)]
pub(crate) struct ResolvedUiOrigin(pub(crate) HeaderValue);

pub(crate) fn router<S>(updates: UiUpdates) -> Router<S>
where
    S: Clone + Send + Sync + 'static,
{
    Router::new()
        .route("/version", get(version))
        .route("/update", post(update))
        .with_state(updates)
}

async fn version(State(updates): State<UiUpdates>, uri: Uri) -> Response {
    let refresh = uri
        .query()
        .is_some_and(|query| query.split('&').any(|pair| pair == "refresh=1"));
    let status = updates
        .status(refresh, Instant::now(), OffsetDateTime::now_utc())
        .await;
    no_store(Json(status).into_response())
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct UpdateRequest {
    target_version: String,
}

async fn update(
    State(updates): State<UiUpdates>,
    origin: Option<Extension<ResolvedUiOrigin>>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let exact_origin = origin.is_some_and(|Extension(ResolvedUiOrigin(expected))| {
        single_header(&headers, header::ORIGIN) == Some(expected.as_bytes())
    });
    if !exact_origin || single_header(&headers, UPDATE_HEADER) != Some(b"1") {
        return ApiError::forbidden().into_response();
    }
    let Ok(request) = serde_json::from_slice::<UpdateRequest>(&body) else {
        return ApiError::validation(Some("target_version")).into_response();
    };
    match updates.request(&request.target_version).await {
        Ok(()) => no_store(
            (
                StatusCode::ACCEPTED,
                Json(serde_json::json!({
                    "status": "restarting",
                    "target_version": request.target_version,
                })),
            )
                .into_response(),
        ),
        Err(UpdateRejection::Unsupported) => ApiError::update_unsupported().into_response(),
        Err(UpdateRejection::InProgress) => ApiError::update_in_progress().into_response(),
        Err(UpdateRejection::NotAvailable) => ApiError::update_not_available().into_response(),
    }
}

fn single_header(headers: &HeaderMap, name: HeaderName) -> Option<&[u8]> {
    let mut values = headers.get_all(name).iter();
    let value = values.next()?;
    values.next().is_none().then_some(value.as_bytes())
}

fn no_store(mut response: Response) -> Response {
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

#[cfg(test)]
mod tests {
    use std::collections::VecDeque;
    use std::sync::Mutex as StdMutex;

    use super::*;

    const TARGET: &str = "aarch64-apple-darwin";

    #[derive(Default)]
    struct FakeSource {
        responses: StdMutex<VecDeque<Result<ReleaseFetch, ReleaseFetchError>>>,
        etags: StdMutex<Vec<Option<String>>>,
    }

    impl FakeSource {
        fn with(responses: Vec<Result<ReleaseFetch, ReleaseFetchError>>) -> Arc<Self> {
            Arc::new(Self {
                responses: StdMutex::new(responses.into()),
                etags: StdMutex::default(),
            })
        }

        fn calls(&self) -> usize {
            self.etags.lock().unwrap().len()
        }
    }

    impl ReleaseSource for FakeSource {
        fn latest<'a>(&'a self, etag: Option<&'a str>) -> ReleaseFuture<'a> {
            self.etags.lock().unwrap().push(etag.map(str::to_owned));
            let response = self
                .responses
                .lock()
                .unwrap()
                .pop_front()
                .expect("unexpected release check");
            Box::pin(async move { response })
        }
    }

    fn release(tag: &str, assets: &[String]) -> Result<ReleaseFetch, ReleaseFetchError> {
        Ok(ReleaseFetch::Fetched {
            etag: Some(format!("\"etag-{tag}\"")),
            release: ReleaseInfo {
                tag_name: tag.to_owned(),
                html_url: Some(format!(
                    "https://github.com/shingyusik/oracle-todo/releases/tag/{tag}"
                )),
                assets: assets.to_vec(),
            },
        })
    }

    fn complete(tag: &str) -> Result<ReleaseFetch, ReleaseFetchError> {
        let version = tag.trim_start_matches('v');
        release(tag, &required_assets(version, TARGET))
    }

    fn updates(current: &str, supported: bool, source: Arc<FakeSource>) -> UiUpdates {
        UiUpdates::new(
            UpdateSettings {
                current_version: current.to_owned(),
                ui_version: Some("0.1.0".to_owned()),
                supported,
                target: TARGET.to_owned(),
            },
            source,
        )
    }

    fn wall() -> OffsetDateTime {
        OffsetDateTime::from_unix_timestamp(1_800_000_000).unwrap()
    }

    #[tokio::test]
    async fn newer_complete_release_is_available_and_cached_for_six_hours() {
        let source = FakeSource::with(vec![complete("v0.2.0"), Ok(ReleaseFetch::NotModified)]);
        let updates = updates("0.1.0", true, source.clone());
        let start = Instant::now();

        let status = updates.status(false, start, wall()).await;
        assert_eq!(status.latest_version.as_deref(), Some("0.2.0"));
        assert!(status.update_available);
        assert!(status.update_supported);
        assert_eq!(status.ui_version.as_deref(), Some("0.1.0"));
        assert_eq!(status.check_error, None);
        assert_eq!(status.checked_at.as_deref(), Some("2027-01-15T08:00:00Z"));
        assert_eq!(
            status.release_url.as_deref(),
            Some("https://github.com/shingyusik/oracle-todo/releases/tag/v0.2.0")
        );

        let cached = updates
            .status(false, start + CACHE_TTL - Duration::from_secs(1), wall())
            .await;
        assert_eq!(cached, status);
        assert_eq!(source.calls(), 1);

        let later = wall() + time::Duration::hours(6);
        let revalidated = updates.status(false, start + CACHE_TTL, later).await;
        assert_eq!(source.calls(), 2);
        assert_eq!(
            source.etags.lock().unwrap()[1].as_deref(),
            Some("\"etag-v0.2.0\"")
        );
        assert!(revalidated.update_available);
        assert_eq!(
            revalidated.checked_at.as_deref(),
            Some("2027-01-15T14:00:00Z")
        );
    }

    #[tokio::test]
    async fn refresh_rechecks_at_most_once_per_minute() {
        let source = FakeSource::with(vec![
            complete("v0.1.1"),
            complete("v0.2.0"),
            complete("v0.3.0"),
        ]);
        let updates = updates("0.1.0", true, source.clone());
        let start = Instant::now();

        updates.status(false, start, wall()).await;
        let limited = updates
            .status(true, start + Duration::from_secs(59), wall())
            .await;
        assert_eq!(limited.latest_version.as_deref(), Some("0.1.1"));
        assert_eq!(source.calls(), 1);

        let refreshed = updates
            .status(true, start + Duration::from_secs(60), wall())
            .await;
        assert_eq!(refreshed.latest_version.as_deref(), Some("0.2.0"));
        assert_eq!(source.calls(), 2);

        updates
            .status(true, start + Duration::from_secs(61), wall())
            .await;
        assert_eq!(source.calls(), 2);
    }

    #[tokio::test]
    async fn failed_check_reports_unavailable_and_retries_after_a_minute() {
        let source = FakeSource::with(vec![Err(ReleaseFetchError), complete("v0.2.0")]);
        let updates = updates("0.1.0", true, source.clone());
        let start = Instant::now();

        let failed = updates.status(false, start, wall()).await;
        assert_eq!(failed.check_error, Some("unavailable"));
        assert_eq!(failed.latest_version, None);
        assert_eq!(failed.checked_at, None);
        assert!(!failed.update_available);

        updates
            .status(false, start + Duration::from_secs(30), wall())
            .await;
        assert_eq!(source.calls(), 1);

        let recovered = updates
            .status(false, start + Duration::from_secs(60), wall())
            .await;
        assert_eq!(recovered.check_error, None);
        assert!(recovered.update_available);
        assert_eq!(source.etags.lock().unwrap()[1], None);
    }

    #[tokio::test]
    async fn equal_or_older_releases_are_never_offered() {
        for (current, tag) in [
            ("0.2.0", "v0.2.0"),
            ("0.3.0", "v0.2.0"),
            ("1.0.0", "v1.0.0-rc.1"),
        ] {
            let updates = updates(current, true, FakeSource::with(vec![complete(tag)]));
            let status = updates.status(false, Instant::now(), wall()).await;
            assert!(!status.update_available, "{current} -> {tag}");
            assert_eq!(
                updates.request(tag.trim_start_matches('v')).await,
                Err(UpdateRejection::NotAvailable)
            );
        }
    }

    #[tokio::test]
    async fn release_missing_a_required_host_asset_is_not_available() {
        let all = required_assets("0.2.0", TARGET);
        for missing in 0..all.len() {
            let assets = all
                .iter()
                .enumerate()
                .filter(|(index, _)| *index != missing)
                .map(|(_, asset)| asset.clone())
                .collect::<Vec<_>>();
            let updates = updates(
                "0.1.0",
                true,
                FakeSource::with(vec![release("v0.2.0", &assets)]),
            );
            let status = updates.status(false, Instant::now(), wall()).await;
            assert_eq!(status.latest_version.as_deref(), Some("0.2.0"));
            assert!(!status.update_available, "missing {}", all[missing]);
        }

        let other_target = required_assets("0.2.0", "x86_64-unknown-linux-gnu");
        let updates = updates(
            "0.1.0",
            true,
            FakeSource::with(vec![release("v0.2.0", &other_target)]),
        );
        assert!(
            !updates
                .status(false, Instant::now(), wall())
                .await
                .update_available
        );
    }

    #[test]
    fn required_assets_follow_the_release_archive_names() {
        assert_eq!(
            required_assets("1.2.3", "aarch64-apple-darwin"),
            [
                "raven-1.2.3-aarch64-apple-darwin.tar.gz".to_owned(),
                "raven-ui-1.2.3.tar.gz".to_owned(),
                "SHA256SUMS".to_owned(),
            ]
        );
        assert_eq!(
            required_assets("1.2.3", "x86_64-pc-windows-msvc")[0],
            "raven-1.2.3-x86_64-pc-windows-msvc.zip"
        );
    }

    #[tokio::test]
    async fn only_the_cached_newer_version_is_accepted_once_and_signals_restart() {
        let updates = updates("0.1.0", true, FakeSource::with(vec![complete("v0.2.0")]));
        assert_eq!(
            updates.request("0.2.0").await,
            Err(UpdateRejection::NotAvailable)
        );
        updates.status(false, Instant::now(), wall()).await;
        for wrong in ["0.1.0", "0.3.0", "v0.2.0", ""] {
            assert_eq!(
                updates.request(wrong).await,
                Err(UpdateRejection::NotAvailable)
            );
        }

        let restart = updates.restart_signal();
        assert_eq!(updates.request("0.2.0").await, Ok(()));
        tokio::time::timeout(Duration::from_secs(1), restart.requested())
            .await
            .expect("restart was signalled");
        assert_eq!(
            updates.request("0.2.0").await,
            Err(UpdateRejection::InProgress)
        );
    }

    #[tokio::test]
    async fn updates_without_a_supervisor_are_unsupported() {
        let updates = updates("0.1.0", false, FakeSource::with(vec![complete("v0.2.0")]));
        let status = updates.status(false, Instant::now(), wall()).await;
        assert!(status.update_available);
        assert!(!status.update_supported);
        assert_eq!(
            updates.request("0.2.0").await,
            Err(UpdateRejection::Unsupported)
        );
    }

    #[test]
    fn parse_release_reads_github_release_json() {
        let release = parse_release(
            br#"{"tag_name":"v0.2.0","html_url":"https://github.com/shingyusik/oracle-todo/releases/tag/v0.2.0","draft":false,"prerelease":false,"assets":[{"name":"SHA256SUMS","size":1}],"body":"notes"}"#,
        )
        .unwrap();
        assert_eq!(release.tag_name, "v0.2.0");
        assert_eq!(release.assets, ["SHA256SUMS"]);
        assert!(parse_release(br#"{"tag_name":"v1.0.0","prerelease":true}"#).is_err());
        assert!(parse_release(br#"{"tag_name":"v1.0.0","draft":true}"#).is_err());
        assert!(parse_release(b"not json").is_err());
    }

    #[tokio::test]
    async fn non_github_release_urls_are_dropped() {
        let response = Ok(ReleaseFetch::Fetched {
            etag: None,
            release: ReleaseInfo {
                tag_name: "v0.2.0".into(),
                html_url: Some("javascript:alert(1)".into()),
                assets: required_assets("0.2.0", TARGET).to_vec(),
            },
        });
        let updates = updates("0.1.0", true, FakeSource::with(vec![response]));
        let status = updates.status(false, Instant::now(), wall()).await;
        assert_eq!(status.release_url, None);
    }

    async fn serve_once(response: &'static str) -> (String, tokio::task::JoinHandle<String>) {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/latest", listener.local_addr().unwrap());
        let handle = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = Vec::new();
            let mut buffer = [0_u8; 4096];
            while !request.windows(4).any(|window| window == b"\r\n\r\n") {
                let read = stream.read(&mut buffer).await.unwrap();
                if read == 0 {
                    break;
                }
                request.extend_from_slice(&buffer[..read]);
            }
            stream.write_all(response.as_bytes()).await.unwrap();
            stream.shutdown().await.ok();
            String::from_utf8(request).unwrap().to_ascii_lowercase()
        });
        (url, handle)
    }

    #[tokio::test]
    async fn github_client_sends_identity_token_and_etag_and_reads_the_release() {
        let body = r#"{"tag_name":"v0.2.0","html_url":"https://github.com/x","assets":[{"name":"SHA256SUMS"}]}"#;
        let response: &'static str = Box::leak(
            format!(
                "HTTP/1.1 200 OK\r\nETag: \"abc\"\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            )
            .into_boxed_str(),
        );
        let (url, request) = serve_once(response).await;
        let client =
            GithubReleases::with_endpoint(&url, Some("secret-token".into()), FETCH_TIMEOUT)
                .unwrap();

        let fetched = client.latest(Some("\"old\"")).await.unwrap();

        let request = request.await.unwrap();
        assert!(request.contains("user-agent: raven\r\n"), "{request}");
        assert!(request.contains("authorization: bearer secret-token\r\n"));
        assert!(request.contains("if-none-match: \"old\"\r\n"));
        assert_eq!(
            fetched,
            ReleaseFetch::Fetched {
                etag: Some("\"abc\"".into()),
                release: ReleaseInfo {
                    tag_name: "v0.2.0".into(),
                    html_url: Some("https://github.com/x".into()),
                    assets: vec!["SHA256SUMS".into()],
                },
            }
        );
    }

    #[tokio::test]
    async fn github_client_maps_not_modified_errors_and_timeouts() {
        let (url, request) =
            serve_once("HTTP/1.1 304 Not Modified\r\nConnection: close\r\n\r\n").await;
        let client = GithubReleases::with_endpoint(&url, None, FETCH_TIMEOUT).unwrap();
        assert_eq!(client.latest(None).await, Ok(ReleaseFetch::NotModified));
        assert!(!request.await.unwrap().contains("authorization:"));

        let (url, _request) =
            serve_once("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                .await;
        let client = GithubReleases::with_endpoint(&url, None, FETCH_TIMEOUT).unwrap();
        assert_eq!(client.latest(None).await, Err(ReleaseFetchError));

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/latest", listener.local_addr().unwrap());
        let _hold = tokio::spawn(async move {
            let (_stream, _) = listener.accept().await.unwrap();
            tokio::time::sleep(Duration::from_secs(5)).await;
        });
        let client = GithubReleases::with_endpoint(&url, None, Duration::from_millis(100)).unwrap();
        assert_eq!(client.latest(None).await, Err(ReleaseFetchError));
    }

    #[test]
    fn loopback_api_url_override_is_honored_and_drops_the_token() {
        for (base, expected) in [
            (
                "http://127.0.0.1:3025",
                "http://127.0.0.1:3025/repos/shingyusik/oracle-todo/releases/latest",
            ),
            (
                "http://localhost:3025/",
                "http://localhost:3025/repos/shingyusik/oracle-todo/releases/latest",
            ),
            (
                "http://[::1]:3025/api",
                "http://[::1]:3025/api/repos/shingyusik/oracle-todo/releases/latest",
            ),
        ] {
            let client =
                GithubReleases::from_env(Some("secret".into()), Some(base.into())).unwrap();
            assert_eq!(client.url, expected, "{base}");
            assert!(client.token.is_none(), "{base}");
        }
    }

    #[test]
    fn non_loopback_api_url_overrides_fall_back_to_github() {
        for base in [
            "https://127.0.0.1:3025",
            "http://example.com",
            "http://127.0.0.1.example.com",
            "http://user:pass@127.0.0.1:3025",
            "http://10.0.0.1",
            "http://127.0.0.1:3025/?q=1",
            "not a url",
            "",
        ] {
            let client =
                GithubReleases::from_env(Some("secret".into()), Some(base.into())).unwrap();
            assert_eq!(client.url, GITHUB_LATEST_RELEASE_URL, "{base}");
            assert_eq!(client.token.as_deref(), Some("secret"), "{base}");
        }
        let client = GithubReleases::from_env(None, None).unwrap();
        assert_eq!(client.url, GITHUB_LATEST_RELEASE_URL);
    }

    #[test]
    fn production_client_uses_the_documented_endpoint_and_timeout() {
        assert_eq!(
            GITHUB_LATEST_RELEASE_URL,
            "https://api.github.com/repos/shingyusik/oracle-todo/releases/latest"
        );
        assert_eq!(FETCH_TIMEOUT, Duration::from_secs(5));
        assert_eq!(CACHE_TTL, Duration::from_secs(21_600));
        assert_eq!(MIN_CHECK_INTERVAL, Duration::from_secs(60));
        assert!(
            GithubReleases::new(Some(String::new()))
                .unwrap()
                .token
                .is_none()
        );
    }
}
