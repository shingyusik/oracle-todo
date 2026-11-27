# Setup

## Prerequisites

- Node.js 18+ for `npx @shings/raven`
- Node.js 22.13+ for frontend source builds and tests
- Rust 2024 toolchain for source builds

SQLite is bundled through `rusqlite`.

## npm release bundle

```bash
npx @shings/raven init
npx @shings/raven health-check
npx @shings/raven ui
```

The wrapper installs the matching native `raven` archive and `raven-ui` archive from
`shingyusik/oracle-todo` GitHub Releases into `RAVEN_CACHE_DIR` or
`~/.local/share/raven`. User data remains under `RAVEN_HOME`; the release cache is not a
data backup.

Wrapper-only commands:

```bash
npx @shings/raven install
npx @shings/raven update
npx @shings/raven version
npx @shings/raven doctor
```

Other arguments are forwarded to the native binary. `ui` and `install` reuse the
installed bundle without contacting GitHub when the engine is executable, the UI
index is readable, and their recorded versions match. `RAVEN_VERSION`, if set,
must also match the installed version. Otherwise the wrapper downloads a matching
bundle before delegating `ui` to native `raven ui`.

`update` explicitly checks GitHub for the requested or latest release. A new bundle
is activated only after both archives pass checksum verification and extraction;
a download failure for a newer version leaves the active bundle unchanged.
The `npx` launcher itself may still need npm access to obtain the wrapper package.

### Updating from the UI

When `raven ui` runs through the npm wrapper, the sidebar footer shows `Raven v<version>`.
Raven checks GitHub every 6 hours (also on page load, plus a `Check now` action); the browser
never calls GitHub itself. When a newer release is available, the footer shows
`Update to v<latest>`. After confirmation the UI calls `POST /api/v1/system/update`, shows an
`Updating to v<latest>…` overlay, and polls `/healthz` every 1.5 s for up to 3 minutes. When
the server answers again, the page reopens `/__raven/session` and reports `Updated to v<latest>`
or `Update failed, still on v<current>`. A few seconds of downtime are expected. The button works
on both the local origin and the Cloudflare Access public origin.

The native server exits with code `75`; the wrapper then updates the bundle (never to a version
at or below the installed one), restarts the launchd labels listed in
`RAVEN_UPDATE_RESTART_LABELS`, and relaunches `raven ui` with the new UI path. If the update
fails, the wrapper logs it and relaunches the old version. If you passed `--ui-path` yourself,
the wrapper keeps it. Each attempt is recorded in `<cacheRoot>/update-status.json`.

Without the wrapper (for example `cargo run -p raven-cli -- ui`), the footer shows the version
and a disabled update button: "Restart Raven through the npm wrapper to enable updates".

| Variable | Set by | Purpose |
| --- | --- | --- |
| `RAVEN_RELEASE_VERSION` | `release.yml` at build time | Release version compiled into `raven`; builds without it report `<crate version>-dev` |
| `RAVEN_UPDATE_SUPERVISOR` | wrapper (`1`) | Enables `POST /api/v1/system/update` |
| `RAVEN_BUNDLE_VERSION` | wrapper | Installed engine version reported by the UI and `/healthz` |
| `RAVEN_UI_VERSION` | wrapper | Installed UI version |
| `RAVEN_UPDATE_RESTART_LABELS` | operator, optional | Comma-separated launchd labels (for example `com.raven.mcp`) restarted with `launchctl kickstart -k gui/<uid>/<label>` after a successful update; macOS only, failures are logged and never fatal |
| `RAVEN_GITHUB_TOKEN` | operator, optional | Bearer token for the GitHub release check; keep it out of logs and evidence |
| `RAVEN_GITHUB_API_URL` | tests only | Replaces `https://api.github.com` for the Rust release check and the npm wrapper (for example a local fake release server). Only plain-`http` loopback URLs (`127.0.0.1`, `localhost`, `[::1]`) are honored; other values are ignored. `RAVEN_GITHUB_TOKEN` is never sent to it |

Do not set the wrapper-owned variables by hand.

## Source build

```bash
cargo build -p raven-cli
cargo run -p raven-cli -- init
cargo run -p raven-cli -- health-check
```

`init` creates the Raven home, all three databases, and `media/health`. It is idempotent.
`health-check` is read-only and reports each schema version and media-directory readiness;
it fails if any component is missing, corrupt, or unsupported.

## Data home

Resolution order:

1. `--home <path>`
2. `RAVEN_HOME` from the process or `.env`
3. `$HOME/.raven`
4. `%USERPROFILE%/.raven` on Windows when `HOME` is absent or empty

```bash
RAVEN_HOME=/path/to/data raven init
raven --home /path/to/data health-check
```

An invalid `.env` aborts instead of falling back. Single-quote values containing
backslashes:

```dotenv
RAVEN_HOME='C:\Users\me\raven-data'
```

See [data-home.md](data-home.md).

## Standalone API

Provide exactly one token source:

```bash
export RAVEN_API_TOKEN='replace-with-at-least-16-visible-ASCII-characters'
raven api
```

or:

```bash
export RAVEN_API_TOKEN_FILE=/path/to/secure-token-file
raven api
```

The token file must satisfy platform permission checks. Default bind is
`127.0.0.1:3002`; configure `RAVEN_API_BIND_HOST` and `RAVEN_API_BIND_PORT` when needed.
Non-loopback cleartext requires the explicit
`RAVEN_API_ALLOW_UNSAFE_CLEARTEXT=true` override.

## Local UI

The release bundle supplies the UI path automatically:

```bash
raven ui
raven ui --no-open
raven ui --port 3202
```

The command prints both the listening address and an `Open Raven UI` session URL. With
`--no-open`, open the latter URL manually to establish the authenticated UI session.

For a source build:

```bash
npm --prefix frontend install
npm --prefix frontend run build
cargo run -p raven-cli -- ui --ui-path frontend/out --no-open
```

`RAVEN_UI_PATH` is the environment alternative to `--ui-path`.

## Cloudflare Access UI

Set the exact public HTTPS origin and keep Raven on its loopback listener:

```bash
RAVEN_UI_PUBLIC_ORIGIN=https://raven.b-sir.xyz \
  raven ui --port 3001 --no-open
```

Local UI behavior is unchanged when `RAVEN_UI_PUBLIC_ORIGIN` is absent. The value is validated
before the listener binds. Its host must be lowercase; its optional decimal port must be
`1..=65535` without leading zeroes and must omit the default `443`. Credentials, paths, queries,
fragments, malformed ports, and an authority that resolves to the active loopback listener are
rejected with validation exit `2` without echoing the value.

Public mode accepts the configured public Host and requires one non-empty
`Cf-Access-Jwt-Assertion`. Top-level document navigation may omit `Origin`; every supplied
Origin and every public API `POST`, `PUT`, `PATCH`, or `DELETE` request must use the exact
configured HTTPS origin. A request-target authority that conflicts with `Host` is rejected with
`421`.

Configure `cloudflared` to connect only to Raven's loopback listener and verify the Access JWT
before forwarding its assertion:

```yaml
- hostname: raven.b-sir.xyz
  service: http://127.0.0.1:3001
  originRequest:
    access:
      required: true
      teamName: divine-hill-da47
      audTag:
        - 5650a5c6613fcfd8d13652e94c82339a8cc68e311c93d241dcb6fc394c046de9
```

Do not place another untrusted proxy or listener between `cloudflared` and Raven. The public UI
index and extensionless SPA fallback issue a `Secure`, HTTP-only `SameSite=Strict` Raven session
cookie; arbitrary `.html` and other static assets do not. API routes require that cookie in
addition to the Access assertion. API tokens, Access JWTs or assertions, and Raven session
cookies must not appear in console output, JSONL logs, proxy logs, shell history, or saved
verification evidence.

Remote AI access uses a separate loopback `raven mcp` listener and Cloudflare Access application.
See [remote MCP](mcp-reference.md) for startup, Tunnel routing and client authentication.

## Google Calendar sync

Raven can sync ToDo events two-way with one Google calendar
([how it behaves](../architecture/data-model.md#google-calendar-sync)). Google requires every
app that reads a calendar to have its own OAuth client, so you create one in your own Google
Cloud project once. It is free and takes about ten minutes. You only need a Google account;
no billing account is required.

### 1. Create a Google Cloud project

1. Open <https://console.cloud.google.com/> and sign in with the Google account whose
   calendar you want to sync.
2. Accept the terms if asked.
3. Click the project picker at the top of the page, then **New project**.
4. Name it `Raven` (any name works), leave the organization as is, and click **Create**.
5. Make sure the new project is selected in the project picker before continuing.

### 2. Enable the Google Calendar API

1. Open the menu (☰) → **APIs & Services** → **Library**.
2. Search for `Google Calendar API`, open it, and click **Enable**.

### 3. Configure the consent screen (Google Auth Platform)

Open the menu (☰) → **Google Auth Platform** (or **APIs & Services** → **OAuth consent
screen**). If it shows **Get started**, click it; the wizard asks for the same values as the
pages below.

1. **Branding**: App name `Raven`; User support email: your Gmail address; Developer contact
   email: your Gmail address. Leave the logo and links empty. **Save**.
2. **Audience**: User type **External** (a personal Gmail account cannot pick Internal).
   Under **Test users**, click **Add users** and add your own Gmail address.
3. **Data Access**: click **Add or remove scopes**. Under **Manually add scopes**, paste these
   three lines, click **Add to table**, then **Update** and **Save**:

   ```text
   https://www.googleapis.com/auth/calendar.events
   https://www.googleapis.com/auth/calendar.calendarlist.readonly
   https://www.googleapis.com/auth/calendar.app.created
   ```

   They let Raven read and write events, list your calendars so you can pick one, and create
   a dedicated "Raven" calendar. Raven cannot delete calendars or read other Google data.
4. **Audience** again: under **Publishing status**, click **Publish app** and confirm, so the
   status reads **In production**.

   Why: while the app is in **Testing**, Google expires its refresh tokens after 7 days, and
   sync would stop with "reconnect" every week. Publishing does not list the app anywhere;
   only software holding your client ID and secret, which stay on your Mac, can start a
   sign-in with it. You do not
   need to submit it for verification.

   Because the app is not verified, Google shows **"Google hasn't verified this app"** when you
   connect. This is expected for your own client: click **Advanced**, then
   **Go to Raven (unsafe)** (**Continue** on some screens), and allow the calendar access.

### 4. Create the OAuth client

1. **Google Auth Platform** → **Clients** → **Create client**.
2. Application type: **Desktop app**. Name: `Raven` (or the Mac's name). **Create**.
3. In the dialog that appears, click **Download JSON**. Download it now: Google may not show
   the client secret again. If you missed it, delete the client and create a new one.

The file contains your client secret. Do not commit it, paste it into chats, or keep extra
copies.

### 5. Give the client to Raven

On the Mac that runs Raven:

```bash
raven google-calendar client set --file ~/Downloads/client_secret_XXXX.json
rm ~/Downloads/client_secret_XXXX.json
```

Raven copies only the client ID and secret into
`$RAVEN_HOME/integrations/google-calendar/oauth-client.json` (`0600`), so the download can be
deleted. To keep the file elsewhere instead, set `RAVEN_GOOGLE_OAUTH_CLIENT_FILE` to its path
and skip `client set`.

### 6. Connect and start syncing

Connect from the Mac that runs Raven, because Google returns to `http://127.0.0.1` after you
sign in:

- **UI**: open Raven at `http://127.0.0.1:3001`, then **Menu → Google Calendar → Connect**.
  Sign in, click through the unverified-app warning, and allow access. The browser returns to
  Raven with the dialog open.
- **CLI**: `raven google-calendar connect` opens the browser and waits up to 5 minutes.

On another device (for example through the Cloudflare Access address), the dialog shows
**Connect from the Mac running Raven** and a **Redirect URL** field: sign in with Google, copy
the full address of the page that fails to load (it starts with
`http://127.0.0.1:<UI port>/`, `3001` for the service above), and paste it into the field.

Then, in the dialog (or with the CLI):

1. **Choose a calendar**: pick an existing calendar you can write to, or **Create Raven
   calendar** for a dedicated one (`raven google-calendar calendars`,
   `calendar select <id>`, or `calendar create`). A dedicated calendar keeps Raven events
   separate and easy to hide.
2. **Preview**: the first-sync preview shows how many Raven events will be added to Google and
   how many Google events will be added to Raven (events from 7 days ago onward; recurring
   Google events are skipped). Nothing is written yet (`raven google-calendar sync --dry-run`).
3. **Start syncing**: confirms the first sync (`raven google-calendar sync`). Afterwards Raven
   syncs every 2 minutes while `raven ui` or `raven api` is running. **Sync now** runs a pass
   immediately.

Settings in the dialog (or `raven google-calendar set`): automatic sync on/off, check interval
(60–3600 seconds), default length of Google events created from timed Raven events (1–1440
minutes), and whether the Raven note syncs with the Google description.

### Reconnecting

The dialog shows **Sync stopped** with **Reconnect** (status `reauth_required`) when Google
rejects Raven's refresh token. Common causes:

- the app was left in **Testing** (tokens expire after 7 days) — publish it, then reconnect;
- Raven did not sync for 6 months (Google expires unused refresh tokens);
- you removed Raven's access at <https://myaccount.google.com/connections>;
- more than 100 refresh tokens were issued for the same account and client (Google silently
  invalidates the oldest), for example after many reconnects or several Raven homes sharing one
  client — use a separate client per machine if needed.

Reconnecting keeps the selected calendar and links, so syncing resumes where it stopped.
**Disconnect** (`raven google-calendar disconnect`) revokes access and deletes the stored token;
Google events and calendars are never deleted.

| Variable | Purpose |
| --- | --- |
| `RAVEN_GOOGLE_CALENDAR=off` | Disables only the automatic sync scheduler in `raven ui`/`raven api`; manual sync still works |
| `RAVEN_GOOGLE_OAUTH_CLIENT_FILE` | Path to a Desktop-app client JSON used instead of `integrations/google-calendar/oauth-client.json` |
| `RAVEN_GOOGLE_API_URL` | Tests only. Replaces Google's Calendar, token, and revoke endpoints with a plain-`http` loopback fake (`<base>/calendar/v3`, `<base>/token`, `<base>/revoke`); other values are ignored. Never set it in a live environment |

## ToDo import

```bash
raven import todo --source-home ~/.todo-engine
```

Import is a one-time no-clobber copy. It validates a temporary destination before
publishing it and never replaces an existing Raven `todo.sqlite`.

## Verification

Run the full gate in [verification-and-smoke.md](verification-and-smoke.md). Use a temporary
Raven home for all mutation or purge smoke checks.
