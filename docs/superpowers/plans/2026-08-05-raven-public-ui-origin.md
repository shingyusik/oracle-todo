# Raven Public UI Origin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `raven ui` safely serve `https://raven.b-sir.xyz` through the existing Cloudflare Tunnel while preserving local UI access and the existing Cloudflare Access email gate.

**Architecture:** Extend the UI authority middleware from one loopback pair to one loopback pair plus one optional, explicitly configured HTTPS pair. Keep Raven bound to `127.0.0.1`, select a `Secure` session cookie only for the public authority, and move the existing Cloudflare Access application and tunnel hostname from Oracle to Raven.

**Tech Stack:** Rust 2024, Axum 0.7 HTTP types and middleware, Clap environment parsing, Cargo tests, macOS launchd, Cloudflare Tunnel and Access.

## Global Constraints

- Accept at most one public origin from `RAVEN_UI_PUBLIC_ORIGIN`.
- The public origin must be absolute HTTPS with a hostname, optional port, and no credentials, query, or fragment.
- `raven ui` remains bound only to `127.0.0.1`.
- Keep exact Host/Origin pairing and return `421 Misdirected Request` for missing, duplicate, malformed, mixed, or unknown authority values.
- Preserve the local HTTP bootstrap cookie and add `Secure` only to the public bootstrap cookie.
- Reuse the existing `paperclip` tunnel and existing Cloudflare Access email allow policy.
- Do not add a reverse proxy, a second tunnel, or a Cloudflare header-transform rule.
- Never run smoke or migration commands against the live Raven home.

---

### Task 1: Public UI authority policy

**Files:**
- Modify: `raven-api/src/server.rs:45-91,678-725`
- Modify: `raven-api/src/lib.rs:23`
- Test: `raven-api/tests/ui_session.rs:1-435`

**Interfaces:**
- Consumes: loopback `SocketAddr` already passed to `ui_router` and optional `&str` public origin.
- Produces: `ui_router(config, artifact, session, authority, public_origin: Option<&str>) -> anyhow::Result<Router>`.
- Produces internally: an authority policy containing the exact loopback pair and optional public pair.

- [ ] **Step 1: Extend the test fixture and write failing public-authority tests**

Change the fixture to pass an optional origin:

```rust
const PUBLIC_AUTHORITY: &str = "raven.b-sir.xyz";
const PUBLIC_ORIGIN: &str = "https://raven.b-sir.xyz";

fn fixture_with_public_origin(public_origin: Option<&str>) -> (tempfile::TempDir, axum::Router) {
    let temp = tempfile::tempdir().unwrap();
    let ui = temp.path().canonicalize().unwrap().join("ui");
    fs::create_dir(&ui).unwrap();
    fs::write(ui.join("index.html"), "<main>Raven</main>").unwrap();
    fs::write(ui.join("app.js"), "export const raven = true;").unwrap();
    fs::write(ui.join("mark.png"), b"\x89PNG\r\n\x1a\n").unwrap();
    let artifact = UiArtifact::load(&ui).unwrap();
    let token = UiSessionToken::generate().unwrap();
    let config = config(&token, temp.path());
    let app = ui_router(
        config,
        artifact,
        token,
        AUTHORITY.parse().unwrap(),
        public_origin,
    )
    .unwrap();
    (temp, app)
}

fn fixture() -> (tempfile::TempDir, axum::Router) {
    fixture_with_public_origin(None)
}
```

Add tests that assert:

```rust
#[tokio::test]
async fn configured_https_authority_accepts_only_its_matching_origin() {
    let (_temp, app) = fixture_with_public_origin(Some(PUBLIC_ORIGIN));

    let public = Request::get("/")
        .header(header::HOST, PUBLIC_AUTHORITY)
        .header(header::ORIGIN, PUBLIC_ORIGIN)
        .body(Body::empty())
        .unwrap();
    assert_eq!(app.clone().oneshot(public).await.unwrap().status(), StatusCode::OK);

    for (host, origin) in [
        (PUBLIC_AUTHORITY, format!("http://{AUTHORITY}")),
        (AUTHORITY, PUBLIC_ORIGIN.to_owned()),
        (PUBLIC_AUTHORITY, "https://attacker.example".to_owned()),
    ] {
        let request = Request::get("/")
            .header(header::HOST, host)
            .header(header::ORIGIN, origin)
            .body(Body::empty())
            .unwrap();
        assert_eq!(
            app.clone().oneshot(request).await.unwrap().status(),
            StatusCode::MISDIRECTED_REQUEST
        );
    }
}

#[tokio::test]
async fn public_bootstrap_cookie_is_secure_and_local_cookie_stays_http_compatible() {
    let (_temp, app) = fixture_with_public_origin(Some(PUBLIC_ORIGIN));
    let public = app
        .clone()
        .oneshot(
            Request::get("/__raven/session")
                .header(header::HOST, PUBLIC_AUTHORITY)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert!(public.headers()[header::SET_COOKIE]
        .to_str().unwrap().contains("; Secure"));

    let local = app.oneshot(get("/__raven/session")).await.unwrap();
    assert!(!local.headers()[header::SET_COOKIE]
        .to_str().unwrap().contains("; Secure"));
}
```

Add table-driven rejection tests for `http://raven.b-sir.xyz`, credentials, `/path`, query,
fragment, an empty value, duplicate public `Host`, and duplicate public `Origin`. Update every
existing `ui_router` call with a final `None` argument.

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```bash
cargo test -p raven-api --test ui_session
```

Expected: compilation fails because `ui_router` does not accept `public_origin`, or the new public-origin assertions fail.

- [ ] **Step 3: Implement the minimal authority policy**

In `raven-api/src/server.rs`, parse the optional origin with Axum's existing HTTP types; do not add a URL dependency. Normalize an accepted value to an exact origin header and authority header:

```rust
#[derive(Clone)]
struct AuthorityPair {
    host: HeaderValue,
    origin: HeaderValue,
}

#[derive(Clone)]
struct ExpectedAuthority {
    local: AuthorityPair,
    public: Option<AuthorityPair>,
}

impl ExpectedAuthority {
    fn new(authority: SocketAddr, public_origin: Option<&str>) -> anyhow::Result<Self> {
        let authority = authority.to_string();
        let local = AuthorityPair {
            host: HeaderValue::from_str(&authority)?,
            origin: HeaderValue::from_str(&format!("http://{authority}"))?,
        };
        let public = public_origin.map(parse_public_origin).transpose()?;
        Ok(Self { local, public })
    }

    fn pair_for_host(&self, host: &[u8]) -> Option<&AuthorityPair> {
        if self.local.host.as_bytes() == host {
            return Some(&self.local);
        }
        self.public.as_ref().filter(|pair| pair.host.as_bytes() == host)
    }
}
```

Implement `parse_public_origin` using `axum::http::Uri`: require scheme `https`, require an authority without `@`, allow only an absent path or `/`, reject any query or fragment, and build canonical `https://{authority}` plus the exact `{authority}` Host value. Return only the safe message `invalid RAVEN_UI_PUBLIC_ORIGIN` on failure.

Change middleware to resolve the exact host to one pair and compare any present Origin only with that pair. Keep the duplicate-header helpers. Change the bootstrap handler to inspect the already validated Host and select one of two prebuilt cookie header values:

```rust
let local_cookie = session_cookie(&session, false)?;
let public_cookie = session_cookie(&session, true)?;
let bootstrap_policy = expected.clone();
let bootstrap = move |request: Request| {
    let cookie = if bootstrap_policy.is_public_host(request.headers()) {
        public_cookie.clone()
    } else {
        local_cookie.clone()
    };
    async move { bootstrap_response(cookie) }
};
```

The secure cookie string is exactly:

```text
raven_session=<token>; HttpOnly; SameSite=Strict; Secure; Path=/
```

Update `ui_router` to accept `public_origin: Option<&str>` and return validation errors before building the router. Keep the non-loopback listener rejection unchanged.

- [ ] **Step 4: Run focused API tests and lint**

Run:

```bash
cargo fmt --check
cargo test -p raven-api --test ui_session
cargo clippy -p raven-api --all-targets --all-features -- -D warnings
```

Expected: all pass.

- [ ] **Step 5: Commit the authority policy**

```bash
git add raven-api/src/server.rs raven-api/src/lib.rs raven-api/tests/ui_session.rs
git diff --cached
git commit -m '[UPDATE] Allow one trusted Raven UI origin' \
  -m '- 루프백 검증을 유지하며 명시한 HTTPS authority/origin 쌍만 추가 허용
- 외부 세션 쿠키에만 Secure 속성을 적용
- 혼합 origin과 중복 헤더 및 잘못된 설정 회귀 테스트 추가'
```

---

### Task 2: CLI environment integration

**Files:**
- Modify: `raven-cli/src/commands/ui.rs:10-38`
- Test: `raven-cli/tests/ui_cli.rs:1-38`

**Interfaces:**
- Consumes: `RAVEN_UI_PUBLIC_ORIGIN` as an optional Unicode environment value.
- Consumes: Task 1's five-argument `raven_api::ui_router`.
- Produces: `raven ui` startup that forwards `Some(&str)` only when the variable is present and valid Unicode.

- [ ] **Step 1: Write failing CLI tests**

Add a test that starts with a valid artifact but an invalid origin and verifies startup fails safely:

```rust
#[test]
fn ui_rejects_an_invalid_public_origin_before_listening() {
    let home = tempfile::tempdir().unwrap();
    let ui = home.path().join("ui");
    std::fs::create_dir(&ui).unwrap();
    std::fs::write(ui.join("index.html"), "Raven").unwrap();

    let output = raven(home.path())
        .env("RAVEN_UI_PUBLIC_ORIGIN", "http://raven.b-sir.xyz")
        .args(["ui", "--ui-path", ui.to_str().unwrap(), "--no-open"])
        .output()
        .unwrap();
    assert!(!output.status.success());
    let stderr = String::from_utf8(output.stderr).unwrap();
    assert!(stderr.contains("invalid RAVEN_UI_PUBLIC_ORIGIN"));
    assert!(!stderr.contains("http://raven.b-sir.xyz"));
}
```

On Unix, add a non-Unicode environment test with `std::os::unix::ffi::OsStringExt` and assert the same safe error message.

- [ ] **Step 2: Run the CLI test to verify it fails**

Run:

```bash
cargo test -p raven-cli --test ui_cli
```

Expected: the invalid value is currently ignored and the process does not fail with the expected message.

- [ ] **Step 3: Read and forward the environment value**

In `raven-cli/src/commands/ui.rs`, resolve the variable before creating the runtime:

```rust
fn public_origin_from_env() -> anyhow::Result<Option<String>> {
    std::env::var_os("RAVEN_UI_PUBLIC_ORIGIN")
        .map(|value| {
            value
                .into_string()
                .map_err(|_| anyhow::anyhow!("invalid RAVEN_UI_PUBLIC_ORIGIN"))
        })
        .transpose()
}
```

Call `public_origin_from_env()?`, move the owned `Option<String>` into the async block, and call:

```rust
let app = raven_api::ui_router(
    config,
    artifact,
    session,
    actual,
    public_origin.as_deref(),
)?;
```

- [ ] **Step 4: Run focused CLI tests and lint**

Run:

```bash
cargo fmt --check
cargo test -p raven-cli --test ui_cli
cargo clippy -p raven-cli --all-targets --all-features -- -D warnings
```

Expected: all pass.

- [ ] **Step 5: Commit CLI integration**

```bash
git add raven-cli/src/commands/ui.rs raven-cli/tests/ui_cli.rs
git diff --cached
git commit -m '[UPDATE] Configure the Raven public UI origin' \
  -m '- RAVEN_UI_PUBLIC_ORIGIN 값을 UI authority 정책으로 전달
- 비유니코드와 잘못된 설정은 값 노출 없이 시작 전에 거부'
```

---

### Task 3: Operations documentation and complete verification

**Files:**
- Modify: `README.md:219-223`
- Modify: `docs/operations/setup.md:100-112`
- Modify: `docs/operations/cli-reference.md:20-27`
- Modify: `docs/operations/api-reference.md:15-25`

**Interfaces:**
- Consumes: Tasks 1-2 behavior and environment name.
- Produces: operator guidance that requires HTTPS and an upstream authentication boundary for public UI use.

- [ ] **Step 1: Update operator documentation**

Document this exact example:

```bash
RAVEN_UI_PUBLIC_ORIGIN=https://raven.b-sir.xyz raven ui --port 3001 --no-open
```

State that Raven still binds to loopback, accepts only the exact configured Host/Origin pair,
uses a Secure cookie for that pair, and does not provide public identity authentication. Require
an authenticated reverse tunnel such as Cloudflare Access before exposing the hostname. Keep
`RAVEN_UI_PATH` documentation intact.

- [ ] **Step 2: Run the full repository quality gate**

Run:

```bash
npm test --prefix npm/raven
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --workspace
npm test --prefix frontend
npm run typecheck --prefix frontend
npm run build --prefix frontend
git diff --check
```

Expected: all pass; no formatter, compiler, lint, unit, frontend, or whitespace failures.

- [ ] **Step 3: Commit documentation**

```bash
git add README.md docs/operations/setup.md docs/operations/cli-reference.md docs/operations/api-reference.md
git diff --cached
git commit -m '[DOCS] Document trusted Raven UI origins' \
  -m '- 외부 UI origin의 HTTPS 제한과 정확한 Host 검증을 설명
- 공개 시 Cloudflare Access 같은 상위 인증 경계를 필수로 명시'
```

---

### Task 4: Release and local deployment

**Files:**
- Modify outside repository: `~/Library/LaunchAgents/com.raven.ui.plist`
- Modify outside repository: `~/.cloudflared/config.yml`
- Modify in Cloudflare: existing Access application hostname and exact `oracle.b-sir.xyz` DNS record

**Interfaces:**
- Consumes: committed Tasks 1-3 on clean synchronized `main`.
- Produces: GitHub Release `v0.4.9`, local Raven 0.4.9, and Access-protected `https://raven.b-sir.xyz` on the existing `paperclip` tunnel.

- [ ] **Step 1: Perform release preflight**

Use the repository `release-oracle-todo` skill. Verify clean state, GitHub authentication, synchronized `main`, and absence of a local or remote `v0.4.9` tag:

```bash
git status --short --branch
git fetch origin --prune --tags
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"
git tag --list v0.4.9
git ls-remote --tags origin refs/tags/v0.4.9
gh auth status
```

Expected: clean synchronized `main`; both tag lookups are empty; GitHub CLI is authenticated.

- [ ] **Step 2: Publish only the engine/UI release**

The npm wrapper is unchanged and already discovers the latest compatible GitHub Release, so do not create an npm tag or republish npm.

```bash
git tag v0.4.9
git push origin v0.4.9
release_run_id="$(gh run list --workflow release.yml --branch v0.4.9 --limit 1 --json databaseId --jq '.[0].databaseId')"
test -n "$release_run_id"
gh run watch "$release_run_id" --exit-status
gh release view v0.4.9 --json tagName,url,publishedAt,assets
```

Require `SHA256SUMS`, the UI archive, and all four engine platform archives.

- [ ] **Step 3: Update and configure the local Raven service**

```bash
raven update
raven version
raven doctor
```

Expected: wrapper remains `0.1.13`; engine and UI report `0.4.9`.

Add this environment entry to `com.raven.ui.plist` with `apply_patch`:

```xml
<key>RAVEN_UI_PUBLIC_ORIGIN</key>
<string>https://raven.b-sir.xyz</string>
```

In `~/.cloudflared/config.yml`, keep the existing `paperclip.b-sir.xyz` entry unchanged and make the Raven ingress exactly:

```yaml
- hostname: raven.b-sir.xyz
  service: http://127.0.0.1:3001
```

Remove only the Raven ingress `originRequest.httpHostHeader`; do not change other tunnel services.

- [ ] **Step 4: Move Access and DNS, then restart exact services**

In the existing Cloudflare Access application, replace only the application hostname
`oracle.b-sir.xyz` with `raven.b-sir.xyz`; preserve its current email allow policy. Confirm the
existing `raven.b-sir.xyz` CNAME targets the `paperclip` tunnel, then delete only the exact old
`oracle.b-sir.xyz` DNS record.

Validate and restart by exact launchd labels:

```bash
cloudflared tunnel ingress validate
launchctl kickstart -k "gui/$(id -u)/com.raven.ui"
launchctl kickstart -k "gui/$(id -u)/com.cloudflare.cloudflared"
```

- [ ] **Step 5: Verify local data and public authentication**

Use `verification-before-completion` and fresh evidence:

```bash
raven version
raven doctor
raven health-check
curl --silent --output /dev/null --write-out '%{http_code}\n' http://127.0.0.1:3001/healthz
curl --silent --output /dev/null --write-out '%{http_code}\n' https://raven.b-sir.xyz/
```

Expected: local health is `200`; unauthenticated public access redirects to Cloudflare Access,
email authentication succeeds, Raven bootstrap redirects to `/`, and the Dashboard plus ToDo,
Ledger, and Health API reads succeed. Confirm the live ToDo database still contains 577 items
and 1133 audit events, the old Oracle process is absent, and `oracle.b-sir.xyz` no longer routes.

- [ ] **Step 6: Final release evidence**

Confirm `HEAD`, `origin/main`, and `v0.4.9` resolve to the same commit, the release workflow is
successful, required assets exist, the worktree is clean, and both rollback artifacts remain:
the unloaded old Oracle LaunchAgent plist and the pre-import empty Raven database backup.
