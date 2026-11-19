# @shings/raven

`npx` runner for the Raven engine and UI GitHub Release bundle. The wrapper downloads the
native `raven` binary and the matching `raven-ui` artifact, verifies them against
`SHA256SUMS`, and caches them under `RAVEN_CACHE_DIR` (default `~/.local/share/raven`).

```bash
npx @shings/raven install    # install the bundle if missing
npx @shings/raven update     # install the latest (or RAVEN_VERSION) release
npx @shings/raven version
npx @shings/raven doctor
npx @shings/raven ui         # native UI with the cached --ui-path
npx @shings/raven todo pending
```

Cache layout: `bin/raven` (active binary), `versions/<v>/`, `ui/<v>/`, `metadata.json`,
`update-status.json`. `bin/raven` is replaced atomically (staged copy in `bin/` + rename),
so a service started from it never sees a partially written file.

## UI update supervisor

`raven ui` runs the native UI as a supervised child and passes it
`RAVEN_UPDATE_SUPERVISOR=1`, `RAVEN_BUNDLE_VERSION` and `RAVEN_UI_VERSION` (omitted when
you pass your own `--ui-path`). When the UI's update button is used, the native server exits
with code `75` and the wrapper:

1. Fetches the latest release (or `RAVEN_VERSION` if pinned) and installs it only if it is
   newer than the installed version.
2. Writes `update-status.json`: `{ "at", "from", "to", "ok", "error" }`.
3. On success, restarts each launchd label in `RAVEN_UPDATE_RESTART_LABELS`
   (comma-separated, e.g. `com.raven.mcp`) with `launchctl kickstart -k gui/<uid>/<label>`.
   macOS only; skipped elsewhere; failures are logged and never fatal. Do not list the UI's
   own label.
4. Relaunches the UI with the new `--ui-path`, unless you passed `--ui-path` yourself. On any
   update failure it logs the error and relaunches the previous version.

Any other exit code is returned unchanged. `SIGINT`, `SIGTERM` and `SIGHUP` are forwarded to
the UI child and end the loop, so launchd stop/restart behaves as before.
