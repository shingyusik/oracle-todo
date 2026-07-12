# npx Local UI Release Artifact Design

## Goal

Run the local workbench UI from the published npm wrapper without requiring Rust, Cargo,
frontend source checkout, or `npm install` in the project repository:

```bash
npx @shings/oracle-todo ui
```

The command starts the downloaded `todo-engine` HTTP API, serves the frontend locally, and opens
the user's browser to the UI.

## User Experience

Default launch:

```bash
npx @shings/oracle-todo ui
```

Behavior:

1. Ensure the compatible `todo-engine` release binary is installed.
2. Ensure the matching frontend UI release artifact is installed.
3. Start `todo-engine api --host 127.0.0.1 --port 3002`.
4. Start a local UI server on `127.0.0.1:3001`.
5. Proxy `/todo-engine/*` requests from the UI server to the API server.
6. Open `http://127.0.0.1:3001` in the default browser.
7. Keep both child processes alive until the wrapper process exits.

Supported options:

| Command | Behavior |
| --- | --- |
| `ui` | Start API + UI and open the browser. |
| `ui --no-open` | Start API + UI and print the URL only. |
| `ui --ui-port <port>` | Override the UI server port. |
| `ui --api-port <port>` | Override the API server port. |
| `--home <path> ui` | Pass the engine data home to the API process. |

## Release Assets

GitHub Releases continue to publish platform-specific engine archives and add one platform-neutral
frontend archive:

```text
todo-engine-<version>-aarch64-apple-darwin.tar.gz
todo-engine-<version>-x86_64-apple-darwin.tar.gz
todo-engine-<version>-x86_64-unknown-linux-gnu.tar.gz
todo-engine-<version>-x86_64-pc-windows-msvc.zip
oracle-todo-ui-<version>.tar.gz
SHA256SUMS
```

The UI archive contains a static Next.js export:

```text
oracle-todo-ui-<version>/
├── index.html
├── _next/
└── merovingian-mark.png
```

The frontend remains developed as a Next.js app, but release builds use static output so the npx
runtime only needs Node's built-in HTTP server capabilities.

## Frontend Build Contract

The frontend production artifact is static.

Required frontend build properties:

- `next build` emits static files through `output: "export"`.
- The UI continues to call the API through relative `/todo-engine/*` URLs.
- No server-only Next.js runtime features are required for the released UI.
- Static assets are path-safe when served from `http://127.0.0.1:<ui-port>/`.

If a future UI feature requires server-side rendering, the release artifact must move to a Next
standalone server bundle. The first UI release path stays static.

## Local UI Cache

The npm wrapper manages frontend artifacts in the same per-user cache root as engine binaries:

```text
~/.local/share/oracle-todo/
├── bin/
│   └── todo-engine
├── versions/
│   └── <version>/
│       └── todo-engine
├── ui/
│   └── <version>/
│       ├── index.html
│       ├── _next/
│       └── merovingian-mark.png
└── metadata.json
```

`metadata.json` records the installed engine version and UI version. `install` and `update` keep
engine and UI artifacts aligned to the same GitHub Release version.

## Wrapper Commands

The wrapper owns `ui` in addition to the existing wrapper commands:

| Command | Behavior |
| --- | --- |
| `install` | Download the latest compatible engine binary and matching UI artifact if missing. |
| `update` | Replace both engine and UI artifacts when a newer release exists. |
| `version` | Print wrapper version, installed engine version, and installed UI version. |
| `doctor` | Verify cache metadata, engine binary, UI artifact, and local port availability. |
| `ui` | Start the local API and UI server, then open the browser by default. |

All non-wrapper commands continue to forward to `todo-engine`.

## Runtime Server

The UI runtime is a small Node HTTP server inside the npm wrapper.

Responsibilities:

- Serve static files from the installed UI artifact directory.
- Fallback unknown non-API routes to `index.html`.
- Proxy `/todo-engine/*` to `http://127.0.0.1:<api-port>/*`.
- Return clear errors when the UI artifact is missing or the API process exits early.
- Shut down child processes on `SIGINT` and `SIGTERM`.

Port handling:

- Default UI port: `3001`.
- Default API port: `3002`.
- If a required port is in use, fail with a clear message unless the user supplied an alternate
  port option.

Browser opening:

- macOS: `open <url>`
- Windows: `cmd /c start "" <url>`
- Linux: `xdg-open <url>`

Failure to open the browser does not stop the servers; the wrapper prints the URL.

## Data Boundary

The UI launch command does not own user data. Persistent data remains in the existing engine data
home:

```text
~/.todo-engine/
├── todo.sqlite
└── logs/
```

The wrapper may pass `--home <path>` to `todo-engine api`, but it must not create database rows,
perform migrations directly, or bypass the Rust service layer.

## Error Handling

Errors distinguish:

- release UI asset not found
- UI download failure
- UI checksum failure
- UI archive extraction failure
- missing `index.html`
- API port already in use
- UI port already in use
- API process exits before becoming reachable
- browser open command failure

When `SHA256SUMS` is present, the UI archive is verified before extraction. Checksum failure keeps
the previously installed UI artifact.

## Testing

Wrapper tests cover:

- UI asset name selection.
- UI artifact installation from a mocked GitHub Release response.
- install/update metadata with aligned engine and UI versions.
- static file serving.
- `/todo-engine/*` proxy path rewriting.
- `ui --no-open`, `--ui-port`, and `--api-port` parsing.
- child process shutdown on wrapper exit.

Release workflow tests cover:

- frontend typecheck and test suite.
- static build artifact creation.
- `SHA256SUMS` includes `oracle-todo-ui-<version>.tar.gz`.

Manual smoke checks cover:

```bash
npx @shings/oracle-todo update
npx @shings/oracle-todo ui --no-open
npx @shings/oracle-todo --home "$(mktemp -d)" ui --no-open --ui-port 3101 --api-port 3102
```

## Implementation Boundaries

- Keep the npm package a small downloader and runtime wrapper.
- Do not bundle `frontend/node_modules` into the npm package.
- Do not require Rust, Cargo, or a repository checkout for `npx @shings/oracle-todo ui`.
- Do not duplicate API business logic in the UI server.
- Keep the development path `npm run dev:with-api` separate from the release runtime path.
