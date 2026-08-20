# UI Session URL Output Design

## Goal

Make every `raven ui` launch print a clickable URL that establishes the local UI session
before loading the application.

## Output Contract

After binding the listener, the command prints both addresses:

```text
Raven UI listening on http://127.0.0.1:3002
Open Raven UI: http://127.0.0.1:3002/__raven/session
```

- The listening address identifies the bound server.
- The open address is the session bootstrap route and is suitable for direct browser use.
- Both addresses use the actual bound address, including an ephemeral port when applicable.

## Behavior

- The session bootstrap URL is constructed once and reused for terminal output and automatic
  browser opening.
- `--no-open` suppresses automatic browser launch only; both URL lines remain visible.
- Visiting the bootstrap URL sets the existing HTTP-only session cookie and redirects to `/`.
- Session generation, authentication policy, listener binding, and public-origin behavior are
  unchanged.

## Verification

- A focused unit test verifies the listening and session URLs for a bound address.
- Existing UI CLI and UI session tests continue to pass.
- `cargo fmt --check` and the relevant `raven-cli` tests pass.

## Non-Goals

- Embedding a session token in the URL
- Opening a browser when `--no-open` is set
- Changing the default port or data-home resolution
