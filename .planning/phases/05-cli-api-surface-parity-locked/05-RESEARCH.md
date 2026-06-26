# Phase 5: CLI + API Surface (parity-locked) - Research

**Researched:** 2026-06-26
**Domain:** Rust adapter surface — `clap` CLI subcommands + `axum` HTTP routes over a completed `TodoService`
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** New `date`/`period` view commands output **JSON only** (default and only format). No Markdown toggle. Reuse `cli/output.rs::print_json`.
- **D-02:** This **relaxes SC1 / SURF-01** ("Markdown + JSON" → "JSON"). Existing Markdown view commands (`list`/`today`/`pending`) are untouched.
- **D-03:** Period view = a single command `period --horizon <week|month|year> --period <date>`, mapping 1:1 to `period_view(horizon, period)`. Not split into `week`/`month`/`year` subcommands.
- **D-04:** Date view = two commands, `agenda <date>` and `date-range <from> <to>`, mapping 1:1 to the `agenda` and `date_range` service methods.
- **D-05:** All three are **flat top-level** commands (consistent with existing `today`/`pending`/`list`), not under a `view` subgroup.
- **D-06:** Goal creation = a grouped subcommand `goal propose <title> --horizon <week|month|year> --scheduled <date> [--parent <id>] [--actor]`, mirroring the existing `task`/`project` `{ Propose }` group pattern; calls `propose_goal`. Goal status transitions reuse the existing generic `approve`/`activate`/etc. commands — no goal-specific transition commands.
- **D-07:** Task→goal linking (LINK-01/LINK-02) reuses the existing `update` command: add `--parent-id <goal>` to `UpdateArgs` (Phase 2 explicitly deferred this CLI wiring); `--scheduled` already exists. Routes through the audited `update_item` path.
- **D-08:** Goal creation API = `POST /goals/propose`, mirroring `/tasks/propose` and `/projects/propose`. Preserves the propose pattern and `parse_actor_or_default` (default `Agent`).
- **D-09:** Task→goal linking reuses the existing `PATCH /items/:id` (`update_item`) endpoint — add `parent_id` to the update DTO (`api/dto.rs`). No new endpoint.
- **D-10:** View endpoints grouped under a `/views/*` prefix: `GET /views/agenda`, `GET /views/date-range`, `GET /views/period`.
- **D-11:** View arguments passed as **query strings**: `?date=`, `?from=&to=`, `?horizon=&period=` — `axum::extract::Query` binding.

### Claude's Discretion
- JSON serialization shape of view outputs: reuse the existing `PeriodView`/`GoalNode` serde types in `queries.rs` and the date-view serde shapes (date views serialize `Vec<TodoItem>`) — not re-invented.
- Error responses: existing `TodoError` → CLI exit code / HTTP status mapping covers invalid horizon/date (Validation → exit 2 / HTTP 400). No new error surface.
- Exact JSON field names / wrapper envelope for view responses, within the parity constraint.

### Deferred Ideas (OUT OF SCOPE)
- **Markdown rendering of date/period views** — dropped from v1 per D-01/D-02 (JSON-only). If a human-facing Markdown view is wanted later, add a `--format`/`--json` toggle and a `render_*` function then; out of scope now.
- No other deferred ideas — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SURF-01 | CLI subcommands for creating goals, linking tasks, and every view (JSON output; new views JSON-only per D-01/D-02; legacy Markdown views unchanged). | Standard Stack + Architecture Patterns: `goal propose`, `agenda`, `date-range`, `period` commands clone the existing `{ Propose }` group and `print_json` convention; `--parent-id` added to `UpdateArgs`. Exact service signatures captured below. |
| SURF-02 | HTTP API endpoints mirroring the new CLI surface, reusing `TodoService` (parity asserted by paired e2e tests). | `POST /goals/propose`, `GET /views/{agenda,date-range,period}`, `parent_id` on `UpdateBody` DTO. Handlers call the identical service methods the CLI calls. |
| CORE-03 | New date/period view logic lives in the application/service layer shared by CLI and API. | **Already satisfied** (verified): `agenda`/`date_range`/`period_view` live in `application/service/queries.rs`; adapters only call + serialize. This phase adds NO policy/view logic to `cli/` or `api/`. |
</phase_requirements>

## Summary

This is a **thin-adapter** phase. Every service method the new surface needs already exists and is fully tested at the service/integration layer (Phases 2–4). The job is to: (1) add four CLI commands (`goal propose`, `agenda`, `date-range`, `period`) plus one CLI arg (`--parent-id` on `update`); (2) add one HTTP POST route (`/goals/propose`), three GET view routes (`/views/{agenda,date-range,period}`), and one DTO field (`parent_id` on `UpdateBody`); and (3) write paired CLI+API e2e tests proving the two surfaces yield identical item state and identical rejections, and that agent-created goals start `proposed` (SC4).

The codebase has an exceptionally clean precedent for every piece. `goal propose` clones the `task propose` / `project propose` `{ Propose }` subcommand group verbatim (substituting the `ProposeGoal` request struct, which takes `horizon: String` + `scheduled: String` and parses internally). The view commands clone the JSON-emitting handler shape in `cli/create.rs` (call service → `print_json`). On the API side, `/goals/propose` clones `propose_project`/`propose_routine` exactly (including `parse_actor_or_default`); the view GET handlers clone `list_items` (which already uses `Query<ItemsQuery>`). The error and approval-gating behaviors are inherited unchanged — no new error surface, no new gating logic.

**Primary recommendation:** Mirror the existing patterns mechanically. The only real decisions left to the planner are (a) the names of the new `Args`/`Body`/`Query` structs and view handler functions, and (b) the JSON envelope for view responses (recommendation: serialize the service return value directly — `Vec<TodoItem>` for date views, `PeriodView` for period view — so CLI `print_json` output and API `Json(...)` body are byte-identical, making SC3 parity assertions trivial). **The single most important correction to CONTEXT: two file:line anchors are wrong** (`propose_goal` lives in `service/creation.rs`, not `goal.rs`; `update_item` handler already exists but hardcodes `parent_id: None` and `UpdateBody` lacks the field). Details in the Anchor Drift table.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Goal create (CLI `goal propose`) | Interfaces/CLI | Application/service | CLI parses args → builds `ProposeGoal` → calls `propose_goal`; policy is in service. |
| Goal create (API `POST /goals/propose`) | Interfaces/API | Application/service | Handler deserializes DTO → `parse_actor_or_default` → `propose_goal`. Identical service call to CLI. |
| Task→goal link (CLI `update --parent-id`) | Interfaces/CLI | Application/service | Adds an arg; `update_item` already validates parent via `ensure_relation(.., Goal, ..)`. |
| Task→goal link (API `PATCH /items/:id`) | Interfaces/API | Application/service | DTO gains `parent_id`; handler stops hardcoding `None`. |
| Date views (`agenda`, `date-range`) | Application/service | Interfaces (CLI+API) | View logic (open-task filtering, sorting) is in `queries.rs` (CORE-03). Adapters call + serialize. |
| Period view (`period`) | Application/service | Interfaces (CLI+API) | Tree assembly + anomaly counting in `queries.rs`. Adapters pass `Horizon` + date string, serialize `PeriodView`. |
| Approval gating (SC4) | Application/service | Interfaces (actor default) | Service sets `proposed` for agent actor; both adapters default actor=agent. Phase only *proves* it. |

**Why this matters:** every capability's *primary* tier is already implemented. This phase only touches the *secondary* (adapter) tier. Any task that proposes adding logic to the primary (service) tier is out of scope and contradicts CORE-03 / the phase boundary.

## Standard Stack

No new dependencies. The phase uses crates already in the workspace, at their pinned versions. Verified present and used in the live interface code.

### Core (already in use, no version change)
| Library | Purpose | Where Used (verified) |
|---------|---------|----------------------|
| `clap` (derive) | CLI subcommand/arg parsing | `cli/mod.rs` `Command` enum, `{ Propose }` groups, `*Args` structs `[VERIFIED: cli/mod.rs]` |
| `axum` | HTTP router + extractors (`Json`, `Query`, `Path`, `State`) | `api/mod.rs` router, `api/handlers.rs` `[VERIFIED: api/mod.rs, api/handlers.rs]` |
| `serde` / `serde_json` | DTO de/serialization, `print_json` | `cli/output.rs`, `api/dto.rs`, `PeriodView`/`GoalNode` derive `Serialize` `[VERIFIED: queries.rs:19,33]` |
| `anyhow` | CLI handler `Result` plumbing | `cli/create.rs`, `cli/views.rs` return `anyhow::Result<()>` `[VERIFIED]` |

### Test stack (already in use)
| Library | Purpose | Where Used (verified) |
|---------|---------|----------------------|
| `assert_cmd` + `predicates` | CLI e2e (`Command::cargo_bin("todo-engine")`) | `tests/e2e/cli.rs` `[VERIFIED]` |
| `tower::ServiceExt` (`oneshot`) + `http` + `http_body_util` | API e2e (drive `router(..)` in-process) | `tests/e2e/api.rs` `[VERIFIED]` |
| `tempfile` | temp DB / `TestHome` | `tests/support/mod.rs`, `tests/e2e/api.rs` `[VERIFIED]` |

### Alternatives Considered
None. CONTEXT locks all command/route shapes; introducing alternative crates or patterns would violate the parity/precedent constraint. Markdown rendering for views is explicitly OUT (D-01/D-02).

*No external packages are installed by this phase → no Package Legitimacy Audit required.*

## Anchor Drift (CONTEXT file:line corrections — HIGHEST-VALUE FINDING)

The planner MUST use these corrected locations. CONTEXT's anchors were close but two are materially wrong.

| CONTEXT claim | Reality (verified) | Impact on plan |
|---------------|--------------------|----------------|
| `propose_goal` in `application/service/goal.rs` | `propose_goal` + `ProposeGoal` struct are in **`application/service/creation.rs`** (`propose_goal` at `creation.rs:139`, `ProposeGoal` at `creation.rs:50`). `goal.rs` holds only the validation helpers (`validate_goal_anchor`, `validate_goal_nesting`, `ensure_goal_not_duplicate`) + `MAX_GOAL_DEPTH`. `[VERIFIED: grep + creation.rs:139]` | CLI/API goal-create handler imports `ProposeGoal` from `crate::application::service` (re-exported at `service/mod.rs:18`), no path change needed in callers, but anyone reading `goal.rs` for `propose_goal` will not find it. |
| `cli/mod.rs` `Command` enum at `:35`; `UpdateArgs` at `:260`; `parse_actor` `default_value="agent"` | Confirmed: `Command` enum `cli/mod.rs:35`; `UpdateArgs` `cli/mod.rs:259` (has `scheduled` at `:289`, **lacks `parent_id`**); `parse_actor` + `default_value="agent"` on every propose args struct `[VERIFIED]` | Accurate. `UpdateArgs` needs a new `#[arg(long = "parent-id")] parent_id: Option<String>` field; the `lifecycle::update` dispatch must forward it. |
| `api/mod.rs` router `:28–49`; `patch(update_item)` at `/items/:id` `:40`; `parse_actor_or_default` `:103` | Confirmed: router `:28–50`; `.route("/items/:id", patch(update_item))` `:40`; `parse_actor_or_default` `:103` `[VERIFIED]` | Accurate. New routes go in the `Router::new()...` chain. |
| `api/dto.rs` update DTO gains `parent_id` (D-09) | `UpdateBody` is `api/dto.rs:65`; **lacks `parent_id`**. The handler `update_item` (`api/handlers.rs:191`) **already constructs `UpdateItem { .. parent_id: None .. }` hardcoded at `handlers.rs:212`** `[VERIFIED]` | Plan must (a) add `pub parent_id: Option<String>` to `UpdateBody`, AND (b) change `handlers.rs:212` from `parent_id: None` to `parent_id: body.parent_id`. Adding the DTO field alone is insufficient. |
| `cli/create.rs` / `views.rs` / `output.rs` reusable | Confirmed: `create.rs` has `task_propose`/`project_propose`/etc (call service → `print_json`); `views.rs` has `list`/`pending`/`today` (Markdown via `render_items`) + `routine_materialize` (JSON); `output.rs::print_json` `[VERIFIED]` | New `goal_propose` goes in `create.rs`; new `agenda`/`date_range`/`period` handlers go in `views.rs` but use `print_json` (NOT `render_items`). |
| `queries.rs` has `period_view`/`agenda`/`date_range` + `PeriodView`/`GoalNode` | Confirmed verbatim. `period_view(horizon: Horizon, period: &str)`, `agenda(date: &str)`, `date_range(from: &str, to: &str)`; `PeriodView`/`GoalNode` derive `Serialize`+`Deserialize`, re-exported at `service/mod.rs:21` `[VERIFIED]` | Accurate and load-bearing — see exact signatures below. |

## Exact Service Signatures (the contract the adapters call)

All on `impl TodoService`, all `pub`. Re-exported request/return types listed.

```rust
// application/service/creation.rs:139  — re-exported: service/mod.rs:18 (ProposeGoal)
pub fn propose_goal(&mut self, request: ProposeGoal) -> TodoResult<TodoItem>

// application/service/creation.rs:50
pub struct ProposeGoal {
    pub title: String,
    pub horizon: String,        // parsed to Horizon INSIDE propose_goal (creation.rs:140-143)
    pub scheduled: String,      // validated/canonicalized inside (validate_goal_anchor)
    pub parent_id: Option<String>,
    pub actor: Actor,           // default Agent drives approval gating (SC4)
    pub note: Option<String>,
    // NOTE: no `area`/`due`/`priority` — goal create is title+horizon+scheduled+parent+note only.
}

// application/service/update.rs:27  — re-exported: service/mod.rs:22 (UpdateItem)
pub fn update_item(&mut self, item_id: &str, request: UpdateItem) -> TodoResult<TodoItem>
// UpdateItem already has `pub parent_id: Option<String>` (update.rs:18). The service applies it
// via ensure_relation(Some(parent_id), ItemType::Goal, "Goal parent") (update.rs:83-86) —
// validates the parent is a non-terminal Goal. Adapters only need to FILL this field.

// application/service/queries.rs:84
pub fn agenda(&mut self, date: &str) -> TodoResult<Vec<TodoItem>>          // returns Vec<TodoItem>

// application/service/queries.rs:100
pub fn date_range(&mut self, from: &str, to: &str) -> TodoResult<Vec<TodoItem>>

// application/service/queries.rs:138  — Horizon: domain/horizon.rs:13 (enum Year|Month|Week)
pub fn period_view(&mut self, horizon: Horizon, period: &str) -> TodoResult<PeriodView>
// PeriodView { horizon: String, period_key: String, roots: Vec<GoalNode>, anomaly_count: usize }
// GoalNode  { goal: TodoItem, child_goals: Vec<GoalNode>, tasks: Vec<TodoItem> }
```

**Critical adapter detail — `period_view` takes a `Horizon` enum, not a string.** Both adapters must parse the `--horizon`/`?horizon=` string to `Horizon` *before* calling. `Horizon: FromStr` (`horizon.rs:47`, accepts `"year"|"month"|"week"`, `Err(String)` otherwise). The other two view methods (`agenda`, `date_range`) take `&str` dates and parse internally via `parse_day` (`service/mod.rs:238`), returning `TodoError::Validation` on junk → exit 2 / HTTP 400 automatically.

**`agenda`/`date_range`/`period` are side-effect-free reads** (verified: no `store_item_and_event`, no event emission). Safe to call on a fresh `service(home)` / `with_service` per request.

## Architecture Patterns

### System Data Flow

```
CLI:   args (clap) ──▶ cli/mod.rs dispatch ──▶ cli/{create,views}.rs handler
                                                   │ service(home) → TodoService
                                                   ▼
                                          TodoService::{propose_goal | update_item
                                            | agenda | date_range | period_view}
                                                   │ (policy + state machine + audit
                                                   │  event live HERE — adapters add none)
                                                   ▼
                                          print_json(&result)  ──▶ stdout (1 JSON line)

API:   HTTP req ──▶ axum Router (api/mod.rs) ──▶ api/handlers.rs handler
            (Json<Body> | Query<Q> | Path<id>)     │ with_service(&state, |svc| …)
                                                   ▼
                                          ── SAME TodoService methods ──
                                                   ▼
                                          Json(result)  ──▶ HTTP body (same shape)
```

Parity is structural: both arrows converge on one `TodoService` method per operation. The only divergence is input parsing (clap args vs Query/JSON) and output framing (`print_json` line vs `Json(...)` body) — both serialize the *same* return value.

### Pattern 1: Goal-create CLI command (clone the `{ Propose }` group)
**What:** A `Goal { #[command(subcommand)] command: GoalCommand }` variant on `Command`, a `GoalCommand::Propose(GoalProposeArgs)` subcommand, and a `goal_propose` handler.
**When:** D-06.
**Example (mirror `ProjectProposeArgs` + `project_propose`):**
```rust
// cli/mod.rs — new enum + args (mirror ProjectCommand / ProjectProposeArgs:165)
#[derive(Debug, Subcommand)]
enum GoalCommand { /// Propose a goal.
    Propose(GoalProposeArgs) }

#[derive(Debug, Args)]
struct GoalProposeArgs {
    title: String,
    #[arg(long)] horizon: String,            // "week"|"month"|"year" (service parses)
    #[arg(long)] scheduled: String,          // ISO canonical period start
    #[arg(long = "parent")] parent_id: Option<String>,
    #[arg(long)] note: Option<String>,
    #[arg(long, default_value = "agent", value_parser = parse_actor)] actor: Actor,
}
// dispatch arm in run() (mirror cli/mod.rs:319) + label arm in command_label() (mirror :377)

// cli/create.rs — handler (mirror project_propose:32)
pub(super) fn goal_propose(home: &Path, args: GoalProposeArgs) -> Result<()> {
    let mut service = service(home)?;
    let item = service.propose_goal(ProposeGoal {
        title: args.title, horizon: args.horizon, scheduled: args.scheduled,
        parent_id: args.parent_id, actor: args.actor, note: args.note,
    })?;
    print_json(&item)?;   // SC4: agent actor ⇒ status "proposed"
    Ok(())
}
```
**Gotcha:** `--horizon`/`--scheduled` are passed as raw strings; `propose_goal` does the `Horizon::from_str` and anchor validation. Do NOT pre-parse in the CLI (keeps adapter policy-free, CORE-01/CORE-03). A bad horizon ⇒ `TodoError::Validation` ⇒ exit 2.

### Pattern 2: View CLI commands (flat top-level, JSON-only)
**What:** Three flat `Command` variants — `Agenda(AgendaArgs)`, `DateRange(DateRangeArgs)`, `Period(PeriodArgs)` — with handlers in `cli/views.rs` that call the service and `print_json`.
**When:** D-03/D-04/D-05.
**Example:**
```rust
// cli/mod.rs — variants (flat, like Pending/Today at :91-93)
/// Show open tasks scheduled or due on a date.
Agenda(AgendaArgs),
/// Show open tasks scheduled within an inclusive [from,to] range.
#[command(name = "date-range")] DateRange(DateRangeArgs),
/// Show the goal subtree for a (horizon, period).
Period(PeriodArgs),

#[derive(Debug, Args)] struct AgendaArgs   { date: String }
#[derive(Debug, Args)] struct DateRangeArgs{ from: String, to: String }
#[derive(Debug, Args)] struct PeriodArgs   {
    #[arg(long)] horizon: String,
    #[arg(long)] period: String,
}

// cli/views.rs — handlers (JSON via print_json, NOT render_items)
pub(super) fn agenda(home: &Path, args: AgendaArgs) -> Result<()> {
    let mut service = service(home)?;
    print_json(&service.agenda(&args.date)?)?; Ok(())   // serializes Vec<TodoItem>
}
pub(super) fn date_range(home: &Path, args: DateRangeArgs) -> Result<()> {
    let mut service = service(home)?;
    print_json(&service.date_range(&args.from, &args.to)?)?; Ok(())
}
pub(super) fn period(home: &Path, args: PeriodArgs) -> Result<()> {
    let mut service = service(home)?;
    let horizon = args.horizon.parse::<Horizon>().map_err(TodoError::Validation)?; // exit 2 on junk
    print_json(&service.period_view(horizon, &args.period)?)?; Ok(())   // serializes PeriodView
}
```
**Note:** `period` is the only view command that parses the horizon in the adapter (because `period_view` wants a `Horizon`). This is mechanical conversion, not policy. Mirror the existing `parse::<Horizon>().map_err(TodoError::Validation)` idiom used in the service (`goal.rs:69-70`).

### Pattern 3: API goal-create route (clone `propose_project`)
**What:** `.route("/goals/propose", post(propose_goal))` + a `GoalProposeBody` DTO + a `propose_goal` handler.
**When:** D-08.
**Example (mirror `propose_project` `handlers.rs:73` + `ProjectProposeBody` `dto.rs:23`):**
```rust
// api/dto.rs
#[derive(Deserialize)]
pub(super) struct GoalProposeBody {
    pub title: String, pub horizon: String, pub scheduled: String,
    pub parent_id: Option<String>, pub note: Option<String>, pub actor: Option<String>,
}
// api/handlers.rs
pub(super) async fn propose_goal(
    State(state): State<ApiState>,
    body: std::result::Result<Json<GoalProposeBody>, JsonRejection>,
) -> ApiResult<Json<TodoItem>> {
    let Json(body) = body.map_err(validation_rejection)?;
    let actor = parse_actor_or_default(body.actor.as_deref())?;   // default Agent ⇒ SC4
    let item = with_service(&state, |service| service.propose_goal(ProposeGoal {
        title: body.title, horizon: body.horizon, scheduled: body.scheduled,
        parent_id: body.parent_id, actor, note: body.note,
    }))?;
    Ok(Json(item))
}
```

### Pattern 4: API view routes (clone `list_items`, use `Query`)
**What:** Three GET routes under `/views/*` with `Query`-extracted params.
**When:** D-10/D-11.
**Example (mirror `list_items` `handlers.rs:141`, which already uses `Query<ItemsQuery>`):**
```rust
// api/mod.rs router additions
.route("/views/agenda", get(view_agenda))
.route("/views/date-range", get(view_date_range))
.route("/views/period", get(view_period))

// api/dto.rs
#[derive(Deserialize)] pub(super) struct AgendaQuery    { pub date: String }
#[derive(Deserialize)] pub(super) struct DateRangeQuery { pub from: String, pub to: String }
#[derive(Deserialize)] pub(super) struct PeriodQuery    { pub horizon: String, pub period: String }

// api/handlers.rs
pub(super) async fn view_agenda(State(state): State<ApiState>, Query(q): Query<AgendaQuery>)
    -> ApiResult<Json<Vec<TodoItem>>> {
    Ok(Json(with_service(&state, |s| s.agenda(&q.date))?))
}
pub(super) async fn view_period(State(state): State<ApiState>, Query(q): Query<PeriodQuery>)
    -> ApiResult<Json<PeriodView>> {
    let horizon = q.horizon.parse::<Horizon>().map_err(TodoError::Validation)?;
    Ok(Json(with_service(&state, |s| s.period_view(horizon, &q.period))?))
}
```
**Gotcha (axum Query):** a *missing required* query param (e.g. `/views/agenda` with no `?date=`) is a `QueryRejection` → axum returns **400 with axum's own body**, not the `{"detail": …}` envelope. The CLI equivalent (missing positional arg) is a **clap usage error → exit 2** with clap's message. So "missing param" rejections are NOT byte-identical across surfaces — assert *status/exit code class* (both reject), not identical bodies. For *present-but-invalid* params (bad horizon, junk date), both go through `TodoError::Validation` ⇒ exit 2 / HTTP 400 with matching `detail`/stderr substring — those CAN be asserted as parity.

### Pattern 5: Task→goal link (fill existing fields, do not add commands/routes)
**CLI (D-07):** add `#[arg(long = "parent-id")] parent_id: Option<String>` to `UpdateArgs` (`cli/mod.rs:259`); in `lifecycle::update` forward `parent_id: args.parent_id` into the `UpdateItem` it builds.
**API (D-09):** add `pub parent_id: Option<String>` to `UpdateBody` (`dto.rs:65`); change `handlers.rs:212` `parent_id: None` → `parent_id: body.parent_id`.
Both then route through the already-validated `update_item` path (parent must be a non-terminal Goal; non-Goal ⇒ Policy error ⇒ exit 2 / 400).

### Anti-Patterns to Avoid
- **Re-implementing view/policy logic in adapters.** All filtering, sorting, tree assembly, anomaly counting is in `queries.rs`. Adapters call + serialize only (CORE-03). A handler that loops/filters items is a defect.
- **Adding Markdown rendering for the new views.** Explicitly OUT (D-01/D-02). Only `render_items` exists in `cli/markdown.rs` and it is for `list`/`today`/`pending` only — do NOT extend it. `print_json` for all new output.
- **Pre-parsing horizon for `agenda`/`date_range`.** Those take `&str` and parse internally; only `period_view` wants a `Horizon`.
- **Adding a `view` subgroup.** D-05 locks flat top-level commands.
- **Forgetting `command_label()`** in `cli/mod.rs` (`:368`): every new `Command` variant needs a matching arm there (the match is exhaustive — omitting one is a compile error, but the planner should list it as a task step).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Horizon string→enum | Manual `match "week" => ..` in adapter | `Horizon::from_str` (`horizon.rs:47`) | Single source; returns the right `Err(String)` that maps to Validation. |
| Date validation | `chrono`/regex date checks in handler | pass raw `&str`; service `parse_day` validates | Keeps adapters policy-free; correct `TodoError::Validation`. |
| Goal anchor canonicalization | Snap date to period start in adapter | `propose_goal` → `validate_goal_anchor` | Phase 1 lock: never auto-snap; strict reject. Service owns it. |
| Approval gating | Set status in adapter | actor default `agent` + service state machine | SC4 is satisfied by the existing default; adapter only passes actor. |
| Parent-is-a-Goal check | Validate parent type in handler | `update_item` → `ensure_relation(.., Goal, ..)` | Already validated on the audited path. |
| JSON envelope | Custom serializer for views | `serde_json` derive on `PeriodView`/`GoalNode`; `print_json`/`Json(..)` | Same shape both surfaces ⇒ trivial SC3 parity. |

**Key insight:** the service layer was deliberately built so adapters are pure plumbing. Every "should I validate X?" question is already answered "no, the service does" — verified against `queries.rs`, `creation.rs`, `update.rs`.

## Runtime State Inventory

Not applicable. This phase is purely additive adapter code (new clap variants, new axum routes, new DTO fields, new tests) over an unchanged service/schema. No rename/refactor/migration; no stored data, live-service config, OS-registered state, secrets, or build artifacts are touched.

- **Stored data:** None — no schema change, no data rewrite. Verified: phase boundary excludes service/domain logic; `Goal` rows already exist from Phase 2.
- **Live service config:** None.
- **OS-registered state:** None.
- **Secrets/env vars:** None — `TODO_ENGINE_HOME` and log envs are unchanged.
- **Build artifacts:** None beyond a normal `cargo build` of the `todo-engine` crate.

## Common Pitfalls

### Pitfall 1: Adding the `parent_id` DTO field but leaving the handler hardcoded
**What goes wrong:** Plan adds `parent_id` to `UpdateBody` but the API still links nothing, because `handlers.rs:212` literally sets `parent_id: None`.
**Why:** The `update_item` handler predates goal-linking and stubbed the field.
**How to avoid:** The task MUST change `handlers.rs:212` to `parent_id: body.parent_id`. Verification: an API `PATCH /items/:id {"parent_id": "<goal>"}` returns an item whose `parent_id` equals the goal id.
**Warning sign:** API link test passes status 200 but `item["parent_id"]` is null.

### Pitfall 2: `period_view` horizon-type mismatch
**What goes wrong:** Passing the raw string to `period_view` won't compile (`expected Horizon, found String`), or worse, someone changes the service signature.
**Why:** `period_view(horizon: Horizon, ..)`; the other two views take `&str`.
**How to avoid:** Parse with `.parse::<Horizon>().map_err(TodoError::Validation)?` in the `period` adapter only. Do NOT change the service signature.
**Warning sign:** Temptation to "make all three views take strings for consistency" — that pushes parsing into the service redundantly; leave it.

### Pitfall 3: Missing-query-param rejection is not byte-identical to CLI
**What goes wrong:** SC3 test asserts identical rejection bodies for an omitted param and fails — axum's `QueryRejection` body ≠ clap's usage error.
**Why:** Different frameworks own the "required input absent" error before the service is reached.
**How to avoid:** For *omitted required inputs*, assert only that both surfaces reject (HTTP 4xx / non-zero exit). For *present-but-invalid* inputs (bad horizon, junk date), the request reaches the service and both yield `TodoError::Validation` ⇒ 400 / exit 2 with the same `detail`/stderr substring — assert those for true parity. Prefer present-but-invalid cases for the strict-parity rejection tests.

### Pitfall 4: Using `render_items` for the new views
**What goes wrong:** New view emits Markdown, violating D-01 and breaking JSON consumers.
**Why:** `cli/views.rs` already imports `render_items` for `list`/`today`/`pending`.
**How to avoid:** New view handlers call `print_json`, not `render_items`. Test asserts stdout parses as JSON.

### Pitfall 5: Forgetting the `command_label()` match arm
**What goes wrong:** Compile error (exhaustive match) — caught at build, but surprises planners who think the dispatch arm is enough.
**How to avoid:** Each new `Command` variant needs an arm in both `run()` dispatch (`:310`) and `command_label()` (`:368`). List both as steps.

## Code Examples

All examples above are derived directly from the live code at the cited file:line anchors (`cli/create.rs:32` `project_propose`; `api/handlers.rs:73` `propose_project`, `:141` `list_items`; `cli/output.rs:5` `print_json`). They are copy-adaptable. No external/Context7 lookup was needed — the in-repo precedents are authoritative `[VERIFIED: codebase]`.

## State of the Art

Not applicable — no fast-moving external technology. The patterns (clap derive subcommands, axum `Query`/`Json` extractors) are stable and already pinned in the workspace.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Serializing the service return value directly (`Vec<TodoItem>` for date views, `PeriodView` for period) is the desired JSON envelope (no wrapper object). | Summary / Discretion | Low — D-discretion explicitly allows the planner to choose the envelope; if a wrapper is wanted, both surfaces add the same wrapper. Either way parity holds. |
| A2 | The `period` CLI flag is `--period <date>` and the `agenda`/`date-range` dates are positional (`agenda <date>`, `date-range <from> <to>`). | Patterns 2 | Low — CONTEXT D-03/D-04 + Specific Ideas lock `--horizon`/`--period` flags for `period`; positional vs flag for agenda/date-range dates is not explicitly locked. Positional mirrors `event propose <title> <scheduled>` precedent; planner may make them flags without affecting parity. |
| A3 | `/views/date-range` route uses literal `date-range` (hyphen) matching the CLI `date-range` command name. | Pattern 4 | Low — D-10 names it `/views/date-range`; cosmetic only. |

*All three are LOW-risk and fall inside the locked "Claude's Discretion" envelope. No assumption touches policy, security, or data.*

## Open Questions

1. **View response envelope: bare value vs `{"data": …}` wrapper?**
   - What we know: D-discretion allows any shape as long as CLI and API match; serializing the raw service return is simplest and makes SC3 byte-comparison trivial.
   - What's unclear: whether the project wants a consistent top-level envelope for future API ergonomics.
   - Recommendation: emit the bare value both sides (Pattern 2/4). Revisit only if a frontend later needs an envelope (out of scope now).

2. **Strict-parity rejection cases for SC3 — which inputs?**
   - What we know: present-but-invalid inputs (bad horizon, junk date, non-Goal parent) reach the service and reject identically (exit 2 / 400, same `detail`). Missing required inputs reject differently per framework (Pitfall 3).
   - Recommendation: build SC3 rejection-parity tests on present-but-invalid inputs; cover missing-input rejection only as "both reject" (class assertion), not body-identical.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Rust toolchain (2024 edition) | build/test | ✓ (project builds today; 16 plans completed) | per workspace | — |
| `cargo` | build/test/fmt/clippy | ✓ | per workspace | — |

All test crates (`assert_cmd`, `predicates`, `tower`, `http`, `http_body_util`, `tempfile`) are already dev-dependencies (used by existing `tests/e2e/{cli,api}.rs`). No new dependency to install. No external service required (API e2e drives `router(..)` in-process via `oneshot`; CLI e2e via `Command::cargo_bin`).

**Known pre-existing failure (out of scope, logged in STATE/deferred-items):** one CLI dotenv e2e test (`init_loads_todo_engine_home_from_dotenv`) fails because `init` resolves the default home rather than the `.env` `TODO_ENGINE_HOME`. This is unrelated to Phase 5; the planner should NOT try to fix it here, but should be aware the e2e suite has one known-red test so "all green" gates must scope to the relevant/new tests.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Rust built-in `#[test]` / `#[tokio::test]`; CLI e2e via `assert_cmd`+`predicates`; API e2e via `tower::ServiceExt::oneshot` |
| Config file | none (Cargo test harness); three test binaries: `tests/unit.rs`, `tests/integration.rs`, `tests/e2e.rs` |
| Quick run command | `cargo test --test e2e` (the surface tests this phase adds) |
| Full suite command | `cargo test` (workspace root) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SURF-01 | CLI `goal propose` returns proposed goal JSON | e2e (CLI) | `cargo test --test e2e cli` | ✅ (extend `tests/e2e/cli.rs`) |
| SURF-01 | CLI `agenda`/`date-range`/`period` emit JSON | e2e (CLI) | `cargo test --test e2e cli` | ✅ extend |
| SURF-01 | CLI `update --parent-id` links task to goal | e2e (CLI) | `cargo test --test e2e cli` | ✅ extend |
| SURF-02 | API `POST /goals/propose` mirrors CLI | e2e (API) | `cargo test --test e2e api` | ✅ (extend `tests/e2e/api.rs`) |
| SURF-02 | API `GET /views/{agenda,date-range,period}` | e2e (API) | `cargo test --test e2e api` | ✅ extend |
| SURF-02 | API `PATCH /items/:id {parent_id}` links | e2e (API) | `cargo test --test e2e api` | ✅ extend |
| SC3 | CLI+API yield same item state AND same rejections (paired) | e2e (both) | `cargo test --test e2e` | ✅ pattern exists (`task_propose_and_items_use_same_service_path` is the closest precedent) |
| SC4 | Agent-created goal (either surface) starts `proposed` | e2e (both) | `cargo test --test e2e` | ✅ assert `status == "proposed"` / `proposed_by == "agent"` |

### Sampling Rate
- **Per task commit:** `cargo test --test e2e` (+ `cargo fmt --check`, `cargo clippy --all-targets --all-features -- -D warnings`).
- **Per wave merge:** `cargo test` (full suite, scoped against the one known-red dotenv test).
- **Phase gate:** full suite green (modulo the documented pre-existing dotenv failure) before `/gsd-verify-work`.

### Wave 0 Gaps
- None — `tests/e2e/{cli,api}.rs` already exist with the exact harness needed (`TestHome`, `Command::cargo_bin`, `router(..)` + `oneshot`, `json_request`/`empty_request`/`body_json` helpers). New tests are added as `#[test]`/`#[tokio::test]` fns in those files. No new fixture/config/framework install required.
- **SC3 parity helper (optional):** there is no shared "run-CLI-and-API-and-compare" helper today; existing tests assert each surface independently against the same service path. The planner may add a small comparison helper in `tests/e2e/` or assert independently in both files. Either satisfies SC3; independent assertion matches the current idiom (`task_propose_and_items_use_same_service_path`).

## Security Domain

`security_enforcement: true`, ASVS level 1. This phase adds input-handling surface (CLI args, HTTP query/body), so V5 applies; no auth/session/crypto is introduced.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Engine is local-first, no auth layer (unchanged). |
| V3 Session Management | no | No sessions. |
| V4 Access Control | no | No authorization model in v1; approval gating is a workflow state, enforced in the service. |
| V5 Input Validation | yes | All new inputs (horizon, dates, ids, parent_id) validated in the service (`parse_day`, `Horizon::from_str`, `validate_goal_anchor`, `ensure_relation`). Adapters pass through; SQLite access is parameterized (`?` binds, verified in repo CTE work). |
| V6 Cryptography | no | None introduced. |

### Known Threat Patterns for Rust CLI + axum API over SQLite
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SQL injection via view/link params | Tampering | All persistence is parameterized `rusqlite` binds (no string interpolation) — verified in prior phases; this phase adds no SQL. |
| Approval-gating bypass via API | Elevation of Privilege | `parse_actor_or_default` defaults `Agent` ⇒ goals start `proposed`; SC4 test proves an API-created goal cannot start `active`. Adapters cannot set status. |
| Unbounded recursion via cyclic `parent_id` (period view) | Denial of Service | Already mitigated in `queries.rs` (`visited` set + `MAX_GOAL_DEPTH` cap, anomaly_count, never errors). This phase only exposes it; no new DoS surface. |
| Oversized/malformed JSON body | DoS / Tampering | axum `JsonRejection` → `validation_rejection` ⇒ 400 (existing pattern, reused). |

No new threat surface beyond input validation, which is delegated to the already-tested service layer.

## Sources

### Primary (HIGH confidence)
- `[VERIFIED: codebase]` `todo-engine/src/interfaces/cli/mod.rs` — `Command` enum, `{ Propose }` groups, `UpdateArgs`, dispatch + `command_label`, `parse_actor`.
- `[VERIFIED: codebase]` `todo-engine/src/interfaces/cli/{create,views,output,markdown}.rs` — handler shapes, `print_json`, `render_items`.
- `[VERIFIED: codebase]` `todo-engine/src/interfaces/api/{mod,handlers,dto}.rs` — router, `with_service`, `parse_actor_or_default`, `update_item` hardcoded `parent_id: None`, `ApiError` status mapping.
- `[VERIFIED: codebase]` `todo-engine/src/application/service/{creation,update,queries,goal,mod}.rs` — `propose_goal`/`ProposeGoal`, `update_item`/`UpdateItem`, `agenda`/`date_range`/`period_view`, `PeriodView`/`GoalNode`, re-exports.
- `[VERIFIED: codebase]` `todo-engine/src/domain/horizon.rs` — `Horizon` enum + `FromStr` + `is_coarser_than`, `normalize_to_period_start`.
- `[VERIFIED: codebase]` `todo-engine/src/application/error.rs` — `TodoError` exit-code / HTTP-status mapping.
- `[VERIFIED: codebase]` `todo-engine/tests/e2e/{cli,api}.rs`, `tests/e2e.rs`, `tests/support/mod.rs` — e2e harness and assertion idioms.

### Secondary (MEDIUM confidence)
- `[CITED: .planning/phases/05-.../05-CONTEXT.md]` — locked decisions D-01..D-11 (authoritative for scope).
- `[CITED: .planning/REQUIREMENTS.md]`, `[CITED: .planning/STATE.md]` — requirement IDs, accumulated decisions.

### Tertiary (LOW confidence)
- None. All claims are codebase-verified or CONTEXT-cited.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new deps; all crates verified in live interface/test code.
- Architecture: HIGH — every pattern has an in-repo precedent read line-by-line.
- Pitfalls: HIGH — drawn from concrete code facts (hardcoded `parent_id: None`, `Horizon` vs `&str`, axum vs clap rejection paths).
- Anchor corrections: HIGH — verified by grep + direct reads.

**Research date:** 2026-06-26
**Valid until:** 2026-07-26 (stable internal codebase; re-verify only if `cli/`, `api/`, or `service/` files change before planning).
