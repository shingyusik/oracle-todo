# Packaging Task 1 Implementer Report

## Implementation

- Added `raven ui` with a fixed loopback bind, configurable port and UI path,
  browser launch by default, and `--no-open`.
- Generates one 32-byte CSPRNG session token per launch. The API state keeps
  only its SHA-256 verifier and compares cookie candidates in constant time.
- Bootstraps an HTTP-only, SameSite-strict, path-scoped session cookie and
  redirects to `/`; the printed URL contains no credential.
- Requires the cookie for `/api/v1/*`, keeps `/healthz` public, and removes the
  transitional `x-raven-session` authentication contract.
- Serves the UI from one origin with explicit MIME types, SPA fallback, missing
  artifact failure, API-path isolation, canonical-root enforcement, and
  encoded traversal and symlink rejection.
- Restricts `RavenApiState` construction to the crate so callers cannot bypass
  verifier preparation.
- Reuses existing `sha2` and `getrandom` workspace dependencies; no static
  server or browser-opening dependency was added.

## TDD Evidence

- Initial RED: `ui_session` failed to compile because `UiSessionToken`,
  `AuthMode::ui_session`, and `ui_router` did not exist.
- Flow RED: the bootstrap test expected a cookie-setting `303` redirect but
  received `204`, exposing that opening `/` would leave the existing frontend
  unauthenticated.
- Focused API: `raven-api/tests/ui_session.rs` — 4 passed.
- Focused CLI/agreement: 3 passed.
- Raven CLI full suite: passed.
- Raven API suite: all tests passed except the pre-existing real-loopback
  server test, which the filesystem/network sandbox rejected with
  `PermissionDenied`.
- Workspace regression suite passed with that one socket test skipped.
- `cargo fmt --all --check`: passed.
- `cargo clippy -p raven-api -p raven-cli --all-targets --all-features -- -D warnings`:
  passed.
- `git diff --check`: passed.

## Environment Limitation

- A managed request to rerun the one loopback socket test outside the sandbox
  was automatically rejected because the approval service reported its usage
  limit. No workaround or live Raven data home was used.

## Security Review Fixes

- Validates exactly one `Host` header against the actual bound loopback socket
  authority at the outermost UI router boundary. A present `Origin` must be
  exactly the matching HTTP loopback origin; missing, duplicate, malformed,
  hostile, and rebinding authorities receive `421` before route handling.
- Builds the API as an authenticated `/api` subtree with its own fallback.
  Exact and descendant unknown API paths therefore return the same `401` as
  registered endpoints without a cookie and `404` after authentication.
  Reserved `/healthz/` descendants also remain authenticated, while exact
  `/healthz` alone is public and Raven-reserved paths never become SPA routes.
- Snapshots recursive regular UI files into immutable memory before binding.
  Symlinks and special entries are rejected, with limits of 16 MiB per file,
  128 MiB total, 10,000 entries, and 64 directory levels. Post-start file
  replacement cannot change served bytes.
- Serves GET and HEAD directly from snapshot metadata with equal
  `Content-Length`, empty HEAD bodies, and `Cache-Control: no-store`.
  Bootstrap redirects also carry `no-store`.
- Reaps the browser launcher child on a detached waiting thread without
  blocking server startup or logging the bootstrap URL.

## Security Review Verification

- Review RED: 8 UI tests initially failed to compile against the missing
  authority-aware snapshot API.
- Flow RED: bootstrap caching assertion failed before `no-store` was added.
- Focused UI security: 9 passed.
- Browser child reaper: 1 passed.
- Raven API full suite excluding the sandbox-blocked real socket test: passed.
- Raven CLI full suite: passed.
- `cargo fmt --all --check`: passed.
- `cargo clippy -p raven-api -p raven-cli --all-targets --all-features -- -D warnings`:
  passed.
- `git diff --check`: passed.

## Descriptor-safe Snapshot Follow-up

- Opens each original artifact path through a read-only descriptor before
  reading any bytes. Unix uses `OpenOptionsExt` with `O_NOFOLLOW` and
  `O_CLOEXEC`; Windows uses `FILE_FLAG_OPEN_REPARSE_POINT` and rejects reparse
  handles.
- Reads exclusively from the opened descriptor. It compares the validated
  path, opened handle, post-read handle, and a newly opened final path handle.
  Unix stamps include device, inode, size, mtime, and ctime. Windows stamps
  include volume, file index, size, attributes, creation/write time, and
  `ChangeTime` obtained from handle APIs.
- Canonical containment is checked after the safe open. A final-link swap,
  path double-swap, same-length mutation, identity change, or timestamp change
  aborts the entire artifact snapshot.
- Deterministic Unix race tests pass for a symlink inserted immediately before
  open, a regular→symlink→regular double-swap after open, and an in-place
  same-length mutation after open: 3 passed.
- The installed Windows target could not build the complete Raven dependency
  graph because the local cross C toolchain lacks SQLite's Windows standard
  headers. A dependency-minimal Windows cfg check using the exact
  `OpenOptionsExt`, `windows-sys` constants, handle identity, and
  `GetFileInformationByHandleEx` calls passed.
- Focused UI security remained 9 passed; Raven API and CLI full suites, fmt,
  clippy with warnings denied, and diff checks passed.

## Directory Capability Follow-up

- Replaced path-based traversal and reopen checks with directory capabilities.
  Unix opens the artifact root with `O_DIRECTORY | O_NOFOLLOW`, enumerates from
  that descriptor, opens every child with `openat` and `O_NOFOLLOW`, recurses
  through opened directory descriptors, and reads bytes only from the exact
  opened file descriptor.
- Keeps every ancestor directory descriptor alive while traversing. A renamed
  or replaced pathname therefore cannot redirect a child lookup outside the
  directory capability used by `openat`.
- Windows opens root and child handles with
  `FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS` and omits
  `FILE_SHARE_DELETE`. Directory guards remain alive during enumeration and
  recursion; every opened handle rejects reparse points and verifies its final
  normalized path is a component-descendant of the root handle path.
- Windows file reads use the opened handle only and compare stable volume/file
  identity, size, attributes, creation/write time, and `ChangeTime` before and
  after the bounded read.
- Removed the superseded path-canonicalization, path-reopen, and expected-path
  stamp comparisons. Existing 16 MiB file, 128 MiB total, 10,000 entry, and
  64-level depth limits remain enforced.
- TDD RED: synchronized Unix tests initially failed to compile because the
  capability loader and phases did not exist.
- Unix capability tests pass for a root symlink held active during root open, a
  nested directory symlink held active during `openat`, and an in-place
  same-length mutation after the file handle is opened: 3 passed.
- Focused UI security: 9 passed.
- Raven API full suite excluding the sandbox-blocked real socket test: passed.
- Raven CLI full suite: passed.
- A dependency-minimal Windows cfg crate using the exact directory flags,
  delete-denying share mode, handle identity calls, and
  `GetFinalPathNameByHandleW` compiled for `x86_64-pc-windows-gnu`.
- `cargo fmt --all --check`, clippy for Raven API/CLI with all targets,
  features, and warnings denied, plus `git diff --check`: passed.

## Filesystem Anchor Follow-up

- Extended capability traversal above the artifact root. Unix now resolves
  relative inputs against `current_dir`, lexically normalizes components,
  rejects a parent component that remains unresolved above `/`, opens `/` as
  the immutable anchor, and opens every artifact-path component with
  descriptor-relative `openat`, `O_DIRECTORY`, and `O_NOFOLLOW`.
- Retains the complete Unix anchor-to-artifact descriptor chain. The
  synchronized ancestor test keeps a replacement `container` symlink active
  while the walker attempts to open that component; the external artifact is
  rejected even though the final `ui` component itself is a regular directory.
- Windows accepts only absolute local-drive paths after resolving relative
  inputs against `current_dir`; UNC, device/verbatim, missing-drive, and
  drive-root escape forms are rejected. It opens the drive root first, then
  opens and validates one directory component at a time while retaining every
  no-delete-share ancestor handle.
- Every Windows intermediate and final component rejects reparse points and
  non-directories, records handle identity, and verifies final-path containment
  under the drive-root handle. The final component handle becomes the artifact
  root.
- Windows final-path comparison normalizes separators, case, and trailing
  separators, then requires exact equality or a separator-bounded descendant.
  Pure tests cover `\\?\C:\` to its first child, case-insensitive and nested
  containment, and `foo` versus sibling `foobar` rejection.
- Unix capability/normalization tests: 6 passed. Cross-platform final-path
  containment tests: 4 passed. Focused UI security: 9 passed.
- Raven API full suite excluding the sandbox-blocked real socket test and Raven
  CLI full suite passed. Formatting, clippy with warnings denied, and diff
  checks passed.
- The dependency-minimal Windows cfg crate was extended with the exact
  local-drive component walker and final-path containment helpers and compiled
  successfully for `x86_64-pc-windows-gnu`.
