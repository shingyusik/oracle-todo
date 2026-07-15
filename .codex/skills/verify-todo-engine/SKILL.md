---
name: verify-todo-engine
description: Build, run, and drive todo-engine (Rust API/CLI) and the Next.js frontend to observe a change working end-to-end against a throwaway data home. Use when asked to verify, run, or drive the app, or to confirm a change works in the real app rather than only in tests.
---

# Verify todo-engine

SQLite is the source of truth. Never point a verification run at the live
data home (`~/.todo-engine/`) — always use a throwaway `--home`.

## Temp data home + API server

```bash
TMP=<scratchpad>/vhome
cargo build -p todo-engine
./target/debug/todo-engine --home "$TMP" init      # creates $TMP/todo.sqlite + logs/
./target/debug/todo-engine --home "$TMP" api       # serves 127.0.0.1:3002 (run in background)
curl -s http://127.0.0.1:3002/health               # {"ok":true}
```

The binary holds `target/debug/todo-engine.exe` open while serving — **stop the
server before `cargo test`/`cargo build`** or the rebuild fails with
`os error 5` (access denied) on Windows.

## Driving the API

Routines must be `active` before they materialize, and activation requires a
`recurrence_rule`. User-created items (`"actor":"user"`) start `approved`, not
`proposed`, so activate is one call:

```bash
curl -sX POST :3002/routines/propose -H 'content-type: application/json' \
  -d '{"title":"t","recurrence_rule":"daily","materialization_policy":"per_occurrence","future_occurrences":2,"actor":"user"}'
curl -sX POST :3002/items/<id>/activate -H 'content-type: application/json' -d '{}'
curl -sX POST :3002/routines/<id>/materialize -H 'content-type: application/json' \
  -d '{"future_occurrences":3}'
```

Error contract: policy/validation → 400, not-found → 404, storage → 500, each
with a `{"code","detail"}` body. Engine logs land in `$TMP/logs/todo-engine.log.jsonl`
(request-level errors are not logged there — read the HTTP body instead).

## Frontend

`next.config.mjs` only proxies `/todo-engine/:path*` → `127.0.0.1:3002` in
**development**, so the API server must already be running:

```bash
npm ci --prefix frontend      # node_modules is not checked in
npm run dev --prefix frontend # localhost:3000
```

Workbench navigation: `ToDo` → `Workspace` → `<Routines|Tasks|…>`, then click a
table row (`Open details for <title>`) to open the detail panel.

## Gotchas

- Korean titles render as `????` in browser screenshots (font fallback). The
  data is fine — read the DOM to confirm.
- Chrome's screenshot viewport in this setup frequently collapses to a thin
  strip and `captureScreenshot` times out. Retrying once usually works;
  `computer:zoom` on a region after `scrollIntoView` is the reliable fallback.
  Don't let a broken screenshot talk you out of checking layout.
- **A control that measures wrong is wrong.** A `getBoundingClientRect()` that
  disagrees with `getComputedStyle().width` is a real layout bug, not reflow
  noise — re-measure once the page settles and believe the second reading.
  Detail-panel fields are the known trap: `.detail-properties-list .field-label`
  makes every field a `140px | control` grid, so a field nested inside one of
  those rows needs `.detail-properties-list .<field> { grid-template-columns:
  1fr }` or its input collapses to ~21px on top of the label
  (`design-boundaries.spec.ts` guards this).
- Pre-existing on Windows, unrelated to any change under test:
  - `cargo clippy` fails on `collapsible_if` in `application/service/update.rs`
  - `cargo test --test e2e cli::init_loads_todo_engine_home_from_dotenv` fails
  - 6 `frontend/tests/architecture/design-boundaries.spec.ts` cases fail —
    they assert LF in `globals.css` but git checks it out CRLF
