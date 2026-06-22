# Feature Research

**Domain:** Hierarchical period-goal planning layer (year/month/week goals → top-down task decomposition → date views) on a local-first ToDo engine
**Researched:** 2026-06-22
**Confidence:** HIGH

## Scope Note

This research covers ONLY the planning layer for this milestone (the PROJECT.md "Active" requirements). The existing engine — item types, status lifecycle, approval gating, audit events, `pending`/`today` views — is treated as a given and is NOT re-evaluated here. Where a feature maps to a PROJECT.md Active requirement it is tagged `[Req: …]`.

Methodologies surveyed and how they map:

- **OKR (Objectives & Key Results)** — periodic objectives that cascade. Maps to: period-anchored goals (year/month/week as the "period"), parent/child goal nesting (cascade), and goal→task linking (objective → initiative/task). OKR's *measurement* (Key Results with numeric targets) maps to progress rollup, which PROJECT.md defers to v2.
- **GTD "Horizons of Focus"** — runway (tasks) → projects → areas → goals → vision → purpose. Maps to: the `horizon` field already in the model and the flexible-nesting requirement (a horizon level can be skipped). The engine already has Area/Project; this milestone adds the higher horizons (year/month/week goals) above them.
- **Time-horizon / cascade planning** (yearly → monthly → weekly → daily) — the classic personal-productivity decomposition. Maps directly to the year/month/week goal hierarchy plus the date view (the "daily" tier is the dated task list).
- **Calendar/date views** (day list, week view, month view, "this week", agenda-by-date) — maps to the date view and period views requirements.

## Feature Landscape

### Table Stakes (Users Expect These)

Without these the planning layer does not deliver its Core Value ("set a big goal for a period, break it top-down into tasks, see those tasks by date"). Missing any one makes the layer useless.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Create a period goal at a horizon** (year/month/week) | The entire layer is "set a big goal for a period". No goal type = no planning. | LOW | `[Req: new Goal ItemType]` New `ItemType::Goal`; reuses status lifecycle, approval gating, audit. Validation: `horizon ∈ {year, month, week}` required for goals. |
| **Anchor a goal to a specific period** | "June 2026" vs "a month goal" — a goal without a period can't appear in any period view. | LOW | `[Req: anchored via (horizon, scheduled)]` Period identity = `(horizon, scheduled)`. Decide+enforce a canonical anchor date (e.g. first day of period: `month`→`YYYY-MM-01`, `week`→Monday, `year`→`YYYY-01-01`). Without normalization, two "June" goals with different `scheduled` days won't match a period query. **This normalization rule is the single highest-leverage design detail.** |
| **Nest goals (parent → child), level-skipping allowed** | Year→month→week is the core decomposition; real planning also jumps levels (year goal → a task directly). | MEDIUM | `[Req: flexible nesting via parent_id]` Reuses `parent_id`. Must validate against cycles and (optionally) against inverted nesting (a year goal under a week goal). Decide whether to *allow* arbitrary nesting or *warn*; PROJECT.md says level-skipping is allowed, so keep validation permissive but cycle-safe. |
| **Link a task to a goal + give it a date** | The decomposition payoff: tasks under a goal, each scheduled. Powers both the goal tree and the date view. | LOW | `[Req: task connects via parent_id + scheduled]` Reuses existing `parent_id` and `scheduled`. The task already exists as a type; this is wiring, not new schema. |
| **Date view — tasks grouped by `scheduled` date for a day or range** | "See those tasks by date" is half the Core Value. Every planning/todo app has a day/agenda list. | MEDIUM | `[Req: date view]` Group by `scheduled`; support a single day and an arbitrary `[from, to]` range. Existing `today` already does "today"; this generalizes it. Note the existing CONCERN: list filtering is in-memory — a date range filter inherits that, acceptable for personal scale. |
| **Period view — roll up the goal tree for a week/month/year** | "Break it top-down" needs to be *seen* top-down: the goal plus its decomposed descendants. | MEDIUM–HIGH | `[Req: period views]` Given `(horizon, period-anchor)`, return the goal(s) for that period and their descendant subtree (goals + tasks). Tree assembly from a flat `items` table is the main work. v1 ships the *structure* only — **no completion %/rollup** (deferred). |
| **CLI subcommands for all of the above** | This milestone is explicitly "db and related CLI". Without CLI the feature is unreachable. | LOW–MEDIUM | `[Req: CLI subcommands]` `goal` create/update, link a task (likely via existing `task --parent`), and the `agenda`/`week`/`month`/`year` view commands. Markdown + JSON output per existing convention. |
| **HTTP API parity for the new surface** | Existing invariant: CLI and API are both views over the service; e2e tests assert parity. Breaking parity breaks the test suite. | LOW–MEDIUM | `[Req: API endpoints mirroring CLI]` Add routes mirroring the new CLI; reuse the `TodoService`. No new policy in the adapter. |
| **All mutations through `TodoService`; additive schema only** | Core architectural invariant — validation, state machine, audit event, no bypass; protects live data homes. | LOW | `[Req: route through service; additive schema]` Extend the `ItemType` enum; backfill is automatic since `horizon`/`parent_id`/`scheduled` columns already exist. This is the cheapest "feature" because the hooks are already present. |
| **A goal/task list filterable by horizon, period, and parent** | Users must be able to ask "show my month goals" or "tasks under goal X" — the read primitive the views are built on. | LOW | Extend the existing `ListFilter` with `horizon` and a parent/ancestor filter. The views compose this primitive. |

### Differentiators (Competitive Advantage)

Not required for the Core Value, but they make the planning layer notably better than a flat goal list and align with the agent-workflow positioning. None block v1.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Unscheduled / "inbox" surfacing within a goal** | Show tasks linked to a goal that have NO `scheduled` date — the gap between "planned" and "scheduled". This is what makes top-down decomposition *actionable*, not just hierarchical. | LOW | A filter (`scheduled IS NULL` + has goal ancestor). Cheap, high signal; natural complement to the date view. |
| **Coverage view: goals in a period with zero linked tasks** | Flags goals you set but never broke down — the #1 failure mode of period planning ("I set it and forgot it"). | LOW–MEDIUM | Read-only derivation over the tree. No new schema. Strong fit for agent review loops (agent proposes decomposition for uncovered goals). |
| **Period rollover / carry-forward of incomplete tasks** | When a week/month ends, surface or move undone tasks into the next period instead of orphaning them. | MEDIUM | Touches the state machine and `scheduled` semantics. Defer past v1, but design the date anchor so it's possible later. |
| **"Horizon ladder" navigation (drill year→month→week→day)** | Walk the GTD horizons in one coherent traversal — the methodology's signature. Differentiates from flat OKR tools. | MEDIUM | Built entirely from the period views + tree; mostly a CLI/UX composition over existing reads. |
| **Cross-period goal alignment links (a week goal references the month goal it serves)** | OKR "alignment" (vs strict cascade) — a sub-goal can point at a parent in a different period it advances. | MEDIUM | `parent_id` already expresses one alignment edge. Multiple alignment edges would need a new link table — heavier; defer. |
| **Agenda spanning scheduled + due** | Show a date with both tasks scheduled *for* that day and tasks due *on* that day. `due` and `scheduled` both already exist on items. | LOW–MEDIUM | Pure read composition over two existing columns; meaningfully richer than scheduled-only agenda. |
| **Recurrence-aware period views** | Routines/recurring items already exist (`recurrence.rs`, materialization). Surfacing materialized occurrences inside period/date views unifies planning with routines. | MEDIUM | Reuse existing materialization; integration risk is in not double-counting. |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Progress rollup / completion-% aggregation in period views** | "Show me 60% of my month goal done" is the iconic OKR/dashboard view. | Aggregation semantics are contentious (weight by task? by KR? recursive vs direct children?) and force decisions that ripple through the schema and views. PROJECT.md explicitly defers this to v2. | Ship goal-tree + date views in v1; design the tree read so rollup is a pure additive computation later. **Already an Out-of-Scope decision — do not build.** |
| **A separate `goals` table / new `period_key` column** | Feels cleaner to model goals separately or add an explicit period column. | Breaks two locked constraints: "Goal as a new ItemType (not a separate table)" and "period anchored by `(horizon, scheduled)`, no new period column". A separate table would also lose the free reuse of status/audit/approval. | Reuse the `items` table + `ItemType::Goal`; derive the period from `(horizon, scheduled)`. **Locked by Key Decisions.** |
| **New goal-specific status states** (e.g. `on_track`, `at_risk`) | OKR tools show health/confidence states. | Inventing planning-only states fragments the single status state machine and complicates every transition path and audit. | Reuse the existing `ItemStatus` lifecycle. **Locked by Out of Scope.** Health/at-risk is a v2 *derived* signal, not a stored status. |
| **Numeric Key Results / metric targets on goals** | Pure OKR fidelity — "increase X to N". | Requires a measurement model (current value, target, unit, update cadence) that is a feature program of its own and only pays off once rollup exists. | Out of scope for v1; revisit alongside progress rollup in v2. Keep goals qualitative for now. |
| **Calendar UI / drag-drop scheduling** | "I want to see a real calendar." | Frontend is explicitly deferred this milestone (backend: db + service + CLI + API). A real calendar is a UI concern, not an engine one. | The engine emits date/period views as data (Markdown/JSON); a later frontend milestone renders the calendar. **Locked by Out of Scope.** |
| **Auto-decomposition of goals into tasks (AI generates the breakdown automatically)** | Agent-workflow framing invites "let the agent fill in the tasks". | Auto-created items must respect approval gating (start `proposed`); silent auto-population would bypass the user-approval policy boundary. | Let agents *propose* decomposed tasks via the normal `proposed` path; the user approves. The engine stays the policy gate; generation is the agent's job, not a hidden engine feature. |
| **Natural-language date parsing ("next Friday", "this week")** | Modern todo apps (Todoist/TickTick) lead with NLP dates. | Adds a parsing dependency and ambiguity (locale, week-start) into a policy engine that values determinism; week-start ambiguity also collides with the period-anchor normalization rule. | Accept explicit ISO dates / explicit period anchors at the engine layer. A future frontend can do NLP and resolve to an ISO date before calling the API. |

## Feature Dependencies

```
[Goal ItemType] (new enum variant, additive schema)
    └──requires──> [Mutations through TodoService] (reuse policy/audit/approval)

[Goal anchored to period (horizon, scheduled)]
    └──requires──> [Goal ItemType]
    └──requires──> [Period-anchor normalization rule]   <-- design lynchpin

[Goal nesting (parent_id, level-skipping)]
    └──requires──> [Goal ItemType]
    └──requires──> [Cycle/relation validation in service]

[Task→goal link (parent_id + scheduled)]
    └──requires──> [Goal ItemType]
    (task type + parent_id + scheduled already exist)

[List filter by horizon/period/parent]
    └──requires──> [Goal anchored to period]
    └──requires──> [Goal nesting]

[Date view (group by scheduled)]
    └──requires──> [Task→goal link]            (only to be useful as "goal's dated tasks")
    └──requires──> [List filter (date range)]

[Period view (roll up goal tree)]
    └──requires──> [Goal nesting]
    └──requires──> [Goal anchored to period]
    └──requires──> [Task→goal link]
    └──requires──> [List filter by horizon/period]

[CLI subcommands] ──require──> all of the above (it surfaces them)
[HTTP API parity] ──mirrors──> [CLI subcommands]   (e2e parity tests enforce)

[Unscheduled-in-goal surfacing] ──enhances──> [Date view] + [Period view]
[Coverage view (goals w/o tasks)] ──enhances──> [Period view]
[Agenda spanning scheduled+due] ──enhances──> [Date view]

[Progress rollup] ──conflicts-with-v1──> [Period view]  (deferred; additive later)
```

### Dependency Notes

- **Everything depends on `[Goal ItemType]`:** It's the cheapest feature (one enum variant + automatic backfill since `horizon`/`parent_id`/`scheduled` columns already exist) and unblocks the whole layer. Build it first.
- **Period-anchor normalization is the hidden critical dependency:** Anchoring, list-filtering by period, and period views all silently break if "the month of June" doesn't map to one canonical `scheduled` value. Settle the rule (canonical first-day-of-period, explicit week-start) before building any view. It is low code but high blast radius.
- **Date view and period view are independent of each other** but both depend on the link + filter primitives — they can be built in parallel once those exist. They are the two halves of Core Value; the date view is the cheaper, more directly testable one.
- **API parity is a constraint, not optional work:** the existing e2e suite asserts CLI/API agreement; every new CLI command needs its API mirror in the same phase or the suite goes red.
- **Progress rollup conflicts with v1 only by scope, not by design** — design the tree-read so rollup is a pure additive computation over the same subtree later (no schema rework).

## MVP Definition

### Launch With (v1) — this milestone

Maps 1:1 to PROJECT.md Active requirements.

- [ ] **Goal ItemType + additive schema** — without it nothing else exists; near-zero cost given existing hooks.
- [ ] **Period anchoring via `(horizon, scheduled)` + normalization rule** — makes a goal addressable by period.
- [ ] **Flexible goal nesting via `parent_id` (cycle-safe)** — the top-down decomposition structure.
- [ ] **Task→goal link via `parent_id` + `scheduled`** — connects work to goals and to dates.
- [ ] **List filter by horizon / period / parent** — read primitive the views compose.
- [ ] **Date view (scheduled, day + range)** — half of Core Value; generalizes existing `today`.
- [ ] **Period view (goal tree for week/month/year, structure only, no rollup)** — the other half.
- [ ] **CLI subcommands for goals, linking, and the views** — the milestone's required surface.
- [ ] **HTTP API parity** — preserves the locked CLI/API-parity invariant.

### Add After Validation (v1.x)

Low-cost differentiators that ride entirely on v1 reads — add once the core tree + date views are proven.

- [ ] **Unscheduled-in-goal surfacing** — trigger: users report linked-but-unscheduled tasks getting lost.
- [ ] **Coverage view (goals with no linked tasks)** — trigger: users set goals they never decompose.
- [ ] **Agenda spanning scheduled + due** — trigger: due-dated items not showing on the day they're due.

### Future Consideration (v2+)

- [ ] **Progress rollup / completion %** — defer: contentious aggregation semantics; explicitly v2. Design tree-read to make it additive.
- [ ] **Numeric Key Results / metric targets** — defer: needs a measurement model; only valuable once rollup exists.
- [ ] **Period rollover / carry-forward** — defer: touches the state machine and date semantics.
- [ ] **Health/at-risk derived signals** — defer: derive (don't store) once rollup lands.
- [ ] **Frontend calendar UI / NLP dates** — defer: explicit Out of Scope; a later frontend milestone.

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Goal ItemType + additive schema | HIGH | LOW | P1 |
| Period anchoring + normalization rule | HIGH | LOW | P1 |
| Flexible goal nesting (cycle-safe) | HIGH | MEDIUM | P1 |
| Task→goal link (parent_id + scheduled) | HIGH | LOW | P1 |
| List filter by horizon/period/parent | HIGH | LOW | P1 |
| Date view (scheduled, day + range) | HIGH | MEDIUM | P1 |
| Period view (goal tree, structure only) | HIGH | MEDIUM | P1 |
| CLI subcommands | HIGH | MEDIUM | P1 |
| HTTP API parity | MEDIUM | MEDIUM | P1 (invariant) |
| Unscheduled-in-goal surfacing | MEDIUM | LOW | P2 |
| Coverage view (uncovered goals) | MEDIUM | LOW–MED | P2 |
| Agenda spanning scheduled + due | MEDIUM | LOW–MED | P2 |
| Progress rollup / completion % | HIGH | HIGH | P3 (v2) |
| Numeric Key Results | LOW (v1) | HIGH | P3 (v2) |
| Period rollover / carry-forward | MEDIUM | MEDIUM | P3 |
| Frontend calendar / NLP dates | MEDIUM | HIGH | P3 (other milestone) |

**Priority key:** P1 must have for this milestone · P2 add after validation · P3 future / deferred.

## Competitor / Methodology Feature Analysis

| Feature | OKR tools (Weekdone, Cascade) | GTD Horizons | Personal todo apps (Todoist, TickTick) | Our Approach |
|---------|------------------------------|--------------|----------------------------------------|--------------|
| Period goals | Quarterly/annual objectives | Goals/vision horizons | Projects + due dates | `(horizon, scheduled)`-anchored `Goal` type |
| Top-down decomposition | Cascade / alignment of OKRs | Runway→…→purpose ladder | Project → sub-tasks | `parent_id` nesting, level-skipping allowed |
| Goal→task link | Objective → initiative/task | Project → next actions | Task under project | Task `parent_id` → goal + `scheduled` |
| Date views | Weak (dashboard-centric) | N/A (methodology) | Strong: day/week/month/agenda | Date view (day+range), period views; calendar UI deferred |
| Progress | Core (KR %; health) | N/A | Completion %, streaks | Deferred to v2 (tree only in v1) |
| Measurement (KRs) | Core | Optional | Minimal | Out of scope v1 |
| Approval/audit of plan changes | Rare | N/A | None | Reused engine invariant (every mutation audited; agent items gated) — our distinct edge |

The standout: our planning layer inherits **policy enforcement, audit, and agent-approval gating for free** — something neither OKR tools nor consumer todo apps provide. That is the real differentiator, and it costs almost nothing here because the engine already provides it.

## Sources

- OKR cascading / objective-hierarchy / goal-to-task linking model — Weekdone, Cascade, What Matters, Businessmap (HIGH confidence: corroborated across 4+ established OKR vendors).
- Period goal apps (yearly/monthly/weekly decomposition into tasks) — Reclaim, Everhour, Day Designer, GoalMap, TickTick reviews (HIGH confidence: consistent feature set across apps).
- Date/calendar view conventions (day/agenda/week/month, scheduled vs due) — Todoist date docs, Todo Cloud calendar, Motion due-by (HIGH confidence).
- GTD Horizons of Focus (runway→purpose) — established methodology, training knowledge (HIGH confidence).
- Project constraints and locked decisions — `.planning/PROJECT.md`, `.planning/codebase/ARCHITECTURE.md` (HIGH confidence: authoritative project sources).

---
*Feature research for: hierarchical period-goal planning layer*
*Researched: 2026-06-22*
