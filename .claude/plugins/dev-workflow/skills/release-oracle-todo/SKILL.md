---
name: release-oracle-todo
description: Publish a Raven engine/UI GitHub Release and its npm wrapper through the repository's tag-triggered GitHub Actions workflows, then update and verify the Mac mini installation and its launchd UI and MCP services. Use when asked to release, deploy, publish to npm, or update the local Raven bundle.
---

# Release Raven

Release from the repository root. The flow is:

1. Push tags `v<engine-version>` and `npm-v<wrapper-version>` from a verified `main`.
2. GitHub Actions runs `release.yml` and `npm-publish.yml`:
   - `v<engine-version>` builds the multi-platform engine, static UI, checksums, and GitHub Release.
   - `npm-v<wrapper-version>` tests and publishes `@shings/raven`.
3. On the Mac mini, update the global wrapper and cached bundle, restart `com.raven.ui` (section 4), then repoint and reload `com.raven.mcp` (section 5).

Do not run `npm publish` locally. npm Trusted Publishing uses GitHub Actions OIDC, so no local npm login, OTP, `NPM_TOKEN`, or secret is required.

## 1. Establish the release boundary

1. Read `docs/operations/setup.md`, `docs/operations/mcp-reference.md`, `.github/workflows/release.yml`, and `.github/workflows/npm-publish.yml`.
2. Inspect `git status --short --branch`, unstaged/staged diffs, `git stash list`, recent commits, tags, GitHub releases, and the current npm `latest` version.
3. Keep unrelated user changes out of the release. Do not tag a mixed or dirty worktree.
4. Determine the two exact versions before creating tags:
   - engine/UI version: next GitHub Release tag, `v<engine-version>`;
   - wrapper version: `npm/raven/package.json`, `npm-v<wrapper-version>`.
5. Confirm that the wrapper package version was committed intentionally. If a version bump or release commit is needed, use the project `structured-commit` skill first.
6. Do not recreate existing local or remote tags. Stop and report a collision.

This repository (`shingyusik/oracle-todo`) releases accepted `main` commits directly by tag. Do not create a PR just to cut a release when `main` is synchronized and the user explicitly requested deployment.

## 2. Validate before publishing

Run these from the repository root. Use the package directory as the working directory for `npm pack`.

```bash
npm test --prefix npm/raven
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test
npm test --prefix frontend
npm run typecheck --prefix frontend
npm run build --prefix frontend
```

Then confirm the wrapper contents without creating an archive:

```bash
(cd npm/raven && npm pack --dry-run --json)
git diff --check
git status --short --branch
```

For an engine behavior change, use `verify-todo-engine` with a `mktemp -d` data home and a non-live API port. Never point tests or smoke checks at the live data home (`~/.raven`).

## 3. Preflight and publish

Require an authenticated GitHub CLI session and a clean, synchronized `main` before tagging.

```bash
gh --version
gh auth status
git fetch origin --prune --tags
git status --short --branch
git rev-parse HEAD
git rev-parse origin/main
git ls-remote --tags origin refs/tags/v<engine-version> refs/tags/npm-v<wrapper-version>
```

Only proceed when `HEAD` equals `origin/main` and neither intended tag exists locally or remotely. Create lightweight tags at the verified `HEAD` and push them together:

```bash
git tag v<engine-version>
git tag npm-v<wrapper-version>
git push origin v<engine-version> npm-v<wrapper-version>
```

Find the two run IDs using `gh run list`, then wait for both to complete successfully:

```bash
gh run watch <npm-run-id> --exit-status
gh run watch <release-run-id> --exit-status
```

If either run fails, stop, inspect the run logs, and do not update the local installation as if the release succeeded.

## 4. Verify publication, update the Mac mini, and restart the UI (com.raven.ui)

Confirm the npm dist-tag, GitHub Release assets, and checksums before installing:

```bash
npm view @shings/raven version dist-tags --json
gh release view v<engine-version> --json tagName,url,publishedAt,assets
```

Require `SHA256SUMS`, `raven-ui-<engine-version>.tar.gz`, and all four `raven-<engine-version>-<target>` archives. Then, on the Mac mini, update the global wrapper and cached bundle:

```bash
npm install -g @shings/raven@latest
raven update
raven version
raven doctor
```

`raven version` must print the wrapper version, `raven <engine-version>`, and `raven-ui <engine-version>`. The cache root is `RAVEN_CACHE_DIR` or `~/.local/share/raven`; it holds `versions/<version>/raven`, the active `bin/raven`, `ui/<version>/index.html`, and `metadata.json`. Do not use native `raven --version` to verify the release; it prints the crate version `0.1.0`.

The live UI is the launchd LaunchAgent `com.raven.ui` (`~/Library/LaunchAgents/com.raven.ui.plist`), listening on `127.0.0.1:3001`. Restart only that job:

```bash
launchctl kickstart -k "gui/$(id -u)/com.raven.ui"
launchctl print "gui/$(id -u)/com.raven.ui"
curl -fsS http://127.0.0.1:3001/healthz
curl -fsS http://127.0.0.1:3001/ | shasum -a 256
shasum -a 256 ~/.local/share/raven/ui/<engine-version>/index.html
```

Require `state = running` with a new pid, `{"status":"ok"}` from `/healthz`, and matching hashes. Never use broad process matching or kill an unrelated port owner. If the job does not come back, report that state rather than starting a detached background service without user direction.

## 5. Update the MCP service (com.raven.mcp)

`com.raven.mcp` is a launchd LaunchAgent running `raven mcp` on `127.0.0.1:3003`. Its plist pins a versioned binary in `ProgramArguments`, for example `~/.local/share/raven/versions/<version>/raven mcp ...`, so `raven update` alone does not move it to the new release.

Assumptions to confirm before editing, because the plist is not in the repo:

- Plist path is `~/Library/LaunchAgents/com.raven.mcp.plist`. `launchctl print "gui/$(id -u)/com.raven.mcp"` shows the actual `path`.
- `ProgramArguments:0` is the binary. Check with `plutil -p` first.
- `RAVEN_MCP_PUBLIC_ORIGIN`, `RAVEN_MCP_ACCESS_ISSUER`, and `RAVEN_MCP_ACCESS_AUDIENCE` come from the plist (`EnvironmentVariables` or arguments). Leave them untouched.

Steps:

```bash
NEW=~/.local/share/raven/versions/<engine-version>/raven
test -x "$NEW"
PLIST=~/Library/LaunchAgents/com.raven.mcp.plist
BACKUP=~/raven-launchd-backups/com.raven.mcp.plist.<old-version>
mkdir -p "$(dirname "$BACKUP")"
cp -p "$PLIST" "$BACKUP"
plutil -p "$PLIST"
/usr/libexec/PlistBuddy -c "Set :ProgramArguments:0 $NEW" "$PLIST"
plutil -lint "$PLIST"
plutil -p "$PLIST"
```

Keep the backup outside `~/Library/LaunchAgents` so launchd never loads it as a second job with the same label. Change only the version segment of the binary path. Because `ProgramArguments` changed, launchd must re-read the plist:

```bash
launchctl bootout "gui/$(id -u)/com.raven.mcp"
launchctl bootstrap "gui/$(id -u)" "$PLIST"
```

If `bootstrap` fails with `5: Input/output error` right after `bootout`, the old job may still be stopping; confirm with `launchctl print` and retry `bootstrap` once. `launchctl kickstart -k` restarts the already-loaded definition and does not pick up plist edits. Use it only when the plist was unchanged.

Verify:

```bash
launchctl print "gui/$(id -u)/com.raven.mcp"
lsof -nP -iTCP:3003 -sTCP:LISTEN
ps -o command= -p <pid>
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3003/mcp
```

Require `state = running`, program and arguments showing the new versioned path, the `lsof` pid matching the launchd pid, and `ps` showing the new path. The `curl` probe sends no credentials and must return `421`: the process answers and rejects the local Host. (`401` means the Host matched but no Access assertion was sent; it also proves liveness.) Optionally confirm a real tool call through the authenticated MCP client.

Never put Cloudflare Access credentials, service tokens, or JWTs in commands or evidence.

Rollback: restore `$BACKUP` over `$PLIST`, then `bootout` and `bootstrap` again. Keep `versions/<old-version>` until verification passes; the wrapper does not prune old version directories. Reinstalling the same version deletes and recreates `versions/<version>`, so never repoint the plist at a version you are about to reinstall.

## 6. Final evidence

Before claiming completion, use `verification-before-completion` and freshly verify:

- npm `latest` equals the wrapper version;
- `raven version` shows the expected wrapper, engine, and UI versions, and `raven doctor` passes;
- both GitHub Actions runs concluded `success`;
- GitHub Release has all expected assets;
- `com.raven.ui` is running, `/healthz` on `127.0.0.1:3001` returns ok, and the served UI hash matches `ui/<engine-version>/index.html`;
- `com.raven.mcp` is running from `versions/<engine-version>/raven` per `launchctl print` and `ps`, the `lsof` listener on `3003` has the same pid, and the unauthenticated `/mcp` probe returns `421`;
- `HEAD`, `origin/main`, `v<engine-version>`, and `npm-v<wrapper-version>` resolve to the same commit;
- worktree is clean.

Report the release URL, both Actions URLs, versions, test results, the MCP binary path before and after, and whether a browser hard refresh may be needed.

## Known gaps

- The `com.raven.ui` and `com.raven.mcp` plists live only on the Mac mini; the repo has no templates or install scripts for them.
- The MCP listener has no health or version endpoint. Version comes from the plist and process command line.
- Native `raven --version` reports the crate version `0.1.0`, not the release version.
