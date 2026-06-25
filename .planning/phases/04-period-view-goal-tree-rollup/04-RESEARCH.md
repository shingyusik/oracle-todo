# Phase 4: Period View (goal-tree rollup) - Research

**Researched:** 2026-06-25
**Domain:** SQLite recursive tree loading (Rust/rusqlite), in-memory tree assembly, store parity
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** `PeriodView` = nested recursive node type. Shape: `PeriodView { <period meta>, roots: Vec<GoalNode> }`, `GoalNode { goal: TodoItem, child_goals: Vec<GoalNode>, tasks: Vec<TodoItem> }`. Single shared type both adapters serialize (SC4/CORE-03). Parity is guaranteed by the shared type itself (does not depend on sort, like the date view).
- **D-01a:** `child_goals` and `tasks` are **separate vecs** → "goals first, tasks later" separation holds at the type level. Adapters render the two vecs in order.
- **D-02:** Root = goals matching `(horizon, period)` **exactly**. Period key derived from Phase 1 `Horizon` anchor normalization. Because Phase 2 GOAL-04 forbids same-horizon nesting (strictly-coarser parent), matching goals are siblings → **all are roots**. Do NOT climb to the root's coarser ancestors.
- **D-03:** Descendants = the **entire `parent_id` subtree** — walk down `parent_id` collecting every finer child goal and its linked tasks, **regardless of the descendant's own period**. Interpretation: the tree shows the period goal's *decomposition (plan)*, not a calendar intersection.
- **D-03a (accepted cost):** A finer goal whose parent is in a *different* period appears only in that parent's period view, not in this one. Intended consequence of D-03.
- **D-04:** Unscheduled (scheduled None/non-ISO) goal-internal tasks go **inline into `GoalNode.tasks`** — no separate bucket, never dropped (VIEW-04 / SC2).
- **D-05:** In-node task sort = **reuse Phase 3 `sort_date_view`** (`scheduled` asc, unscheduled last, tie-break `created_at` → `id`). No new sort semantics.
- **D-06:** `child_goals` sort = period anchor (`scheduled`) asc → `created_at` → `id`. Same deterministic tie-break as tasks.
- **D-08:** Infinite-loop prevention = visited `HashSet` + depth cap. Depth cap reuses Phase 2 `goal.rs` `MAX_GOAL_DEPTH = 64` (the ancestor-walk visited idiom lives there too). **SC3 LOCKED.**
- **D-09:** Anomaly signal is kept but minimal; the view **NEVER fails (throw/`Err`)**. Lightweight flag/counter on `PeriodView` (e.g. `truncated: bool` or `anomaly_count: usize` summing severed cycle back-edges + depth-cap hits + orphans). No per-node markup, no rich error objects. Adapters emit ONE summary line.
- **D-10:** **Do SQL pushdown in this phase.** Load the working set via an indexed query in `repo.rs` (not the existing `list_items` full scan), exercising Phase 1 indexes (`parent_id`, `scheduled`, `(type, horizon, scheduled)`). Recursive CTE or hybrid load — researcher decides. SC3 "single-load → in-memory walk, no `list_items` in recursion" is preserved. **Scope is confined to the period-view load path** — do NOT rewrite the global `list_items` scan (that is deferred tech-debt per PROJECT.md).
- **D-11:** **CLI/API parity is no longer automatic — it must be explicitly guaranteed and tested.** Persistent store goes through the new SQL path; InMemory store has no SQL, so it needs an equivalent Rust filter/traversal. Both must produce identical results, asserted via the `parity_in_memory_vs_persistent` idiom (Phase 3 `date_view.rs`).

### Claude's Discretion

- Exact field names / period-meta shape of `PeriodView` / `GoalNode`; `truncated` vs `anomaly_count` signal field shape (D-09).
- Task status filter policy (D-07) — reuse open-only allowlist vs include terminal tasks.
- Method signature (`period_view(horizon, period)` param types: `Horizon`+`Date` vs `&str` parsed internally), return location.
- SQL pushdown concrete shape — recursive CTE vs hybrid load, index strategy (D-10, **researcher's core task**).
- Test placement (unit vs integration); persistent + parity follows `goal_view.rs`/`date_view.rs` idiom.

### Deferred Ideas (OUT OF SCOPE)

- **Progress / completion rollup** (ROLL-01) — v2. This phase is structure-only (SC1).
- **Health / at-risk derived signals** (ROLL-02) — depends on rollup. v2.
- **Coverage view** (COVER-01) — surface period goals with zero linked tasks. v2/v1.x.
- **Engine-wide `list_items` SQL rewrite** — full CONCERNS.md debt resolution. D-10 is confined to the period-view load path; the global rewrite is separate tech-debt work.
- **busy_timeout / WAL / connection pool / API auth** — CONCERNS.md items, non-goal this milestone.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| VIEW-03 | Period view: `(horizon, period)` root goal(s) + descendant goal+task subtree, structure-only | Architecture Patterns (root-select + recursive subtree load); Standard Stack (recursive CTE); the `PeriodView`/`GoalNode` shared-type design (D-01) |
| VIEW-04 | Unscheduled-in-goal surfacing — tasks linked under a goal with no `scheduled` date are surfaced | "Don't filter tasks by `scheduled`" pattern; tasks are pulled by `parent_id` only, never excluded by date — `iso_day`-None tasks land inline in `GoalNode.tasks` (D-04) |
| CORE-03 | View logic in application/service layer shared by CLI & API (parity) | `queries.rs` placement; single shared `PeriodView` type; explicit parity strategy (D-11) and parity test pattern |
</phase_requirements>

## Summary

This phase adds a single read-only service method (`period_view`) in `application/service/queries.rs` that returns a nested `PeriodView` tree, plus a confined SQL-pushdown load path in `infrastructure/sqlite/repo.rs`. The mechanics are well-understood: the codebase already has every reusable primitive (the `sort_date_view`/`iso_day` sorters from Phase 3, the `MAX_GOAL_DEPTH=64` + visited-`HashSet` walk idiom from Phase 2, the `ListFilter`/`apply_list_filter` InMemory machinery, and the `parity_in_memory_vs_persistent` test idiom). The only genuinely *new* decision is D-10's load strategy.

**The load-strategy recommendation is a SQLite `WITH RECURSIVE` CTE** that seeds on the root goals (selected via the `idx_items_type_horizon_scheduled` index) and walks `parent_id` downward to collect the whole goal subtree plus all tasks whose `parent_id` is any goal in that subtree — returned as one flat `Vec<TodoItem>` in a single query. The recursion is over `parent_id` (which has `idx_items_parent_id`), so each step is an indexed lookup, not a scan. The CTE is *confined* to a brand-new repository method (`load_period_subtree` or similar) and does not touch `list_items` at all, satisfying D-10's scope fence. The SQL provides the *load*; SC3's safety invariant (visited set + depth cap) and the tree *assembly* stay in `queries.rs` in memory, run over the flat vec, regardless of the load path — so cycle/depth safety is identical across both stores.

bundled SQLite is **3.45.3** (`rusqlite 0.32` + `bundled` → `libsqlite3-sys 0.30.1`), so `WITH RECURSIVE` (available since 3.8.3, 2014) is fully supported with no version risk. [VERIFIED: Cargo.lock + bundled_version.rs]

**Primary recommendation:** Add a confined recursive-CTE repository method that returns the flat working set (root goals + descendant goals + their tasks) in one indexed query; assemble the nested `PeriodView` tree in `queries.rs` with the reused visited-set + `MAX_GOAL_DEPTH` walk; implement an equivalent two-pass `list_items`-backed loader for the InMemory store; prove equality with a `parity_in_memory_vs_persistent` test.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Root goal selection by `(horizon, period)` | application/service (`queries.rs`) | infrastructure (`repo.rs` SQL) | Policy/derivation (period-key normalization) is application; the indexed fetch is infra |
| Recursive subtree load (working set) | infrastructure (`repo.rs` CTE) | application (InMemory equivalent) | D-10 pushes the load to SQL; InMemory must replicate in Rust (D-11) |
| Tree assembly (nesting goals + tasks) | application/service (`queries.rs`) | — | Pure transformation over the loaded vec; identical for both stores |
| Cycle/depth/orphan safety (SC3) | application/service (`queries.rs`) | — | Must hold regardless of store; kept in-memory per the locked SC3 invariant |
| `PeriodView` serialization | interfaces (CLI/API, Phase 5) | — | Out of scope this phase — adapters consume the shared type later |
| Period-key derivation | domain (`horizon.rs`) | application | `normalize_to_period_start`/`is_period_start` already exist; pure logic |

## Standard Stack

This phase introduces **no new dependencies**. Everything needed is in-tree.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `rusqlite` | 0.32 (bundled) | Recursive CTE query + row mapping | Already the repository driver; `bundled` → SQLite 3.45.3 supports `WITH RECURSIVE` [VERIFIED: todo-engine/Cargo.toml + Cargo.lock] |
| `time` | (in tree) | `Date` parsing/compare for period-key derivation | Already used by `parse_day`, `normalize_to_period_start`, `recurrence.rs` [VERIFIED: codebase] |
| `serde` | (in tree) | `PeriodView`/`GoalNode` JSON serialization (consumed Phase 5) | Existing convention for all wire types [VERIFIED: codebase] |
| std `HashSet`/`HashMap` | std | Visited set (SC3) + InMemory child-index | `HashSet` already used in `goal.rs` ancestor walk [VERIFIED: goal.rs:81] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `tempfile` | (dev-dep, in tree) | Temp SQLite home for persistent + parity tests | Already used by `date_view.rs`/`goal_view.rs` `persistent_service()` [VERIFIED: tests] |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Recursive CTE (one query) | Hybrid load (goals in memory via indexed `WHERE`, then a single `parent_id IN (...)` task fetch) | Avoids CTE complexity but needs ≥2 queries and a host-side iterative goal walk; still indexed. Viable fallback but more moving parts and doesn't strictly satisfy "single-load" as cleanly. |
| Recursive CTE | N+1 per-level `parent_id` queries inside the walk | **Rejected** — violates SC3 ("no `list_items` in recursion") in spirit; re-introduces the per-level round-trip cost the CTE eliminates. |
| Recursive CTE | Reuse `list_items` full scan + in-memory filter (Phase 3 approach) | **Rejected by D-10** — that is the full-table-scan debt this phase is explicitly told to avoid on this path. |

**Installation:** None — no new crates.

**Version verification:** `rusqlite = "0.32"` resolves `libsqlite3-sys 0.30.1` which bundles SQLite **3.45.3** (`SQLITE_VERSION_NUMBER = 3045003`). `WITH RECURSIVE` requires ≥ 3.8.3 — satisfied with a wide margin. [VERIFIED: Cargo.lock line 578-581 + libsqlite3-sys-0.30.1/.../bindgen_bundled_version.rs]

## Package Legitimacy Audit

No external packages are installed in this phase. All dependencies (`rusqlite`, `time`, `serde`, `tempfile`) are pre-existing, mainstream, actively-maintained crates already vetted in CONCERNS.md ("Stack is mainstream and actively maintained… No dependencies flagged"). [VERIFIED: CONCERNS.md "Dependencies at Risk"]

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
period_view(horizon, period)  ── application/service/queries.rs (NEW method)
        │
        │ 1. derive period key:  normalize_to_period_start(parse_day(period), horizon)
        │                         (domain/horizon.rs — already exists)
        ▼
   ┌─────────────────────────── load the working set ONCE ───────────────────────────┐
   │                                                                                  │
   │  Persistent store                              InMemory store                    │
   │  store.load_period_subtree(                    list_items(...) twice:            │
   │     horizon, period_key)         ── repo.rs    (a) goals via ListFilter,         │
   │     = WITH RECURSIVE CTE         (NEW)         (b) iterative parent_id walk in    │
   │       over parent_id            (indexed)          Rust to collect subtree +     │
   │     → Vec<TodoItem>                                 tasks → Vec<TodoItem>         │
   │     (root goals + desc goals + their tasks)                                       │
   └──────────────────────────────────┬───────────────────────────────────────────────┘
                                       │  flat Vec<TodoItem> (working set)
                                       ▼
        2. assemble tree IN MEMORY (queries.rs, store-agnostic):
            - partition: goals vs tasks; index tasks by parent_id; index goals by parent_id
            - roots = goals where (horizon,scheduled) == (horizon, period_key)
            - recurse roots ↓ via parent_id index:
                  visited HashSet + depth ≤ MAX_GOAL_DEPTH (SC3)
                  on re-visit / depth cap / orphan → bump anomaly_count, sever edge (NO Err)
            - each GoalNode.tasks  = tasks indexed under that goal, sorted by sort_date_view (D-05)
            - each GoalNode.child_goals sorted by (scheduled asc, created_at, id) (D-06)
                                       │
                                       ▼
        PeriodView { period meta, roots: Vec<GoalNode>, anomaly_count/truncated }
                                       │
                                       ▼
        (Phase 5) CLI Markdown (indent by depth) / API JSON (natural nesting)
```

The diagram's key invariant: **the load happens exactly once** (left branch for Persistent SQL, right branch for InMemory Rust), and **the tree-assembly + SC3 safety walk is the same code** operating on the flat vec for both stores. That is what makes the parity test meaningful — only the loader differs.

### Recommended Project Structure
```
todo-engine/src/
├── application/service/queries.rs     # period_view() + PeriodView/GoalNode types + in-memory tree build + SC3 walk
├── application/ports.rs               # (maybe) extend TodoRepository trait with load_period_subtree
├── infrastructure/sqlite/repo.rs      # load_period_subtree(): WITH RECURSIVE CTE (NEW, confined)
└── domain/horizon.rs                  # REUSE normalize_to_period_start / is_period_start (no change)

todo-engine/tests/integration/
└── period_view.rs                     # NEW: persistent tree tests + parity_in_memory_vs_persistent
```

### Pattern 1: Recursive-CTE subtree load (the D-10 load path)
**What:** One indexed SQL query that returns root goals + all descendant goals + all tasks linked anywhere in that subtree, as a flat row set.
**When to use:** The Persistent store's working-set load. Confined to a new repo method; `list_items` is untouched.
**Example (SQLite syntax sketch — bundled 3.45.3):**
```sql
-- :horizon and :period_key are the normalized (horizon, scheduled) of the roots.
WITH RECURSIVE subtree(id) AS (
    -- seed: root goals matching the period exactly (uses idx_items_type_horizon_scheduled)
    SELECT id FROM items
    WHERE type = 'goal' AND horizon = :horizon AND scheduled = :period_key

    UNION                          -- UNION (not UNION ALL) dedups + is the SQL-level cycle guard
    -- step: any item whose parent is already in the subtree (uses idx_items_parent_id)
    SELECT i.id FROM items i
    JOIN subtree s ON i.parent_id = s.id
    WHERE i.type IN ('goal', 'task')
)
SELECT <full item column list>     -- reuse item_select_sql's column list
FROM items
WHERE id IN (SELECT id FROM subtree);
```
- Seed exercises `idx_items_type_horizon_scheduled`; the recursive JOIN exercises `idx_items_parent_id`. [VERIFIED: schema.rs:83-86 indexes exist]
- `UNION` (not `UNION ALL`) makes SQLite's CTE machinery skip already-seen rows, so a `parent_id` cycle in legacy data terminates the SQL recursion (the working set is the set of *reachable* nodes; back-edges contribute nothing new and stop). This is the **SQL-level** cycle guard.
- **SC3 safety still lives in memory regardless.** The CTE guarantees a *finite, deduped* working set, but the locked SC3 invariant requires the visited-set + depth-cap during the in-memory tree *assembly* walk — keep it there unconditionally (it is also the only safety the InMemory store has). Do not delete the in-memory guard on the grounds that "SQL already dedups."
- Implementation note: `item_select_sql(suffix)` (mapping.rs:22) builds the `SELECT <cols> FROM items {suffix}`. You can pass a `suffix` of `WHERE id IN (WITH RECURSIVE … )`, or write the CTE as a standalone prepared statement that reuses the same column list. Either keeps row mapping via `row_to_item`.

### Pattern 2: Store-agnostic in-memory tree assembly
**What:** Build `Vec<GoalNode>` from the flat `Vec<TodoItem>` working set. Identical code for both stores.
**When to use:** Always, after the load.
**Example (shape):**
```rust
// queries.rs (sketch — field names are planner's discretion)
fn assemble(working_set: Vec<TodoItem>, horizon: Horizon, period_key: Date)
    -> (Vec<GoalNode>, usize /* anomaly_count */)
{
    // 1. partition + index
    let (goals, tasks): (Vec<_>, Vec<_>) =
        working_set.into_iter().partition(|i| i.item_type == ItemType::Goal);
    let mut tasks_by_parent: HashMap<String, Vec<TodoItem>> = HashMap::new();
    for t in tasks { if let Some(p) = &t.parent_id { tasks_by_parent.entry(p.clone()).or_default().push(t); } }
    let mut goals_by_parent: HashMap<Option<String>, Vec<TodoItem>> = HashMap::new();
    for g in goals { goals_by_parent.entry(g.parent_id.clone()).or_default().push(g); }

    // 2. roots = exact (horizon, period) match (D-02); siblings all roots
    //    NOTE: roots are NOT only the parent_id=None goals — a finer goal whose parent is in
    //    a *different* period is a root HERE only if it matches the period exactly... but D-02
    //    says roots are the exact-match goals; descendants are whatever is reachable via parent_id.
    //    See "Pitfall: root identity" below for the precise rule.

    // 3. recurse with visited + depth cap (reuse MAX_GOAL_DEPTH); bump anomaly on cut.
}
```

### Anti-Patterns to Avoid
- **Calling `list_items` (or any repo read) inside the recursion.** Violates SC3 explicitly. Load once, then walk the in-memory vec/index. [SC3 LOCKED]
- **Rewriting the global `list_items` to be index-backed in this phase.** D-10 confines the SQL pushdown to a *new* period-view method. Touching `list_items` blows the scope fence and risks regressing every other read path. [D-10 scope fence]
- **Filtering tasks by `scheduled` when collecting them under a goal.** Tasks are pulled by `parent_id` only; unscheduled tasks MUST appear (VIEW-04/SC2). The `scheduled`-based sort (D-05) puts them last — it never excludes them.
- **Letting the view return `Err` on bad legacy data.** Cycles/orphans/depth overflow → bump the anomaly counter and sever, never propagate an error (D-09, never-lose-data).
- **Deleting the in-memory visited-set because the SQL `UNION` already dedups.** The InMemory store has no SQL guard; SC3 is a locked in-memory invariant. Keep both.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Period-key derivation from a date | Custom year/month/week-start math | `normalize_to_period_start(date, horizon)` + `is_period_start` (domain/horizon.rs) | ISO-Monday week start (can land in prior year) is already correct and tested; re-deriving risks the "two ways to bucket a period" bug the helper exists to prevent [VERIFIED: horizon.rs:75-92] |
| ISO date parsing of `scheduled`/`due` | Re-parse with new logic | `iso_day(Option<&str>)` (queries.rs:106) | Already handles bare date, timestamped, `"today"` sentinel, and junk → `None`; used by the date view [VERIFIED: queries.rs:106] |
| In-node task ordering | New sort | `sort_date_view(&mut items)` (queries.rs:113) | D-05 reuse: scheduled asc / unscheduled last / created_at → id; identical semantics to date view, free parity [VERIFIED: queries.rs:113] |
| Cycle/depth guard during the walk | New traversal guard | `MAX_GOAL_DEPTH = 64` + visited `HashSet` idiom (goal.rs:11,81) | Exact pattern already used for goal ancestor-walk validation; reuse the constant and the insert-returns-false cycle check [VERIFIED: goal.rs:11,84-96] |
| InMemory filtering | New filter | `ListFilter` + `apply_list_filter` (ports.rs) | The InMemory loader composes `list_items(ListFilter{...})` exactly like `open_tasks`/`ensure_goal_not_duplicate` do [VERIFIED: ports.rs:32, queries.rs:89] |
| Cross-store parity assertion | New test harness | `parity_in_memory_vs_persistent` idiom (date_view.rs:160) | Seed one fixture into both stores, compare by stable key (title, not id) [VERIFIED: date_view.rs:160] |

**Key insight:** Phase 4's "newness" is almost entirely the recursive-CTE SQL and the explicit InMemory parity loader. Every other building block already exists and is tested — the plan should be heavy on *reuse* and light on *new logic*. The biggest risk is accidental scope creep into the global `list_items` rewrite.

## Runtime State Inventory

> Not a rename/refactor/migration phase. This is additive read-only feature work — no stored data, service config, OS state, secrets, or build artifacts are renamed or migrated.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — no schema change; reads existing `items` rows. CORE-02 already locked "no new `period_key` column"; period derives from `(horizon, scheduled)`. | None |
| Live service config | None — no new service/config; method is consumed by CLI/API only in Phase 5 | None |
| OS-registered state | None | None |
| Secrets/env vars | None | None |
| Build artifacts | None — no package rename | None |

**Nothing found in any category:** verified — this phase adds one read-only service method, one read-only repo method, one test file, and a shared type. The schema and existing indexes are unchanged (Phase 1 already created `idx_items_parent_id`, `idx_items_scheduled`, `idx_items_type_horizon_scheduled`).

## Common Pitfalls

### Pitfall 1: Root identity — exact-match goals, not just `parent_id IS NULL`
**What goes wrong:** Treating "root goals of the period" as top-level (`parent_id IS NULL`) goals. The exact-match set can include a finer goal nested under a *coarser* goal that itself lives in a different period.
**Why it happens:** Intuition conflates "tree root" with "no parent."
**How to avoid:** Per D-02, roots = **every goal whose `(horizon, scheduled)` equals the requested `(horizon, period_key)`**, irrespective of its own `parent_id`. GOAL-04 guarantees same-horizon goals can't nest under each other, so the matched goals are mutual siblings → all roots. Do **not** climb to ancestors. The recursive CTE seed query encodes exactly this (`type='goal' AND horizon=? AND scheduled=?`), so the seed *is* the root set.
**Warning signs:** A goal that should head the view is missing because it had a non-null `parent_id`; or duplicate appearance of a subtree because you both matched it as a root and pulled it as a descendant of another period's view.

### Pitfall 2: `period` parameter normalization vs validation
**What goes wrong:** Caller passes an arbitrary in-period date (e.g. `2026-06-15` for a month) and the view returns empty because goals are stored at the canonical start (`2026-06-01`).
**Why it happens:** Goal anchors are strictly canonical (GOAL-03), but a *query* period may be any day in the period.
**How to avoid:** Derive the period key by `normalize_to_period_start(parse_day(period), horizon)` before matching — do not require the caller to pass the canonical start. (Decide explicitly and document: does `period_view` accept any in-period date and normalize, or require the canonical start? Recommendation: **normalize** for ergonomics — it mirrors how a user thinks "show me June".) This is a Claude's-discretion signature decision; either is defensible but **normalizing is more forgiving and harder to misuse**.
**Warning signs:** Empty views for valid periods; off-by-a-week errors at year/week boundaries (ISO Monday can fall in the prior calendar year — `horizon.rs` already handles this if you go through `normalize_to_period_start`).

### Pitfall 3: InMemory loader diverging from the SQL CTE (D-11)
**What goes wrong:** The Persistent path uses `UNION` semantics (dedup, type filter `IN ('goal','task')`); a hand-written InMemory walk forgets to dedup, includes non-goal/non-task children, or stops at a different depth → parity test fails or, worse, passes weakly.
**Why it happens:** Two implementations of the same set operation drift.
**How to avoid:** Make the InMemory loader compute the **exact same set**: seed = goals matching `(horizon, period_key)`; then BFS/DFS over `parent_id` collecting any `goal`/`task` whose `parent_id` is in the frontier, deduping by id, until no new ids. Then the *same* `assemble()` builds the tree. Keep the working-set computation and the tree assembly in separate functions so only the loader differs between stores — the assembler is shared, which is what the parity test ultimately validates. Note the InMemory store's `list_items` returns hidden-by-default-filtered rows unless `status`/`include_archived` is set (apply_list_filter line 39-42) — make sure the SQL CTE applies the *same* visibility policy, or the two diverge on terminal items. **Resolve this together with the D-07 status-filter decision below.**
**Warning signs:** `parity_in_memory_vs_persistent` red; or it passes but a hand check shows different node counts.

### Pitfall 4: Hidden-by-default / status visibility mismatch between SQL and InMemory
**What goes wrong:** `apply_list_filter` hides `hidden_by_default_status` rows unless a status filter or `include_archived` is set (ports.rs:39-42). The raw recursive CTE above selects *all* matching rows including terminal/hidden ones. If the InMemory loader goes through `list_items` (which applies the hidden-by-default filter) and the SQL CTE doesn't, the two stores disagree on whether a `completed`/`dropped` goal or task appears.
**Why it happens:** The SQL pushdown bypasses `apply_list_filter`, which is where the visibility policy lives today.
**How to avoid:** **Decide the visibility policy once (D-07) and apply it identically on both sides.** Two consistent options:
  1. **Open-only (recommended for tasks):** filter tasks to `OPEN_STATUSES` (Proposed/Approved/Active) on both paths — mirrors the date view (queries.rs:10) and `open_tasks`. Add the status predicate to the CTE's task branch AND to the InMemory task collection.
  2. **Structure-complete:** include terminal goals/tasks so the decomposition is fully visible. Then the SQL CTE selects all, and the InMemory loader must NOT go through the hidden-by-default filter (pass `include_archived: true` or a status-bearing filter) so it matches.
Whichever is chosen, **the two stores must apply the identical predicate** or D-11 parity breaks. See the D-07 recommendation below.

### Pitfall 5: Forgetting `time::Date` is `Ord` but stored as TEXT
**What goes wrong:** Comparing `scheduled` strings lexically vs parsing to `Date`.
**Why it happens:** `scheduled` is a TEXT column; ISO `YYYY-MM-DD` happens to sort lexically == chronologically, but timestamped values (`...T..`) or junk break that.
**How to avoid:** For the period *match* use exact string equality on the canonical anchor (`scheduled = :period_key`) — goal anchors are always canonical `YYYY-MM-DD` (GOAL-03), so exact-string match is correct and index-friendly. For *sorting* use `iso_day` (parses to `Date`) as the date view already does. Don't mix the two.

## Code Examples

### Period-key derivation (reuse existing domain helper)
```rust
// Source: todo-engine/src/domain/horizon.rs:75 (existing, no change)
// In queries.rs:
let day = parse_day(period)?;                                  // mod.rs:222
let period_key = normalize_to_period_start(day, horizon);      // horizon.rs:75
let period_key_str = /* format Date back to YYYY-MM-DD */;     // matches stored canonical anchor
```

### Visited-set + depth-cap walk (reuse Phase 2 idiom)
```rust
// Source: todo-engine/src/application/service/goal.rs:81-101 (existing pattern to mirror)
let mut visited: HashSet<String> = HashSet::new();
let mut depth = 0usize;
// during recursion:
if !visited.insert(node.id.clone()) { anomaly_count += 1; /* sever, do NOT recurse */ }
depth += 1;
if depth > MAX_GOAL_DEPTH { anomaly_count += 1; /* stop descent */ }
```
Note: `MAX_GOAL_DEPTH` is currently `const` and private to `goal.rs` (goal.rs:11). To reuse it in `queries.rs`, promote it to `pub(super)` at the `service` module level (or re-declare per the `pub(super)` convention — layers.md "never widen to `pub`"). [VERIFIED: goal.rs:11; layers.md "pub(super) convention"]

### Parity test skeleton (reuse Phase 3 idiom)
```rust
// Source: todo-engine/tests/integration/date_view.rs:159 (pattern to mirror)
#[test]
fn parity_in_memory_vs_persistent() {
    let mut mem = TodoService::in_memory();
    let (_dir, mut disk) = persistent_service();
    seed_goal_tree(&mut mem);    // identical fixture (distinct titles as stable keys)
    seed_goal_tree(&mut disk);
    let mem_view = mem.period_view(Horizon::Month, "2026-06-01").unwrap();
    let disk_view = disk.period_view(Horizon::Month, "2026-06-01").unwrap();
    assert_eq!(tree_keys(&mem_view), tree_keys(&disk_view)); // flatten tree → Vec<(title, depth, kind)>
}
```
`persistent_service()` is copy-pasted in both `date_view.rs` and `goal_view.rs` — copy it again into `period_view.rs` (the tests don't share a support module outside e2e). Build keys from `title` (+ depth/path), never raw id (in-memory uses `goal_000001`, persistent uses UUID). [VERIFIED: date_view.rs:10-17,81-86]

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Date view (Phase 3) got store parity "for free" by synthesizing over `list_items` | D-10 splits Persistent (SQL CTE) from InMemory (Rust walk) | This phase | Parity is now an explicit, tested responsibility (D-11) — it is no longer automatic |
| All reads go through `list_items` full-table-scan + `apply_list_filter` | Period-view load uses an indexed recursive CTE (this path only) | This phase | First index-backed read in the engine; global rewrite remains deferred debt |

**Deprecated/outdated:** None. The recursive-CTE feature has been stable in SQLite since 3.8.3 (2014); the bundled 3.45.3 is current. No deprecated API.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Bundled SQLite supports `RECURSIVE` CTE with no feature flag | Standard Stack | Low — verified 3.45.3 via Cargo.lock + bundled_version.rs; recursion is core SQLite, not an optional compile flag |
| A2 | Recommending **normalize** (accept any in-period date) over requiring canonical start for the `period` param | Pitfall 2 | Low — both work; this is an ergonomics call left to the planner (Claude's discretion D). If wrong, the method just requires canonical input. |
| A3 | `MAX_GOAL_DEPTH` can be promoted to `pub(super)` and shared | Code Examples | Low — matches the layers.md `pub(super)` convention; alternatively re-declare the constant in `queries.rs` |

**Note:** No external/compliance/security claims are assumed. The genuinely open *decisions* (not assumptions) are D-07 status policy and the load-strategy choice — both are addressed with grounded recommendations below and in Open Questions.

## Open Questions (RESOLVED)

1. **D-07: Task (and goal) status visibility in the structure view**
   - What we know: The date view uses an **open-only allowlist** (`OPEN_STATUSES` = Proposed/Approved/Active, queries.rs:10) and `apply_list_filter` hides `hidden_by_default_status` rows by default. ADR-0006 says goal terminality does **not** cascade — a terminal goal can have live children, and a live goal can have terminal tasks.
   - What's unclear: Whether a *structure* view should show terminal (completed/dropped) tasks and goals so the decomposition is complete, or hide them like the date view.
   - **Recommendation (grounded):** Treat **goal visibility and task visibility separately** (ADR-0006 demands it):
     - **Goals:** include terminal goals in the tree structure (a completed month-goal still frames its period's plan; hiding it would orphan live children). This honors "a child can outlive a terminal parent; treat parent terminality as informational" (ADR-0006 consequences).
     - **Tasks:** reuse the **open-only `OPEN_STATUSES` allowlist** (D-05/date-view consistency) — a structure view of *actionable* decomposition is the common need, and it matches the date view's task semantics so the two views agree on which tasks "exist." This is the lower-surprise default and reuses existing constants.
     - Apply the chosen predicate **identically in the SQL CTE and the InMemory loader** (Pitfall 4). Final call is the planner's, but this split (goals: all; tasks: open-only) is the most defensible and the cheapest to implement.
   - Note: whichever is chosen, the recursive CTE's *traversal* should still descend through terminal **goals** (else live grandchildren are lost) even if you later filter terminal goals from display — i.e. filter at display, traverse fully.
   - **RESOLVED (Phase 4 planning, D-07):** Goals = keep terminal goals in the structure AND traverse THROUGH them (live grandchildren survive, per ADR-0006); Tasks = open-only via the `OPEN_STATUSES` allowlist (Proposed/Approved/Active). The predicate is applied identically on the SQL CTE (04-02) and InMemory loader (04-01), sourced from the single `OPEN_STATUSES` constant.

2. **Load strategy: recursive CTE vs hybrid — final pick**
   - What we know: CTE does it in one indexed query; hybrid (indexed goal `WHERE` + one `parent_id IN (...)` task fetch) needs a host-side goal walk and ≥2 queries.
   - **Recommendation:** **Recursive CTE.** It is the single-query, single-load answer that most directly satisfies SC3's "load the working set ONCE," exercises both relevant indexes, and keeps the host code simple (one prepared statement, reuse `row_to_item`). The hybrid is the documented fallback if a CTE complication arises (e.g. needing different visibility rules for goals vs tasks in one query — solvable with a `CASE`/typed UNION branch, see Pitfall 4 option).
   - **RESOLVED (Phase 4 planning, D-10):** Recursive CTE (`load_period_subtree` in repo.rs, 04-02) — a single `WITH RECURSIVE` query seeded on the period roots and walking `parent_id`, confined to a new method (global `list_items` scan untouched). Hybrid load rejected as unnecessary.

3. **Where does `PeriodView`/`GoalNode` live and what is "period meta"?**
   - What we know: Must be a single shared `serde`-serializable type in `queries.rs` (CORE-03/SC4).
   - Recommendation: Define both types in `queries.rs`, `#[derive(Debug, Clone, Serialize, Deserialize)]`. Period meta = at minimum the requested `horizon` (string) and the normalized `period_key` (string), so adapters can render a header without re-deriving. Include the anomaly signal (`anomaly_count: usize` recommended over `truncated: bool` — a count is strictly more informative and the adapter can render "⚠ N nodes truncated" or nothing if 0).
   - **RESOLVED (Phase 4 planning, D-01/D-09):** `PeriodView`/`GoalNode` live in `application/service/queries.rs` (04-01), both `#[derive(Debug, Clone, Serialize, Deserialize)]`. Period meta = `horizon: String` + `period_key: String`; anomaly signal = `anomaly_count: usize` (chosen over `truncated: bool`).

## Environment Availability

> No new external dependencies. The only runtime dependency is the bundled SQLite, statically linked via `rusqlite` `bundled`.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| SQLite (bundled) | recursive CTE load path | ✓ | 3.45.3 (statically bundled) | — |
| `rusqlite` | repo layer | ✓ | 0.32 | — |
| `tempfile` (dev) | persistent/parity tests | ✓ | in tree | — |

**Missing dependencies with no fallback:** none
**Missing dependencies with fallback:** none

## Validation Architecture

> Nyquist validation is enabled (`workflow.nyquist_validation: true`).

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Rust built-in `#[test]` + `cargo test` (three test binaries: unit/integration/e2e) |
| Config file | none (Cargo convention); see `docs/conventions/testing.md` for the layered-binary split |
| Quick run command | `cargo test --test integration period_view` |
| Full suite command | `cargo test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| VIEW-03 | `(horizon,period)` → root goal(s) + descendant goal+task subtree as a tree (structure-only) | integration | `cargo test --test integration period_view::persistent_period_view_builds_subtree` | ❌ Wave 0 |
| VIEW-03 | Roots = exact `(horizon,period)` match (siblings all roots; no ancestor climb) — D-02 | integration | `cargo test --test integration period_view::roots_are_exact_period_matches` | ❌ Wave 0 |
| VIEW-03 | Descendant from a different period is included via `parent_id` (D-03); finer goal under a different-period parent is NOT a root here (D-03a) | integration | `cargo test --test integration period_view::descendants_cross_period_included` | ❌ Wave 0 |
| VIEW-04 | Unscheduled goal-internal task is surfaced inline in `GoalNode.tasks`, never dropped | integration | `cargo test --test integration period_view::unscheduled_task_surfaced` | ❌ Wave 0 |
| SC3 | Cyclic legacy `parent_id` terminates (visited+depth) and bumps anomaly_count; view returns Ok | integration | `cargo test --test integration period_view::cycle_is_severed_no_error` | ❌ Wave 0 |
| SC3 | Over-deep chain (> MAX_GOAL_DEPTH) is capped, anomaly_count bumped, no Err | unit or integration | `cargo test --test integration period_view::depth_cap_truncates` | ❌ Wave 0 |
| SC3/CORE-03 | View is side-effect-free (no audit events written) | integration | `cargo test --test integration period_view::period_view_is_side_effect_free` | ❌ Wave 0 |
| CORE-03 / D-11 | InMemory and Persistent produce identical trees (stable-key compare) | integration | `cargo test --test integration period_view::parity_in_memory_vs_persistent` | ❌ Wave 0 |
| D-05/D-06 | In-node task order (sort_date_view) and child_goals order (scheduled asc) deterministic | integration | `cargo test --test integration period_view::node_ordering_is_deterministic` | ❌ Wave 0 |
| D-07 | Chosen status policy: terminal goals included, terminal tasks excluded (or chosen variant) — applied identically both stores | integration | `cargo test --test integration period_view::status_visibility_policy` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `cargo test --test integration period_view` + `cargo clippy --all-targets --all-features -- -D warnings`
- **Per wave merge:** `cargo test` (all three binaries — e2e/integration parity must stay green per CLAUDE.md)
- **Phase gate:** `cargo fmt --check` + `cargo clippy -- -D warnings` + full `cargo test` green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `todo-engine/tests/integration/period_view.rs` — new file; covers all rows above. Copy `persistent_service()`/`open_task`/`keys` idioms from `date_view.rs`.
- [ ] A seed helper that builds a multi-period goal tree (year → month → week, with cross-period children and an unscheduled task) with distinct titles as stable keys.
- [ ] A `tree_keys()` flattener (tree → ordered `Vec<(title, depth, kind)>`) for parity comparison (the tree is nested, unlike the flat date-view vec — the comparison key must capture structure, not just membership).
- [ ] A deliberately-cyclic / orphaned fixture for the SC3 anomaly tests. Since the service rejects cycles at *create* time (goal.rs validation), the cycle must be injected at the **store** level (write rows directly to the temp SQLite, or construct an InMemory map with a back-edge) — the service's own API can't create one. **Plan must account for this**: the anomaly tests need a low-level fixture path that bypasses `validate_goal_nesting`.

*Note:* `cargo test --test integration <filter>` — the integration binary is `integration`; the `period_view` filter narrows to the module. Confirm the exact binary name against `Cargo.toml [[test]]` entries during Wave 0.

## Security Domain

> `security_enforcement: true`, `security_asvs_level: 1`. This phase is a local-first, read-only query over an existing SQLite DB with no new network surface, no auth, no user-supplied free text persisted.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No auth surface added (local-first; API auth is an out-of-scope CONCERNS.md item) |
| V3 Session Management | no | No sessions |
| V4 Access Control | no | OS-user owns the data home; no per-row authz in v1 |
| V5 Input Validation | yes | `horizon`/`period` inputs validated via existing `parse_day` (rejects junk → `TodoError::Validation`) and `Horizon::from_str`; no new validation primitive needed |
| V6 Cryptography | no | None |
| V5.3 (Injection) | yes | **Parameterized SQL only** — the recursive CTE MUST bind `:horizon` and `:period_key` via `params!`/`?N`, never string-interpolate. The column-list portion (`item_select_sql`) is a fixed internal constant, not user input. |

### Known Threat Patterns for Rust/rusqlite/SQLite

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SQL injection via `horizon`/`period` | Tampering | Bind as parameters (`?N`); CONCERNS.md confirms the repo is already "fully parameterized" — keep the CTE the same. Never build the WHERE values via `format!`. |
| Unbounded recursion / DoS on cyclic legacy data | Denial of Service | `UNION` (dedup) at SQL level + visited-set + `MAX_GOAL_DEPTH` cap in memory (SC3, D-08). The CTE produces a finite working set; the assembler is depth-bounded. |
| Resource exhaustion on a pathological wide tree | Denial of Service | Working set is bounded by reachable `parent_id` descendants of the period's roots — naturally scoped; not the whole table. Personal/local workload (CONCERNS.md scaling note). |
| Information leak (terminal items surfaced) | Information Disclosure | Not a security concern here (single-user local DB); but the D-07 status policy controls what is shown — apply it consistently. |

No `block_on: high` security issues identified for this phase: read-only, parameterized, local, depth-bounded.

## Sources

### Primary (HIGH confidence)
- `todo-engine/Cargo.toml`, `Cargo.lock` (lines 578-581) + `libsqlite3-sys-0.30.1/.../bindgen_bundled_version.rs` — bundled SQLite 3.45.3, recursive-CTE support confirmed
- `todo-engine/src/application/service/queries.rs` — `sort_date_view`, `iso_day`, `OPEN_STATUSES`, `open_tasks`, `list_items` (reuse targets)
- `todo-engine/src/application/service/goal.rs` — `MAX_GOAL_DEPTH=64`, visited-`HashSet` ancestor-walk idiom (D-08 source)
- `todo-engine/src/application/ports.rs` — `ListFilter`/`apply_list_filter`, hidden-by-default visibility policy (D-11 InMemory + Pitfall 4)
- `todo-engine/src/infrastructure/sqlite/{repo,schema,mapping,mod}.rs` — list_items full-scan, Phase 1 indexes, `item_select_sql`/`row_to_item`, `connect`
- `todo-engine/src/domain/horizon.rs` — `normalize_to_period_start`, `is_period_start`, `is_coarser_than` (period-key derivation, D-02)
- `todo-engine/tests/integration/{date_view,goal_view}.rs` — `persistent_service`/`parity_in_memory_vs_persistent` idioms (D-11)
- `docs/architecture/decisions/adr-0006-goal-itemstatus-semantics.md` — no-cascade lock (D-07 reasoning)
- `docs/architecture/layers.md` — `pub(super)` convention
- `.planning/codebase/CONCERNS.md` — full-table-scan debt (D-10 target), unused indexes, parameterized-SQL confirmation
- `README.md` §### Goal — authoritative Goal data model
- `.planning/phases/04-.../04-CONTEXT.md` — all locked decisions

### Secondary (MEDIUM confidence)
- None — all claims grounded in the codebase or shipped docs.

### Tertiary (LOW confidence)
- None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new deps; bundled SQLite version verified directly from Cargo.lock + bundled header
- Architecture (load strategy / tree assembly): HIGH — recursive CTE is standard SQLite, all reuse primitives read directly from source
- Pitfalls: HIGH — derived from reading the actual visibility policy (`apply_list_filter`), the existing sort/parse helpers, and the goal-creation cycle-rejection (which forces the SC3 test fixture insight)
- D-07 status policy: MEDIUM (decision, not fact) — grounded recommendation given; final call is the planner's per CONTEXT discretion

**Research date:** 2026-06-25
**Valid until:** 2026-07-25 (stable — internal codebase + a SQLite feature unchanged since 2014)
