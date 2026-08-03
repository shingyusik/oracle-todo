# Raven frontend

The Next.js frontend is Raven's single-screen workbench. It is exported as static files and
served by `raven ui` from the same origin as the authenticated API.

## Navigation

- Dashboard: combined ToDo, Ledger, Health Journal, and recent-activity projections
- ToDo: Workspace and Planner
- Ledger: Transactions, Accounts, Categories, Reports
- Health Journal: Timeline, Diet, Bowel, Medication, Health Metrics, Trends

Dashboard is the only overview. Ledger and Health Journal start directly at their
operational views. If one Dashboard domain is unavailable, its card shows an error while
the other domain cards remain usable.

## Production artifact

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
- `src/features/dashboard` — unified summaries and recent activity
- `src/features/workbench` — ToDo Workspace and Planner
- `src/features/ledger` — entries, master data, and reports
- `src/features/health` — timeline, diet, events, metrics, and trends
- `tests` — architecture, model, controller, and presentation checks
