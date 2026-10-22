# Continuous Integration

## Workflow

`.github/workflows/ci.yml` (`CI`) runs on:

- pushes to `main`;
- pull requests targeting `main`;
- manual `workflow_dispatch`.

Runs share one concurrency group per pull request or ref. A newer push cancels an
in-progress pull request run; `main` and manual runs are never cancelled.

The workflow has `contents: read` permission, uses no secrets, and pins every action to a
full commit SHA.

| Job (check context) | Runner | Steps |
| --- | --- | --- |
| `frontend` | `ubuntu-latest`, Node.js 24 | `npm ci`, `npm test`, `npm run typecheck`, `npm run build` in `frontend/` |
| `rust` | `ubuntu-latest`, stable Rust | `cargo test --workspace --locked` |

Job ids and names are identical so the required-check contexts are exactly `frontend`
and `rust`. Renaming either job breaks branch protection that requires it.

- Node.js 24 matches `release.yml`; `frontend/package.json` requires `>=22.13.0`.
- Stable Rust matches `release.yml`; the workspace `rust-version = "1.88"` is the MSRV.
- No system packages are installed. `rusqlite` uses the `bundled` SQLite feature and
  `reqwest` uses `rustls-tls` without default features, so no system SQLite or OpenSSL
  is linked.
- The Linux runner uses UTC. Use `TZ=UTC` locally to match it (see
  [Verification and smoke](verification-and-smoke.md)).

## Local reproduction

```bash
npm --prefix frontend ci
npm --prefix frontend test
npm --prefix frontend run typecheck
npm --prefix frontend run build
cargo test --workspace --locked
```

Match the runner timezone with `TZ=UTC npm --prefix frontend test`. The full local gate,
including `cargo fmt --check` and `cargo clippy`, is in
[Verification and smoke](verification-and-smoke.md).

## Scope

CI does not run `cargo fmt --check`, `cargo clippy`, `npm --prefix npm/raven test`, or a
release build. These are candidates for additional jobs. The frontend has no lint
script or ESLint config, so there is no lint step.

## Recommended `main` protection

Not applied. The repository owner applies one of the options below manually.

Release commits (`[RELEASE] ...`) are pushed directly to `main` and then tagged; see
`.codex/skills/release-oracle-todo/SKILL.md`. Admins must therefore keep direct-push
access: `enforce_admins: false` with classic protection, or an admin bypass with rulesets.

Apply protection only after `CI` has run at least once on GitHub, so the `frontend` and
`rust` check contexts exist.

Tag pushes that trigger `release.yml` and `npm-publish.yml` are not affected by `main`
branch protection.

Use either classic protection or a ruleset, not both. `15368` is the app id of the
GitHub Actions app (`gh api /apps/github-actions`).

### Option A: classic branch protection

```bash
gh api -X PUT repos/shingyusik/oracle-todo/branches/main/protection \
  -H "Accept: application/vnd.github+json" --input - <<'JSON'
{
  "required_status_checks": {
    "strict": false,
    "checks": [
      { "context": "frontend", "app_id": 15368 },
      { "context": "rust", "app_id": 15368 }
    ]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": false,
    "require_code_owner_reviews": false,
    "required_approving_review_count": 0
  },
  "restrictions": null,
  "required_linear_history": false,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_conversation_resolution": false
}
JSON
```

- `required_approving_review_count: 0` requires a pull request but no approval. A solo
  maintainer cannot approve their own pull request.
- `checks` replaces the deprecated `contexts` field. If the API rejects the body without
  `contexts`, replace the `checks` array with `"contexts": ["frontend", "rust"]`.
- To require branches to be up to date with `main` before merging, set
  `"strict": true`.
- `enforce_admins: false` exempts admins from the pull request and status-check
  requirements, so release commits can still be pushed directly to `main`.
- `allow_force_pushes: false` and `allow_deletions: false` apply to everyone, including
  admins, regardless of `enforce_admins`.

Verify and roll back:

```bash
gh api repos/shingyusik/oracle-todo/branches/main/protection
gh api -X DELETE repos/shingyusik/oracle-todo/branches/main/protection
```

### Option B: repository ruleset

```bash
gh api -X POST repos/shingyusik/oracle-todo/rulesets \
  -H "Accept: application/vnd.github+json" --input - <<'JSON'
{
  "name": "main-protection",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "bypass_actors": [
    { "actor_id": 5, "actor_type": "RepositoryRole", "bypass_mode": "always" }
  ],
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": false,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false,
        "allowed_merge_methods": ["merge", "squash", "rebase"]
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": false,
        "do_not_enforce_on_create": false,
        "required_status_checks": [
          { "context": "frontend", "integration_id": 15368 },
          { "context": "rust", "integration_id": 15368 }
        ]
      }
    }
  ]
}
JSON
```

- `actor_id: 5` is the repository Admin role. `bypass_mode: "always"` lets admins push
  release commits directly to `main`.
- The bypass covers every rule in the ruleset, so admins can also force-push to and
  delete `main`.

To block force pushes and deletion for everyone, split the rules into two rulesets. The
first keeps the admin bypass for pull request and status-check rules; the second has no
bypass actors. Fast-forward release pushes remain allowed.

```bash
gh api -X POST repos/shingyusik/oracle-todo/rulesets \
  -H "Accept: application/vnd.github+json" --input - <<'JSON'
{
  "name": "main-merge-gate",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "bypass_actors": [
    { "actor_id": 5, "actor_type": "RepositoryRole", "bypass_mode": "always" }
  ],
  "rules": [
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": false,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false,
        "allowed_merge_methods": ["merge", "squash", "rebase"]
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": false,
        "do_not_enforce_on_create": false,
        "required_status_checks": [
          { "context": "frontend", "integration_id": 15368 },
          { "context": "rust", "integration_id": 15368 }
        ]
      }
    }
  ]
}
JSON

gh api -X POST repos/shingyusik/oracle-todo/rulesets \
  -H "Accept: application/vnd.github+json" --input - <<'JSON'
{
  "name": "main-history",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "bypass_actors": [],
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" }
  ]
}
JSON
```

List and roll back:

```bash
gh api repos/shingyusik/oracle-todo/rulesets
gh api -X DELETE repos/shingyusik/oracle-todo/rulesets/<id>
```
