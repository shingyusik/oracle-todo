# Direct Active Status Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the `proposed` and `approved` lifecycle from storage, service, CLI, API, and frontend so every newly created item is truthfully `active`, while requiring complete Project and Routine creation input.

**Architecture:** Keep SQLite and `TodoService` as the policy boundary. First make creation and recurrence behavior active-first, then migrate legacy rows before deleting the old enum variants and transition surfaces; finally remove frontend status aliases and follow-up activation requests. Preserve legacy provenance columns and creation route names for compatibility.

**Tech Stack:** Rust 2024, rusqlite, axum, clap, Next.js/React, TypeScript, Vitest, Testing Library.

---

## File map

- `todo-engine/src/domain/model.rs`: construct every item in `active` and stop populating approval markers.
- `todo-engine/src/domain/status.rs`: define the reduced status enum and active-only open set.
- `todo-engine/src/application/service/creation.rs`: require Project DoD and Routine recurrence at the service boundary.
- `todo-engine/src/application/service/{transitions,materialization}.rs`: remove approval transitions and keep generated routine tasks active/waiting.
- `todo-engine/src/infrastructure/sqlite/schema.rs`: normalize legacy stored statuses during additive schema initialization.
- `todo-engine/src/interfaces/{cli,api}/`: remove approval/activation commands and routes while preserving creation names.
- `frontend/src/features/workbench/model/`: remove approval transition types and planner grouping labels; add creation payload fields.
- `frontend/src/features/workbench/hooks/useWorkbenchController.ts`: send complete create requests and stop calling `/activate`.
- `frontend/src/features/workbench/ui/MainPanel.tsx`: show conditional required inputs, inline errors, and stored statuses without aliases.
- `todo-engine/tests/` and `frontend/src/**/*.spec.*`: lock domain, migration, adapter, and presentation behavior.
- `README.md`, `AGENTS.md`, and current-state files under `docs/`: describe the direct-active lifecycle; retain the old ADR as superseded history.

### Task 1: Make service-layer creation complete and active-first

**Files:**
- Modify: `todo-engine/src/domain/model.rs`
- Modify: `todo-engine/src/application/service/creation.rs`
- Test: `todo-engine/tests/unit/model.rs`
- Test: `todo-engine/tests/integration/service_policy.rs`
- Test: `todo-engine/tests/integration/goal_policy.rs`

- [ ] **Step 1: Replace actor-dependent constructor tests with active-first assertions**

In `todo-engine/tests/unit/model.rs`, replace the user-auto-approved and agent-proposed cases with a table-driven test that calls `TodoItem::new` for `Actor::User` and `Actor::Agent`, then asserts:

```rust
assert_eq!(item.status, ItemStatus::Active);
assert_eq!(item.proposed_by, actor);
assert_eq!(item.approved_by, None);
assert_eq!(item.approved_at, None);
```

Keep `proposed_by` as historical creator provenance; do not reinterpret it as an authorization gate.

- [ ] **Step 2: Add failing service-policy tests for required creation content**

In `todo-engine/tests/integration/service_policy.rs`, add tests that submit both `None` and whitespace-only values and assert the exact policy messages:

```rust
assert_eq!(
    error.to_string(),
    "Project requires definition_of_done"
);
assert_eq!(
    error.to_string(),
    "Routine requires recurrence_rule"
);
```

Also add successful cases proving a Project with `"  Ship when tests pass  "` stores `Some("Ship when tests pass")`, a Routine with `"  RRULE:FREQ=DAILY  "` stores the trimmed rule, and both statuses are `ItemStatus::Active` for user and agent actors.

- [ ] **Step 3: Run the focused tests and confirm the old behavior fails**

Run:

```powershell
cargo test -p todo-engine --test unit model:: -- --nocapture
cargo test -p todo-engine --test integration service_policy:: -- --nocapture
```

Expected: constructor assertions report `approved`/`proposed`, and missing Project/Routine fields are currently accepted.

- [ ] **Step 4: Change the domain constructor to create active items**

In `TodoItem::new` in `todo-engine/src/domain/model.rs`, remove the actor-based `approved` calculation and initialize these fields exactly:

```rust
status: ItemStatus::Active,
proposed_by: actor,
approved_by: None,
approved_at: None,
```

Leave the legacy fields in `TodoItem`; they still match the additive SQLite schema.

- [ ] **Step 5: Enforce Project definition at the service boundary**

At the beginning of `TodoService::propose_project` in `todo-engine/src/application/service/creation.rs`, normalize before constructing or storing an item:

```rust
let definition_of_done = request
    .definition_of_done
    .map(|value| value.trim().to_owned())
    .filter(|value| !value.is_empty())
    .ok_or_else(|| TodoError::Policy("Project requires definition_of_done".to_owned()))?;
```

Assign `Some(definition_of_done)` to the item. Do not add defaults for old records.

- [ ] **Step 6: Enforce and parse Routine recurrence at the service boundary**

At the beginning of `TodoService::propose_routine`, normalize the request and validate support using the existing recurrence parser:

```rust
let recurrence_rule = request
    .recurrence_rule
    .map(|value| value.trim().to_owned())
    .filter(|value| !value.is_empty())
    .ok_or_else(|| TodoError::Policy("Routine requires recurrence_rule".to_owned()))?;

recurrence_occurrences(
    &recurrence_rule,
    now.date(),
    now.date().previous_day().unwrap_or(time::Date::MIN),
    1,
)
.map_err(|error| {
    TodoError::Policy(format!("Unsupported recurrence_rule: {}", error.rule()))
})?;
```

Import `future_occurrences as recurrence_occurrences` from `crate::domain` so it cannot be shadowed by the existing numeric `future_occurrences` local. Obtain the service's existing clock value as `now` before the parser call, retain existing materialization-policy validation, and store `Some(recurrence_rule)`.

- [ ] **Step 7: Repair creation fixtures to provide newly required values**

Update Project requests in `service_policy.rs` and `goal_policy.rs` to use:

```rust
definition_of_done: Some("Done when verified".to_owned()),
```

Update Routine requests to use:

```rust
recurrence_rule: Some("RRULE:FREQ=DAILY".to_owned()),
```

Change actor-status expectations in `goal_policy.rs` from proposed/approved to active without weakening the existing goal-policy assertions.

- [ ] **Step 8: Run focused and complete Rust tests**

Run:

```powershell
cargo test -p todo-engine --test unit model::
cargo test -p todo-engine --test integration service_policy::
cargo test -p todo-engine --test integration goal_policy::
cargo test -p todo-engine
```

Expected: all commands pass; if unrelated fixtures omit DoD or recurrence, update those request builders with the exact valid values above and rerun the failing binary.

- [ ] **Step 9: Commit the active-first creation policy**

```powershell
git add docs/superpowers/plans/2026-07-16-remove-proposed-approved-status.md todo-engine/src/domain/model.rs todo-engine/src/application/service/creation.rs todo-engine/tests/unit/model.rs todo-engine/tests/integration/service_policy.rs todo-engine/tests/integration/goal_policy.rs
git commit -m "[UPDATE] Create complete items as active"
```

### Task 2: Normalize legacy rows and generated routine tasks

**Files:**
- Modify: `todo-engine/src/infrastructure/sqlite/schema.rs`
- Modify: `todo-engine/src/application/service/materialization.rs`
- Modify: `todo-engine/src/application/service/transitions.rs`
- Modify: `todo-engine/src/interfaces/cli/markdown.rs`
- Test: `todo-engine/tests/integration/repository.rs`
- Test: `todo-engine/tests/integration/date_view.rs`
- Test: `todo-engine/tests/integration/period_view.rs`
- Test: `todo-engine/tests/integration/service_policy.rs`

- [ ] **Step 1: Add an idempotent migration integration test**

In `todo-engine/tests/integration/repository.rs`, initialize a temporary repository, insert two raw item rows with statuses `proposed` and `approved`, call `init_schema()` again, and query through raw SQL to assert both statuses are `active`. Call `init_schema()` a third time and repeat the same assertion so the test proves idempotence.

Use two distinct IDs and this final check:

```rust
let statuses: Vec<String> = statement
    .query_map([], |row| row.get(0))?
    .collect::<Result<_, _>>()?;
assert_eq!(statuses, vec!["active", "active"]);
```

Do not decode the legacy values through `ItemStatus`; the migration must occur first.

- [ ] **Step 2: Add routine cascade and materialization expectations**

In `service_policy.rs`, assert a materialized generated task starts `ItemStatus::Active`, pausing its Routine moves it to `Waiting`, and resuming the Routine returns it to `Active`. In `date_view.rs` and `period_view.rs`, remove approval/activation setup and assert newly created relevant items enter the views directly.

- [ ] **Step 3: Run the focused tests and verify they fail**

Run:

```powershell
cargo test -p todo-engine --test integration repository::init_schema_migrates_legacy_open_statuses
cargo test -p todo-engine --test integration service_policy:: -- --nocapture
```

Expected: raw statuses remain unchanged, generated tasks are approved, or resume returns them to approved.

- [ ] **Step 4: Add the schema normalization before item decoding can occur**

In `init_schema_inner` in `todo-engine/src/infrastructure/sqlite/schema.rs`, immediately after `ensure_item_columns(conn)?`, execute:

```rust
conn.execute(
    "UPDATE items SET status = 'active' WHERE status IN ('proposed', 'approved')",
    [],
)
.map_err(storage_error)?;
```

Keep `PRAGMA user_version=1`, the existing transaction, and every provenance column unchanged.

- [ ] **Step 5: Make generated and resumed Routine tasks active**

In `materialization.rs`, delete the explicit `ItemStatus::Approved` assignment and approval-marker writes from generated task construction; `TodoItem::new_task` now supplies `Active`. In `transitions.rs`, change the Routine resume cascade target from `ItemStatus::Approved` to `ItemStatus::Active`.

- [ ] **Step 6: Make the pending convenience view active-only**

In `todo-engine/src/interfaces/cli/markdown.rs`, change the `pending_items` filter to:

```rust
.filter(|item| item.status == ItemStatus::Active)
```

Retain the command and its rendering format.

- [ ] **Step 7: Update repository and view fixtures without masking migration coverage**

Change the legacy actor compatibility test's inserted status from `proposed` to `active`; its purpose is actor decoding, while the new migration test owns legacy status coverage. Remove all `service.approve(...)` and `service.activate(...)` setup calls from `date_view.rs` and `period_view.rs`.

- [ ] **Step 8: Run integration and full Rust tests**

```powershell
cargo test -p todo-engine --test integration
cargo test -p todo-engine
```

Expected: all tests pass and running schema initialization repeatedly leaves every migrated row active.

- [ ] **Step 9: Commit migration and routine behavior**

```powershell
git add todo-engine/src/infrastructure/sqlite/schema.rs todo-engine/src/application/service/materialization.rs todo-engine/src/application/service/transitions.rs todo-engine/src/interfaces/cli/markdown.rs todo-engine/tests/integration/repository.rs todo-engine/tests/integration/date_view.rs todo-engine/tests/integration/period_view.rs todo-engine/tests/integration/service_policy.rs
git commit -m "[UPDATE] Normalize open work to active"
```

### Task 3: Remove approval lifecycle from Rust domain, CLI, and API

**Files:**
- Modify: `todo-engine/src/domain/status.rs`
- Modify: `todo-engine/src/application/service/transitions.rs`
- Modify: `todo-engine/src/interfaces/cli/mod.rs`
- Modify: `todo-engine/src/interfaces/cli/lifecycle.rs`
- Modify: `todo-engine/src/interfaces/api/mod.rs`
- Modify: `todo-engine/src/interfaces/api/handlers.rs`
- Test: `todo-engine/tests/unit/status.rs`
- Test: `todo-engine/tests/e2e/cli.rs`
- Test: `todo-engine/tests/e2e/api.rs`

- [ ] **Step 1: Define failing reduced-status tests**

In `todo-engine/tests/unit/status.rs`, set the expected status strings to exactly:

```rust
[
    "active", "waiting", "paused", "completed", "cancelled",
    "dropped", "archived", "someday", "rejected",
]
```

Add explicit assertions that both legacy strings fail parsing:

```rust
assert!(ItemStatus::from_str("proposed").is_err());
assert!(ItemStatus::from_str("approved").is_err());
```

- [ ] **Step 2: Add adapter tests for removed transitions and direct-active creation**

In `todo-engine/tests/e2e/cli.rs`, assert `approve` and `activate` are unrecognized subcommands. Update creation assertions to `status: active`, and supply `--definition-of-done "Done when verified"` to every Project creation and `--recurrence-rule "RRULE:FREQ=DAILY"` to every Routine creation.

In `todo-engine/tests/e2e/api.rs`, assert `POST /items/{id}/approve` and `POST /items/{id}/activate` return `404`, replace approval lifecycle requests with direct active assertions, and expect materialized tasks to be active. Add create-validation cases that assert HTTP `400` and exact JSON detail for omitted/blank Project DoD and Routine recurrence.

- [ ] **Step 3: Run the new status and adapter tests to prove the old surfaces remain**

```powershell
cargo test -p todo-engine --test unit status::
cargo test -p todo-engine --test e2e cli:: -- --nocapture
cargo test -p todo-engine --test e2e api:: -- --nocapture
```

Expected: legacy statuses still parse and the old commands/routes still exist.

- [ ] **Step 4: Reduce `ItemStatus` and the open status set**

In `todo-engine/src/domain/status.rs`, delete `Proposed` and `Approved` from the enum, `as_str`, and `FromStr` match arms. Replace the open set with:

```rust
pub const OPEN_STATUSES: [ItemStatus; 1] = [ItemStatus::Active];
```

Do not change terminal or deferred statuses.

- [ ] **Step 5: Delete service approval transitions**

Remove `TodoService::approve` and `TodoService::activate` from `transitions.rs`. Remove imports that were used only by those methods, but retain recurrence validation in create, resume, and materialize paths.

- [ ] **Step 6: Delete CLI approval commands and dispatch code**

From `todo-engine/src/interfaces/cli/mod.rs`, remove `Command::Approve`, `Command::Activate`, their dispatch arms, command-label arms, and `proposed`/`approved` from the status parser's accepted-value message. From `cli/lifecycle.rs`, remove the `approve` and `activate` functions.

- [ ] **Step 7: Delete API approval routes and handlers**

From `todo-engine/src/interfaces/api/mod.rs`, remove:

```rust
.route("/items/:id/approve", post(handlers::approve_item))
.route("/items/:id/activate", post(handlers::activate_item))
```

Remove `approve_item` and `activate_item` from `handlers.rs`. Preserve every `/propose` creation route and its DTO.

- [ ] **Step 8: Mechanically update remaining Rust fixtures**

Run `rg -n "Proposed|Approved|\.approve\(|\.activate\(|/approve|/activate" todo-engine` and resolve every non-migration hit as follows: creation expectations become `Active`; lifecycle setup calls are deleted; the migration SQL and its raw test keep lowercase legacy strings. Replace any missing-item API test that used `/approve` with an existing route such as `/items/missing/pause` so 404 error-envelope coverage remains meaningful.

- [ ] **Step 9: Run all Rust quality gates**

```powershell
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test
cargo build
```

Expected: all commands exit 0. `rg -n "ItemStatus::(Proposed|Approved)|Command::(Approve|Activate)" todo-engine` returns no matches.

- [ ] **Step 10: Commit the reduced Rust lifecycle**

```powershell
git add todo-engine/src todo-engine/tests
git commit -m "[BREAKING] Remove approval lifecycle surfaces"
```

### Task 4: Add complete Project and Routine creation fields to the frontend

**Files:**
- Modify: `frontend/src/features/workbench/model/workbench-model.ts`
- Modify: `frontend/src/features/workbench/hooks/useWorkbenchController.ts`
- Modify: `frontend/src/features/workbench/ui/MainPanel.tsx`
- Test: `frontend/src/features/workbench/ui/workbench-wireframe.spec.tsx`
- Test: `frontend/src/features/workbench/hooks/use-workbench-controller.spec.tsx`

- [ ] **Step 1: Add presentation tests for conditional creation fields**

In `workbench-wireframe.spec.tsx`, add a Project New-dialog test that verifies `Definition of Done` is present, clears it, clicks Create, sees:

```tsx
expect(screen.getByRole("alert")).toHaveTextContent(
  "Project requires definition_of_done",
);
```

and observes no fetch. Then enter `Done when verified`, create, and assert the request body includes:

```ts
{ title: "Project title", actor: "user", definition_of_done: "Done when verified" }
```

Add a Routine test that opens New, verifies the recurrence preview is `RRULE:FREQ=DAILY`, submits, and asserts that exact `recurrence_rule` is in the body. Clear the rule through the recurrence controls and assert `Routine requires recurrence_rule` keeps the dialog open.

- [ ] **Step 2: Add controller tests proving creation is one request**

In `use-workbench-controller.spec.tsx`, create a Task, Event, Project, and Routine using mocked active API responses. Assert each flow sends one creation request and that no captured URL ends with `/activate`. Assert Project and Routine bodies carry their required values.

- [ ] **Step 3: Run the focused frontend tests and verify they fail**

```powershell
npm --prefix frontend test -- src/features/workbench/ui/workbench-wireframe.spec.tsx src/features/workbench/hooks/use-workbench-controller.spec.tsx
```

Expected: the New dialog lacks the fields and the controller still performs activation follow-ups.

- [ ] **Step 4: Extend the creation form type**

In `frontend/src/features/workbench/model/workbench-model.ts`, add:

```ts
definition_of_done?: string;
recurrence_rule?: string;
```

to `CreateWorkspaceItemForm`. Do not make them globally required because they are conditional on item type.

- [ ] **Step 5: Send complete creation bodies and remove follow-up activation**

In `createItemRequest` in `useWorkbenchController.ts`:

- include `definition_of_done: form.definition_of_done` in Project bodies;
- include `recurrence_rule: form.recurrence_rule` in Routine bodies, including planner Routine creation;
- return the item from the create request for Tasks and Events without chaining activation;
- delete `activateIfNeeded` and every `/activate` call.

Preserve the existing creation endpoint names and cache/update behavior.

- [ ] **Step 6: Add conditional dialog state, validation, and controls**

In `CreationDialog` in `MainPanel.tsx`, initialize:

```ts
const [definitionOfDone, setDefinitionOfDone] = useState("");
const [recurrenceRule, setRecurrenceRule] = useState("RRULE:FREQ=DAILY");
```

Derive Project/Routine selection from the dedicated panel or planner `itemType`. Before setting submitting state, trim the applicable value and set exactly one of these existing inline errors:

```ts
setSubmitError("Project requires definition_of_done");
setSubmitError("Routine requires recurrence_rule");
```

Return immediately so the dialog stays open and no request is sent. Render the existing text-field pattern labeled `Definition of Done` for Projects and reuse `RecurrenceRuleField` for Routines. Pass the trimmed conditional values to `createWorkspaceItem`. Keep API failures routed through the existing `submitError` element with `role="alert"`; do not add a modal or browser alert.

- [ ] **Step 7: Run frontend tests and typecheck**

```powershell
npm --prefix frontend test -- src/features/workbench/ui/workbench-wireframe.spec.tsx src/features/workbench/hooks/use-workbench-controller.spec.tsx
npm --prefix frontend run typecheck
```

Expected: both commands pass, blank submissions perform zero requests, and valid creation performs no activation request.

- [ ] **Step 8: Commit complete frontend creation**

```powershell
git add frontend/src/features/workbench/model/workbench-model.ts frontend/src/features/workbench/hooks/useWorkbenchController.ts frontend/src/features/workbench/ui/MainPanel.tsx frontend/src/features/workbench/ui/workbench-wireframe.spec.tsx frontend/src/features/workbench/hooks/use-workbench-controller.spec.tsx
git commit -m "[UPDATE] Require complete workspace creation"
```

### Task 5: Render truthful frontend statuses

**Files:**
- Modify: `frontend/src/features/workbench/model/workbench-model.ts`
- Modify: `frontend/src/features/workbench/model/planner-group-settings.ts`
- Modify: `frontend/src/features/workbench/ui/MainPanel.tsx`
- Test: `frontend/src/features/workbench/model/planner-group-settings.spec.ts`
- Test: `frontend/src/features/workbench/ui/workbench-wireframe.spec.tsx`

- [ ] **Step 1: Add failing truthful-status tests**

In `workbench-wireframe.spec.tsx`, use active fixtures for newly created and listed items and assert Status selectors show the exact API status without an alias. Remove proposed/approved fixtures and assertions. Add a regression assertion that changing an active item's status uses only the selected supported transition and never `approve` or `activate`.

In `planner-group-settings.spec.ts`, change the fixed Status group candidates so their status keys contain no `proposed` or `approved` and include `active` exactly once.

- [ ] **Step 2: Run focused tests and confirm obsolete values remain**

```powershell
npm --prefix frontend test -- src/features/workbench/model/planner-group-settings.spec.ts src/features/workbench/ui/workbench-wireframe.spec.tsx
```

Expected: current group candidates or fixtures still expose proposed/approved, or transition selection still contains approval actions.

- [ ] **Step 3: Remove approval transition types**

In `workbench-model.ts`, remove `"approve"` and `"activate"` from `WorkspaceItemTransitionAction`. Keep only actions backed by surviving API routes.

- [ ] **Step 4: Remove the status alias and obsolete transition branches**

In `MainPanel.tsx`, make `displayStatusForItem` return `item.status` unchanged, or inline `item.status` at all call sites and delete the helper. Remove proposed/approved branches from `transitionActionForStatus`, Status checkbox visibility, labels, and option construction. Active is not a synthetic transition target; pause/resume/reopen/complete behavior remains unchanged.

- [ ] **Step 5: Remove planner approval group values**

In `planner-group-settings.ts`, delete proposed/approved labels and candidate entries. Keep the remaining fixed statuses in the established UI order, with `active` representing open work.

- [ ] **Step 6: Scan frontend sources for obsolete lifecycle logic**

Run:

```powershell
rg -n "proposed|approved|approve|activateIfNeeded|/activate" frontend/src
```

Expected after cleanup: no executable-code or fixture matches. If historical explanatory text is present in a test name, rename it to direct-active terminology.

- [ ] **Step 7: Run every frontend gate**

```powershell
npm --prefix frontend test
npm --prefix frontend run typecheck
npm --prefix frontend run build
```

Expected: all commands exit 0 and the production build completes. The current frontend package exposes no separate format or lint script, so do not claim or invoke nonexistent gates.

- [ ] **Step 8: Commit truthful status rendering**

```powershell
git add frontend/src/features/workbench/model/workbench-model.ts frontend/src/features/workbench/model/planner-group-settings.ts frontend/src/features/workbench/model/planner-group-settings.spec.ts frontend/src/features/workbench/ui/MainPanel.tsx frontend/src/features/workbench/ui/workbench-wireframe.spec.tsx
git commit -m "[FIX] Render stored workspace statuses"
```

### Task 6: Synchronize current-state documentation and run final verification

**Files:**
- Modify: `README.md`
- Modify: `AGENTS.md`
- Modify: `docs/architecture/overview.md`
- Modify: `docs/architecture/decisions/adr-0003-approval-gating.md`
- Modify: `docs/operations/cli-reference.md`
- Modify: `docs/operations/api-reference.md`
- Modify: `docs/operations/verification-and-smoke.md`
- Modify if matched by current-state scan: `docs/operations/data-home.md`

- [ ] **Step 1: Load the documentation guard skills before editing**

Read and follow `.codex/skills/readme-structure-guard/SKILL.md`, `.codex/skills/docs-change-updater/SKILL.md`, and `.codex/skills/writing-final-state-docs/SKILL.md`. Preserve the README's existing heading order and write only current behavior outside the historical ADR.

- [ ] **Step 2: Find every current-state approval reference**

```powershell
rg -n -i "proposed|approved|approve|activate|approval" README.md AGENTS.md docs/architecture docs/operations
```

Classify each hit as current behavior, historical ADR content, migration explanation, or an unrelated English use before editing it.

- [ ] **Step 3: Update the root overview and agent guidance**

In `README.md` and `AGENTS.md`, state that every creator produces active work, Project creation requires `definition_of_done`, Routine creation requires `recurrence_rule`, and SQLite initialization normalizes legacy proposed/approved rows. Remove approval-gate policy claims and approve/activate command examples while retaining the `/propose` compatibility naming explanation.

- [ ] **Step 4: Update architecture and operation references**

In `docs/architecture/overview.md`, document the direct-active lifecycle and service validation boundary. In CLI/API references, remove approve/activate surfaces, show active creation responses, document the exact Project/Routine 400 or exit-2 messages, and define `pending` as active-only. In verification guidance, replace approval smoke steps with direct creation, field-validation, migration, pause/resume, and materialization checks.

- [ ] **Step 5: Mark ADR-0003 as superseded without rewriting history**

Change its status to `Superseded` and add a short notice linking to `docs/superpowers/specs/2026-07-16-remove-proposed-approved-status-design.md`. Keep the original decision body as historical context.

- [ ] **Step 6: Verify documentation consistency**

Run:

```powershell
rg -n "approve|activate" README.md AGENTS.md docs/operations docs/architecture/overview.md
rg -n "proposed|approved" README.md AGENTS.md docs/operations docs/architecture/overview.md
```

Expected: any remaining hits explicitly describe legacy migration or compatible `/propose` naming; no removed command, route, or state is presented as available.

- [ ] **Step 7: Run final repository gates**

```powershell
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test
cargo build
npm --prefix frontend test
npm --prefix frontend run typecheck
npm --prefix frontend run build
git status --short
```

Expected: every gate exits 0. `git status --short` contains only the documentation changes intended for this task and no generated `frontend/out` files.

- [ ] **Step 8: Commit synchronized documentation**

```powershell
git add README.md AGENTS.md docs/architecture/overview.md docs/architecture/decisions/adr-0003-approval-gating.md docs/operations/cli-reference.md docs/operations/api-reference.md docs/operations/verification-and-smoke.md docs/operations/data-home.md
git commit -m "[DOCS] Document direct active lifecycle"
```

- [ ] **Step 9: Inspect the final change series**

```powershell
git status --short
git log --oneline -6
git diff HEAD~6..HEAD --stat
```

Expected: the worktree is clean, the six scoped commits are present, and the diff contains no schema-column removal or creation-route renaming.
