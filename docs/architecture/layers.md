# Layers

Raven keeps engine dependencies inward:

```text
interfaces / infrastructure → application → domain
```

Domain modules perform no I/O. Application services enforce mutation policy through
repository and media ports. Infrastructure implements those ports. CLI and HTTP adapters
translate transport input and output only.

## Workspace map

| Package | Important modules | Responsibility |
| --- | --- | --- |
| `raven-cli` | `cli`, `commands`, `config`, `logging` | `raven` parser, shared paths, engine dispatch, import, API/UI/MCP process startup |
| `raven-api` | `auth`, `routes`, `dto`, `state`, `server`, `mcp` | Authenticated `/api/v1`, error contract, Dashboard composition, static UI session, MCP adapter |
| `todo-engine` | `domain`, `application`, `infrastructure`, `interfaces` | ToDo item graph, recurrence, status policy, SQLite, reusable CLI/API adapters |
| `ledger-engine` | `domain`, `application`, `infrastructure` | Money and master data, entries, transfers, reports, audit, SQLite |
| `health-engine` | `domain`, `application`, `infrastructure` | Diet, media, health events, Reports, record inspection, audit, SQLite |
| `backend` | `api` | Namespaced UI preferences stored in `todo.sqlite` |
| `frontend` | `app`, `domain`, `features` | Static ToDo Dashboard and domain workspaces |

`todo-engine` is a library crate; `raven-cli` owns the only shipped native binary.

## Engine boundaries

### ToDo

`TodoService` is the mutation boundary. CLI and API adapters reuse it, and the existing
ToDo router is mounted by `raven-api` below `/api/v1/todo`.

### Ledger

`LedgerService` owns master-data references and activation, integer-minor-unit money policy,
atomic transfer pairs, entry archive/restore, account-category confirmation-gated purge, audit, reports,
doctor checks, and export.

### Health Journal

`HealthService` coordinates `SqliteHealthRepository` with `LocalMediaStore`. Mutations that
touch both database and files preserve committed-state reporting and record pending cleanup
when a file operation cannot finish.

### Composition

`raven-cli` and `raven-api` instantiate services from paths. They may map errors and shape
DTOs but do not implement domain policy. Dashboard projection functions are read-only and
never initialize a missing database.

The MCP adapter translates strict tools to the existing in-process HTTP router, including
media operations. Domain services retain all mutation and audit policy. Discovery shares
ToDo CLI choices and UI lookups; scope-specific query schemas restrict filter/sort/group fields.

## Visibility and tests

Raven uses a dark UI with shared color and radius tokens in `frontend/src/design/tokens.ts`
and `frontend/src/styles/globals.css`. Green primary actions use a dark foreground;
cards, dialogs and menus use distinct dark surfaces. Native controls inherit `color-scheme:
dark`. The palette test checks token synchronization and text contrast. Health heatmaps
use dark diverging colors with numeric labels. UI controls use Tabler outline icons from
`@tabler/icons-react`; brand artwork remains a separate image asset.

Dashboard, Ledger and Health charts use Recharts for lines, bars, donuts and the Bristol
comparison heatmap. Charts resize to their containers, show value tooltips, and preserve
report drilldowns and keyboard controls. Line axes show compact month/day labels with
full dates in SVG titles and `data-date` attributes. Tooltips render in a viewport-bounded
portal outside scrolling cards. Short data transitions respect the reduced-motion setting.
The heatmap keeps its sample threshold, missing-data markers and bounded scroll area.

Frontend tag fields reuse `TagsInput`. Its dropdown defaults to a fixed-position portal,
placed above or below the trigger within the viewport and repositioned on scroll or resize.
Inside a modal, the portal stays under the dialog element so focus isolation and keyboard
navigation include it; outside a modal, it uses `document.body`. Dialog ancestors must not
use transforms that turn fixed positioning into container-relative positioning.

ToDo, Ledger and Health creation dialogs use the shared styled confirmation dialog before
discarding an
edited draft through Escape or Close; Health backdrop dismissal and Quick Add's Back
action use the same guard. Cancelling keeps the form and draft open. Successful saves
close directly. Drafts stay in memory and do not survive a page reload.

Diet photo fields use a clickable upload area backed by a native image file input. The
area supports keyboard focus and shows the selected filename in creation and detail forms.

Table sort controls allow each field once. Ledger normalizes repeated saved sort fields
to the latest direction while preserving the field's priority.

Engine crates expose only composition-facing types. Split implementation modules use
private or `pub(super)` visibility where possible. Unit tests cover pure domain policy;
integration tests exercise repository/service behavior; CLI/API tests verify adapter
agreement and security boundaries.
