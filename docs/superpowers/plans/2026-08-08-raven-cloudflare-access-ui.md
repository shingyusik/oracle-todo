# Raven Cloudflare Access UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an Access-authenticated browser open `https://raven.b-sir.xyz` directly while preserving Raven's loopback development flow and API session authentication.

**Architecture:** Extend the UI policy with one optional HTTPS authority and require a Cloudflare Access assertion on that authority. `cloudflared` validates JWT signature and audience; Raven validates exact Host/Origin pairing and adds its existing random session cookie only to successful public HTML responses.

**Tech Stack:** Rust 2024, Axum 0.7, Cargo tests, Cloudflare Tunnel Access validation, macOS launchd

## Global Constraints

- `raven ui` remains bound to `127.0.0.1` only.
- Local mode keeps the existing `/__raven/session` bootstrap.
- Public mode accepts exactly one absolute HTTPS origin from `RAVEN_UI_PUBLIC_ORIGIN`.
- Every public-host request requires exactly one non-empty `Cf-Access-Jwt-Assertion`.
- `cloudflared`, not Raven, validates JWT signature and audience.
- Public cookies use `Secure; HttpOnly; SameSite=Strict; Path=/` without `Domain`.
- Raven API session authentication remains enabled.
- Add no dependencies, public listeners, database changes, or generic proxy abstraction.
- Never run mutation smoke tests against the live Raven home.

---

### Task 1: Public request policy and automatic session

**Files:**
- Modify: `raven-api/src/server.rs:52-91,677-782`
- Modify: `raven-api/src/lib.rs:23`
- Test: `raven-api/tests/ui_session.rs:1-390`
- Test callers: every workspace test that invokes `ui_router`

**Interfaces:**
- Consumes: loopback `SocketAddr`, `UiSessionToken`, `public_origin: Option<&str>`.
- Produces: `ui_router(config, artifact, session, authority, public_origin: Option<&str>) -> anyhow::Result<Router>`.

- [ ] **Step 1: Write failing public-mode tests**

Extend the fixture:

```rust
const PUBLIC_AUTHORITY: &str = "raven.b-sir.xyz";
const PUBLIC_ORIGIN: &str = "https://raven.b-sir.xyz";
const ACCESS_ASSERTION: &str = "validated-by-cloudflared";

fn fixture_with_public_origin(public_origin: Option<&str>) -> (tempfile::TempDir, axum::Router) {
    let temp = tempfile::tempdir().unwrap();
    let ui = temp.path().canonicalize().unwrap().join("ui");
    fs::create_dir(&ui).unwrap();
    fs::write(ui.join("index.html"), "<main>Raven</main>").unwrap();
    fs::write(ui.join("app.js"), "export const raven = true;").unwrap();
    fs::write(ui.join("mark.png"), b"\x89PNG\r\n\x1a\n").unwrap();
    let artifact = UiArtifact::load(&ui).unwrap();
    let token = UiSessionToken::generate().unwrap();
    let app = ui_router(
        config(&token, temp.path()),
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

fn public_get(path: &str) -> Request<Body> {
    Request::get(path)
        .header(header::HOST, PUBLIC_AUTHORITY)
        .header("cf-access-jwt-assertion", ACCESS_ASSERTION)
        .body(Body::empty())
        .unwrap()
}
```

Add `public_html_issues_a_secure_session_and_static_assets_do_not`. For `/` and `/todo`, assert
`200` and a cookie containing `HttpOnly`, `SameSite=Strict`, `Secure`, and `Path=/`, without
`Domain`. For `/app.js`, assert `200` and no `Set-Cookie`.

Add `public_requests_require_one_access_assertion_and_matching_origin`. Assert `421` and no
cookie for missing, empty, or duplicate assertion; local Origin with public Host; public Origin
with local Host; and an attacker Origin. Assert `200` for the public Host, public Origin, and one
assertion.

Add `public_html_replaces_a_stale_session_used_by_the_api`. Send `raven_session=stale` to `/`,
extract the returned cookie, and send it with public Host and assertion to `/api/v1/dashboard`.
Expect `200`; a public API request carrying the assertion and only the stale cookie must return
`401`.

Add startup rejection cases:

```rust
[
    "",
    "http://raven.b-sir.xyz",
    "https://user@raven.b-sir.xyz",
    "https://raven.b-sir.xyz/path",
    "https://raven.b-sir.xyz?query=1",
    "https://raven.b-sir.xyz#fragment",
]
```

Update all existing `ui_router` calls with a final `None`.

- [ ] **Step 2: Verify RED**

Run:

```bash
cargo test -p raven-api --test ui_session
```

Expected: compilation fails because `ui_router` lacks `public_origin`.

- [ ] **Step 3: Implement the minimal policy**

In `raven-api/src/server.rs`, use existing HTTP types:

```rust
const ACCESS_ASSERTION: HeaderName = HeaderName::from_static("cf-access-jwt-assertion");

#[derive(Clone)]
struct AuthorityPair {
    host: HeaderValue,
    origin: HeaderValue,
    public: bool,
}

#[derive(Clone)]
struct ExpectedAuthority {
    local: AuthorityPair,
    public: Option<AuthorityPair>,
}
```

Change `ExpectedAuthority::new` to return `anyhow::Result<Self>`. Parse the optional value as
`axum::http::Uri`; require `https`, authority without `@`, path `/`, and no query. Normalize to
Host `{authority}` and Origin `https://{authority}`. Every failure returns only
`invalid RAVEN_UI_PUBLIC_ORIGIN`.

Update authority middleware to resolve one exact Host pair, compare an optional single Origin,
and require one non-empty exact assertion for the public pair. After `next.run`, add the public
cookie only when the request was public `GET`, the response succeeded, and content type is
`text/html; charset=utf-8`.

Create local/public cookie headers with:

```rust
fn session_cookie(session: &UiSessionToken, secure: bool) -> anyhow::Result<HeaderValue> {
    let secure = if secure { "; Secure" } else { "" };
    Ok(HeaderValue::from_str(&format!(
        "raven_session={}; HttpOnly; SameSite=Strict{secure}; Path=/",
        session.cookie_value()
    ))?)
}
```

Keep `/__raven/session`; select its secure cookie for the public Host. Do not log assertions or
cookies. Add no new public API besides the changed `ui_router` signature.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
cargo fmt --check
cargo test -p raven-api --test ui_session
cargo test -p raven-api
cargo clippy -p raven-api --all-targets --all-features -- -D warnings
```

Expected: all commands exit `0` with local and public tests passing.

- [ ] **Step 5: Commit the API policy**

```bash
git add raven-api/src/server.rs raven-api/src/lib.rs raven-api/tests/ui_session.rs \
  raven-cli/src/commands/ui.rs
git diff --cached
git commit -m '[UPDATE] Authenticate Cloudflare Access UI requests' \
  -m '- 정확한 외부 HTTPS authority와 Access assertion이 있는 요청만 허용
- 공개 HTML 응답에서 Secure Raven 세션을 자동 갱신
- 기존 loopback bootstrap과 API 세션 검증 동작을 유지'
```

---

### Task 2: CLI public-origin configuration

**Files:**
- Modify: `raven-cli/src/commands/ui.rs:12-38`
- Test: `raven-cli/tests/ui_cli.rs:1-38`

**Interfaces:**
- Consumes: `RAVEN_UI_PUBLIC_ORIGIN` and Task 1's five-argument `ui_router`.
- Produces: safe environment validation and `public_origin.as_deref()` forwarding.

- [ ] **Step 1: Write failing CLI tests**

Add a valid one-file UI fixture. Spawn the command with piped stderr, poll `try_wait()` for up to
one second, and kill only that child if it is still serving; that timeout is the expected RED
state before the environment value is forwarded. Once the child exits, assert the safe error:

```rust
#[test]
fn ui_rejects_an_invalid_public_origin_without_echoing_it() {
    let home = tempfile::tempdir().unwrap();
    let ui = home.path().join("ui");
    std::fs::create_dir(&ui).unwrap();
    std::fs::write(ui.join("index.html"), "Raven").unwrap();
    let invalid = "http://raven.b-sir.xyz/private";
    let mut command = raven(home.path());
    command
        .env("RAVEN_UI_PUBLIC_ORIGIN", invalid)
        .args(["ui", "--ui-path", ui.to_str().unwrap(), "--no-open"])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    let mut child = command.spawn().unwrap();
    let exited = (0..100).any(|_| {
        if child.try_wait().unwrap().is_some() {
            true
        } else {
            std::thread::sleep(std::time::Duration::from_millis(10));
            false
        }
    });
    if !exited {
        child.kill().unwrap();
        child.wait().unwrap();
        panic!("ui ignored invalid RAVEN_UI_PUBLIC_ORIGIN");
    }
    let output = child.wait_with_output().unwrap();
    assert!(!output.status.success());
    let stderr = String::from_utf8(output.stderr).unwrap();
    assert!(stderr.contains("invalid RAVEN_UI_PUBLIC_ORIGIN"));
    assert!(!stderr.contains(invalid));
}
```

On Unix, add a non-Unicode value using `OsStringExt::from_vec(vec![0xff])`; expect the same safe
message and non-zero status.

- [ ] **Step 2: Verify RED**

Run `cargo test -p raven-cli --test ui_cli`.

Expected: the invalid value is ignored or the safe error assertion fails.

- [ ] **Step 3: Implement environment forwarding**

Add:

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

Resolve it before creating the runtime and call:

```rust
let app = raven_api::ui_router(
    config,
    artifact,
    session,
    actual,
    public_origin.as_deref(),
)?;
```

- [ ] **Step 4: Verify GREEN**

Run:

```bash
cargo fmt --check
cargo test -p raven-cli --test ui_cli
cargo test -p raven-cli
cargo clippy -p raven-cli --all-targets --all-features -- -D warnings
```

Expected: all commands exit `0` without warnings.

- [ ] **Step 5: Commit CLI integration**

```bash
git add raven-cli/src/commands/ui.rs raven-cli/tests/ui_cli.rs
git diff --cached
git commit -m '[UPDATE] Configure Cloudflare Access UI origin' \
  -m '- RAVEN_UI_PUBLIC_ORIGIN을 외부 UI 요청 정책으로 전달
- 잘못된 값과 비유니코드 환경 설정을 원문 노출 없이 거부'
```

---

### Task 3: Operations documentation and full verification

**Files:**
- Modify: `README.md:218-230`
- Modify: `docs/operations/setup.md:96-115`
- Modify: `docs/operations/cli-reference.md:17-27`
- Modify: `docs/operations/api-reference.md:15-26`
- Modify: `docs/operations/verification-and-smoke.md:104-125`

**Interfaces:**
- Consumes: Tasks 1-2 public-mode contract.
- Produces: authoritative local and Cloudflare deployment guidance.

- [ ] **Step 1: Update authoritative docs**

Use `docs-change-updater`. Document:

```bash
RAVEN_UI_PUBLIC_ORIGIN=https://raven.b-sir.xyz \
  raven ui --port 3001 --no-open
```

State that local behavior is unchanged, public mode stays loopback-bound, public Host/Origin and
assertion are mandatory, public HTML issues a secure Raven cookie, API routes still require that
cookie, and secrets/assertions/cookies must not be logged.

Add this exact tunnel example:

```yaml
- hostname: raven.b-sir.xyz
  service: http://127.0.0.1:3001
  originRequest:
    access:
      required: true
      teamName: divine-hill-da47
      audTag:
        - 5650a5c6613fcfd8d13652e94c82339a8cc68e311c93d241dcb6fc394c046de9
```

Do not document `httpHostHeader` or an Origin rewrite.

- [ ] **Step 2: Run the complete quality gate**

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

Expected: every command exits `0`; all test summaries report zero failures.

- [ ] **Step 3: Commit docs**

```bash
git add README.md docs/operations/setup.md docs/operations/cli-reference.md \
  docs/operations/api-reference.md docs/operations/verification-and-smoke.md
git diff --cached
git commit -m '[DOCS] Document Cloudflare Access UI mode' \
  -m '- 로컬 bootstrap과 외부 자동 세션 흐름을 구분해 설명
- cloudflared JWT 검증과 정확한 HTTPS 요청 조건을 명시
- 공개 쿠키 및 안전한 검증 절차를 운영 문서에 추가'
```

---

### Task 4: Release and live deployment

**Files:**
- Modify outside repository: `~/Library/LaunchAgents/com.raven.ui.plist`
- Modify outside repository: `~/.cloudflared/config.yml`
- Modify in Cloudflare: existing Raven Origin Rule

**Interfaces:**
- Consumes: synchronized Tasks 1-3, existing `paperclip` tunnel and Raven Access app.
- Produces: GitHub Release `v0.4.9`, installed engine/UI `0.4.9`, direct Access-authenticated UI.

- [ ] **Step 1: Run release preflight**

Use `release-oracle-todo`, then run:

```bash
git fetch origin --prune --tags
git status --short --branch
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"
test -z "$(git tag --list v0.4.9)"
test -z "$(git ls-remote --tags origin refs/tags/v0.4.9)"
gh auth status
```

Expected: clean synchronized `main`, unused tag, authenticated GitHub CLI.

- [ ] **Step 2: Publish engine/UI only**

```bash
git tag v0.4.9
git push origin v0.4.9
gh run list --workflow release.yml --branch v0.4.9 --limit 1
```

Watch that run with `gh run watch` and `--exit-status`. Then require `SHA256SUMS`,
`raven-ui-0.4.9.tar.gz`, and all four engine archives in:

```bash
gh release view v0.4.9 --json tagName,url,publishedAt,assets
```

- [ ] **Step 3: Update local bundle and LaunchAgent**

Run `raven update`, `raven version`, and `raven doctor`. Expect wrapper `0.1.13`, engine/UI
`0.4.9`. Use `apply_patch` to add:

```xml
<key>RAVEN_UI_PUBLIC_ORIGIN</key>
<string>https://raven.b-sir.xyz</string>
```

to the existing LaunchAgent environment dictionary.

- [ ] **Step 4: Enforce Access validation in the tunnel**

Use `apply_patch` so the Raven ingress is exactly:

```yaml
- hostname: raven.b-sir.xyz
  service: http://127.0.0.1:3001
  originRequest:
    access:
      required: true
      teamName: divine-hill-da47
      audTag:
        - 5650a5c6613fcfd8d13652e94c82339a8cc68e311c93d241dcb6fc394c046de9
```

Leave every other ingress unchanged. Remove the existing Cloudflare Origin Rule that rewrites
Raven Host/Origin to loopback.

- [ ] **Step 5: Validate and restart exact services**

Run:

```bash
cloudflared tunnel ingress validate
launchctl kickstart -k "gui/$(id -u)/com.raven.ui"
```

Restart `paperclip` through its actual launchd label. If none exists, resolve only the exact
`/opt/homebrew/bin/cloudflared tunnel run paperclip` PID and let its existing supervisor restart
it. Never use a broad process match.

- [ ] **Step 6: Verify read-only live behavior**

Use `verification-before-completion` and run:

```bash
raven version
raven doctor
raven health-check
curl --silent --output /dev/null --write-out '%{http_code}\n' http://127.0.0.1:3001/healthz
curl --silent --output /dev/null --write-out '%{http_code}\n' https://raven.b-sir.xyz/
sqlite3 "$HOME/.raven/todo.sqlite" \
  "select integrity_check from pragma_integrity_check; select count(*) from items; select count(*) from events;"
```

Expect engine/UI `0.4.9`, local `200`, anonymous public Access redirect, integrity `ok`, 577
items, and 1133 events. In an authenticated external browser, open only the root URL and verify
Dashboard, ToDo, Ledger, and Health reads without visiting `/__raven/session` or mutating data.

- [ ] **Step 7: Record final evidence**

Confirm the release workflow is `success`, required assets exist, `HEAD`, `origin/main`, and
`v0.4.9` match, and the worktree is clean. Report release/workflow URLs, installed versions,
quality-gate results, Access challenge, direct UI success, and unchanged database counts.
