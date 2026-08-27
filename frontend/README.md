# Raven frontend

The Next.js frontend is Raven's single-screen workbench. It is exported as static files and
served by `raven ui` from the same origin as the authenticated API.

## Navigation

- Dashboard: Today's work, Completion history, and Project/Area mini-donut Status analytics
- ToDo: Workspace and Planner
- Ledger: Transactions, Accounts, Categories, Reports
- Health Journal: Diet / Bowel / Medication / Health Metrics / Reports

Dashboard shows ToDo analytics only. Ledger and Health Journal start directly at their
operational views.

Active Planner tasks and events expose a Miss dialog. Users can mark the item missed only
or create an independent follow-up on a selected date; the date defaults to browser-local
tomorrow and cannot be earlier than tomorrow.

Workspace detail visits participate in browser Back and Forward navigation, including linked
details. Browser Back and the detail header Back button require confirmation before discarding
unsaved edits.

ToDo details opened from Workspace or Planner provide page-local Undo, Redo, and Save controls.
`Ctrl/Cmd+Z` undoes, `Ctrl/Cmd+Shift+Z` or `Ctrl+Y` redoes, and `Ctrl/Cmd+S` saves. Undo and Redo
change only the open draft and never mutate the server until Save is explicitly used.

Completion history reports the daily percentage of Tasks and Events scheduled or due on
each browser-local calendar date. Its Y-axis is fixed at 0–100%, and dates without eligible
work remain visible as zero-value points.

## Production artifact

Frontend source builds and tests require Node.js 22.13 or newer.

```bash
npm install
npm run test
npm run typecheck
npm run build
cargo run -p raven-cli -- ui --ui-path frontend/out --no-open
```

The static client calls relative `/api/v1/*` routes. `raven ui` provides the session-cookie
bootstrap, API, static files, and SPA fallback on one loopback origin.

## Development

Run frontend tests or the Next.js development server from this directory:

```bash
npm run test
npm run typecheck
npm run dev
```

Run the built frontend with browser session authentication:

```bash
npm run ui
npm run ui:dev
```

`npm run ui` builds the static frontend before Raven starts.
`npm run ui:dev` does the same on port `3003`, avoiding a local service already using the
default port `3002`.

`npm run dev` is suitable for frontend-only work. The configured `/api/*` rewrite targets
`RAVEN_API_URL` or `http://127.0.0.1:3002`, but standalone `raven api` requires a bearer
header that browser fetches do not inject. Use the production-artifact command above for
authenticated browser integration through the Raven UI session.

## Source layout

- `src/app` — thin Next.js entries
- `src/design` — shared tokens and copy
- `src/domain` — navigation and pure UI policy
- `src/features/dashboard` — active ToDo Dashboard presentation; reusable composed API,
  unified models, and cards remain available but are not wired into `DashboardPanel`
- `src/features/workbench` — ToDo Workspace and Planner
- `src/features/ledger` — entries, master data, and reports
- `src/features/health` — diet, events, metrics, and reports
- `tests` — architecture, model, controller, and presentation checks
