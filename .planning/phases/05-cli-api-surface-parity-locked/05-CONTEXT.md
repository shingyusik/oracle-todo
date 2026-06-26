# Phase 5: CLI + API Surface (parity-locked) - Context

**Gathered:** 2026-06-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Expose the already-built planning layer (goal create, task→goal link, date view, period view) over **both** the `clap` CLI and the `axum` HTTP API. The service layer is complete (Phase 2–4: `propose_goal`, `update_item` parent-linking, `agenda`, `date_range`, `period_view`); this phase adds only thin adapter surface. CLI and API must be provably in parity — both call the identical `TodoService` methods, with no policy or view logic re-implemented in handlers (CORE-03, already satisfied at the service layer).

In scope: new CLI subcommands + HTTP endpoints for goal-create, task-link, and the three views; paired e2e CLI+API tests; approval-gating verification across both surfaces.
Out of scope: any new service/domain logic, frontend, new view capabilities, Markdown rendering of the new views (see D-01).

</domain>

<decisions>
## Implementation Decisions

### Output format (CLI)
- **D-01:** New `date`/`period` view commands output **JSON only** (default and only format). No Markdown toggle. Rationale: this engine targets agent workflows (agents consume JSON); a Markdown renderer for the new views is unneeded weight. Reuse `cli/output.rs::print_json`.
- **D-02:** This **relaxes SC1 / SURF-01**, which read "Markdown + JSON output." The ROADMAP Phase 5 SC1 and REQUIREMENTS SURF-01 wording are updated from "Markdown + JSON" → "JSON" as part of this discussion. Existing Markdown view commands (`list`/`today`/`pending`) are untouched.

### View command structure (CLI)
- **D-03:** Period view = a single command `period --horizon <week|month|year> --period <date>`, mapping 1:1 to `period_view(horizon, period)`. Not split into `week`/`month`/`year` subcommands.
- **D-04:** Date view = two commands, `agenda <date>` and `date-range <from> <to>`, mapping 1:1 to the `agenda` and `date_range` service methods.
- **D-05:** All three are **flat top-level** commands (consistent with existing `today`/`pending`/`list`), not under a `view` subgroup.

### Goal create & task link (CLI)
- **D-06:** Goal creation = a grouped subcommand `goal propose <title> --horizon <week|month|year> --scheduled <date> [--parent <id>] [--actor]`, mirroring the existing `task`/`project` `{ Propose }` group pattern; calls `propose_goal`. Goal status transitions reuse the existing generic `approve`/`activate`/etc. commands (they operate on any item id) — no goal-specific transition commands.
- **D-07:** Task→goal linking (LINK-01/LINK-02) reuses the existing `update` command: add `--parent-id <goal>` to `UpdateArgs` (Phase 2 explicitly deferred this CLI wiring); `--scheduled` already exists. Routes through the audited `update_item` path — no new bespoke command.

### API routes
- **D-08:** Goal creation = `POST /goals/propose`, mirroring `/tasks/propose` and `/projects/propose`. Preserves the propose pattern and the `parse_actor_or_default` (default `Agent`) approval-gating entry.
- **D-09:** Task→goal linking reuses the existing `PATCH /items/:id` (`update_item`) endpoint — add `parent_id` to the update DTO (`api/dto.rs`). No new endpoint.
- **D-10:** View endpoints grouped under a `/views/*` prefix: `GET /views/agenda`, `GET /views/date-range`, `GET /views/period`.
- **D-11:** View arguments passed as **query strings**: `?date=`, `?from=&to=`, `?horizon=&period=` — standard for GET reads, simple `axum::extract::Query` binding.

### Approval gating (SC4) — confirmed, not a decision
- CLI and API both default `actor = agent` (CLI `#[arg(default_value = "agent")]`; API `parse_actor_or_default`). Agent-created goals via either surface start `Proposed` and require approval. SC4 is satisfied by the existing default; the phase's job is to **prove** it with paired tests, not to add gating.

### Claude's Discretion
- JSON serialization shape of view outputs: reuse the existing `PeriodView`/`GoalNode` serde types in `queries.rs` and the date-view serde shapes — not re-invented.
- Error responses: existing `TodoError` → CLI exit code / HTTP status mapping covers invalid horizon/date (Validation → exit 2 / HTTP 400). No new error surface.
- Exact JSON field names / wrapper envelope for view responses, within the parity constraint.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase requirements & scope (SC1/SURF-01 relaxation lives here)
- `.planning/REQUIREMENTS.md` §Surface — SURF-01 (CLI subcommands), SURF-02 (API mirror), CORE-03 (view logic in service). SURF-01 reworded to JSON-only per D-02.
- `.planning/ROADMAP.md` §"Phase 5: CLI + API Surface (parity-locked)" — goal + 4 success criteria; SC1 reworded to JSON-only per D-02.
- `.planning/PROJECT.md` §Active — "CLI subcommands for creating goals, linking tasks, and the date/period views"; "HTTP API endpoints mirroring the new CLI/service behavior."

### Surface conventions (the patterns to mirror)
- `docs/operations/cli-reference.md` — full existing CLI surface + output convention.
- `docs/operations/api-reference.md` — full existing API surface + route convention.
- `todo-engine/src/interfaces/cli/mod.rs` — `Command` enum (`:35`), grouped `{ Propose }` arg structs, `UpdateArgs` (`:260`, has `scheduled`, lacks `parent_id`), `parse_actor` + `default_value = "agent"`.
- `todo-engine/src/interfaces/api/mod.rs` — `router` (`:28–49`) propose/items routes, `patch(update_item)` at `/items/:id` (`:40`), `parse_actor_or_default` (`:103`).
- `todo-engine/src/interfaces/cli/create.rs` / `views.rs` / `output.rs` — `print_json`, `render_items`, propose handler shape.
- `todo-engine/src/interfaces/api/dto.rs` / `handlers.rs` — request DTOs + handler shape (update DTO gains `parent_id` per D-09).

### Service methods to call (no re-implementation)
- `todo-engine/src/application/service/queries.rs` — `period_view(horizon, period)`, `agenda(date)`, `date_range(from, to)`, plus the `PeriodView`/`GoalNode` serde view types to serialize.
- `todo-engine/src/application/service/goal.rs` — `propose_goal` (goal-create policy).
- `todo-engine/src/application/service/update.rs` — `update_item` (parent-link path).

### Policy / status semantics
- `docs/architecture/decisions/` — ADR-0006 (Goal reuses `ItemStatus`; `active` for its period; no cascade), ADR on actor/approval gating.
- `docs/conventions/{code-style,error-handling}.md` — `TodoError` → exit/status mapping; no-panic policy.

### Test parity (SC3)
- `todo-engine/tests/e2e/{cli,api}.rs` — existing paired e2e structure to extend; both surfaces must yield the same item state and the same rejections.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `cli/output.rs::print_json` — the JSON-line printer for all new view + goal-create command output (D-01).
- Grouped `{ Propose }` subcommand pattern (`task`/`project`/`routine`/`event`) — clone for `goal propose` (D-06).
- `update_item` audited mutation path — already wired for `parent_id` at the service layer (Phase 2); CLI/API just expose it (D-07/D-09).
- `POST /{type}s/propose` route pattern + `parse_actor_or_default` (default `Agent`) — clone for `/goals/propose` (D-08), preserves approval gating.
- `PATCH /items/:id` (`update_item`) endpoint — already exists; only the DTO needs a `parent_id` field (D-09).
- `period_view` / `agenda` / `date_range` service methods + `PeriodView`/`GoalNode` serde types — serialize directly, no view logic in adapters.

### Established Patterns
- **Output split convention:** mutation commands → `print_json`; legacy view commands (`list`/`today`/`pending`) → `render_items` (Markdown). New views deliberately deviate to JSON-only (D-01) — they do NOT add Markdown.
- **Actor default = agent** on every CLI propose arg and the API default — drives approval gating (SC4).
- **Parity is structural:** adapters call one service method; e2e `tests/e2e/{cli,api}.rs` assert CLI and API agree on state + rejections.
- **Additive, no policy in adapters** (CORE-01/CORE-03): no new validation or state-machine logic in `cli/` or `api/`.

### Integration Points
- `cli/mod.rs` — add `Goal { Propose }` variant + `period`/`agenda`/`date-range` variants to `Command`; add `--parent-id` to `UpdateArgs`; wire dispatch.
- `cli/create.rs` — add `goal_propose` handler; `cli/views.rs` — add `agenda`/`date_range`/`period` handlers (JSON via `print_json`).
- `api/mod.rs` — add `/goals/propose` + `/views/{agenda,date-range,period}` routes; `api/handlers.rs` — handlers; `api/dto.rs` — goal-propose DTO + `parent_id` on update DTO.

</code_context>

<specifics>
## Specific Ideas

- Period command flag spelling locked: `period --horizon <week|month|year> --period <date>` (mirrors `period_view(horizon, period)` exactly).
- View query params locked: `agenda?date=`, `date-range?from=&to=`, `period?horizon=&period=`.

</specifics>

<deferred>
## Deferred Ideas

- **Markdown rendering of date/period views** — dropped from v1 per D-01/D-02 (JSON-only). If a human-facing Markdown view is wanted later, add a `--format`/`--json` toggle and a `render_*` function then; out of scope now.

None other — discussion stayed within phase scope.

</deferred>

---

*Phase: 5-CLI + API Surface (parity-locked)*
*Context gathered: 2026-06-26*
