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

### Mock data

The mock-data scripts seed ToDo records around the local run date and Ledger activity over
the inclusive 90-day period ending today. Without an argument, they delete and rebuild
`.mock-data/todo-engine`:

```bash
bash scripts/create-mock-db.sh
```

```powershell
./scripts/create-mock-db.ps1
```

For an isolated custom home, pass an empty throwaway location. Custom homes are no-clobber:
the scripts refuse to continue if `todo.sqlite`, `ledger.sqlite`, or `health.sqlite` already
exists. Never point either command at a live Raven home.

```bash
mock_home="$(mktemp -d)"
bash scripts/create-mock-db.sh "$mock_home"
from="$(python3 -c 'from datetime import date,timedelta; print(date.today()-timedelta(days=89))')"
to="$(python3 -c 'from datetime import date; print(date.today())')"
cargo run -q -p raven-cli -- --home "$mock_home" ledger reports --from "$from" --to "$to"
cargo run -q -p raven-cli -- --home "$mock_home" ledger balances
```

```powershell
$mockHome = Join-Path ([IO.Path]::GetTempPath()) "raven-mock-$([guid]::NewGuid())"
./scripts/create-mock-db.ps1 -DataHome $mockHome
$from = (Get-Date).Date.AddDays(-89).ToString('yyyy-MM-dd')
$to = (Get-Date).Date.ToString('yyyy-MM-dd')
cargo run -q -p raven-cli -- --home $mockHome ledger reports --from $from --to $to
cargo run -q -p raven-cli -- --home $mockHome ledger balances
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

### External Access verification

Verify the deployed hostname from outside the origin boundary. An unauthenticated request must
receive the Cloudflare Access challenge or login redirect. After Access authentication, opening
the root document must succeed without visiting `/__raven/session`, issue a `Secure`, HTTP-only
`SameSite=Strict` Raven cookie, and allow an `/api/v1/dashboard` read with that cookie. A missing
or stale Raven cookie still returns `401` after the request reaches Raven.

Cloudflare Access rejection happens before the origin request. Do not treat its challenge or
edge response as evidence for Raven's `421` policy, and do not expect a missing Access assertion
to reach Raven through the protected public hostname.

### Isolated Raven public-policy verification

Test Raven's origin policy directly against the loopback listener, isolated from the Access
edge. Use the configured public `Host`, the exact HTTPS `Origin` where required, and a synthetic
non-secret `Cf-Access-Jwt-Assertion` placeholder; never copy a real Access JWT into the probe.
Confirm that:

- a top-level public `GET` may omit `Origin`, serves the UI entry, and sets the secure Raven
  cookie;
- the UI index and extensionless SPA fallback set the cookie, while arbitrary `.html` and other
  static assets do not;
- a missing, empty, or duplicate assertion returns Raven `421` without a cookie;
- an unknown `Host`, mismatched or duplicate supplied `Origin`, or request-target authority that
  conflicts with `Host` returns Raven `421` without a cookie;
- public API `POST`, `PUT`, `PATCH`, and `DELETE` requests without the exact configured `Origin`
  return Raven `421` before API session authentication.

The focused automated origin-policy probe is:

```bash
cargo test -p raven-api --test ui_session
```

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
