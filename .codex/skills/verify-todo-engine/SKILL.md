---
name: verify-todo-engine
description: Use when asked to build, run, or verify Raven CLI, API, or UI behavior against a throwaway data home.
---

# Verify Raven

Read `docs/operations/verification-and-smoke.md` and the relevant CLI/API reference.
Run mutations, imports, migrations, archive/restore, and purge checks only against a
new temporary home. Never use live Raven or source ToDo data.

## Build and CLI smoke

```powershell
cargo build -p raven-cli
$smokeHome = Join-Path ([IO.Path]::GetTempPath()) "raven-smoke-$([guid]::NewGuid())"
$ravenBin = (Resolve-Path target/debug/raven.exe).Path
& $ravenBin --home $smokeHome init
& $ravenBin --home $smokeHome health-check
& $ravenBin --home $smokeHome todo task create "Smoke task"
& $ravenBin --home $smokeHome todo list --format json
```

On Unix, use `smoke_home="$(mktemp -d)"` and `target/debug/raven`.
Mutations print JSON. Use `--format json` for reads and `--error-format json`
for structured errors. Inspect the exit code and stdout/stderr separately.

## API and UI

All HTTP access uses `raven api` or `raven ui`; `raven todo api` is unsupported.
API requests use `/api/v1/<domain>` and bearer authentication. API errors have
`{code,message,fields,request_id}`. Only `/healthz` is unauthenticated.

```powershell
$env:RAVEN_API_TOKEN = 'smoke-token-0123456789'
$env:RAVEN_API_BIND_PORT = '39002'
& $ravenBin --home $smokeHome api
```

Use another terminal to request `/healthz` and authenticated `/api/v1/dashboard`.
Do not print or save real API tokens or session cookies.

```powershell
npm --prefix frontend run build
& $ravenBin --home $smokeHome ui --ui-path frontend/out --port 39003 --no-open
```

Open `http://127.0.0.1:39003/__raven/session` and verify the affected UI flow.
Stop servers before rebuilding on Windows: an open `raven.exe` prevents replacement.

## Verification

Run focused regression tests first, then the applicable full gate from the operations
reference. Verify a read does not create or migrate a missing store. ToDo `today`
is a read; use `todo routine materialize` explicitly to generate occurrences.
ToDo creation starts active and has no approval/activation step.

Record actual failures from this checkout; do not assume historical failures still apply.
Keep Health database and media together when copying temporary test data.
