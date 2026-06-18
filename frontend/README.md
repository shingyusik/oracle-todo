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

## Architecture

- `src/app`: thin route entries.
- `src/design`: tokens, copy, and layout constants.
- `src/domain`: pure policy and navigation rules.
- `src/features`: workbench model, controller hooks, and UI.
- `tests`: architecture, domain, and presentation tests.
