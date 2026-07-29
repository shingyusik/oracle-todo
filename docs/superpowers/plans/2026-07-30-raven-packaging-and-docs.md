# Raven Packaging and Documentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Oracle Todo distribution with `@shings/raven`, serve the bundled UI/API safely, remove transitional binaries, and synchronize final user/operator documentation.

**Architecture:** The npm wrapper remains a thin installer/launcher for one native `raven` binary plus one static UI artifact. `raven ui` owns local API/session startup; release assets and docs use Raven names exclusively.

**Tech Stack:** Node.js 18+, npm, Rust release builds, Next.js static output, GitHub Releases, shell/PowerShell smoke tests

## Global Constraints

- Requires all prior Raven plans.
- Runtime names are only `raven` and `@shings/raven`; no `oracle-todo` executable alias.
- Default local bind is `127.0.0.1:3002`.
- `raven ui` uses a per-launch HTTP-only SameSite-strict session cookie.
- Release assets cover supported macOS, Linux, and Windows targets.
- Stable docs describe final behavior only; no migration diary or future-work sections.
- Release verification never targets live Raven or legacy ToDo data homes.

---

### Task 1: Raven UI serving and ephemeral browser session

**Files:**
- Modify: `raven-cli/Cargo.toml`
- Create: `raven-cli/src/commands/ui.rs`
- Modify: `raven-cli/src/commands/mod.rs`
- Modify: `raven-cli/src/cli.rs`
- Modify: `raven-api/src/auth.rs`
- Modify: `raven-api/src/server.rs`
- Test: `raven-cli/tests/ui_cli.rs`
- Test: `raven-api/tests/ui_session.rs`

**Interfaces:**
- Produces: `raven ui`, static artifact serving, and `AuthMode::UiSession`.
- Consumes: path to bundled UI artifact and composed Raven router.

- [ ] **Step 1: Write failing session tests**

```rust
#[tokio::test]
async fn ui_bootstrap_sets_http_only_same_site_cookie() {
    let response = ui_router().oneshot(get("/__raven/session")).await.unwrap();
    let cookie = response.headers()[SET_COOKIE].to_str().unwrap();
    assert!(cookie.contains("HttpOnly"));
    assert!(cookie.contains("SameSite=Strict"));
}

#[test]
fn raven_ui_rejects_missing_artifact() {
    raven(temp_home()).args(["ui", "--ui-path", "missing"])
        .assert().failure().stderr(predicate::str::contains("UI artifact"));
}
```

- [ ] **Step 2: Run UI/session tests**

Run: `cargo test -p raven-api --test ui_session && cargo test -p raven-cli --test ui_cli`

Expected: FAIL because session/static serving is absent.

- [ ] **Step 3: Implement one-origin local serving**

Generate a 32-byte random token per launch, store only its verifier in server
state, issue the cookie on bootstrap, and require it for `/api/v1/*`. Serve
static files with path traversal protection and SPA fallback. Bind loopback by
default and print one safe local URL without the token. Open the browser unless
`--no-open` is supplied.

```rust
pub struct UiArgs {
    pub ui_path: Option<PathBuf>,
    pub port: u16,
    pub no_open: bool,
}

pub async fn run_ui(paths: RavenPaths, args: UiArgs) -> anyhow::Result<()>;
```

- [ ] **Step 4: Run API/UI command tests**

Run: `cargo test -p raven-api --test ui_session && cargo test -p raven-cli --test ui_cli`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add raven-api raven-cli Cargo.lock
git commit -m "[ADD] Serve Raven UI securely" -m "- 단일 origin 정적 UI와 API 실행 경로 추가
- 실행별 HTTP-only SameSite 세션 쿠키 적용"
```

### Task 2: Rename npm wrapper and artifact contracts

**Files:**
- Move: `npm/oracle-todo/` to `npm/raven/`
- Modify: `npm/raven/package.json`
- Modify: `npm/raven/bin/raven.js`
- Modify: `npm/raven/src/config.js`
- Modify: `npm/raven/src/cli.js`
- Modify: `npm/raven/src/install.js`
- Modify: `npm/raven/src/runner.js`
- Modify: `npm/raven/src/ui-command.js`
- Modify: `npm/raven/src/ui-artifact.js`
- Modify: `npm/raven/src/version.js`
- Modify: `npm/raven/test/*.test.js`

**Interfaces:**
- Produces: `npx @shings/raven ...`, cache metadata for Raven binary/UI, and release asset lookup.
- Consumes: native `raven` release assets and UI archive.

- [ ] **Step 1: Change tests first**

```js
test("package exposes only the raven command", () => {
  const pkg = require("../package.json");
  assert.deepEqual(pkg.bin, { raven: "bin/raven.js" });
  assert.equal(pkg.name, "@shings/raven");
});

test("runner forwards domain args unchanged", async () => {
  const result = await main(["ledger", "entry", "list"], { runEngine });
  assert.deepEqual(runEngine.mock.calls[0][0], ["ledger", "entry", "list"]);
  assert.equal(result, 0);
});
```

- [ ] **Step 2: Run npm tests**

Run: `npm --prefix npm/raven test`

Expected: FAIL because the directory/package has not been renamed.

- [ ] **Step 3: Move and rename wrapper contracts**

Set package name `@shings/raven`, bin `raven`, repository directory
`npm/raven`, cache namespace `raven`, binary metadata `raven`, and UI metadata
`raven-ui`. Preserve install/update/version/doctor behavior while deleting
Oracle-specific messages and API proxy assumptions now owned by `raven ui`.

```json
{
  "name": "@shings/raven",
  "bin": { "raven": "bin/raven.js" },
  "engines": { "node": ">=18" }
}
```

- [ ] **Step 4: Run wrapper tests**

Run: `npm --prefix npm/raven test`

Expected: PASS with no `oracle-todo` or `todo-engine` runtime strings.

- [ ] **Step 5: Commit**

```bash
git add npm
git commit -m "[UPDATE] Rename npm distribution to Raven" -m "- @shings/raven 패키지와 raven 실행 진입점으로 전환
- 캐시·artifact·진단 메시지의 Oracle 이름 제거"
```

### Task 3: Release assets and transitional binary removal

**Files:**
- Modify: `todo-engine/Cargo.toml`
- Delete: `todo-engine/src/main.rs`
- Modify: `raven-cli/Cargo.toml`
- Modify: `.github/workflows/release.yml` if present, otherwise create it
- Modify: `.github/workflows/npm-publish.yml`
- Modify: release archive scripts referenced by the workflow
- Test: `npm/raven/test/platform.test.js`
- Test: `npm/raven/test/install.test.js`

**Interfaces:**
- Produces: one native binary per target and one Raven UI archive.
- Consumes: tested workspace and frontend production build.

- [ ] **Step 1: Add failing artifact-name tests**

```js
test("selects Raven binary archive for supported platform", () => {
  assert.equal(binaryAsset({ platform: "darwin", arch: "arm64" }),
               "raven-aarch64-apple-darwin.tar.gz");
  assert.equal(binaryAsset({ platform: "win32", arch: "x64" }),
               "raven-x86_64-pc-windows-msvc.zip");
});
```

- [ ] **Step 2: Run artifact tests**

Run: `npm --prefix npm/raven test -- platform.test.js install.test.js`

Expected: FAIL while old names remain.

- [ ] **Step 3: Update release build matrix**

Build `raven-cli` for supported macOS/Linux/Windows targets, archive the binary
as `raven`/`raven.exe`, build the frontend, archive it as
`raven-ui-<version>.tar.gz`, and publish checksums. Remove the
`todo-engine` binary target only after all Raven CLI regression tests pass;
keep `todo-engine` as a library crate. Update the npm publication job name,
working directory, and package assertion to `@shings/raven` and `npm/raven`.

```yaml
- name: Build Raven
  run: cargo build -p raven-cli --release --target ${{ matrix.target }}
- name: Build Raven UI
  working-directory: frontend
  run: npm ci && npm test && npm run typecheck && npm run build
```

- [ ] **Step 4: Run packaging verification locally**

Run: `cargo build --release -p raven-cli && npm --prefix frontend run build && npm --prefix npm/raven test`

Expected: PASS and `target/release/raven` exists.

- [ ] **Step 5: Commit**

```bash
git add .github todo-engine raven-cli npm/raven
git commit -m "[UPDATE] Build Raven release artifacts" -m "- 단일 Raven 바이너리와 UI archive release 계약 적용
- 전환용 todo-engine 실행 파일 제거 후 라이브러리 경계 유지"
```

### Task 4: Final documentation and agent-context sync

**Files:**
- Modify: `README.md`
- Modify: `frontend/README.md`
- Modify: `docs/architecture/overview.md`
- Modify: `docs/architecture/layers.md`
- Modify: `docs/architecture/data-model.md`
- Modify: `docs/operations/setup.md`
- Modify: `docs/operations/data-home.md`
- Modify: `docs/operations/cli-reference.md`
- Modify: `docs/operations/api-reference.md`
- Modify: `docs/operations/verification-and-smoke.md`
- Modify: `docs/conventions/error-handling.md`
- Modify: `docs/conventions/logging.md`
- Modify: `CLAUDE.md`
- Modify: `AGENTS.md`

**Interfaces:**
- Produces: final-state Raven documentation matching shipped commands and schemas.
- Consumes: verified implementation, not planning assumptions.

- [ ] **Step 1: Run documentation target and stale-name scans**

Run: `python3 .codex/skills/docs-change-updater/scripts/find_doc_targets.py --format markdown`

Expected: reports README, operations, architecture, and agent-context files.

Run: `rg -n "oracle-todo|TODO_ENGINE_|~/.todo-engine|cargo run -p todo-engine" README.md frontend/README.md docs CLAUDE.md AGENTS.md`

Expected: matches identify text that must become Raven final state, except the
explicit legacy source path documented for `raven import todo`.

- [ ] **Step 2: Update docs from actual command help and schema**

Capture authoritative output:

```bash
cargo run -p raven-cli -- --help
cargo run -p raven-cli -- ledger --help
cargo run -p raven-cli -- health --help
```

Document the three-database layout, media, env variables, API routes, exit
codes, archive/restore/purge differences, ToDo import safety, Dashboard
partial failures, and verification commands. Keep README's locked section
structure and keep `CLAUDE.md` byte-identical to `AGENTS.md`.

```text
~/.raven/
├── todo.sqlite
├── ledger.sqlite
├── health.sqlite
├── media/health/
└── logs/raven.log.jsonl(.1-.3)
```

- [ ] **Step 3: Verify documentation coherence**

Run: `diff -u CLAUDE.md AGENTS.md && rg -n "TBD|FIXME|implement later" README.md frontend/README.md docs/architecture docs/operations CLAUDE.md AGENTS.md`

Expected: agent files are identical and no placeholder matches appear.

- [ ] **Step 4: Run docs plus full product gate**

Run: `cargo fmt --check && cargo test --workspace && cargo clippy --all-targets --all-features -- -D warnings && npm --prefix frontend test && npm --prefix frontend run typecheck && npm --prefix frontend run build && npm --prefix npm/raven test`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add README.md frontend/README.md docs CLAUDE.md AGENTS.md
git commit -m "[DOCS] Document Raven final state" -m "- 통합 CLI·API·데이터 홈·엔진 모델을 현재 상태로 문서화
- 운영·검증·오류·로그 안내와 에이전트 컨텍스트 동기화"
```

### Task 5: Throwaway-home end-to-end smoke

**Files:**
- Create: `scripts/smoke-raven.sh`
- Create: `scripts/smoke-raven.ps1`
- Create: `scripts/test-smoke-raven.sh`
- Modify: `docs/operations/verification-and-smoke.md`

**Interfaces:**
- Produces: repeatable ToDo/Ledger/Health/API/UI smoke evidence without live data.
- Consumes: release-mode Raven binary and frontend artifact.

- [ ] **Step 1: Write the failing smoke sequence**

```bash
RAVEN_SMOKE_HOME="$(mktemp -d)"
trap 'rm -rf "$RAVEN_SMOKE_HOME"' EXIT
target/release/raven --home "$RAVEN_SMOKE_HOME" init
target/release/raven --home "$RAVEN_SMOKE_HOME" todo area create "Health"
target/release/raven --home "$RAVEN_SMOKE_HOME" ledger doctor
target/release/raven --home "$RAVEN_SMOKE_HOME" health trends --days 30
target/release/raven --home "$RAVEN_SMOKE_HOME" health-check
```

Seed only minimal master data required for a Ledger expense, then add/list one
expense and one diet/health record. Start the API on an ephemeral port, probe
`/healthz` and authenticated Dashboard, then stop it reliably.

- [ ] **Step 2: Run the smoke test before scripts exist**

Run: `bash scripts/test-smoke-raven.sh`

Expected: FAIL because the script is absent.

- [ ] **Step 3: Implement POSIX and PowerShell smoke scripts**

Use only an explicitly created temporary home. Validate all three SQLite files,
media/log directories, JSON output, API authentication, Dashboard domain
statuses, and clean process termination. Search the generated JSONL log and
assert that seeded transaction content, amount, food name, and health value do
not appear. Never resolve the default home.

```bash
test -f "$RAVEN_SMOKE_HOME/todo.sqlite"
test -f "$RAVEN_SMOKE_HOME/ledger.sqlite"
test -f "$RAVEN_SMOKE_HOME/health.sqlite"
! rg -F "Lunch" "$RAVEN_SMOKE_HOME/logs"
! rg -F "Bibimbap" "$RAVEN_SMOKE_HOME/logs"
```

- [ ] **Step 4: Run final release-readiness gate**

Run: `cargo build --release -p raven-cli && bash scripts/test-smoke-raven.sh && npm --prefix npm/raven test`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts docs/operations/verification-and-smoke.md
git commit -m "[ADD] Verify Raven end to end" -m "- 임시 홈에서 세 엔진과 인증 API 스모크 검증
- POSIX·PowerShell 운영 절차와 안전 가드 추가"
```
