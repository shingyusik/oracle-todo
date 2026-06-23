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
`http://127.0.0.1:3002/*`. `npm run dev:with-api` starts the Rust API from the
workspace root, so `TODO_ENGINE_HOME` from the root `.env` selects the SQLite data home.

## Architecture

- `src/app`: thin route entries.
- `src/design`: tokens, copy, and layout constants.
- `src/domain`: pure policy and navigation rules.
- `src/features`: workbench model, controller hooks, and UI.
- `tests`: architecture, domain, and presentation tests.
