# Pitfalls Research

**Domain:** Hierarchical period-goal planning (year/month/week goals, top-down decomposition, dated tasks) layered onto an existing Rust local-first SQLite ToDo engine (`todo-engine`)
**Researched:** 2026-06-22
**Confidence:** HIGH (grounded in the engine's actual source: `domain/model.rs`, `domain/status.rs`, `domain/recurrence.rs`, `application/service/`, `infrastructure/sqlite/mapping.rs`, `interfaces/cli/markdown.rs`; cross-checked against `.planning/codebase/CONCERNS.md` and `PROJECT.md`)

> Scope note: This milestone reuses `(horizon, scheduled)` as the period key, `ItemType::Goal` as a new enum variant, the existing `ItemStatus` lifecycle, `parent_id` for nesting (level-skipping allowed), and ships goal-tree + date views (progress rollup deferred to v2). Pitfalls below are specific to *that* design on *this* codebase, not generic planning-app advice.

---

## Critical Pitfalls

### Pitfall 1: `scheduled` is a free-form string, not a validated date — period derivation silently breaks

**What goes wrong:**
The engine stores `scheduled` as `Option<String>` (`domain/model.rs:49`) and never validates it on the write path. `propose_task`/`update` copy `request.scheduled` through verbatim (`creation.rs:105`, `update.rs:89-90`); `propose_event` only checks non-empty (`creation.rs:157-161`). The only consumer that parses it, `today_tasks`, treats the literal string `"today"` as a magic value and *silently drops* any value it can't parse: `parse_scheduled_day(value).is_some_and(|scheduled| scheduled <= today)` (`markdown.rs:90-92`) — an unparseable or wrong-format `scheduled` yields `false`, so the task vanishes from the view with no error. If period views derive a goal's period from `(horizon, scheduled)` the same way, a goal anchored with `"2026-6-1"`, `"2026/06/01"`, `"june"`, or `"today"` will either parse to the wrong day or disappear from its own period entirely.

**Why it happens:**
The existing engine got away with lax `scheduled` because `today` is the only reader and it fails closed. Planning makes `scheduled` *load-bearing* for both axes (date view and period anchor), so silent failure becomes data loss. Developers reuse the existing field assuming it's already a date.

**How to avoid:**
- Add a single canonical date validator at the service layer (`parse_day` already exists at `service/mod.rs:219` — use it) and call it whenever `scheduled` is set on a `Goal` and on any task that participates in period/date views. Reject non-`YYYY-MM-DD` with `TodoError::Validation` at write time, not read time.
- Decide explicitly whether the `"today"` sentinel is allowed for goals. It almost certainly is not — a goal's period must be a concrete anchor. Forbid sentinels on `Goal`.
- For goals, enforce the *canonical anchor* per horizon: week goal `scheduled` = the Monday (ISO) of the week; month goal = the 1st; year goal = Jan 1. Normalize on write so two callers can't anchor the same period two ways (see Pitfall 4).

**Warning signs:**
A task or goal "disappears" from a view with no error. Tests that only use `"today"` or perfectly-formatted dates and never assert the rejection of bad input. `parse_scheduled_day` returning `None` anywhere on a hot path.

**Phase to address:** Schema/model + service-validation phase (before any view phase). View correctness depends on it.

---

### Pitfall 2: ISO-week vs calendar-week and year-boundary week numbering corrupts period grouping

**What goes wrong:**
"Which week does 2026-01-01 belong to?" has two correct answers and they disagree at year boundaries. ISO-8601 week date (`time::Date::iso_week()` / `to_iso_week_date()`) can place early-January days in **week 52/53 of the previous year** and late-December days in **week 1 of the next year** (e.g., 2026-12-31 is ISO 2026-W53; 2027-01-01 is also 2026-W53). A naive "calendar week" (Sunday- or Monday-based count within the calendar year) gives different buckets. The engine already mixes conventions: `recurrence.rs:242` computes `number_from_monday()` (Monday=0) for weekday math, while there is no ISO-week code anywhere yet. If the week-goal anchor uses ISO Monday but the week *view* groups by "same calendar month's weeks," tasks land in the wrong week, week 53 either duplicates or vanishes, and a 2026-W01 goal shows tasks from late December 2025 (or doesn't).

**Why it happens:**
Developers pick whichever week function is handy (`iso_week()` vs manual arithmetic) per call site, and the two disagree only ~a few days a year, so it passes casual testing and breaks every New Year.

**How to avoid:**
- Pick **one** week convention (ISO-8601 Monday-start, which matches the engine's existing Monday=0 weekday math in `recurrence.rs`) and write a single `week_anchor(date) -> Date` (Monday of the ISO week) plus `period_of(horizon, date) -> PeriodKey` helper in the domain layer. Every anchor and every view bucket goes through it. Never compute weeks ad hoc at a call site.
- Make the week-goal anchor the **ISO-week Monday**, not "first Monday of the month" or "Sunday." Document it next to the helper.
- Add explicit unit tests for: 2026-W01 (Mon 2025-12-29), week 53 years (2026 has W53), Jan-1-belongs-to-prev-year, Dec-31-belongs-to-next-year.

**Warning signs:**
Two different functions computing "week" in the codebase. Off-by-one task counts only in the first/last week of a year. A week view that's empty or doubled at year boundaries. Goal anchored to a Monday that isn't the ISO Monday.

**Phase to address:** Period-key/domain phase (the helper), verified again in the period-view phase.

---

### Pitfall 3: Reusing `ItemStatus` for goals creates a lifecycle/semantics mismatch

**What goes wrong:**
`PROJECT.md` locks "reuse the existing `ItemStatus` lifecycle" for goals. But that lifecycle was designed for actionable items: `Proposed → Approved → Active → Completed/Cancelled/...` with `terminal_status` including `Completed`, `Someday`, `Rejected`, etc. (`status.rs:20-30`). A period goal doesn't "complete" like a task — its period simply *ends*. Questions with no current answer: Does a month-goal auto-complete when the month passes? Can a goal be `Active` for a future period? Does `Waiting`/`Paused` mean anything for a goal? If a goal is `Completed`, do its still-open child tasks become orphaned in views? Because v1 explicitly defers progress rollup, there's no completion-rate signal — so a goal's status is *manually set and semantically ambiguous*.

**Why it happens:**
Reusing the enum is the right call for machinery (audit, approval, transitions), but reuse of the *machinery* gets conflated with reuse of the *meaning*. Nobody writes down what each status means for a `Goal`, so each view and command invents its own interpretation.

**How to avoid:**
- Write a short decision (one paragraph in an ADR or `PROJECT.md` Key Decisions) defining the *meaning* of each `ItemStatus` for a `Goal`: which statuses are valid, which are no-ops, what "terminal" means for a goal (recommend: a goal is just `Active` for its period; `Completed`/`Dropped` are user-driven and do NOT cascade to children in v1).
- In period/goal-tree views, decide and test how goal status affects child visibility — recommend children are listed regardless of parent goal status in v1 (no cascade), since rollup is deferred.
- Do NOT invent new goal-only statuses (out of scope per `PROJECT.md`); instead, narrow the *allowed* set for goals via service validation if some statuses are meaningless.

**Warning signs:**
Code asking "is this goal done?" with no defined answer. A completed goal hiding its open children (or not) inconsistently between CLI and API. Transition tests for goals copied from task tests without rethinking semantics.

**Phase to address:** Goal-model/service phase (define semantics before views consume status).

---

### Pitfall 4: No period-uniqueness enforcement — two goals for the same period

**What goes wrong:**
Nothing stops two `(horizon:month, scheduled:2026-06-01)` goals from existing. The period view would then show two "June 2026" goals, rollup (v2) would double-count, and "the month goal" becomes ambiguous. The engine has *no* uniqueness machinery for this combo — the only unique index that exists is `idx_items_routine_occurrence` for routine occurrences (CONCERNS.md:17), and `(horizon, scheduled, parent_id)` is a different shape.

**Why it happens:**
The period key is implicit (a pair of nullable free-text columns), not a constraint. Additive schema means it's tempting to skip the index. Uniqueness "feels" like a UI concern.

**How to avoid:**
- Decide the uniqueness rule explicitly. Recommended: **one active goal per `(horizon, normalized_scheduled, parent_id)`** — sibling goals of the same horizon under the same parent must target distinct periods. Enforce in `TodoService` (the single mutation path) on create/update, returning `TodoError::Policy`.
- Service-layer enforcement is mandatory (per the engine's core invariant: all policy in `TodoService`). A SQL unique index is a *defense-in-depth* backstop but is hard to express cleanly over nullable `parent_id` + free-text `scheduled` and only counts non-terminal rows — so treat the service check as primary.
- Normalize the anchor first (Pitfall 1/2) so the check compares apples to apples.

**Warning signs:**
Period view rendering two goals for one period. A uniqueness check that compares raw `scheduled` strings (so `2026-06-01` and `2026-6-1` both pass). Uniqueness enforced only in the CLI, not the service (API can bypass).

**Phase to address:** Goal-model/service phase. Verify in CLI/API parity tests.

---

### Pitfall 5: `parent_id` cycles, cross-period parents, and orphans — no graph validation exists

**What goes wrong:**
`parent_id` is a free pointer (`model.rs:37`) with **no** validation on the task/goal create path — `ProposeTask` doesn't even carry `parent_id` today, and the existing relation guard `ensure_relation` (`service/mod.rs:169-192`) only checks *type* and *terminal status*, never cycles. With flexible level-skipping nesting (`PROJECT.md` allows month→task directly), the hazards multiply:
- **Cycles:** Goal A's parent = B, B's parent = A. A recursive rollup or tree-walk then infinite-loops or stack-overflows.
- **Cross-period parent:** a week-goal for 2026-W10 parented under a month-goal for 2026-05 (a different/wrong month). The week then appears under the wrong month in the tree.
- **Orphans / dangling pointers:** `parent_id` points at a deleted/archived/dropped item; the child silently leaves the tree view.
- **Level-skip ambiguity for rollup:** a task parented directly to a year-goal vs. via month vs. week — v2 rollup can't tell where to attribute it without a rule.

**Why it happens:**
SQLite has no enforced FK here (and even with FKs, no cycle prevention). The codebase has never needed deep `parent_id` walking, so no walk-with-visited-set helper exists. Level-skipping is a deliberate feature, which makes "is this a valid parent?" genuinely non-trivial.

**How to avoid:**
- Add a `validate_parent` service check (extend the `ensure_relation` pattern): parent must exist, be a non-terminal `Goal` (or allowed type), and assigning it must not create a cycle — walk ancestors with a visited set and bail with `TodoError::Policy` on revisit *or* on exceeding a max-depth bound.
- Enforce **monotonic horizon nesting**: a child goal's horizon must be finer-or-equal than its parent's (year > month > week); reject week-under-week-of-different-period and week-under-wrong-month by checking the parent's period *contains* the child's period.
- For tree/rollup walks, always carry a `visited: HashSet` and a depth cap as a second backstop even after validation (defense against pre-existing bad data on old DBs).
- Orphans: in tree views, treat a child whose parent is missing/terminal as either top-level or explicitly "unparented" — decide and test; never let it silently vanish.

**Warning signs:**
Any recursive function over `parent_id` without a visited set or depth limit. A test suite with only 1–2 level hierarchies. Stack overflow / hang on a hand-crafted cyclic fixture. A week goal showing under the wrong month.

**Phase to address:** Goal-linking/service phase (validation) and period-view phase (safe traversal).

---

### Pitfall 6: Recursive goal-tree rollup amplifies the existing in-memory full-table scan debt

**What goes wrong:**
CONCERNS.md flags that `list_items` loads the *entire* `items` table and filters in Rust (`repo.rs:29`, `ports.rs:29`), and that materialization already fans this out into quadratic full scans (`materialization.rs`). Building a goal tree the easy way — "for each goal, call `list_items` to find its children, recurse" — repeats the full-table load *per node*, turning an O(N) view into O(N × depth × goals). The `today`/`pending` views already do one full scan each (`markdown.rs:58-75`); a period view that walks year→months→weeks→tasks could trigger dozens. On a personal DB this is invisible until the table reaches thousands of rows, then every period view stalls.

**Why it happens:**
The repository offers no "children of X" or "by period" query — only "load everything." The natural recursion reuses `list_items`, inheriting its cost at every node. It's fast in tests (tiny DBs) and slow only in real long-lived data homes.

**How to avoid:**
- Load the relevant working set **once** (a single `list_items`/SQL query for the period window), then build the parent→children map and walk it **in memory** — do not call the repository inside the recursion.
- Ideally, push a `parent_id IN (...)` / `horizon = ? AND scheduled BETWEEN ? AND ?` predicate into SQL so the existing-but-unused indexes (`idx_items_*` per CONCERNS.md:10) get exercised. This is the same fix CONCERNS.md already prescribes; the planning layer is a forcing function for it. If full SQL pushdown is out of scope, at minimum do single-load-then-in-memory-tree.
- Add the `idx_items_parent_id` / a `(horizon, scheduled)` index if not present, even if the query is in-memory today, so the later SQL pushdown lands cheaply.

**Warning signs:**
`list_items` (or `repo.list`) called inside a loop or recursion. Period-view latency growing with total item count rather than items-in-period. New `today`-style helpers that re-scan per goal.

**Phase to address:** Period-view phase. Note in roadmap: this is the phase most likely to need a deeper performance look; flag it.

---

### Pitfall 7: Adding `Goal` to the type enum breaks reads on older/concurrent binaries (downgrade hazard)

**What goes wrong:**
`infrastructure/sqlite/mapping.rs:108` parses the stored `item_type` via `ItemType::from_str`, which returns `Err` for any unknown string (`model.rs:160-171`), mapped to `TodoError::Storage`. So once a `goal`-typed row exists, **any binary that doesn't know `goal` fails to load that row** — and because `list_items` loads the *whole table* (CONCERNS.md), a single `goal` row can make `list`, `today`, `pending`, and `health` all error out on an older binary. The schema migration is "additive-only" (CONCERNS.md:68, CLAUDE.md) and `user_version` is set to `1` and never read (`schema.rs:86`), so there's no version gate to catch a mismatch. Additive *columns* are safe; an additive *enum value* is a one-way data change that older code can't read.

**Why it happens:**
"Additive schema" is interpreted as "safe," but it only covers columns. Enum-value additions are data-format changes. The strict `from_str` (correct for input validation) is also the read path, so it rejects data the running binary doesn't recognize.

**How to avoid:**
- Treat shipping the `Goal` enum value as a real version bump: read and check `user_version` (the mechanism exists — `user_version()` per CONCERNS.md:70-71) so a downgrade or stale binary fails loudly with a clear message instead of cryptic `Storage` errors mid-list.
- Decide row-load resilience: either (a) accept that `goal` rows require the new binary (document it, bump version), or (b) make the *list* path tolerant — skip/quarantine rows whose type doesn't parse rather than aborting the whole load. (a) is simpler and acceptable for a single-user local engine; pick it deliberately, don't default into it.
- Add an integration test: write a row with `item_type = 'goal'`, confirm load works on the new binary; and a test that an unknown type produces a *clear* error, not a panic.

**Warning signs:**
`health`/`list` erroring with `Storage` after a goal is created. No `user_version` check anywhere. Tests that never exercise loading a `goal` row through `mapping.rs`. Assuming "additive = backward compatible" for the enum.

**Phase to address:** Schema/model phase (the first phase). This is the highest-leverage early decision.

---

### Pitfall 8: CLI/API parity drift on the new commands and endpoints

**What goes wrong:**
The engine's defining invariant is that CLI and API are equal views over `TodoService`, locked by e2e parity suites (`tests/e2e/{cli,api}.rs`, TESTING.md). New planning surface (create goal, link task, date view, period view) is the easiest place to drift: a flag exists on the CLI but not the API, period filtering differs, or — worst — validation/uniqueness/cycle checks (Pitfalls 1,4,5) get implemented in a CLI handler instead of `TodoService`, so the API silently bypasses them. The API's actor self-attribution (`parse_actor_or_default`, CONCERNS.md:40-44) already lets a caller claim `Actor::User`; if approval gating for goals lives outside the service, the API path skips the gate.

**Why it happens:**
Two adapters, one easy to forget. Validation feels natural to write where the input is parsed (the handler). Parity tests for *new* features don't exist yet, so drift ships green.

**How to avoid:**
- Put **all** planning policy (date validation, period normalization, uniqueness, parent/cycle/horizon checks, approval gating) in `TodoService` request structs/methods, never in CLI or API handlers. The adapters only parse args → request → call service → render.
- Add e2e parity tests for every new command/endpoint mirroring the existing pattern: same input via CLI and via `oneshot` HTTP must yield the same item state and the same rejections.
- Reuse the existing approval-gating path for goals (agent-created `Goal` → `Proposed`); verify via the same test shape as `agent_task_requires_approval_before_activation` (TESTING.md).

**Warning signs:**
A validation branch inside `interfaces/cli` or `interfaces/api`. A CLI flag with no API equivalent (or vice versa). New feature with no `tests/e2e/api.rs` counterpart to its `cli.rs` test. The architecture-boundary test (`tests/unit/architecture.rs`) is green but parity tests are absent.

**Phase to address:** Every feature phase; enforce in the phase's success criteria. Make "CLI+API parity test added" a checklist item.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Store `scheduled`/goal anchor as unvalidated string (status quo) | No new validation code; matches existing field | Silent data loss in views (Pitfall 1); two encodings of same period defeat uniqueness | Never for `Goal` anchors; tasks-in-views must validate too |
| Compute "week" ad hoc at each call site | Quick to write | Year-boundary corruption (Pitfall 2) every New Year | Never — always go through one `period_of` helper |
| Recurse with `list_items` per goal node | Trivial tree-building | O(N×goals) period views; amplifies known scan debt (Pitfall 6) | Prototype only; must be single-load before merge |
| Skip cycle/horizon validation on `parent_id` | Less code; "users won't do that" | Hang/stack-overflow on cyclic data; wrong-period nesting (Pitfall 5) | Never — at minimum a visited-set + depth cap on traversal |
| Put validation in CLI handler | Fast for the CLI demo | API bypasses policy; parity drift (Pitfall 8) | Never — violates the core single-mutation-path invariant |
| Ship `Goal` enum value without `user_version` check | One less migration concern | Older/concurrent binary can't load the table (Pitfall 7) | Acceptable only if documented as "new binary required" + tested |
| Define goal `ItemStatus` meaning implicitly | No upfront decision | Inconsistent child visibility, ambiguous "done" (Pitfall 3) | Never — write the one-paragraph semantics down |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| `time` crate week handling | Mixing `iso_week()` with manual `number_from_monday()` math | Single ISO-Monday `week_anchor`/`period_of` helper; reuse existing Monday=0 convention from `recurrence.rs:242` |
| `time` crate date parsing | Accepting `2026-6-1`, `2026/06/01`, `"today"` as a date | Reuse `parse_day` (`service/mod.rs:219`, strict `[year]-[month]-[day]`); reject sentinels for goals |
| SQLite additive migration | Treating a new enum *value* like a new *column* (both "additive") | Bump/check `user_version`; test loading a `goal` row through `mapping.rs` |
| `rusqlite` indexes | Adding `(horizon, scheduled)`/`parent_id` index but querying via full-table load | Push period/parent predicate into SQL `WHERE` so the index is used (CONCERNS.md fix) |
| Approval gate via API | Trusting request-supplied `Actor` for goal approval (`parse_actor_or_default`) | Keep gating in `TodoService`; do not let goal approval depend on a caller-claimed actor |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| `list_items` called inside goal-tree recursion | Period view latency scales with total items, not items-in-period | Single load, build parent→children map in memory; ideally SQL predicate | Thousands of items in a long-lived data home |
| Full-table scan per view (existing) inherited by date/period views | `today`-style O(N) scan now run for week/month/year too | Push `ListFilter`/period predicate into SQL (CONCERNS.md fix) | Tens of thousands of rows |
| Re-running `init_schema` per API request now also touches a bigger schema | Per-request DDL overhead (CONCERNS.md:19) | Move schema init to router construction (already recommended) | High API request rate |
| Unbounded `parent_id` traversal | Hang/stack overflow on cyclic or very deep data | Visited set + depth cap (also a correctness fix, Pitfall 5) | Any cyclic/orphaned legacy row |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Goal approval gating outside `TodoService` | API caller claims `Actor::User` (CONCERNS.md:40) and self-approves agent-proposed goals | Gate in service; tie user-vs-agent to transport if integrity must hold |
| Exposing period/goal API beyond loopback | No auth layer (CONCERNS.md:34); anyone on the port can mutate the goal tree | Keep loopback-only; document near `router`; add token/bind guard before any exposure |
| Trusting `scheduled`/period input unparsed | Not injection (SQL is parameterized) but data-integrity corruption of the whole period model | Strict validation at the service boundary |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Task with `scheduled = null` invisible in date view | Planned-but-undated tasks silently disappear | Decide a home: an explicit "unscheduled" bucket in the date view, not omission |
| Task scheduled outside any goal's period | Task shows in date view but nowhere in the goal tree (or vice versa) | Show such tasks as "unplanned"/top-level; never drop; test the case |
| Unstable ordering in views | Tasks reshuffle between runs | Reuse existing `ORDER BY created_at, id` deterministic order; sort views explicitly by (date, priority, id) |
| Week goal anchored to a non-ISO-Monday day | User's "this week" disagrees with the engine's week | Normalize anchor to ISO Monday on write; show the period range, not the raw anchor |
| Completed goal hides its open children | User loses track of in-flight work | v1: no cascade — list children regardless of goal status (Pitfall 3) |

## "Looks Done But Isn't" Checklist

- [ ] **Date view:** Often missing the `scheduled = null` and out-of-any-period cases — verify both render in an explicit bucket, with a test, not silently dropped.
- [ ] **Week view:** Often missing year-boundary weeks (2026-W01, W53) — verify with tests at Dec 31 / Jan 1 / week-53 years.
- [ ] **Goal anchor:** Often accepts non-canonical dates (`2026-6-1`, `"today"`) — verify rejection/normalization at the service layer.
- [ ] **Period uniqueness:** Often enforced only in CLI — verify the *API* path also rejects a duplicate `(horizon, scheduled, parent)`.
- [ ] **Parent linking:** Often missing cycle + horizon-containment checks — verify a cyclic and a wrong-month fixture are rejected.
- [ ] **Tree traversal:** Often missing visited-set/depth cap — verify it terminates on a hand-crafted cycle in legacy data.
- [ ] **`Goal` row load:** Often untested through `mapping.rs` — verify a `goal`-typed row loads on the new binary and `user_version` is checked.
- [ ] **CLI/API parity:** Often missing the API twin of a new CLI command — verify every new command has both an e2e CLI and API test.
- [ ] **Audit events:** Often forgotten on new mutations — verify every goal/link mutation writes a `TodoEvent` (the engine's mandatory invariant).
- [ ] **Approval gating:** Often skipped for goals — verify agent-created goals start `Proposed` and need approval, like tasks.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Unvalidated `scheduled` already written in mixed formats | MEDIUM | Add validator; write a one-off normalization pass (through the service, with audit events) to rewrite anchors to canonical `YYYY-MM-DD`; backfill goal anchors to ISO-Monday/1st/Jan-1 |
| Week math inconsistent across call sites | LOW–MEDIUM | Centralize into one `period_of` helper, replace call sites, add boundary tests; data usually re-derives correctly once code agrees |
| Cyclic/orphaned `parent_id` in data | MEDIUM | Add visited-set traversal first (stops the hang), then a repair command that re-parents orphans to top-level and breaks cycles, emitting audit events |
| Duplicate goals per period already created | LOW | Service uniqueness check + a list/merge command; user picks the canonical goal, others `Dropped` via service |
| `Goal` rows unreadable by older binary | MEDIUM | Add `user_version` gate with a clear error, or make list path skip-and-warn on unknown type; require/document the newer binary |
| Period view slow from per-node `list_items` | LOW–MEDIUM | Refactor to single-load + in-memory tree; add SQL predicate + index later (already on the CONCERNS.md backlog) |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| 1. Unvalidated `scheduled` / anchor | Schema + model + service validation (early) | Service rejects bad/sentinel dates; views never silently drop |
| 2. ISO-week / year-boundary math | Period-key/domain helper phase | Unit tests at W01/W53/Dec31/Jan1 pass |
| 3. `ItemStatus` semantics for goals | Goal-model/service phase | Documented status meaning; child-visibility test |
| 4. Period uniqueness | Goal-model/service phase | CLI *and* API reject duplicate `(horizon, scheduled, parent)` |
| 5. `parent_id` cycles / wrong-period nesting | Goal-linking/service phase | Cyclic + wrong-month fixtures rejected; traversal terminates |
| 6. Recursive rollup scan amplification | Period-view phase (flag for deeper research) | No `list_items` inside recursion; latency scales with period, not table |
| 7. `Goal` enum downgrade hazard | Schema/model phase (first) | `goal` row loads; `user_version` checked; clear error on unknown type |
| 8. CLI/API parity drift | Every feature phase (success criterion) | Each new command has paired e2e CLI + API tests; policy lives in service |

> **Roadmap flags:** Phase order should be (1) schema/model + period-key helper + validation, then (2) goal create/link with parent + uniqueness validation, then (3) date view, then (4) period/goal-tree view. The **period-view phase (Pitfall 6) is the one most likely to need deeper performance research** because it collides with the pre-existing full-table-scan debt in CONCERNS.md. The **schema/model phase carries the highest-leverage one-way decisions** (Pitfalls 1, 7).

## Sources

- Engine source (HIGH — primary): `todo-engine/src/domain/model.rs` (`ItemType`, `TodoItem.scheduled/horizon/parent_id`, `from_str`), `domain/status.rs` (`ItemStatus`, `terminal_status`), `domain/recurrence.rs` (Monday=0 weekday math, month/year edge handling), `application/service/{creation.rs,update.rs,mod.rs}` (unvalidated `scheduled`, `parse_day`, `ensure_relation`), `infrastructure/sqlite/mapping.rs` (strict `from_str` read path), `interfaces/cli/markdown.rs` (`today_tasks`, `parse_scheduled_day`, magic `"today"`).
- `.planning/codebase/CONCERNS.md` (HIGH — cross-checked): in-memory full-table filtering, quadratic materialization, additive-schema-no-version-branching, `user_version` set-but-unread, API actor self-attribution, no busy_timeout/WAL.
- `.planning/codebase/TESTING.md` (HIGH): layered test binaries, e2e CLI/API parity suites, approval-gating test pattern.
- `.planning/PROJECT.md` (HIGH): locked decisions — `Goal` as `ItemType`, `(horizon, scheduled)` period key, level-skipping nesting, status reuse, rollup deferred.
- ISO-8601 week-date semantics / `time` crate `iso_week` behavior (HIGH — well-established): week-53 years and Jan-1/Dec-31 cross-year week ownership.

---
*Pitfalls research for: hierarchical period-goal planning on the `todo-engine` Rust/SQLite engine*
*Researched: 2026-06-22*
