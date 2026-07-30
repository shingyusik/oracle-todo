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
