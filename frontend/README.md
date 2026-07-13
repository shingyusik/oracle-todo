# frontend

Next.js workbench frontend for `todo-engine`.

## Commands

```bash
npm install
npm run dev
npm run dev:with-api
npm run test
npm run typecheck
npm run build
```

Run the frontend with the Rust API:

```bash
npm run dev:with-api
```

The frontend calls `/todo-engine/*`; `next.config.mjs` proxies those requests to
the Rust API during development. `npm run dev:with-api` starts the Rust API from the
workspace root on `127.0.0.1:3102` and the Next.js dev server on `127.0.0.1:3101`, so
it can run alongside the packaged `oracle-todo ui` runtime on `3001`/`3002`. The root
`.env` still selects the development SQLite data home through `TODO_ENGINE_HOME`.

Override the development ports in the workspace root `.env` when needed:

```env
TODO_ENGINE_DEV_UI_PORT=3201
TODO_ENGINE_DEV_API_PORT=3202
```

Shell variables also work and take precedence over `.env`:

```bash
TODO_ENGINE_DEV_UI_PORT=3201 TODO_ENGINE_DEV_API_PORT=3202 npm run dev:with-api
```

When running `npm run dev` by itself, set `TODO_ENGINE_API_URL` to choose the API target;
otherwise the development rewrite falls back to `http://127.0.0.1:3002`.

## Architecture

- `src/app`: thin route entries.
- `src/design`: tokens, copy, and layout constants.
- `src/domain`: pure policy and navigation rules.
- `src/features`: workbench model, controller hooks, and UI.
- `tests`: architecture, domain, and presentation tests.
