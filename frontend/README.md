# frontend

Next.js workbench frontend for `todo-engine`.

## Commands

```bash
npm install
npm run dev
npm run test
npm run typecheck
npm run build
```

Run the Rust API beside the frontend:

```bash
cargo run -p todo-engine -- api
npm run dev -- --port 3001
```

The frontend calls `/todo-engine/*`; `next.config.mjs` proxies those requests to
`http://127.0.0.1:3002/*`.

## Architecture

- `src/app`: thin route entries.
- `src/design`: tokens, copy, and layout constants.
- `src/domain`: pure policy and navigation rules.
- `src/features`: workbench model, controller hooks, and UI.
- `tests`: architecture, domain, and presentation tests.
