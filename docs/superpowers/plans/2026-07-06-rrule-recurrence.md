# RRULE Recurrence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store new routine recurrence rules as RRULE expressions and materialize them as date-based routine tasks.

**Architecture:** Keep the existing `recurrence_rule` column. Add RRULE parsing to `todo-engine/src/domain/recurrence.rs` before the legacy parser, then replace the workbench routine detail controls so they generate RRULE strings. No schema change.

**Tech Stack:** Rust 2024, `time`, existing cargo tests, Next/React, Vitest/Testing Library.

## Global Constraints

- New routine rules are stored as iCalendar RRULE strings.
- Existing natural-language rules remain readable for migration safety.
- Materialization still emits date-based task occurrences.
- The workbench UI builds RRULE values through condition controls, not a raw expression box.
- Supported RRULE values use `RRULE:FREQ=<DAILY|WEEKLY|MONTHLY|YEARLY>[;INTERVAL=<n>][;BYDAY=<days>][;BYMONTHDAY=<days>][;BYMONTH=<months>]`.
- `FREQ` is required.
- `INTERVAL` is a positive integer and defaults to `1`.
- `BYDAY` uses `MO,TU,WE,TH,FR,SA,SU` and applies to weekly rules only.
- `BYMONTHDAY` uses `1..31` or `-1` for the last day and applies to monthly/yearly rules.
- `BYMONTH` uses `1..12` and applies to yearly rules.
- Unsupported RRULE features are rejected with the existing unsupported `recurrence_rule` policy error.
- No schema changes.
- No new item type.
- No raw RRULE editor in the first implementation.
- No time-of-day task materialization; routines remain date-based.
- No new recurrence dependency.

---

### Task 1: Engine RRULE Occurrences

**Files:**
- Modify: `todo-engine/src/domain/recurrence.rs`
- Modify: `todo-engine/tests/unit/recurrence.rs`
- Modify: `todo-engine/tests/integration/materialization.rs`

**Interfaces:**
- Consumes: `pub fn occurrences(rule: &str, start: Date, end: Date) -> Result<Vec<Date>, RecurrenceError>`
- Produces: The same `occurrences` function accepting RRULE strings before falling back to legacy natural-language rules.

- [ ] **Step 1: Write failing unit tests**

Add tests covering:

```rust
#[test]
fn rrule_daily_interval_expands_from_window_start() {
    let got = occurrences(
        "RRULE:FREQ=DAILY;INTERVAL=2",
        date!(2026 - 01 - 01),
        date!(2026 - 01 - 07),
    )
    .unwrap();
    assert_eq!(
        got,
        vec![
            date!(2026 - 01 - 01),
            date!(2026 - 01 - 03),
            date!(2026 - 01 - 05),
            date!(2026 - 01 - 07),
        ]
    );
}

#[test]
fn rrule_weekly_byday_matches_requested_weekdays() {
    let got = occurrences(
        "RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR",
        date!(2026 - 06 - 01),
        date!(2026 - 06 - 07),
    )
    .unwrap();
    assert_eq!(
        got,
        vec![
            date!(2026 - 06 - 01),
            date!(2026 - 06 - 03),
            date!(2026 - 06 - 05),
        ]
    );
}

#[test]
fn rrule_monthly_last_day_uses_month_end() {
    let got = occurrences(
        "RRULE:FREQ=MONTHLY;BYMONTHDAY=-1",
        date!(2026 - 01 - 01),
        date!(2026 - 02 - 28),
    )
    .unwrap();
    assert_eq!(got, vec![date!(2026 - 01 - 31), date!(2026 - 02 - 28)]);
}

#[test]
fn rrule_yearly_interval_uses_month_and_monthday() {
    let got = occurrences(
        "RRULE:FREQ=YEARLY;INTERVAL=2;BYMONTH=3;BYMONTHDAY=15",
        date!(2026 - 01 - 01),
        date!(2030 - 12 - 31),
    )
    .unwrap();
    assert_eq!(
        got,
        vec![
            date!(2026 - 03 - 15),
            date!(2028 - 03 - 15),
            date!(2030 - 03 - 15),
        ]
    );
}

#[test]
fn unsupported_rrule_field_is_rejected() {
    assert!(
        occurrences(
            "RRULE:FREQ=WEEKLY;COUNT=3",
            date!(2026 - 01 - 01),
            date!(2026 - 01 - 31),
        )
        .is_err()
    );
}
```

- [ ] **Step 2: Verify tests fail**

Run: `cargo test -p todo-engine --test unit recurrence::rrule -- --nocapture`

Expected: FAIL because RRULE strings are unsupported.

- [ ] **Step 3: Implement the minimal RRULE parser**

In `occurrences`, after trimming and empty-window handling, call a private `rrule_occurrences(original_rule, normalized_rule, start, end)`.

Implement only:

- optional `RRULE:` prefix
- `;`-separated `KEY=VALUE`
- required `FREQ`
- optional `INTERVAL`
- optional `BYDAY`, `BYMONTHDAY`, `BYMONTH`
- rejection of any other key

Reuse existing helpers where possible:

- `interval_occurrences`
- `weekday_set_occurrences`
- `monthly_occurrences`
- `monthly_last_occurrences`
- `yearly_occurrences` when yearly defaults are enough
- `date`, `last_day_of_month`, `Month::try_from`

- [ ] **Step 4: Add integration coverage**

Add one case to `recurrence_matrix_covers_supported_cases`:

```rust
(
    "RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO",
    "2026-05-26",
    21,
    1,
    vec!["2026-05-25", "2026-06-08"],
),
```

- [ ] **Step 5: Verify engine tests pass**

Run:

```bash
cargo test -p todo-engine --test unit recurrence
cargo test -p todo-engine --test integration materialization
```

Expected: PASS.

### Task 2: Workbench RRULE Controls

**Files:**
- Modify: `frontend/src/features/workbench/ui/MainPanel.tsx`
- Modify: `frontend/tests/presentation/workbench-wireframe.spec.tsx`

**Interfaces:**
- Consumes: `RecurrenceRuleField` props `{ value: string; onChange: (value: string) => void }`
- Produces: `RecurrenceRuleField` still calling `onChange(nextRule)` with an RRULE string.

- [ ] **Step 1: Write a failing presentation test**

Replace the routine detail save expectation so the UI saves:

```ts
expect(init.body).toBe(
  JSON.stringify({
    recurrence_rule: "RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR",
  }),
);
```

Drive the UI by:

- opening a routine detail view
- setting `Every` to `2`
- selecting `Frequency` as `weekly`
- checking Monday, Wednesday, Friday weekday controls
- saving

- [ ] **Step 2: Verify the test fails**

Run: `npm --prefix frontend test -- workbench-wireframe.spec.tsx -t "saves routine detail recurrence rule"`

Expected: FAIL because the current UI saves `every 2 weeks`.

- [ ] **Step 3: Replace the recurrence detail controls**

Keep `RecurrenceRuleField` local to `MainPanel.tsx`.

Controls:

- `Every` number input, min `1`, max `365`
- `Frequency` select: `daily`, `weekly`, `monthly`, `yearly`
- Weekly weekday checkboxes labeled Monday through Sunday
- Monthly/yearly month-day number input, min `1`, max `31`
- Monthly/yearly checkbox labeled `Last day of month`
- Yearly month select with values `1..12`
- Read-only generated preview text

Formatting rules:

- Daily: `RRULE:FREQ=DAILY` plus `;INTERVAL=N` when N is not `1`
- Weekly: `RRULE:FREQ=WEEKLY` plus interval and `;BYDAY=...` when weekdays are selected
- Monthly: `RRULE:FREQ=MONTHLY;BYMONTHDAY=1` by default, or `-1` when last day is checked
- Yearly: `RRULE:FREQ=YEARLY;BYMONTH=1;BYMONTHDAY=1` by default

- [ ] **Step 4: Keep legacy values editable**

When `value` is a legacy rule, initialize controls to daily/every 1 and save RRULE after the user changes a control.

- [ ] **Step 5: Verify frontend tests pass**

Run: `npm --prefix frontend test -- workbench-wireframe.spec.tsx -t "saves routine detail recurrence rule"`

Expected: PASS.

### Task 3: Documentation Sync

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture/data-model.md`
- Modify: `docs/architecture/decisions/adr-0005-recurrence-pattern-parsing.md`

**Interfaces:**
- Consumes: final engine/UI behavior from Tasks 1 and 2.
- Produces: docs that describe RRULE as the current rule format and legacy parsing as compatibility behavior.

- [ ] **Step 1: Update docs after code passes**

Replace the supported recurrence examples with RRULE examples and keep a short compatibility note for legacy values.

- [ ] **Step 2: Verify docs mention RRULE**

Run: `rg -n "RRULE|legacy|recurrence_rule" README.md docs/architecture/data-model.md docs/architecture/decisions/adr-0005-recurrence-pattern-parsing.md`

Expected: The current format is RRULE and legacy parsing is described only as compatibility.

### Task 4: Final Verification

**Files:**
- No direct edits unless verification reveals a bug.

- [ ] **Step 1: Run Rust checks**

```bash
cargo fmt --check
cargo test
cargo clippy --all-targets --all-features -- -D warnings
```

- [ ] **Step 2: Run frontend checks**

```bash
npm --prefix frontend test -- workbench-wireframe.spec.tsx -t "saves routine detail recurrence rule"
npm --prefix frontend test
```

- [ ] **Step 3: Fix only failures caused by this change**
