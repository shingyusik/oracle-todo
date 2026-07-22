---
name: release-oracle-todo
description: Publish an Oracle Todo engine/UI GitHub Release and its npm wrapper through the repository's tag-triggered GitHub Actions workflows, then update and verify the local installation. Use when asked to release, deploy, publish to npm, or update the local Oracle Todo bundle.
---

# Release Oracle Todo

Release from the repository root. This project publishes through tags:

- `v<engine-version>` builds the multi-platform engine, static UI, checksums, and GitHub Release.
- `npm-v<wrapper-version>` tests and publishes `@shings/oracle-todo`.

Do not run `npm publish` locally. npm Trusted Publishing uses GitHub Actions OIDC, so no local npm login, OTP, `NPM_TOKEN`, or secret is required.

## 1. Establish the release boundary

1. Read `docs/operations/setup.md`, `.github/workflows/release.yml`, and `.github/workflows/npm-publish.yml`.
2. Inspect `git status --short --branch`, unstaged/staged diffs, `git stash list`, recent commits, tags, GitHub releases, and the current npm `latest` version.
3. Keep unrelated user changes out of the release. Do not tag a mixed or dirty worktree.
4. Determine the two exact versions before creating tags:
   - engine/UI version: next GitHub Release tag, `v<engine-version>`;
   - wrapper version: `npm/oracle-todo/package.json`, `npm-v<wrapper-version>`.
5. Confirm that the wrapper package version was committed intentionally. If a version bump or release commit is needed, use the project `structured-commit` skill first.
6. Do not recreate existing local or remote tags. Stop and report a collision.

This repository releases accepted `main` commits directly by tag. Do not create a PR just to cut a release when `main` is synchronized and the user explicitly requested deployment.

## 2. Validate before publishing

Run these from the repository root. Use the package directory as the working directory for `npm pack`.

```bash
npm test --prefix npm/oracle-todo
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test
npm test --prefix frontend
npm run typecheck --prefix frontend
npm run build --prefix frontend
```

Then confirm the wrapper contents without creating an archive:

```bash
(cd npm/oracle-todo && npm pack --dry-run --json)
git diff --check
git status --short --branch
```

For an engine behavior change, use `verify-todo-engine` with a `mktemp -d` data home and a non-live API port. Never point tests or smoke checks at the live data home.

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

## 4. Verify publication and update local Oracle Todo

Confirm the npm dist-tag, GitHub Release assets, and checksums before installing locally:

```bash
npm view @shings/oracle-todo version dist-tags --json
gh release view v<engine-version> --json tagName,url,publishedAt,assets
```

Require `SHA256SUMS`, the UI archive, and all four engine platform archives. Then update the global wrapper and cached bundle:

```bash
npm install -g @shings/oracle-todo@latest
oracle-todo update
oracle-todo version
oracle-todo doctor
```

If a local `oracle-todo ui --no-open` process already exists, restart only that exact parent process with `TERM`; never use broad process matching or kill an unrelated port owner. Check that its child API restarts, then compare the served UI hash with the installed `ui/<engine-version>/index.html`. If the service does not restart automatically, report that state rather than starting a detached background service without user direction.

## 5. Final evidence

Before claiming completion, use `verification-before-completion` and freshly verify:

- npm `latest` equals the wrapper version;
- global wrapper, engine, and UI versions are expected;
- both GitHub Actions runs concluded `success`;
- GitHub Release has all expected assets;
- live API health succeeds and served UI matches the installed release;
- `HEAD`, `origin/main`, `v<engine-version>`, and `npm-v<wrapper-version>` resolve to the same commit;
- worktree is clean.

Report the release URL, both Actions URLs, versions, test results, and whether a browser hard refresh may be needed.
