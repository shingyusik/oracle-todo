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

Frontend Health assertions use the fixed UTC+09:00 calendar, independent of the host
timezone. Match the Linux release runner when checking timezone-sensitive tests on Unix:

```bash
TZ=UTC npm --prefix frontend test
```

Timestamp display assertions must specify `timeZone: "Etc/GMT-9"`; editable Health times
must assert the UTC instant represented by an explicit `+09:00` offset.

## Throwaway-home rule

MCP regression checks use temporary stores and disposable signing keys:

```bash
cargo test -p raven-api --lib mcp
cargo test -p raven-cli --test mcp_cli
```

CLI/MCP contract tests run the same fixture through the `raven` binary and through MCP
JSON-RPC over the authenticated HTTP transport. They compare normalized results and audit
records:

```bash
cargo test -p raven-cli --test contract_todo --test contract_ledger --test contract_health --test contract_retry
```

Automatic UI refresh checks cover independent CLI and MCP mutations, SSE authentication,
WAL writes, rollback, missing stores, multiple subscribers, and reconnect synchronization:

```bash
cargo test -p raven-api --test changes
cargo test -p raven-api --lib mcp_mutation_notifies_an_independent_ui_router
cargo test -p raven-cli --test changes_cli
npm --prefix frontend test -- tests/presentation/data-changes.spec.tsx tests/presentation/use-workbench-controller.spec.tsx tests/presentation/health-panel.spec.tsx tests/presentation/ledger-panel.spec.tsx
```

External acceptance also requires the selected client's authenticated `initialize`,
`tools/list`, search, choices and guarded mutation through the actual Tunnel/Access
configuration, plus denial without credentials. Use a throwaway Raven home for mutations.
The source includes no operational Access credentials or ready-made external deployment.

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

The mock-data scripts build Raven once, then invoke that executable directly for each
record through the domain CLI. A failed build leaves the existing mock home intact.
They seed ToDo records around the local run date and Ledger and Health
activity over the inclusive 90-day period ending today. Health includes 18 meals, 18 bowel
records, 18 medication records, and 90 daily-upsert metric readings (weight, sleep, CRP, fecal
calprotectin, and overall condition). Repeated food tags, varying readings, and same-day
bowel records populate the Health Reports charts and tag association analysis for the
7/14/30/90-day presets. Images are not included. Without an argument, the scripts delete and rebuild
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
"$raven_bin" --home "$smoke_home" todo task create "Smoke task"
"$raven_bin" --home "$smoke_home" --error-format json todo list --format json
"$raven_bin" --home "$smoke_home" todo routine materialize

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
"$raven_bin" --home "$smoke_home" health diet list --format json
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

## Google Calendar smoke

Never call real Google from tests, smoke runs, or development servers, and never connect a
throwaway home to a real Google account. The pure mapping, reconcile, storage, and HTTP
client tests use fakes and loopback servers:

```bash
cargo test -p raven-api google_calendar -- --test-threads=2
npm --prefix frontend test -- tests/domain/google-calendar-api.spec.ts tests/presentation/google-calendar-dialog.spec.tsx
```

For an end-to-end smoke, run a fake Google server on loopback and point Raven at it with the
test-only `RAVEN_GOOGLE_API_URL`. Only plain-`http` loopback URLs (`127.0.0.1`, `localhost`,
`[::1]`) without credentials, query, or fragment are honored; any other value is ignored and
real Google is used. The fake must serve:

- `<base>/calendar/v3/...` — Calendar API (`users/me/calendarList`, `calendars`,
  `calendars/<id>/events` list/get/insert/patch/delete);
- `<base>/token` — authorization-code exchange and refresh;
- `<base>/revoke` — revoke.

The browser consent URL (`accounts.google.com`) is not overridden and must not be opened.
Complete the connection by calling the loopback callback yourself with the `state` and
`redirect_uri` from the authorization URL and any code the fake token endpoint accepts. The
fake token endpoint must answer the code exchange with `access_token`, `expires_in`,
`refresh_token` and `token_type: Bearer`, and list/get/insert/patch return Google `Event`
JSON with `etag` and `updated`; list returns `nextSyncToken`:

```bash
smoke_home="$(mktemp -d)"
client_dir="$(mktemp -d)"
printf '%s' '{"installed":{"client_id":"smoke.apps.googleusercontent.com","client_secret":"smoke-secret"}}' \
  > "$client_dir/client.json"
export RAVEN_GOOGLE_API_URL=http://127.0.0.1:39080   # fake Google
"$raven_bin" --home "$smoke_home" init
"$raven_bin" --home "$smoke_home" google-calendar client set --file "$client_dir/client.json"
"$raven_bin" --home "$smoke_home" todo event create "Smoke event" "$(date -v+1d +%F)T01:00:00Z"
"$raven_bin" --home "$smoke_home" google-calendar connect --no-open --timeout-secs 120 \
  > "$client_dir/connect.out" 2> "$client_dir/connect.err" &
sleep 2
auth_url="$(grep accounts.google.com "$client_dir/connect.err")"
callback="$(python3 -c 'import sys,urllib.parse as u; q=dict(u.parse_qsl(u.urlparse(sys.argv[1]).query)); print(q["redirect_uri"]+"?"+u.urlencode({"state":q["state"],"code":"smoke"}))' "$auth_url")"
curl -s -i "$callback"    # 200, Cache-Control: no-store
wait; cat "$client_dir/connect.out"   # status JSON, "connection":"connected"
"$raven_bin" --home "$smoke_home" google-calendar calendar create
"$raven_bin" --home "$smoke_home" google-calendar sync --dry-run --format json
"$raven_bin" --home "$smoke_home" google-calendar sync --format json
```

Check that:

- `status` reads on a fresh home create no `integrations/` directory;
- `integrations/google-calendar/` is `0700` and its files `0600`, and Raven refuses a
  group- or other-readable `token.json`;
- the preview writes nothing and the first `sync` pushes and imports only events inside the
  today − 7 days window; recurring fake events count as `skipped_recurring`;
- a second `sync` with no changes finishes `nothing_to_do` (no echo writes);
- archiving a pushed Raven event deletes the fake event; completing one keeps it (link
  `frozen`); deleting a fake event archives the Raven event with reason
  `google_calendar_deleted`;
- a fake that deletes more than `max(10, 20%)` of linked events trips `guard_tripped` until
  `sync --allow-mass-delete`;
- a fake token endpoint answering `invalid_grant` moves `connection` to `reauth_required`;
- two concurrent `sync` runs report `google_calendar_sync_in_progress` for one of them;
- with `RAVEN_GOOGLE_CALENDAR=off`, `raven ui` reports `env_override: "disabled"` and no
  scheduled sync, while **Sync now** still works;
- JSONL logs and error output contain no tokens, codes, `state`, client secret, event titles,
  fake URLs, or response bodies.

For the UI path, start `raven ui` on a smoke port with the same environment and walk the
**Menu → Google Calendar** dialog through not configured, connect, choose calendar, preview,
**Start syncing**, and disconnect. The UI callback uses the actual listener port
(`http://127.0.0.1:<smoke port>/__raven/google-calendar/callback`), so `POST …/connect` with the
session cookie, `Origin: http://127.0.0.1:<smoke port>` and `X-Raven-Integration: 1`, then GET
the callback with `state` and a fake code; it answers `200` with a link to
`/?google_calendar=connected` (a reused `state` answers `400` with `…=error`). Port `3001`
belongs to the live UI, so never start a smoke server on it.

## Log checks

- stdout contains only command results.
- stderr contains diagnostics.
- JSONL records do not contain API tokens, Access JWTs or assertions, UI session values, Health
  image bytes, or raw domain error details from the composed API.
- Rotation honors `RAVEN_LOG_MAX_BYTES` and `RAVEN_LOG_MAX_FILES`.

Temporary homes may be removed after the smoke evidence is recorded.
