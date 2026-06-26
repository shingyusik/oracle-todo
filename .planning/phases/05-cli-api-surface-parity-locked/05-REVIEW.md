---
phase: 05-cli-api-surface-parity-locked
reviewed: 2026-06-26T02:46:31Z
depth: standard
files_reviewed: 9
files_reviewed_list:
  - todo-engine/src/interfaces/api/dto.rs
  - todo-engine/src/interfaces/api/handlers.rs
  - todo-engine/src/interfaces/api/mod.rs
  - todo-engine/src/interfaces/cli/create.rs
  - todo-engine/src/interfaces/cli/lifecycle.rs
  - todo-engine/src/interfaces/cli/mod.rs
  - todo-engine/src/interfaces/cli/views.rs
  - todo-engine/tests/e2e/api.rs
  - todo-engine/tests/e2e/cli.rs
findings:
  critical: 0
  warning: 5
  info: 4
  total: 9
status: issues_found
---

# Phase 05: Code Review Report

**Reviewed:** 2026-06-26T02:46:31Z
**Depth:** standard
**Files Reviewed:** 9
**Status:** issues_found

## Summary

Reviewed the Phase 5 CLI surface additions (`goal propose`, `agenda`/`date-range`/`period` views, `update --parent-id`) and the mirrored HTTP API surface plus the paired e2e parity tests. The implementation correctly routes every mutation through `TodoService` (CORE invariant upheld — no handler bypasses the service), and the exit-code/HTTP-status mapping is wired through `ApiError::into_response` and `cli_exit_code_from_error`. No injection, secret, or data-loss defects were found; the interface adapters are thin and add no policy/view logic, satisfying CORE-03.

However, the phase's headline goal — **CLI/API surface parity** — has a real asymmetry: the API `approve` and `complete` endpoints accept no request body and hardcode `reason = None`, while the CLI counterparts accept `--reason`. This divergence is currently behaviorally inert because the service ignores the reason for those two transitions, but it is a latent parity break that the paired e2e tests do not catch. The remaining findings concern silent input-divergence between CLI and API filter parsing, duplicated actor-parsing logic, and a route-ordering fragility in the axum router.

No source files were modified; this review is read-only.

## Warnings

### WR-01: API `approve`/`complete` cannot accept a reason, but CLI can — silent surface-parity gap

**File:** `todo-engine/src/interfaces/api/handlers.rs:273-279, 311-317`
**Issue:** Every other transition handler (`activate`, `pause`, `resume`, `archive`, `drop`, `cancel`) takes `body: Option<Json<ReasonBody>>` and threads the reason into the service. `approve_item` and `complete_item` take **no body parameter** and call the service with a hardcoded `None`:

```rust
pub(super) async fn approve_item(/* no body */) -> ApiResult<Json<TodoItem>> {
    let item = with_service(&state, |service| service.approve(&id, None))?;
    ...
}
pub(super) async fn complete_item(/* no body */) -> ApiResult<Json<TodoItem>> {
    let item = with_service(&state, |service| service.complete(&id, None))?;
    ...
}
```

The CLI, by contrast, accepts `--reason` for both (`lifecycle::approve`/`lifecycle::complete` pass `args.reason.as_deref()`). This is exactly the CLI/API surface divergence the phase set out to lock. It is inert *today* only because `TodoService::approve`/`complete` bind the parameter as `_reason` (unused). The moment those transitions begin recording the reason in the audit event (which is a stated mandatory-audit invariant), the API will silently drop user-supplied reasons while the CLI records them. The parity e2e tests do not cover this because no test sends a reason to `/approve` or `/complete`.
**Fix:** Give both handlers the same body shape as the sibling transitions and forward the reason:

```rust
pub(super) async fn approve_item(
    State(state): State<ApiState>,
    AxumPath(id): AxumPath<String>,
    body: Option<Json<ReasonBody>>,
) -> ApiResult<Json<TodoItem>> {
    let reason = body.and_then(|Json(b)| b.reason);
    let item = with_service(&state, |service| service.approve(&id, reason.as_deref()))?;
    Ok(Json(item))
}
```
Apply the same change to `complete_item`. Add a parity test that posts `{"reason": "..."}` to both endpoints.

### WR-02: API silently drops empty filter values; CLI passes them through — parsing divergence

**File:** `todo-engine/src/interfaces/api/handlers.rs:188-194` vs `todo-engine/src/interfaces/cli/views.rs:15-26`
**Issue:** In `list_items` the API applies `non_empty`/`non_empty_string` to coerce empty query parameters to `None` (e.g. `area_id: query.area_id.and_then(non_empty_string)`), and `status`/`type`/`include_archived` use `.and_then(non_empty)` so `?status=&type=` is treated as "unset" (the e2e test at api.rs:315 relies on this). The CLI `list` performs **no** such empty-string coercion — `args.area_id`, `args.query`, etc. flow straight into `ListFilter`. For the `query` field this is an observable behavioral difference: an empty `--query ""` on the CLI becomes `Some("")` and is forwarded to the repository's text filter, whereas `?query=` on the API becomes `None`. The two surfaces are documented as views over the same service but parse the same input differently.
**Fix:** Normalize in one place. Either move the empty-to-`None` coercion into the service/`ListFilter` construction so both adapters inherit it, or apply the same `non_empty_string` coercion in `cli/views.rs::list`. Add a parity assertion that an empty filter value yields the same result set on both surfaces.

### WR-03: `status`/`type` parsed as `ItemStatus`/`ItemType` strings only on success — invalid value error wording diverges

**File:** `todo-engine/src/interfaces/api/handlers.rs:166-179` vs `todo-engine/src/interfaces/cli/mod.rs:544-558`
**Issue:** The CLI parses `--status`/`--type` through `parse_status`/`parse_item_type`, which produce a descriptive clap error listing the allowed variants ("expected one of: proposed, approved, ..."). The API parses the same fields with `ItemStatus::from_str(...).map_err(TodoError::Validation)`, surfacing whatever the bare `from_str` error string is. Both reject invalid input (good), but the rejection messages differ between surfaces for the same logical error, which undercuts the "parity" guarantee and makes API errors less actionable. No e2e test pins the API's invalid-`status`/`type` message.
**Fix:** Either share a single `parse_status`/`parse_item_type` helper between the CLI and API layers, or assert the same allowed-variants message text in a paired test so drift is caught. At minimum, add an API test for `GET /items?status=bogus` returning 400.

### WR-04: Router places `/items/:id` PATCH after static `/items/...` routes — fragile ordering relied on implicitly

**File:** `todo-engine/src/interfaces/api/mod.rs:39-52`
**Issue:** `/items/archive` (GET) and `/items` (GET) are registered before the parameterized `/items/:id` (PATCH) and `/items/:id/<action>` (POST) routes. With axum 0.6-style `:id` matching this works because methods differ and the static segment `archive` is only registered for GET, but the arrangement is order- and version-sensitive: a future `GET /items/:id` (fetch one item) would shadow `GET /items/archive` unless ordering/precedence is handled. The e2e suite exercises only the current happy paths, so a regression here (e.g. on an axum upgrade that changes matcher precedence) would not be caught.
**Fix:** Make the intent explicit — group routes and add a comment documenting that `/items/archive` must not collide with a future `/items/:id` GET, or migrate to a nested router (`Router::nest("/items", ...)`) with the static `archive` route distinguished. Add a test asserting `GET /items/archive` resolves to the archive handler, not an `:id` handler.

### WR-05: `propose_task` inlines actor parsing instead of reusing `parse_actor_or_default` — duplicated logic, default-drift risk

**File:** `todo-engine/src/interfaces/api/handlers.rs:49-55`
**Issue:** Every other propose handler resolves the actor via the shared `parse_actor_or_default(body.actor.as_deref())?` helper (mod.rs:107), which defaults to `Actor::Agent`. `propose_task` reimplements the identical logic inline:

```rust
let actor = body.actor.as_deref().map(Actor::from_str).transpose()
    .map_err(TodoError::Validation)?.unwrap_or(Actor::Agent);
```

This is duplicated policy (the default-actor decision) living in two places. If the default ever changes (e.g. to `Actor::User` for a specific type), one site can be missed. It also makes `propose_task` the only handler whose actor-default is not centrally visible.
**Fix:** Replace the inline block with `let actor = parse_actor_or_default(body.actor.as_deref())?;` to match the other five propose handlers.

## Info

### IN-01: `materialization_policy` default duplicated as a magic string across layers

**File:** `todo-engine/src/interfaces/api/handlers.rs:125-127`, `todo-engine/src/interfaces/cli/mod.rs:241`, `todo-engine/src/application/service/creation.rs:166`
**Issue:** The literal `"single_open"` appears as a default in the API handler (`unwrap_or_else(|| "single_open".to_string())`), as a clap `default_value` in the CLI, and again in the service's allow-list. Three copies of the same magic string. Likewise `"appointment"` for `commitment_type` is duplicated between API (handlers.rs:155) and CLI (mod.rs:279).
**Fix:** Promote these defaults to named constants (e.g. `domain` or service-level `const DEFAULT_MATERIALIZATION_POLICY: &str = "single_open";`) and reference them from both adapters and the validator.

### IN-02: `service(&ApiState)` rebinds `_keeper` with no effect

**File:** `todo-engine/src/interfaces/api/mod.rs:56-57`
**Issue:** `fn service` begins with `let _keeper = &state.keeper;`. This borrow is discarded immediately and does nothing — the shared in-memory connection is kept alive by `state.keeper` itself (an `Arc` stored in `ApiState`), not by this local. The line reads as if it were load-bearing for the `:memory:` cache lifetime but is dead.
**Fix:** Remove the `let _keeper = &state.keeper;` line, or replace it with a comment explaining that `ApiState` holding the `Arc` is what keeps the shared-cache memory DB alive across per-request connections.

### IN-03: API and CLI `service()` constructors duplicate connect/init_schema wiring

**File:** `todo-engine/src/interfaces/api/mod.rs:56-67` and `todo-engine/src/interfaces/cli/mod.rs:517-526`
**Issue:** Both layers independently `connect(path)` + `init_schema(&conn)` + `TodoService::persistent(SqliteTodoRepository::new(conn))` on every call. The wiring is near-identical; divergence here (e.g. one layer adding a pragma the other lacks) would create subtle CLI/API behavior gaps that the parity tests would not necessarily surface.
**Fix:** Extract a shared `fn open_service(path: &Path) -> Result<TodoService>` in the infrastructure or application layer and call it from both adapters.

### IN-04: Parity e2e tests assert shape, not value-equality, across the two surfaces

**File:** `todo-engine/tests/e2e/api.rs:599-640`, `todo-engine/tests/e2e/cli.rs:723-794`
**Issue:** The view-parity tests (`view_routes_return_json` / `agenda_date_range_period_emit_json`) assert each surface independently returns an array / a `period_key`+`roots` object, but never assert the two surfaces return the *same* payload for the same inputs. "Parity" is asserted by convention (mirrored test names and comments) rather than by a shared fixture. A divergence in field naming or ordering between CLI JSON and API JSON would pass both tests.
**Fix:** Where practical, seed identical data through the service and assert the CLI stdout JSON and the API response body are structurally equal (or share a normalization helper), so parity is enforced mechanically rather than by reviewer vigilance.

---

_Reviewed: 2026-06-26T02:46:31Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
