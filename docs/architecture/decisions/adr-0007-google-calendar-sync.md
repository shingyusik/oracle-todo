# ADR-0007: Google Calendar two-way sync

## Status

Accepted.

## Context

ToDo `event` items are external commitments with a required `scheduled` value. Users also keep
those commitments in Google Calendar and want both sides to stay in step without copying by
hand. Raven is a local-first engine: `todo.sqlite` is the source of truth (ADR-0001), every
mutation goes through the ToDo service with audit history (ADR-0002), and nothing is hard
deleted outside the retention purge (ADR-0004). The public UI is reachable only through
Cloudflare Access; the Raven listener itself is loopback-only.

## Decision

### Scope

- Sync **ToDo events only**. Tasks, routines, goals, projects, and areas are never sent to
  Google.
- Sync is **two-way**: Raven changes are pushed to Google, and Google changes are pulled into
  Raven through the same ToDo service as `Actor::System` (`reason = "google_calendar_sync"`;
  archives for Google deletions use `reason = "google_calendar_deleted"`).
- The user **chooses the calendar** in the sync settings: either a dedicated "Raven" calendar
  that Raven creates, or any existing calendar the account can write to (including the
  primary calendar). Raven never deletes a Google calendar.
- OAuth scopes, the minimum for that choice:
  - `https://www.googleapis.com/auth/calendar.events` — read and write events;
  - `https://www.googleapis.com/auth/calendar.calendarlist.readonly` — list calendars to pick from;
  - `https://www.googleapis.com/auth/calendar.app.created` — create the dedicated calendar.
- Changing the calendar later unlinks every link of the old calendar without deleting its
  events, forgets its sync token, and runs the first-sync rules on the new calendar.

### Separate `sync.sqlite`, not `todo.sqlite`

Sync bookkeeping (links, per-calendar sync tokens, retry queue) lives in
`integrations/google-calendar/sync.sqlite` with its own `user_version` and migrations. The
only ToDo-side change is an optional `metadata.external_source` value on imported events,
which needs no schema change.

Reason: a `todo.sqlite` schema bump must migrate on every read path, because npm and UI
updates do not run `raven init`. The v0.4.40 rollout showed that a schema-bumping release is
only safe when read paths (CLI reads, `GET` routes, MCP reads, Dashboard) migrate or tolerate
an older store, and that has to be verified against a copy of the live database. Keeping
sync state out of `todo.sqlite` means this feature ships without a ToDo schema migration,
the ToDo store stays readable by older binaries, and deleting `sync.sqlite` (`disconnect
--forget-links`) resets sync without touching ToDo data. `sync.sqlite` follows the same rule
internally: read paths migrate it or tolerate its absence.

### Polling, not push notifications

Raven polls the selected calendar with incremental `events.list` sync tokens every
`poll_interval_secs` (default `120`, range `60..=3600`), only while `raven ui` or `raven api`
is running. Google push notifications (`events.watch`) need a public HTTPS webhook that Google
can call without credentials. Raven's only public entry point sits behind Cloudflare Access,
which would reject Google's unauthenticated callbacks; opening an unauthenticated hole in that
boundary for a personal tool is not worth a lower latency. A two-minute delay is acceptable
for calendar events.

### Desktop OAuth with PKCE and a loopback redirect

The user creates their own Google Cloud OAuth client of type **Desktop app**. Raven uses the
authorization-code flow with PKCE (S256), a random single-use `state` (32 bytes, 10 minutes,
constant-time compare, kept in memory), `access_type=offline`, and `prompt=consent`. The
redirect is a loopback URL: `http://127.0.0.1:<UI port>/__raven/google-calendar/callback` for
the UI (the actual `raven ui` listener port, `3001` for the usual service), or a temporary
`127.0.0.1:0` listener for `raven google-calendar connect`. Desktop clients
are the type Google supports for loopback redirects and do not require a public redirect
host. From another device the UI offers a paste-the-redirect-URL fallback. Token, revoke, and
API endpoints are hard-coded; the `auth_uri`/`token_uri` in the client file are ignored.

### Refresh token in a file, not the macOS Keychain

The refresh token is stored in `integrations/google-calendar/token.json` (`0600`, inside a
`0700` directory; Raven refuses to read it when it is group- or other-readable). The access
token stays in memory only. Reasons: Raven runs headless under launchd and on non-macOS hosts,
where Keychain prompts or a missing Keychain would stop background sync; the API token file
already uses the same permission-checked file model; and the file is excluded from retention
backups and never logged. The token is scoped to calendar access only and can be revoked from
the Google account at any time.

### Deletion and close rules

| Raven side | Google side |
| --- | --- |
| `archived`, `dropped`, `cancelled`, `rejected` | Event deleted (`sendUpdates=none`) |
| `completed`, `missed` | Event kept; link `frozen`, later Google edits ignored |
| `paused` | Event status `tentative` |
| Item vanished while linked (retention purge or otherwise) | Link `orphaned`; the Google event is never deleted |

| Google side | Raven side |
| --- | --- |
| Event deleted or cancelled | Active Raven event archived with reason `google_calendar_deleted`; if Raven already completed/missed it, only the link is dropped |
| Event restored after Raven archived it | A new Raven event is created and re-linked |

Every Google write uses `sendUpdates=none`, and Raven `participants` are never mapped to
attendees, so sync never emails anyone.

### First sync

The first sync is previewed (counts only) and starts only after the user confirms
**Start syncing**. It pushes `active`/`paused` Raven events scheduled on or after
today − 7 days (Asia/Seoul), and imports non-recurring, `eventType=default`, non-cancelled
Google events of the selected calendar starting on or after the same day. Older history on
either side is left alone.

### Recurring and special events are skipped

Recurring Google events (and their instances) are not imported and are counted as
`skipped_recurring`; Raven events have no recurrence to express them. Non-default event types
(focus time, out of office, working location, birthdays) are skipped. A linked event that later
becomes recurring is marked `unsupported`.

### Conflicts and mass-change guard

Each field is merged three-way against stored base hashes: a field changed on one side is
copied; a field changed differently on both sides takes the newer timestamp (Raven
`updated_at` vs Google `updated`) and is counted as a conflict. Etags are used only as a write
guard (`If-Match`).

A pass that would delete more than `max(10, 20% of links)` Google events, or archive that many
Raven events, applies no deletions or archives and records outcome `guard_tripped`. Deletions
resume only after a manual sync with `allow_mass_delete`. This protects against a wrong
calendar choice, an expired sync token, or a bug wiping one side.

## Consequences

- No ToDo schema change; `metadata.external_source = {system:"google_calendar",
  id:"<calendar_id>/<event_id>"}` marks imported events and survives postpone.
- Sync runs only while `raven ui` or `raven api` is up; there is no background daemon and no
  MCP surface. `RAVEN_GOOGLE_CALENDAR=off` disables only the scheduler; manual sync still works.
- Events have no end time in Raven. The duration is kept in the link (default 60 minutes,
  all-day = 1 day), and Google-only fields (attendees, conference data, colors, reminders) are
  preserved because Raven patches only the fields it changed.
- Users must create their own Google Cloud OAuth client and publish its consent screen
  "In production" (Testing mode expires refresh tokens after 7 days). See
  [Setup](../../operations/setup.md#google-calendar-sync).
- Details: [Data Model](../data-model.md#google-calendar-sync),
  [API](../../operations/api-reference.md#google-calendar-integration),
  [CLI](../../operations/cli-reference.md#google-calendar),
  [Data Home](../../operations/data-home.md#google-calendar-integration).
