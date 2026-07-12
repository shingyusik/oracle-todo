# npx GitHub Release Installer Design

## Goal

Provide a Rust-free local execution path for `todo-engine` through an npm package:

```bash
npx @shinggyusik/oracle-todo <todo-engine args>
```

The npm package downloads and runs prebuilt GitHub Release binaries. User data remains local
under the existing `todo-engine` data home.

## Package Name

- npm package: `@shinggyusik/oracle-todo`
- CLI command exposed by the package: `oracle-todo`
- Runtime target binary: `todo-engine`

## User Experience

First run:

```bash
npx @shinggyusik/oracle-todo init
npx @shinggyusik/oracle-todo today
npx @shinggyusik/oracle-todo pending
```

Update:

```bash
npx @shinggyusik/oracle-todo update
```

Command forwarding:

- Any command other than wrapper-owned commands is passed through to `todo-engine`.
- `npx @shinggyusik/oracle-todo today` executes the downloaded `todo-engine today`.
- `npx @shinggyusik/oracle-todo --home ~/.todo-engine-dev today` preserves normal engine flags.

## Data Model Boundary

The installer manages only application binaries and metadata.

The engine continues to own persistent user data:

```text
~/.todo-engine/
├── todo.sqlite
└── logs/
```

Install and update operations must not create, delete, migrate, or overwrite `todo.sqlite`.
Schema initialization and migrations remain service-owned behavior reached through
`todo-engine init` and future engine commands.

## Local Binary Cache

Use a per-user cache outside the repository:

```text
~/.local/share/oracle-todo/
├── bin/
│   └── todo-engine
├── versions/
│   └── <version>/
│       └── todo-engine
└── metadata.json
```

`metadata.json` records:

- installed version
- release asset name
- binary path
- install timestamp

The active binary at `bin/todo-engine` is copied or linked from the selected version directory.

## Wrapper Commands

The npm wrapper owns these commands:

| Command | Behavior |
| --- | --- |
| `install` | Download the latest compatible release binary if missing. |
| `update` | Check the latest GitHub Release and replace the active binary when newer. |
| `version` | Print wrapper version and installed engine version. |
| `doctor` | Verify cache, binary execute permission, and engine health command availability. |

All other commands are forwarded to `todo-engine`.

## Release Assets

GitHub Releases publish one archive per supported platform:

```text
todo-engine-<version>-aarch64-apple-darwin.tar.gz
todo-engine-<version>-x86_64-apple-darwin.tar.gz
todo-engine-<version>-x86_64-unknown-linux-gnu.tar.gz
todo-engine-<version>-x86_64-pc-windows-msvc.zip
```

Each archive contains:

```text
todo-engine
LICENSE
README.md
```

Windows archives contain `todo-engine.exe`.

## Platform Resolution

The wrapper maps Node platform values to release assets:

| Node `process.platform` | Node `process.arch` | Rust target |
| --- | --- | --- |
| `darwin` | `arm64` | `aarch64-apple-darwin` |
| `darwin` | `x64` | `x86_64-apple-darwin` |
| `linux` | `x64` | `x86_64-unknown-linux-gnu` |
| `win32` | `x64` | `x86_64-pc-windows-msvc` |

Unsupported platform or architecture combinations fail with a clear message that names the
detected platform and supported targets.

## GitHub Release Lookup

The wrapper uses the GitHub Releases API:

- latest release endpoint for default install/update
- explicit version endpoint for pinned installs

Supported environment overrides:

| Variable | Purpose |
| --- | --- |
| `ORACLE_TODO_VERSION` | Install a specific release version. |
| `ORACLE_TODO_CACHE_DIR` | Override the binary cache directory. |
| `ORACLE_TODO_GITHUB_TOKEN` | Optional token for higher GitHub API rate limits. |

## Error Handling

Errors should distinguish:

- unsupported platform
- release not found
- matching asset not found
- download failure
- checksum failure when checksums are available
- archive extraction failure
- binary permission failure
- child process execution failure

The wrapper exits with the child `todo-engine` exit code when command forwarding reaches the
engine. Wrapper-owned command failures exit with code `1`.

## Security

The initial release can rely on GitHub HTTPS transport. A follow-up checksum asset should be
supported before wider distribution:

```text
SHA256SUMS
```

When `SHA256SUMS` is present, the wrapper verifies the downloaded archive before extraction.
Checksum verification failure must remove the partially downloaded archive and keep the previous
active binary.

## Release Workflow

GitHub Actions builds release assets from tags:

```text
v<version>
```

The workflow:

1. Builds `todo-engine` in release mode for each supported target.
2. Packages the binary with `README.md` and license file when present.
3. Generates `SHA256SUMS`.
4. Uploads archives and checksums to the GitHub Release.

The npm package can be published independently, because it resolves engine versions from GitHub
Releases at runtime.

## Testing

Unit tests cover:

- platform-to-target mapping
- release asset name selection
- version comparison
- cache metadata read/write
- unsupported platform errors

Integration tests cover:

- install from a mocked GitHub Release response
- update from one mocked version to another
- command forwarding to a fake engine binary
- preservation of existing cache when download or checksum validation fails

Manual smoke checks cover:

```bash
npx @shinggyusik/oracle-todo version
npx @shinggyusik/oracle-todo --home "$(mktemp -d)" init
npx @shinggyusik/oracle-todo --home "$(mktemp -d)" health
```

## Implementation Boundaries

- Keep the wrapper package small and dependency-light.
- Do not duplicate engine commands in JavaScript.
- Do not add database migration behavior to the wrapper.
- Do not require Rust or Cargo for the default user path.
- Keep source-build installation out of the first implementation.
