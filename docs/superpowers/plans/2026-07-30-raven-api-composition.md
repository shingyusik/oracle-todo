# Raven API Composition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compose ToDo, Ledger, Health, Dashboard, preferences, authentication, and stable errors behind one versioned Raven HTTP API.

**Architecture:** A new `raven-api` library owns routing and transport concerns only. It opens a fresh engine service per blocking-safe request, nests existing ToDo routes, maps domain errors to one envelope, and aggregates independent Dashboard projections.

**Tech Stack:** Rust 2024, axum 0.7, tokio, tower, serde, uuid, subtle/constant-time token comparison, http-body-util

## Global Constraints

- Requires completed foundation, Ledger, and Health engine plans.
- Routes are `/healthz`, `/api/v1/todo/*`, `/api/v1/ledger/*`, `/api/v1/health/*`, and `/api/v1/dashboard`.
- CLI and HTTP call the same application services; handlers never issue SQL mutations.
- Standalone API requires `RAVEN_API_TOKEN` or a permissions-checked `RAVEN_API_TOKEN_FILE`.
- Non-loopback cleartext binds require `RAVEN_API_ALLOW_UNSAFE_CLEARTEXT=true`.
- Error JSON contains `code`, `message`, `fields`, and `request_id`.
- One failed Dashboard projection must not fail successful projections.

---

### Task 1: Raven API crate, paths, and common error envelope

**Files:**
- Modify: `Cargo.toml`
- Modify: `Cargo.lock`
- Create: `raven-api/Cargo.toml`
- Create: `raven-api/src/lib.rs`
- Create: `raven-api/src/config.rs`
- Create: `raven-api/src/error.rs`
- Create: `raven-api/src/state.rs`
- Create: `raven-api/tests/error_contract.rs`

**Interfaces:**
- Produces: `RavenApiConfig`, `RavenApiState`, `ApiError`, `ApiErrorBody`, and `router(config)`.
- Consumes: `RavenPaths` values passed by the binary; no global data-home lookup inside handlers.

- [ ] **Step 1: Write failing error-contract tests**

```rust
#[tokio::test]
async fn validation_error_has_stable_envelope_and_request_id() {
    let response = test_router().oneshot(invalid_ledger_request()).await.unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let body: Value = json_body(response).await;
    assert_eq!(body["code"], "validation_error");
    assert!(body["message"].is_string());
    assert!(body["fields"].is_object());
    assert!(Uuid::parse_str(body["request_id"].as_str().unwrap()).is_ok());
}
```

- [ ] **Step 2: Run the API test**

Run: `cargo test -p raven-api --test error_contract`

Expected: FAIL because `raven-api` does not exist.

- [ ] **Step 3: Implement transport state and mapping**

```rust
#[derive(Debug, Serialize)]
pub struct ApiErrorBody {
    pub code: String,
    pub message: String,
    pub fields: serde_json::Map<String, Value>,
    pub request_id: Uuid,
}

pub struct RavenApiConfig {
    pub todo_db: PathBuf,
    pub ledger_db: PathBuf,
    pub health_db: PathBuf,
    pub health_media_dir: PathBuf,
    pub auth: AuthMode,
}
```

Map validation/policy to 400, conflict/state to 409, not-found to 404, and
storage/internal to 500. Public messages must not expose SQL text, paths,
tokens, notes, amounts, or health values.

- [ ] **Step 4: Run the test and clippy**

Run: `cargo test -p raven-api --test error_contract && cargo clippy -p raven-api --all-targets -- -D warnings`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add Cargo.toml Cargo.lock raven-api
git commit -m "[ADD] Establish Raven API composition" -m "- 통합 API 상태와 안전한 오류 envelope 정의
- 엔진별 DB와 미디어 경로를 명시적으로 주입"
```

### Task 2: Versioned ToDo, Ledger, and Health routes

**Files:**
- Modify: `todo-engine/src/interfaces/api/mod.rs`
- Create: `raven-api/src/routes/mod.rs`
- Create: `raven-api/src/routes/todo.rs`
- Create: `raven-api/src/routes/ledger.rs`
- Create: `raven-api/src/routes/health.rs`
- Create: `raven-api/src/dto/mod.rs`
- Create: `raven-api/src/dto/ledger.rs`
- Create: `raven-api/src/dto/health.rs`
- Test: `raven-api/tests/routes_todo.rs`
- Test: `raven-api/tests/routes_ledger.rs`
- Test: `raven-api/tests/routes_health.rs`

**Interfaces:**
- Produces: nested domain routers and explicit request/response DTO conversion.
- Consumes: all three application services.

- [ ] **Step 1: Write one failing contract test per engine**

```rust
#[tokio::test]
async fn todo_items_are_nested_under_v1() {
    assert_eq!(get("/api/v1/todo/items").await.status(), StatusCode::OK);
}

#[tokio::test]
async fn ledger_entry_create_uses_service_policy() {
    assert_eq!(post_json("/api/v1/ledger/entries", valid_expense()).await.status(),
               StatusCode::CREATED);
}

#[tokio::test]
async fn health_daily_metrics_upsert_returns_changed_rows() {
    let response = post_json("/api/v1/health/metrics/daily", daily_metrics()).await;
    assert_eq!(response.status(), StatusCode::OK);
}
```

- [ ] **Step 2: Run route tests**

Run: `cargo test -p raven-api --test routes_todo --test routes_ledger --test routes_health`

Expected: FAIL because routes are absent.

- [ ] **Step 3: Implement nested routers and blocking-safe service calls**

```rust
pub fn router(config: RavenApiConfig) -> anyhow::Result<Router> {
    let state = RavenApiState::new(config)?;
    Ok(Router::new()
        .route("/healthz", get(healthz))
        .nest("/api/v1/todo", todo::router(state.clone())?)
        .nest("/api/v1/ledger", ledger::router())
        .nest("/api/v1/health", health::router())
        .with_state(state))
}
```

Use `tokio::task::spawn_blocking` for rusqlite work. DTOs convert into engine
commands and never accept create IDs, transfer row types, raw media paths, or
unvalidated attributes. Keep the old ToDo router behavior available to its
tests while Raven nests it at the new prefix.

- [ ] **Step 4: Run route and engine tests**

Run: `cargo test -p raven-api && cargo test -p todo-engine -p ledger-engine -p health-engine`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add raven-api todo-engine/src/interfaces/api/mod.rs
git commit -m "[ADD] Compose Raven domain APIs" -m "- ToDo·Ledger·Health 라우트를 /api/v1 아래 결합
- DTO 검증 뒤 동일 서비스 계층을 호출하도록 연결"
```

### Task 3: Failure-isolated Dashboard endpoint

**Files:**
- Create: `raven-api/src/routes/dashboard.rs`
- Create: `raven-api/src/dto/dashboard.rs`
- Modify: `raven-api/src/routes/mod.rs`
- Modify: `raven-api/src/lib.rs`
- Test: `raven-api/tests/dashboard.rs`

**Interfaces:**
- Produces: `GET /api/v1/dashboard`, `DomainProjection<T>`, and safe
  cross-domain `RecentActivityItem` values.
- Consumes: ToDo dashboard model, Ledger current-period summary, and Health recent snapshot.

- [ ] **Step 1: Write failing partial-failure tests**

```rust
#[tokio::test]
async fn dashboard_returns_successful_domains_when_health_db_is_unavailable() {
    let response = dashboard_router_with_missing_health().oneshot(
        Request::get("/api/v1/dashboard").body(Body::empty()).unwrap(),
    ).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body: DashboardResponse = json_body(response).await;
    assert!(matches!(body.todo, DomainProjection::Ok { .. }));
    assert!(matches!(body.ledger, DomainProjection::Ok { .. }));
    assert!(matches!(body.health, DomainProjection::Error { .. }));
}
```

- [ ] **Step 2: Run Dashboard tests**

Run: `cargo test -p raven-api --test dashboard`

Expected: FAIL because the projection DTO and route are absent.

- [ ] **Step 3: Implement concurrent independent projections**

```rust
#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum DomainProjection<T> {
    Ok { data: T },
    Error { code: String, message: String },
}
```

Run the three blocking projections independently with `tokio::join!`. Return
HTTP 200 when the envelope can be produced, even if one or two domains fail.
Use safe domain error messages and the same request ID for all three
projections. Merge recent ToDo events and Ledger/Health audit events by
timestamp into a bounded activity list containing only domain, action, safe
record ID, and timestamp.

- [ ] **Step 4: Run Dashboard and API tests**

Run: `cargo test -p raven-api`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add raven-api
git commit -m "[ADD] Aggregate Raven Dashboard projections" -m "- 세 엔진 요약을 독립적으로 병렬 조회
- 일부 엔진 실패를 해당 Dashboard 카드 오류로 격리"
```

### Task 4: Standalone token and bind security

**Files:**
- Create: `raven-api/src/auth.rs`
- Create: `raven-api/src/auth_permissions.rs`
- Create: `raven-api/src/server.rs`
- Modify: `raven-api/src/config.rs`
- Modify: `raven-api/src/lib.rs`
- Modify: `raven-cli/src/cli.rs`
- Create: `raven-cli/src/commands/api.rs`
- Modify: `raven-cli/src/commands/mod.rs`
- Test: `raven-api/tests/api_security.rs`
- Test: `raven-cli/tests/api_cli.rs`

**Interfaces:**
- Produces: `AuthMode::Bearer`, `AuthMode::UiSession`, `serve(config, bind)`, and `raven api`.
- Consumes: token environment/file and explicit bind configuration.

- [ ] **Step 1: Write failing authentication tests**

```rust
#[tokio::test]
async fn protected_routes_reject_missing_or_wrong_token() {
    assert_eq!(request_without_token().await.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(request_with_token("wrong").await.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(request_with_token("correct-token-value").await.status(), StatusCode::OK);
}

#[test]
fn non_loopback_cleartext_requires_explicit_override() {
    assert!(validate_bind("0.0.0.0:3002".parse().unwrap(), false).is_err());
}
```

- [ ] **Step 2: Run security tests**

Run: `cargo test -p raven-api --test api_security`

Expected: FAIL because auth middleware is absent.

- [ ] **Step 3: Implement token loading and middleware**

Read `RAVEN_API_TOKEN` or a token file whose Unix mode has no group/other
permissions. On Windows, inspect the file DACL and allow only the current user,
Administrators, and SYSTEM; reject inherited or explicit read access for other
principals. Require at least 16 bytes, compare in constant time, never log the
token, and exempt only `/healthz`. Reject non-loopback unless
`RAVEN_API_ALLOW_UNSAFE_CLEARTEXT=true`.

```rust
pub enum AuthMode {
    Bearer(SecretToken),
    UiSession(SessionVerifier),
}

pub fn load_bearer_from_env() -> Result<SecretToken, AuthConfigError>;
pub fn validate_bind(addr: SocketAddr, allow_unsafe: bool) -> Result<(), BindError>;
```

Add `raven api` using `RAVEN_API_BIND_HOST`/`PORT`, default
`127.0.0.1:3002`.

- [ ] **Step 4: Run API and CLI security tests**

Run: `cargo test -p raven-api --test api_security && cargo test -p raven-cli --test api_cli`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add raven-api raven-cli Cargo.lock
git commit -m "[ADD] Secure standalone Raven API" -m "- bearer token과 권한 제한 파일 로딩 추가
- 비 loopback cleartext 바인딩을 명시적 허용 없이는 차단"
```

### Task 5: API integration verification

**Files:**
- Modify: `todo-engine/tests/e2e/api.rs`
- Create: `raven-api/tests/cli_api_agreement.rs`
- Create: `raven-api/tests/preferences.rs`
- Modify: `backend/src/api.rs`

**Interfaces:**
- Produces: evidence that CLI/API policies and namespaced preferences agree.
- Consumes: complete composed router.

- [ ] **Step 1: Add failing agreement tests**

```rust
#[tokio::test]
async fn equivalent_invalid_ledger_input_matches_cli_error_class() {
    let cli = run_ledger_cli(invalid_expense());
    let http = post_ledger(invalid_expense()).await;
    assert_eq!(cli.exit_code, 2);
    assert_eq!(http.status(), StatusCode::BAD_REQUEST);
    assert_eq!(cli.code, json_body(http).await["code"]);
}
```

Add the same classification test for ToDo not-found and Health conflict.
Verify `planner.v1`, `ledger.table.v1`, and `health.timeline.v1` preference keys
round-trip through the namespaced Raven route.

- [ ] **Step 2: Run agreement tests**

Run: `cargo test -p raven-api --test cli_api_agreement --test preferences`

Expected: FAIL until preference nesting and exact codes agree.

- [ ] **Step 3: Align adapters without changing services**

Mount preferences under `/api/v1/preferences/:key`, allow only approved
namespace prefixes, and update ToDo API tests to call the versioned composed
router where cross-domain behavior is intended.

```rust
fn valid_preference_key(key: &str) -> bool {
    ["planner.", "workspace.", "ledger.", "health."]
        .iter()
        .any(|prefix| key.starts_with(prefix))
}
```

- [ ] **Step 4: Run full Rust verification**

Run: `cargo fmt --check && cargo test --workspace && cargo clippy --all-targets --all-features -- -D warnings`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend todo-engine/tests raven-api
git commit -m "[UPDATE] Verify Raven API contracts" -m "- CLI와 HTTP 오류 분류 동등성 검증 추가
- 화면 설정을 안전한 namespace 기반 통합 API로 이동"
```
