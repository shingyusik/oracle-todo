---
phase: 03-date-view
reviewed: 2026-06-23T09:27:07Z
depth: standard
files_reviewed: 5
files_reviewed_list:
  - todo-engine/src/application/service/queries.rs
  - todo-engine/tests/integration.rs
  - todo-engine/tests/integration/date_view.rs
  - todo-engine/tests/unit.rs
  - todo-engine/tests/unit/date_view.rs
findings:
  critical: 0
  warning: 4
  info: 2
  total: 6
status: issues_found
---

# Phase 03: Code Review Report

**Reviewed:** 2026-06-23T09:27:07Z
**Depth:** standard
**Files Reviewed:** 5
**Status:** issues_found

## Summary

Phase 03 adds two read-only date-view query methods (`agenda`, `date_range`) plus
two private helpers (`iso_day`, `sort_date_view`) and an `OPEN_STATUSES` allowlist
to `queries.rs`, with matching unit and integration suites. The implementation is
small, well-commented, and architecturally clean: it composes `list_items` (so
in-memory/persistent parity is free), routes through `TodoService`, writes no audit
events, and reuses the existing `created_at -> id` tie-break.

No security vulnerabilities and no Critical correctness bugs were found. The methods
are pure reads with no injection surface, no unsafe code, and no unchecked indexing
(`str::get(..10)` is bounds-safe and char-boundary-safe by returning `None`).

The findings below are robustness and contract-coverage concerns. The most material
is that `date_range` accepts an inverted range (`from > to`) and silently returns an
empty result instead of surfacing a validation error, and that the explicitly
documented "junk date propagates `TodoError::Validation`" contract is not exercised
by any test in either suite.

## Warnings

### WR-01: `date_range` silently accepts an inverted range (`from > to`)

**File:** `todo-engine/src/application/service/queries.rs:76-84`
**Issue:** `date_range` parses both bounds but never checks their ordering. When a
caller passes `from > to` (e.g. `date_range("2026-06-30", "2026-06-01")`), the
predicate `from <= day && day <= to` is unsatisfiable, so the method returns an
empty `Vec` and `Ok(...)`. An inverted range is almost always a caller error
(swapped arguments), and silently returning "no results" hides the mistake — the
caller cannot distinguish "empty range" from "no tasks scheduled in range." The
sibling `parse_day` path already establishes that malformed input should yield
`TodoError::Validation`; an inverted but well-formed range is a comparable
caller-side mistake that currently escapes detection.
**Fix:** Reject the inverted range explicitly after parsing:
```rust
pub fn date_range(&mut self, from: &str, to: &str) -> TodoResult<Vec<TodoItem>> {
    let (from, to) = (parse_day(from)?, parse_day(to)?);
    if from > to {
        return Err(TodoError::Validation(format!(
            "date_range bounds inverted: from {from} is after to {to}"
        )));
    }
    let mut items = self.open_tasks()?;
    // ...
}
```
If silent-empty is the intended contract, document it on the method and add a test
asserting the empty result so the behavior is locked rather than incidental.

### WR-02: Documented `parse_day` validation contract is untested

**File:** `todo-engine/tests/unit/date_view.rs` (whole file); `todo-engine/tests/integration/date_view.rs` (whole file)
**Issue:** The doc comments on both `agenda` (queries.rs:59) and `date_range`
(queries.rs:75) make an explicit behavioral promise: "A junk `date` propagates
`TodoError::Validation` from `parse_day`." Neither the unit suite nor the
integration suite ever calls `agenda` / `date_range` with a malformed date string,
so this error-path contract is entirely unverified. A regression that, for example,
swallowed the parse error (returning `Ok(vec![])`) would pass every existing test.
Error paths are exactly where adversarial review expects coverage gaps.
**Fix:** Add a unit test asserting the error variant for each method:
```rust
#[test]
fn junk_date_is_validation_error() {
    let mut service = TodoService::in_memory();
    assert!(matches!(
        service.agenda("not-a-date"),
        Err(TodoError::Validation(_))
    ));
    assert!(matches!(
        service.date_range("not-a-date", "2026-06-30"),
        Err(TodoError::Validation(_))
    ));
    assert!(matches!(
        service.date_range("2026-06-01", "garbage"),
        Err(TodoError::Validation(_))
    ));
}
```

### WR-03: Asymmetric date parsing between query params and item fields is undocumented and untested

**File:** `todo-engine/src/application/service/queries.rs:60-61, 77, 106-108`
**Issue:** The method parameters (`date`, `from`, `to`) are parsed with
`parse_day`, which requires an exact `[year]-[month]-[day]` string — a timestamped
value like `"2026-06-23T10:00:00"` would be rejected with `TodoError::Validation`.
In contrast, item `scheduled`/`due` fields are parsed via `iso_day`, which slices
the leading 10 chars (`value.get(..10)`) and therefore *accepts* timestamped
values. This asymmetry is intentional per the design notes, but it is an
easy-to-trip edge: any future CLI/API adapter that forwards a timestamped query
parameter (rather than a bare date) will get a hard validation error rather than a
match, and nothing in the suite pins this boundary.
**Fix:** Either (a) document on `agenda`/`date_range` that query params must be bare
`YYYY-MM-DD` (no timestamp), and add a test asserting a timestamped param is
rejected; or (b) if timestamped params should be tolerated, normalize them through
the same leading-10-char slice before `parse_day`. Pick one and lock it with a test.

### WR-04: `date_range` boundary (equal bounds / single-day range) is untested

**File:** `todo-engine/tests/integration/date_view.rs:120-136`; `todo-engine/tests/unit/date_view.rs:49-63`
**Issue:** The range predicate uses inclusive bounds (`from <= day && day <= to`),
but no test exercises the inclusive endpoints directly — the existing range tests
use interior dates (06-05, 06-28 inside 06-01..06-30). An off-by-one regression
that changed `<=` to `<` on either bound (dropping items scheduled exactly on
`from` or `to`) would not be caught. Boundary inclusivity is precisely the kind of
contract that should be asserted at the edges.
**Fix:** Add a test with tasks scheduled exactly on `from`, exactly on `to`, and a
single-day range (`from == to`), asserting all boundary tasks are included:
```rust
#[test]
fn range_bounds_are_inclusive() {
    let mut service = TodoService::in_memory();
    let on_from = task(&mut service, Some("2026-06-01"), None);
    let on_to = task(&mut service, Some("2026-06-30"), None);
    let result = service.date_range("2026-06-01", "2026-06-30").unwrap();
    let order = ids(&result);
    assert!(order.contains(&on_from) && order.contains(&on_to));
    // single-day range
    let only = service.date_range("2026-06-01", "2026-06-01").unwrap();
    assert_eq!(ids(&only), vec![on_from]);
}
```

## Info

### IN-01: `OPEN_STATUSES` duplicates the `visible_statuses` allowlist in `markdown.rs`

**File:** `todo-engine/src/application/service/queries.rs:10-14`
**Issue:** `OPEN_STATUSES = [Proposed, Approved, Active]` is a verbatim copy of
`visible_statuses` in `interfaces/cli/markdown.rs:80-84` (`today_tasks`). The doc
comment acknowledges the copy ("Copied from `today_tasks`"), but two independent
literal lists of the same policy-relevant allowlist can drift: if the open-status
policy ever changes, one site can be updated and the other missed, producing
divergent date-view vs. today-view results with no compiler error. This is the kind
of policy constant that belongs in one shared location given the project's "service
layer enforces policy" invariant.
**Fix:** Hoist a single shared `pub(crate)` (or `pub(super)`) `OPEN_STATUSES`
constant (e.g. in `domain::status` or `application::service::mod`) and have both
`today_tasks` and the date-view methods reference it, so the allowlist has exactly
one source of truth.

### IN-02: `iso_day` is invoked twice per element on the hot comparator path

**File:** `todo-engine/src/application/service/queries.rs:113-123`
**Issue:** `sort_date_view`'s comparator calls `iso_day(...)` on both `left` and
`right` for every comparison, and `iso_day` re-parses the date string each time
(allocating a `parse_format_description` per call inside `parse_day`). For large
result sets this re-parses the same value O(n log n) times. This is a performance
observation only (explicitly out of v1 review scope) and is flagged purely for
awareness — it is not a correctness defect, and the sort itself is deterministic
and correct.
**Fix (optional, post-v1):** Decorate-sort-undecorate — precompute
`(Option<Date>, created_at, id)` keys once per item into a temporary, then sort by
the key. Defer unless profiling shows the date views are hot.

---

_Reviewed: 2026-06-23T09:27:07Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
