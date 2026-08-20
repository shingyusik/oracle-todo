# UI Session URL Output Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `raven ui` print both its listening address and a clickable session-bootstrap URL.

**Architecture:** Construct the base and session URLs once in a small pure helper inside the existing UI command module. Reuse those values for terminal output and browser launch; keep server, authentication, and CLI argument behavior unchanged.

**Tech Stack:** Rust 2024, Clap, Tokio, Cargo test

---

### Task 1: Print the UI session bootstrap URL

**Files:**
- Modify: `raven-cli/src/commands/ui.rs`

- [ ] **Step 1: Write the failing URL-construction test**

Add this test to the existing `tests` module in `raven-cli/src/commands/ui.rs`:

```rust
#[test]
fn ui_urls_include_session_bootstrap() {
    let actual = SocketAddr::from((Ipv4Addr::LOCALHOST, 4321));

    let (url, session_url) = ui_urls(actual);

    assert_eq!(url, "http://127.0.0.1:4321");
    assert_eq!(
        session_url,
        "http://127.0.0.1:4321/__raven/session"
    );
}
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```powershell
cargo test -p raven-cli ui_urls_include_session_bootstrap
```

Expected: compilation fails because `ui_urls` does not exist.

- [ ] **Step 3: Construct and print both URLs**

Add this helper beside `resolve_ui_path` in `raven-cli/src/commands/ui.rs`:

```rust
fn ui_urls(actual: SocketAddr) -> (String, String) {
    let url = format!("http://{actual}");
    let session_url = format!("{url}/__raven/session");
    (url, session_url)
}
```

Replace the URL block inside `run` with:

```rust
let (url, session_url) = ui_urls(actual);
println!("Raven UI listening on {url}");
println!("Open Raven UI: {session_url}");
if !args.no_open {
    if let Err(error) = open_browser(&session_url) {
        tracing::warn!(event = "browser_open_failed", %error, "browser could not be opened");
    }
}
```

Do not change listener binding, session generation, authentication, `--no-open`, or public
origin behavior.

- [ ] **Step 4: Run the focused test**

Run:

```powershell
cargo test -p raven-cli ui_urls_include_session_bootstrap
```

Expected: PASS.

- [ ] **Step 5: Run the relevant CLI verification**

Run:

```powershell
cargo test -p raven-cli --test ui_cli
cargo fmt --check
```

Expected: all UI CLI tests pass and formatting is clean.

- [ ] **Step 6: Commit the implementation**

Stage only the UI command source; leave the pre-existing
`frontend/package-lock.json` change untouched.

```powershell
git add -- raven-cli/src/commands/ui.rs
git commit -m @'
[FIX] Print the UI session bootstrap URL

- UI 수신 주소와 클릭 가능한 세션 진입 주소를 함께 출력
- 자동 브라우저 열기와 터미널 안내가 동일한 인증 경로를 사용
'@
```
