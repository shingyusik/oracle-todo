# Phase 5: CLI + API Surface (parity-locked) - Pattern Map

**Mapped:** 2026-06-26
**Files analyzed:** 8 (5 modified, 0 new — all surface lives in existing files) + 2 test files extended
**Analogs found:** 8 / 8 (every piece has a verbatim in-repo precedent)

This is a thin-adapter phase. No new files are created; every change is an additive edit to an existing interface or DTO file, plus extensions to two existing e2e test files. Each change clones a precedent that already lives one or two lines away. All anchors below are codebase-verified.

## File Classification

| Modified File | Role | Data Flow | Closest Analog (same file unless noted) | Match Quality |
|---------------|------|-----------|------------------------------------------|---------------|
| `todo-engine/src/interfaces/cli/mod.rs` | route (clap dispatch) | request-response | `ProjectCommand`/`ProjectProposeArgs` (`:103`,`:166`); flat `Pending`/`Today` variants (`:91-93`); `UpdateArgs` (`:259`) | exact |
| `todo-engine/src/interfaces/cli/create.rs` | controller (handler) | request-response | `project_propose` (`:32`) | exact |
| `todo-engine/src/interfaces/cli/views.rs` | controller (handler) | request-response (read) | `routine_materialize` JSON path (`:27`); NOT `list`/`today` (those are Markdown) | role-match (JSON, not Markdown) |
| `todo-engine/src/interfaces/cli/lifecycle.rs` | controller (handler) | CRUD (update) | `update` (`:64`) — change `parent_id: None` at `:80` | exact (edit in place) |
| `todo-engine/src/interfaces/api/mod.rs` | route (axum router) | request-response | `propose_project` route (`:34`); `list_items` GET route (`:38`) | exact |
| `todo-engine/src/interfaces/api/handlers.rs` | controller (handler) | request-response | `propose_project` (`:73`); `list_items` Query handler (`:141`); `update_item` (`:191`, fix `:212`) | exact |
| `todo-engine/src/interfaces/api/dto.rs` | model (DTO) | transform | `ProjectProposeBody` (`:23`); `ItemsQuery` (`:85`); `UpdateBody` (`:65`) | exact |
| `todo-engine/tests/e2e/{cli,api}.rs` | test | request-response | `task_propose_and_items_use_same_service_path` (api.rs:66); `task_propose_prints_json_item` (cli.rs:76) | exact |

## Shared Service Contract (do NOT re-implement — call only)

All re-exported from `crate::application::service` (verified `service/mod.rs:18-22`):

```rust
use crate::application::service::{ProposeGoal, UpdateItem, PeriodView, GoalNode};
use crate::domain::Horizon;

// creation.rs:139 — ProposeGoal struct at creation.rs:50 (NOT goal.rs — CONTEXT anchor drift)
pub fn propose_goal(&mut self, request: ProposeGoal) -> TodoResult<TodoItem>
// ProposeGoal { title, horizon: String, scheduled: String, parent_id: Option<String>, actor: Actor, note: Option<String> }
// propose_goal parses horizon -> Horizon and validates the anchor INTERNALLY (creation.rs:140-147). Adapters pass raw strings.

// update.rs — UpdateItem already has `parent_id: Option<String>`. Adapters only need to FILL it.
pub fn update_item(&mut self, item_id: &str, request: UpdateItem) -> TodoResult<TodoItem>

// queries.rs:84 / :100 — side-effect-free reads, return Vec<TodoItem>
pub fn agenda(&mut self, date: &str) -> TodoResult<Vec<TodoItem>>
pub fn date_range(&mut self, from: &str, to: &str) -> TodoResult<Vec<TodoItem>>

// queries.rs:138 — takes Horizon ENUM, not &str. period adapter must parse first.
pub fn period_view(&mut self, horizon: Horizon, period: &str) -> TodoResult<PeriodView>
```

`PeriodView` and `GoalNode` (queries.rs:19/:33) both derive `Serialize` — serialize directly; no envelope needed.

## Pattern Assignments

### 1. `cli/mod.rs` — Goal subcommand + 3 view variants + `--parent-id` (route)

**Analog — grouped `{ Propose }` subcommand** (`ProjectCommand` `:103`, `ProjectProposeArgs` `:166`):
```rust
#[derive(Debug, Subcommand)]
enum ProjectCommand {
    /// Propose a project.
    Propose(ProjectProposeArgs),
}
#[derive(Debug, Args)]
struct ProjectProposeArgs {
    title: String,
    #[arg(long)] area: Option<String>,
    // ...
    #[arg(long, default_value = "agent", value_parser = parse_actor)]
    actor: Actor,                                  // <- SC4 default-agent gating
}
```
Clone as `GoalCommand` + `GoalProposeArgs` (title, `--horizon`, `--scheduled`, `--parent` → `parent_id`, `--note`, `--actor`). Add a `Command::Goal { command: GoalCommand }` variant (mirror `:50`).

**Analog — flat top-level view variants** (`Pending`/`Today` `:91-93`):
```rust
    /// Show proposed, approved, and active work.
    Pending,
    /// Show today's materialized task view.
    Today,
```
Add `Agenda(AgendaArgs)`, `#[command(name = "date-range")] DateRange(DateRangeArgs)`, `Period(PeriodArgs)`. Args: `AgendaArgs { date: String }`, `DateRangeArgs { from, to }`, `PeriodArgs { #[arg(long)] horizon, #[arg(long)] period }`.

**Analog — `UpdateArgs` field** (`:259-294`, currently has `scheduled` at `:289`, lacks `parent_id`):
Add after an existing `#[arg(long)] ...: Option<String>` line:
```rust
    #[arg(long = "parent-id")]
    parent_id: Option<String>,
```

**Dispatch + label — BOTH required (exhaustive matches):**
- `run()` arm at `:310-345` — mirror `Command::Project { command: ProjectCommand::Propose(args) } => create::project_propose(&home, args)` (`:318`). Add goal → `create::goal_propose`; view variants → `views::agenda`/`views::date_range`/`views::period`.
- `command_label()` at `:368-405` — every new variant needs a string arm here too (mirror `:377` `"project propose"`). Omitting one is a compile error (Pitfall 5).

### 2. `cli/create.rs` — `goal_propose` handler (controller)

**Analog** (`project_propose` `:32-45`):
```rust
pub(super) fn project_propose(home: &Path, args: ProjectProposeArgs) -> Result<()> {
    let mut service = service(home)?;
    let item = service.propose_project(ProposeProject { /* field-for-field from args */ })?;
    print_json(&item)?;
    Ok(())
}
```
Clone as `goal_propose`: build `ProposeGoal { title, horizon, scheduled, parent_id, actor, note }` from `GoalProposeArgs`, call `service.propose_goal(..)`, `print_json(&item)`. Add `GoalProposeArgs` to the `use super::{...}` list (`:5`) and `ProposeGoal` to the `crate::application::service::{...}` import (`:9`). Pass `--horizon`/`--scheduled` as raw strings — do NOT pre-parse (service owns it).

### 3. `cli/views.rs` — `agenda`/`date_range`/`period` handlers (controller, JSON-only)

**Analog — JSON output, NOT Markdown** (`routine_materialize` `:27`, which already uses `print_json`):
```rust
use super::output::print_json;   // already imported at views.rs:5
```
The existing `list`/`today`/`pending` use `render_items` (Markdown) — do NOT follow them (D-01, Pitfall 4). New handlers:
```rust
pub(super) fn agenda(home: &Path, args: AgendaArgs) -> Result<()> {
    let mut service = service(home)?;
    print_json(&service.agenda(&args.date)?)?;            // Vec<TodoItem>
    Ok(())
}
pub(super) fn date_range(home: &Path, args: DateRangeArgs) -> Result<()> {
    let mut service = service(home)?;
    print_json(&service.date_range(&args.from, &args.to)?)?;
    Ok(())
}
pub(super) fn period(home: &Path, args: PeriodArgs) -> Result<()> {
    let mut service = service(home)?;
    let horizon = args.horizon.parse::<Horizon>().map_err(TodoError::Validation)?; // ONLY adapter parse
    print_json(&service.period_view(horizon, &args.period)?)?; // PeriodView
    Ok(())
}
```
Add `AgendaArgs, DateRangeArgs, PeriodArgs` to `use super::{...}` (`:6`); add `use crate::domain::Horizon;` and `use crate::application::error::TodoError;`. The `.parse::<Horizon>().map_err(TodoError::Validation)` idiom mirrors `propose_goal` (creation.rs:140-143).

### 4. `cli/lifecycle.rs` — fill `parent_id` (CRUD, edit in place)

**Analog = the function itself** (`update` `:64-90`). Line `:80` currently reads `parent_id: None,`. Change to:
```rust
            parent_id: args.parent_id,
```
No other change; `UpdateItem` already carries the field and `update_item` validates it via `ensure_relation(.., Goal, ..)`.

### 5. `api/mod.rs` — 1 POST route + 3 GET view routes (router)

**Analog — POST propose route** (`:34`) and **GET read route** (`:38`):
```rust
        .route("/projects/propose", post(propose_project))
        .route("/items", get(list_items))
```
Add to the `Router::new()` chain (`:31-49`):
```rust
        .route("/goals/propose", post(propose_goal))
        .route("/views/agenda", get(view_agenda))
        .route("/views/date-range", get(view_date_range))
        .route("/views/period", get(view_period))
```
`post`, `get` already imported (`:10`). Handlers are pulled in via `use handlers::*` (`:20`) — no import edit. `parse_actor_or_default` (`:103`, default `Agent`) is reused by the goal handler for SC4.

### 6. `api/handlers.rs` — `propose_goal` + 3 view handlers + fix `update_item` (controller)

**Analog — propose handler** (`propose_project` `:73-91`):
```rust
pub(super) async fn propose_project(
    State(state): State<ApiState>,
    body: std::result::Result<Json<ProjectProposeBody>, JsonRejection>,
) -> ApiResult<Json<TodoItem>> {
    let Json(body) = body.map_err(validation_rejection)?;
    let actor = parse_actor_or_default(body.actor.as_deref())?;   // SC4 default Agent
    let item = with_service(&state, |service| service.propose_project(ProposeProject { .. }))?;
    Ok(Json(item))
}
```
Clone as `propose_goal` building `ProposeGoal { title, horizon, scheduled, parent_id, actor, note }`.

**Analog — Query read handler** (`list_items` `:141-184`, already `Query<ItemsQuery>`):
```rust
pub(super) async fn view_agenda(State(state): State<ApiState>, Query(q): Query<AgendaQuery>)
    -> ApiResult<Json<Vec<TodoItem>>> {
    Ok(Json(with_service(&state, |s| s.agenda(&q.date))?))
}
pub(super) async fn view_date_range(State(state): State<ApiState>, Query(q): Query<DateRangeQuery>)
    -> ApiResult<Json<Vec<TodoItem>>> {
    Ok(Json(with_service(&state, |s| s.date_range(&q.from, &q.to))?))
}
pub(super) async fn view_period(State(state): State<ApiState>, Query(q): Query<PeriodQuery>)
    -> ApiResult<Json<PeriodView>> {
    let horizon = q.horizon.parse::<Horizon>().map_err(TodoError::Validation)?;
    Ok(Json(with_service(&state, |s| s.period_view(horizon, &q.period))?))
}
```
`Query`, `State`, `with_service`, `validation_rejection`, `parse_actor_or_default` all already imported (`:5`,`:12-15`). Add `ProposeGoal`, `PeriodView` to the `crate::application::service::{...}` import (`:18`) — `UpdateItem` is already there; add `Horizon` to the `crate::domain::{...}` import (`:21`); add the new DTOs to the `super::dto::{...}` import (`:8`).

**FIX — `update_item` hardcoded `None`** (`:212`). Current:
```rust
                parent_id: None,
```
Change to:
```rust
                parent_id: body.parent_id,
```
Pitfall 1: adding the DTO field WITHOUT this fix means API linking silently no-ops (returns 200 but `parent_id` stays null).

### 7. `api/dto.rs` — goal DTO + 3 query DTOs + `parent_id` on `UpdateBody` (model)

**Analog — propose body** (`ProjectProposeBody` `:23`) and **query** (`ItemsQuery` `:85`):
```rust
#[derive(Deserialize)]
pub(super) struct ProjectProposeBody {
    pub title: String,
    pub area: Option<String>,
    // ...
    pub actor: Option<String>,                 // parsed via parse_actor_or_default
}
#[derive(Deserialize)]
pub(super) struct ItemsQuery { pub status: Option<String>, /* ... */ }
```
Add:
```rust
#[derive(Deserialize)]
pub(super) struct GoalProposeBody {
    pub title: String, pub horizon: String, pub scheduled: String,
    pub parent_id: Option<String>, pub note: Option<String>, pub actor: Option<String>,
}
#[derive(Deserialize)] pub(super) struct AgendaQuery    { pub date: String }
#[derive(Deserialize)] pub(super) struct DateRangeQuery { pub from: String, pub to: String }
#[derive(Deserialize)] pub(super) struct PeriodQuery    { pub horizon: String, pub period: String }
```
**FIX — `UpdateBody`** (`:65-83`, lacks `parent_id`): add
```rust
    pub parent_id: Option<String>,
```
(Required by the `handlers.rs:212` fix above — the field must exist on the struct.)

### 8. `tests/e2e/{cli,api}.rs` — paired surface tests (test)

**CLI analog** (`task_propose_prints_json_item` cli.rs:76): `Command::cargo_bin("todo-engine")` → `init` on a `TestHome`, then run the command, assert `.success()` and JSON stdout. Parse stdout for `status == "proposed"`, `proposed_by == "agent"` (SC4).

**API analog** (`task_propose_and_items_use_same_service_path` api.rs:66): `router(&db_path)` (file or `:memory:`) → `oneshot` a request (use `json_request`/`empty_request`/`body_json` helpers, api.rs:7-27), assert `status() == 200` and parse `body_json`. For views use GET (`empty_request(app, "GET", "/views/agenda?date=2026-06-26")`).

**Parity assertions:**
- **State parity (SC3):** assert independently in each file against the same service path (matches the current idiom — there is no shared cross-surface helper). A goal proposed via CLI and via `POST /goals/propose` both yield `status="proposed"`, identical view JSON shape.
- **Rejection parity (SC3, Pitfall 3):** assert byte/`detail`-identical rejection ONLY for *present-but-invalid* inputs (bad horizon, junk date, non-Goal parent → `TodoError::Validation` → exit 2 / HTTP 400 with matching message). For *missing required* params (`/views/agenda` with no `?date=`; missing CLI positional), assert only the *class* (both reject: non-zero exit / 4xx) — axum `QueryRejection` body ≠ clap usage error.
- **SC4:** assert agent-created goal (either surface) starts `proposed`; assert it cannot be created `active` directly.

## Shared Patterns

### Approval gating (SC4) — actor defaults to Agent
**Source:** CLI `#[arg(default_value = "agent", value_parser = parse_actor)]` (mod.rs:178); API `parse_actor_or_default` (mod.rs:103, `unwrap_or(Actor::Agent)`).
**Apply to:** `goal_propose` on both surfaces. No status is ever set in an adapter — the service state machine sets `proposed` for the agent actor. The phase only *proves* this with tests.

### Error → exit/status mapping (inherited, no new surface)
**Source:** `ApiError::into_response` (api/mod.rs:136-147) maps `TodoError` → `http_status_code()` with `{"detail": ...}` body; CLI `TodoError::cli_exit_code_from_error` (mod.rs:360). `Validation → exit 2 / HTTP 400`.
**Apply to:** all new handlers. Adapters add NO validation — they pass raw strings (or parse only `Horizon` for `period`) and let the service raise `TodoError`.

### JSON output split
**Source:** `print_json` (cli/output.rs:5) for machine output; `render_items` (cli/markdown.rs) for legacy Markdown views.
**Apply to:** ALL new CLI output uses `print_json` (D-01). Do NOT extend `render_items` (anti-pattern). API mirrors with `Json(value)` over the same serde types → byte-comparable bodies.

### Per-request service construction
**Source:** CLI `service(home)` (mod.rs:451); API `with_service(&state, |svc| ..)` (mod.rs:87). View methods are side-effect-free reads — safe to call on a fresh service per request.

## No Analog Found

None. Every change has an exact or near-exact in-repo precedent.

## CONTEXT Anchor Corrections (carry into plans)

| CONTEXT claim | Verified reality |
|---------------|------------------|
| `propose_goal` in `service/goal.rs` | Actually `creation.rs:139`; `ProposeGoal` struct at `creation.rs:50`. `goal.rs` holds only validation helpers. Import path unchanged (`crate::application::service::ProposeGoal`). |
| CLI `update` hardcodes parent (cli wiring) | `lifecycle.rs:80` `parent_id: None` — change there, not in `mod.rs`. `UpdateArgs` field is added in `mod.rs:259`. |
| API update DTO just needs a field | TWO edits: add `parent_id` to `UpdateBody` (dto.rs:65) AND change `handlers.rs:212` `None` → `body.parent_id`. Field-only is insufficient (Pitfall 1). |

## Metadata

**Analog search scope:** `todo-engine/src/interfaces/{cli,api}/`, `todo-engine/src/application/service/`, `todo-engine/tests/e2e/`
**Files read for extraction:** 12 (all anchors verified line-by-line)
**Pattern extraction date:** 2026-06-26
