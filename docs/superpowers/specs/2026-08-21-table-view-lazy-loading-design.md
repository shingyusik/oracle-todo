# Table View Lazy Loading Design

## Goal

Keep navigation responsive as ToDo, Ledger, and Health Journal tables grow. A table loads
only its first visible batch, then appends more rows as the user approaches the end while
preserving whole-dataset filtering, sorting, and grouping.

## Scope

Lazy loading applies to:

- ToDo Workspace areas, projects, goals, routines, tasks, and events;
- ToDo Planner tables;
- ToDo detail linked-item tables;
- Ledger transactions, accounts, and categories;
- Health Journal diet, bowel, medication, and health-metric tables.

Dashboard cards and report tables remain bounded aggregate reads and do not use infinite
scrolling.

## Table Query Contract

Each domain exposes one authenticated, read-only query route:

- `POST /api/v1/todo/table/query`
- `POST /api/v1/ledger/table/query`
- `POST /api/v1/health/table/query`

`POST` carries a bounded structured query body and does not mutate state. The query body
contains:

```json
{
  "scope": "ledger.transactions",
  "offset": 0,
  "limit": 50,
  "filter_mode": "and",
  "filters": [],
  "sorts": [{"field": "date", "direction": "desc"}],
  "group_by": "month",
  "context": {}
}
```

`context` is scope-specific and denies unknown fields. Workspace, Ledger, and Health record
tables use an empty object. Planner scopes carry their selected local period. A ToDo linked
table carries the parent type and ID.

The response contains display-ready row occurrences and the next offset:

```json
{
  "items": [{
    "key": "2026-08:entry-123",
    "group_key": "2026-08",
    "group_label": "August 2026",
    "record": {}
  }],
  "next_offset": 50
}
```

`next_offset` is `null` after the final page. The default and maximum page size for table
views is 50. It is a code constant, not user configuration. Ungrouped rows use `null` group
keys and labels. `key` uniquely identifies one displayed row occurrence, including records
projected into more than one group.

Existing list routes and their response shapes remain supported for CLI, integrations,
lookups, and non-table reads. The table UI uses the table-query contract so logical table
rows can differ from raw stored records without changing domain APIs.

## Query Semantics

- Each scope has an explicit allowlist of filter, sort, and group fields matching its table
  controls.
- Unknown fields, operators, directions, malformed values, and out-of-range pages return the
  shared safe validation error.
- Filtering runs against the complete active dataset before grouping and pagination.
- Group keys precede user sort rules in database ordering.
- User sort rules run in their displayed priority order.
- The stored record ID is the final ascending tie-breaker for deterministic offset pages.
- A row belonging to multiple groups, such as a multi-tag item, becomes one row occurrence
  per matching group before pagination.
- Group labels and keys are produced by the domain query so adjacent pages can join the same
  group without loading earlier records again.

Domain application services own the query policy. SQLite repositories apply validated
filters, ordering, row-occurrence projection, `LIMIT`, and `OFFSET`; API handlers do not
filter or sort domain records in memory.

## Supporting Data

Table pages contain the labels required to render their rows. Relation pickers and filter
option menus use compact lookup reads containing only stable IDs and labels. ToDo no longer
loads every full item solely to build relation names or tag options.

Each domain serves these values from `GET /api/v1/{domain}/table/lookups?scope=<scope>`.
Responses are domain-specific bounded objects containing only the relation and tag options
allowed by that scope; they contain no notes, descriptions, media, audit history, or other
record payloads.

Lookup reads are independent of table row pagination. A lookup may return all compact values
because it does not render table rows and is required to construct a whole-dataset query.

## Frontend Behavior

- Entering a table requests offset `0` only.
- A shared bottom sentinel uses `IntersectionObserver` to request `next_offset` when it nears
  the viewport.
- A visible **Load more** control invokes the same action for keyboard access and browsers
  without observer support.
- Only one next-page request may be active for a table generation.
- Returned pages append in offset order and duplicate row-occurrence keys are ignored.
- Adjacent rows with the same `group_key` render under one group header, including across a
  page boundary.
- Changing the active tab, saved view, filter, sort, or group invalidates loaded pages and
  requests offset `0` with the new query.
- A generation number prevents a late response for an obsolete query from replacing or
  appending to current rows.

Controllers expose loaded rows, `nextOffset`, initial status, next-page status, and a
`loadMore` action. Existing table components retain their columns, row selection, detail
navigation, and saved-view controls.

## Loading and Error States

- Initial loading uses the table's existing blocking loading state.
- Next-page loading preserves all loaded rows and displays a small pending row at the bottom.
- An initial failure uses the existing blocking table error and retry action.
- A next-page failure preserves loaded rows and replaces the pending row with a retry action.
- An empty first page shows the existing empty or no-view-match state.
- A successful final page removes the sentinel and Load more control.

## Mutation Consistency

Successful create, update, archive, restore, activation, or purge actions invalidate the
affected table query and reload it from offset `0`. This avoids duplicate or skipped rows
when a mutation changes membership or ordering between offset requests. Failed mutations
preserve the current loaded pages and existing error behavior.

## Verification

Rust service and repository checks cover:

- filtering before pagination for both `and` and `or` modes;
- multiple sort rules and the stable ID tie-breaker;
- group ordering and a group spanning two pages;
- multi-group row occurrences such as tags;
- exact-limit, final partial-page, empty-page, and invalid-query behavior;
- unchanged legacy list-route response contracts.

Frontend checks cover:

- one initial request with limit 50;
- one appended request when the sentinel intersects repeatedly;
- Load more keyboard behavior and next-page retry;
- loaded-row preservation during next-page loading and failure;
- query reset after view changes and successful mutations;
- stale-response rejection and group merging across page boundaries.

Final verification runs workspace Rust formatting, tests, and Clippy plus frontend tests,
type checking, and production build.

## Non-Goals

- Cursor or keyset pagination
- User-configurable page size
- Table row virtualization
- Background draining of every page
- Infinite scrolling for Dashboard cards or report aggregates
- Prefetching domain image bytes or audit histories
