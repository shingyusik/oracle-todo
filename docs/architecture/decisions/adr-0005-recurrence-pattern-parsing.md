# ADR-0005: Recurrence parsing is pattern-based

## Status

Accepted (v1).

## Context

Routines need a `recurrence_rule` to materialize tasks. A naive design enumerates one parser
branch per literal string ("daily", "every monday", "every 15th", …). That does not scale:
every new cadence needs new code, and Korean/English variants multiply the table. The rules
the engine must support — intervals, weekday sets, monthly day-of-month, month-end — share
an obvious structure.

## Decision

Recurrence is parsed by a small *pattern* grammar in `domain::occurrences`, not a fixed
one-rule-per-string table. The verified behavior (from `src/domain/recurrence.rs`):

- **Alias normalization first.** `daily`/`매일` → `every day`, `weekly`/`매주` → `every week`,
  `monthly`/`매월` → `every month`, `yearly`/`매년` → `every year`. The raw rule is trimmed and
  lowercased before matching.
- **Weekday sets** (`parse_weekday_set`) handle, in order: named sets
  (`weekdays`/`평일`/`월-금` → Mon–Fri; `weekend`/`주말`/`토-일` → Sat–Sun; `월-일` → every day);
  a single weekday alias (`mon`/`monday`/`월`, …); a dash/tilde **range**
  (`mon-fri`, wrapping when start > end); a **list** separated by comma/slash/whitespace
  (`mon,wed,fri`, `mon wed fri`); and a run of Korean weekday characters (`월수금`). Short and
  long English aliases and Korean characters all normalize to the same weekday index.
- **Interval rules** (`parse_interval_rule`) match `every [N] <unit>` with an optional
  `on <anchor>`:
  - `<unit>` is `day(s)` / `week(s)` / `month(s)` / `year(s)`. The default count is 1 when no
    number is given.
  - `every N day(s)` — anchor is **not** allowed (`every 2 days on mon` is unsupported);
    `interval < 1` is unsupported.
  - `every N week(s)` — unanchored steps every N weeks from the window start; with an anchor,
    the anchor must be a weekday set, and occurrences fall on those weekdays every N weeks.
  - `every N month(s)` — unanchored defaults to **day 1** of each month; `on the <day>`
    (`on the 15th`) targets that day, **clamped to the month length** (so `the 31st` becomes
    Feb 28/29); `on the last` targets the last day of each month; the day must be `1..=31`.
  - `every N year(s)` — anchor is not allowed; occurrences fall on **Jan 1** of every Nth year.
- **Empty window** (`start > end`) returns no dates. An **unrecognized** rule returns
  `RecurrenceError::unsupported(rule)`, which carries the *original* rule string for error
  messages.

The full list of supported example strings lives in `README.md`'s "Supported recurrence
examples" table; the unit tests in `tests/unit/recurrence.rs` pin the behavior.

## Consequences

- New cadences that fit the grammar (different intervals, weekday combinations, month days)
  need no new code.
- Korean and English inputs are first-class and normalize to the same internal representation.
- Edge cases are defined and tested: month-end clamping, interval `< 1` rejection, day-unit
  anchor rejection, range wraparound, and empty windows.
- `per_occurrence` materialization can rely on a deterministic, total occurrence function over
  any `[start, end]` window.
