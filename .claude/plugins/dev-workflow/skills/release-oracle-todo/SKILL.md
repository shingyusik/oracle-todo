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
node -p "require('./npm/raven/package.json').version"
```

Only proceed when `HEAD` equals `origin/main`, neither intended tag exists locally or remotely, and the `node -p` output equals `<wrapper-version>` in `npm-v<wrapper-version>`. If the versions differ, stop and report. Create lightweight tags at the verified `HEAD` and push them together:

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
npm install -g @shings/raven@<wrapper-version>
raven update
raven version
raven doctor
```

`raven version` must print the wrapper version, `raven <engine-version>`, and `raven-ui <engine-version>`. The cache root is `RAVEN_CACHE_DIR` or `~/.local/share/raven`; it holds `versions/<version>/raven`, the active `bin/raven`, `ui/<version>/index.html`, and `metadata.json`. Do not use native `raven --version` to verify the release; it prints the crate version `0.1.0`.

The live UI is the launchd LaunchAgent `com.raven.ui` (`~/Library/LaunchAgents/com.raven.ui.plist`), listening on `127.0.0.1:3001` (confirmed on the Mac mini). Two processes are involved:

- the launchd job pid is the node wrapper (`/opt/homebrew/bin/raven` -> `raven.js`);
- the `127.0.0.1:3001` listener is its child native process `~/.local/share/raven/bin/raven ui --ui-path ~/.local/share/raven/ui/<version> --port 3001`.

Record the old listener pid, then restart only that job:

```bash
lsof -nP -iTCP:3001 -sTCP:LISTEN -t
launchctl kickstart -k "gui/$(id -u)/com.raven.ui"
launchctl print "gui/$(id -u)/com.raven.ui" | grep -E '^[[:space:]]*(state|pid|path|program|last exit code) ='
lsof -nP -iTCP:3001 -sTCP:LISTEN -t
ps -o args= -p <listener-pid>
curl -fsS http://127.0.0.1:3001/healthz
curl -fsS http://127.0.0.1:3001/ | shasum -a 256
shasum -a 256 "${RAVEN_CACHE_DIR:-$HOME/.local/share/raven}/ui/<engine-version>/index.html"
```

Require:

- `launchctl print`: `state = running` and a new wrapper pid;
- `lsof`: a listener pid different from the one recorded before the restart;
- `ps` on the listener pid: `--ui-path .../ui/<engine-version>`;
- `{"status":"ok"}` from `/healthz` (confirmed to return 200 on the Mac mini) and matching hashes.

UNVERIFIED: it is not confirmed whether `launchctl kickstart -k` also restarts the child listener. That is why the listener pid and its `--ui-path` are checked separately. If the old child survives, stop and report; do not kill it by broad matching.

Never use broad process matching or kill an unrelated port owner. If the job does not come back, report that state rather than starting a detached background service without user direction.

## 5. Update the MCP service (com.raven.mcp)

First check for legacy services:

```bash
launchctl list | grep -i oracle
```

`com.oracle-todo.ui` still exists on the Mac mini and is restart-looping with HTTP 403 (observed by the Tech Lead). Report it; do not clean it up as part of the release.

**Cleanup REQUIRES OWNER APPROVAL before running and is not part of the normal release.** With approval, confirm the plist path first (the `mv` below assumes the default LaunchAgents path; adjust it if `path =` differs), then move the plist into the backup folder instead of deleting it:

```bash
launchctl print "gui/$(id -u)/com.oracle-todo.ui" | grep -E '^[[:space:]]*path = '
launchctl bootout "gui/$(id -u)/com.oracle-todo.ui"
BACKUP_DIR=~/raven-launchd-backups
mkdir -p "$BACKUP_DIR" && chmod 700 "$BACKUP_DIR"
mv ~/Library/LaunchAgents/com.oracle-todo.ui.plist "$BACKUP_DIR/com.oracle-todo.ui.plist.$(date +%Y%m%d-%H%M%S)"
chmod 600 "$BACKUP_DIR"/com.oracle-todo.ui.plist.*
```

`com.raven.mcp` is a launchd LaunchAgent listening on `127.0.0.1:3003`. Its plist pins a versioned binary, so `raven update` alone does not move it to the new release. Its `ProgramArguments` are:

```text
~/.local/share/raven/versions/<version>/raven --home /Users/singyusig/.raven mcp --port 3003
```

Confirmed on the Mac mini (the plist itself is not in the repo):

- Plist path is `~/Library/LaunchAgents/com.raven.mcp.plist`. Re-confirm it with the first command under Steps, which prints only the `path` line.
- `ProgramArguments:0` is the binary. Only index 0 changes; `--home /Users/singyusig/.raven mcp --port 3003` stays as is.
- `launchctl`, `plutil`, and `/usr/libexec/PlistBuddy` are available.
- `RAVEN_MCP_PUBLIC_ORIGIN`, `RAVEN_MCP_ACCESS_ISSUER`, and `RAVEN_MCP_ACCESS_AUDIENCE` live in the plist. Leave them untouched.

The plist and `launchctl print` contain `RAVEN_MCP_ACCESS_*` values in plaintext. Never paste full `plutil -p` or `launchctl print` output into chat, logs, issues, or evidence. Use only the filtered commands below.

Pre-move check: the MCP currently runs the locally built hotfix `0.4.32-ledger-audit-entry-fix-20261016` (`versions/0.4.32-ledger-audit-entry-fix-20261016/raven`). Before repointing, confirm the release tag contains the hotfix commit `9eeac76` (`[FIX] Resolve Ledger MCP audit record aliases`):

```bash
git merge-base --is-ancestor 9eeac76 v<engine-version>
```

Repeat for any related Ledger fix being relied on. If any check exits non-zero, do not move the MCP service. Keep the hotfix running and report.

Steps:

```bash
launchctl print "gui/$(id -u)/com.raven.mcp" | grep -E '^[[:space:]]*path = '
NEW="${RAVEN_CACHE_DIR:-$HOME/.local/share/raven}/versions/<engine-version>/raven"
test -x "$NEW"
PLIST=~/Library/LaunchAgents/com.raven.mcp.plist
BACKUP_DIR=~/raven-launchd-backups
mkdir -p "$BACKUP_DIR" && chmod 700 "$BACKUP_DIR"
BACKUP="$BACKUP_DIR/com.raven.mcp.plist.$(date +%Y%m%d-%H%M%S)"
cp -p "$PLIST" "$BACKUP"
cmp "$PLIST" "$BACKUP"
chmod 600 "$BACKUP"
/usr/libexec/PlistBuddy -c 'Print :ProgramArguments' "$PLIST"
plutil -extract EnvironmentVariables xml1 -o - "$PLIST" | grep -o '<key>[^<]*</key>'
/usr/libexec/PlistBuddy -c "Set :ProgramArguments:0 $NEW" "$PLIST"
plutil -lint "$PLIST"
/usr/libexec/PlistBuddy -c 'Print :ProgramArguments' "$PLIST"
plutil -extract EnvironmentVariables xml1 -o - "$PLIST" | grep -o '<key>[^<]*</key>'
```

The env check records key names only. Require identical key names before and after, including the three `RAVEN_MCP_*` keys, and `ProgramArguments` differing only at index 0.

The backup contains the Access settings in plaintext, so `$BACKUP_DIR` is `700` and the backup is `600`. Keep the backup outside `~/Library/LaunchAgents` so launchd never loads it as a second job with the same label, and never commit or share it. Note the `$BACKUP` path; rollback restores from it. Because `ProgramArguments` changed, launchd must re-read the plist. Check the loaded state first:

```bash
launchctl print "gui/$(id -u)/com.raven.mcp" | grep -E '^[[:space:]]*(state|pid) ='
```

If `launchctl print` fails with error `113` ("Could not find service"), the job is not loaded; skip `bootout` and go straight to `bootstrap`. Otherwise:

```bash
launchctl bootout "gui/$(id -u)/com.raven.mcp"
launchctl bootstrap "gui/$(id -u)" "$PLIST"
```

If `bootout` fails with `3: No such process`, the job was not loaded; continue with `bootstrap`. Any other `bootout` error: stop and report.

If `bootstrap` fails (for example `5: Input/output error`) right after `bootout`, the old job may still be stopping. Poll until the service is gone (error `113`), then retry `bootstrap` once:

```bash
for i in 1 2 3 4 5 6 7 8 9 10; do launchctl print "gui/$(id -u)/com.raven.mcp" >/dev/null 2>&1 || break; sleep 1; done
launchctl bootstrap "gui/$(id -u)" "$PLIST"
```

If it still fails, roll back. `launchctl kickstart -k` restarts the already-loaded definition and does not pick up plist edits. Use it only when the plist was unchanged.

Verify:

```bash
launchctl print "gui/$(id -u)/com.raven.mcp" | grep -E '^[[:space:]]*(state|pid|path|program|last exit code) ='
launchctl print "gui/$(id -u)/com.raven.mcp" | sed -n '/^[[:space:]]*arguments = {/,/^[[:space:]]*}/p'
lsof -nP -iTCP:3003 -sTCP:LISTEN
ps -o args= -p <pid>
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3003/mcp
```

The `sed` range prints only the `arguments` block; never widen it to the `environment` block. Require `state = running`, program and arguments showing `versions/<engine-version>/raven --home /Users/singyusig/.raven mcp --port 3003`, the `lsof` pid matching the launchd pid, and `ps` showing the same command line. The `curl` probe sends no credentials and must return `421` (confirmed on the Mac mini): the process answers and rejects the local Host. (`401` means the Host matched but no Access assertion was sent; it also proves liveness.)

Then run a read-only functional check through the authenticated MCP client. `ledger_audit` requires `record_type` and `id` (`raven-api/src/mcp/catalog.rs`):

1. Call `ledger_entry_list` and pick an existing entry id.
2. Call `ledger_audit` with `record_type="entry"` and that id.

Require a valid, non-empty items page with events present. If the call fails, or returns empty for an entry known to have history, roll back and re-verify. Do not make test mutations. Record only the item count and `next_offset` as evidence, not record contents.

Never put Cloudflare Access credentials, service tokens, or JWTs in commands or evidence.

### MCP rollback

Restore the timestamped `$BACKUP` recorded above over `$PLIST` (`cp -p "$BACKUP" "$PLIST"`), then `bootout` and `bootstrap` with the same error handling. Re-run the full Verify block against the restored path: filtered `launchctl print`, PlistBuddy `ProgramArguments`, `lsof` on `3003`, `ps`, the `421` `curl` probe, and the `ledger_audit` check. Keep `versions/<old-version>` until verification passes; the wrapper does not prune old version directories. Reinstalling the same version deletes and recreates `versions/<version>`, so never repoint the plist at a version you are about to reinstall.

### Wrapper and UI rollback

The wrapper honors `RAVEN_VERSION` (`npm/raven/src/install.js`):

```bash
npm install -g @shings/raven@<old-wrapper-version>
RAVEN_VERSION=<old-engine-version> raven update
raven version
raven doctor
launchctl kickstart -k "gui/$(id -u)/com.raven.ui"
```

Then re-run the section 4 UI checks with `<old-engine-version>`. Re-installing a version deletes and recreates `versions/<version>`. Never `RAVEN_VERSION`-reinstall the version the MCP plist is currently pinned to while the MCP is running.

## 6. Final evidence

Before claiming completion, use `verification-before-completion` and freshly verify:

- `npm/raven/package.json` version matches the `npm-v<wrapper-version>` tag;
- npm `latest` equals the wrapper version, and the global install was pinned to `@shings/raven@<wrapper-version>`;
- `raven version` shows the expected wrapper, engine, and UI versions, and `raven doctor` passes;
- both GitHub Actions runs concluded `success`;
- GitHub Release has all expected assets;
- `com.raven.ui` is running with a new wrapper pid, the `3001` listener has a new pid whose `ps` args show `--ui-path .../ui/<engine-version>`, `/healthz` returns ok, and the served UI hash matches `ui/<engine-version>/index.html`;
- `9eeac76` (and any other relied-on Ledger fix) is an ancestor of `v<engine-version>`;
- `com.raven.mcp` is running from `versions/<engine-version>/raven` per filtered `launchctl print`, PlistBuddy `ProgramArguments`, and `ps`, the `lsof` listener on `3003` has the same pid, the unauthenticated `/mcp` probe returns `421`, and `ledger_audit` on an existing entry returns events;
- evidence contains only filtered `launchctl print` lines, PlistBuddy `ProgramArguments`, and env key names; no full `plutil -p` or `launchctl print` output;
- `HEAD`, `origin/main`, `v<engine-version>`, and `npm-v<wrapper-version>` resolve to the same commit;
- worktree is clean.

Report the release URL, both Actions URLs, versions, test results, the MCP binary path before and after, and whether a browser hard refresh may be needed.

## Known gaps

- The `com.raven.ui` and `com.raven.mcp` plists live only on the Mac mini; the repo has no templates or install scripts for them.
- The MCP listener has no health or version endpoint. Version comes from the plist and process command line.
- Native `raven --version` reports the crate version `0.1.0`, not the release version.
- The `com.raven.mcp` plist has no `StandardOutPath` or `StandardErrorPath`, so there are no log files. On failure, use filtered `launchctl print` and `log show --predicate 'process == "raven"' --last 10m`.
- Legacy `com.oracle-todo.ui` is still loaded on the Mac mini and restart-looping with HTTP 403. Its cleanup (section 5) requires owner approval.
- `versions/0.4.32-ledger-audit-entry-fix-20261016` was built locally and has no `SHA256SUMS`, so it cannot be checksum-verified. It is the rollback target; do not delete it until the new release passes verification.
