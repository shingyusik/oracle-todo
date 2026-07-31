# Frontend UI Command

## Goal

Provide one short command from `frontend/` that builds the static frontend and
starts Raven UI with browser session authentication.

## Design

- Add `npm run ui` to `frontend/package.json`.
- Run the existing frontend build before starting Raven.
- Start `raven-cli ui` through the workspace manifest at `../Cargo.toml`.
- Serve the generated `out/` directory and let Raven open the browser session
  bootstrap endpoint.
- Stop immediately when the frontend build fails.
- Keep the removed unauthenticated `dev:with-api` command absent.

## Verification

- Extend the package-script architecture test with the exact `ui` command.
- Observe the new assertion fail before adding the package script.
- Run the focused architecture test, frontend type check, and frontend build.
