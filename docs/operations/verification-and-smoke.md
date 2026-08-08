# Verification and Smoke

## Full gate

```bash
cargo fmt --check
cargo test --workspace
cargo clippy --all-targets --all-features -- -D warnings
npm --prefix frontend test
npm --prefix frontend run typecheck
npm --prefix frontend run build
npm --prefix npm/raven test
cargo build --release -p raven-cli
```

The release binary is `target/release/raven` (`raven.exe` on Windows). The UI artifact is
`frontend/out`.

## Throwaway-home rule

Never run mutation, import, migration, archive/restore, or purge smoke checks against live
Raven or source ToDo data.

```bash
smoke_home="$(mktemp -d)"
raven_bin="$PWD/target/release/raven"
"$raven_bin" --home "$smoke_home" init
"$raven_bin" --home "$smoke_home" health-check
```

Expected health output includes:

```text
todo=ok user_version=1 ledger=ok user_version=2 health=ok user_version=1 media=ok
```

## Domain smoke

```bash
"$raven_bin" --home "$smoke_home" todo task propose "Smoke task"

"$raven_bin" --home "$smoke_home" ledger currency create \
  --code KRW --name "Korean Won" --symbol ₩ --decimal-places 0
"$raven_bin" --home "$smoke_home" ledger account-category create --name Cash
"$raven_bin" --home "$smoke_home" ledger account create \
  --name Wallet --category Cash --currency KRW --opening-balance 0
"$raven_bin" --home "$smoke_home" ledger category create --name Food --kind expense
"$raven_bin" --home "$smoke_home" ledger entry add \
  --date 2026-07-31 --type expense --amount 12000 --currency KRW \
  --account Wallet --category Food --content Lunch

"$raven_bin" --home "$smoke_home" health diet add \
  --at 2026-07-31T12:00:00+09:00 --meal lunch --food "Smoke meal" --tags smoke
"$raven_bin" --home "$smoke_home" health timeline --format json
```

Confirm `todo.sqlite`, `ledger.sqlite`, `health.sqlite`, `media/health`, and
`logs/raven.log.jsonl` exist only below the temporary home.

## Import smoke

Create or copy a source ToDo home distinct from the empty Raven destination:

```bash
source_home="$(mktemp -d)"
import_home="$(mktemp -d)"
cargo run -p raven-cli -- --home "$source_home" todo init
```

For a real source, place its `todo.sqlite` under `source_home`, then:

```bash
"$raven_bin" --home "$import_home" import todo --source-home "$source_home"
"$raven_bin" --home "$import_home" todo health
```

Repeat import and confirm it exits `2` without replacing the destination. Compare the source
before/after hash when validating read-only behavior.

## API smoke

Use a fresh token and loopback port:

```bash
RAVEN_HOME="$smoke_home" \
RAVEN_API_TOKEN='smoke-token-0123456789' \
RAVEN_API_BIND_PORT=39002 \
"$raven_bin" api
```

From another shell:

```bash
curl http://127.0.0.1:39002/healthz
curl -H 'Authorization: Bearer smoke-token-0123456789' \
  http://127.0.0.1:39002/api/v1/dashboard
```

Verify an unauthenticated Dashboard request returns `401`, an authenticated request returns
all three projection keys, and a deliberately unavailable copied domain becomes only that
domain's `status:"error"`.

## UI smoke

```bash
"$raven_bin" --home "$smoke_home" ui \
  --ui-path frontend/out --port 39003 --no-open
```

Open `http://127.0.0.1:39003/__raven/session`. Confirm the redirect sets the strict
HTTP-only cookie, Dashboard loads, and ToDo, Ledger, and Health Journal mutations round-trip.
Unknown `/api/*` routes must return authenticated API `404`, never the SPA document.

For the Cloudflare Access path, keep the server loopback-bound and use the deployment's exact
public origin:

```bash
RAVEN_UI_PUBLIC_ORIGIN=https://raven.b-sir.xyz \
  "$raven_bin" --home "$smoke_home" ui \
  --ui-path frontend/out --port 3001 --no-open
```

Confirm through the deployed tunnel that the public Host and Origin are exact and that
`cloudflared` requires Access, validates its JWT, and forwards exactly one non-empty
`Cf-Access-Jwt-Assertion`. A successful HTML response must set a `Secure`, HTTP-only
`SameSite=Strict` Raven cookie. Reuse that cookie for an `/api/v1/dashboard` request and confirm
that a missing or stale cookie returns `401`. A missing, empty, or duplicate assertion and a
mismatched Host or supplied Origin must return `421` without setting a Raven cookie.

Keep cookie jars and captured headers in a permission-restricted temporary directory. Redact
session values before saving evidence, and do not copy real Access JWTs or assertions into shell
history, command output, or test logs.

## Log checks

- stdout contains only command results.
- stderr contains diagnostics.
- JSONL records do not contain API tokens, Access JWTs or assertions, UI session values, Health
  image bytes, or raw domain error details from the composed API.
- Rotation honors `RAVEN_LOG_MAX_BYTES` and `RAVEN_LOG_MAX_FILES`.

Temporary homes may be removed after the smoke evidence is recorded.
