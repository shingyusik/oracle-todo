---
name: structured-commit
description: Enforce a disciplined Git commit workflow with mandatory change inspection, fine-grained logical commit splitting, and English commit messages prefixed with [type]. Use when Codex is asked to commit changes, prepare commits, or generate commit messages.
---

# Structured Commit

## Overview

Apply a strict commit workflow: inspect all changes, split them into the smallest meaningful logical units, and create English commit messages that always start with `[type]`.

## Commit Workflow

1. Inspect repository state before staging anything.
2. Review all unstaged and staged diffs in detail.
3. Group edits by behavior change or purpose.
4. Stage one logical unit at a time.
5. Re-check staged diff before each commit.
6. Commit with an English message in `[type] summary` format.
7. Repeat until no intended changes remain.

Run this baseline sequence:

```bash
git status --short
git diff --stat
git diff
git diff --cached
```

Use `git add -p` when a file contains multiple logical changes.

## Granularity Rules

- Keep one commit for one intent.
- Separate refactors from functional changes.
- Separate formatting-only edits from behavior edits.
- Avoid bundling unrelated files in the same commit.
- Prefer multiple small commits over one broad commit.

If a change cannot be split safely, explain why in the final summary.

## Commit Message Rules

Use English only.

Use this exact structure:

```text
[type] imperative summary
```

Valid types:

- `[feat]` new functionality
- `[fix]` bug fix
- `[refactor]` internal restructuring without behavior change
- `[docs]` documentation-only changes
- `[test]` test additions or updates
- `[chore]` maintenance tasks
- `[perf]` performance improvements
- `[build]` build or dependency system changes
- `[ci]` CI/CD pipeline changes
- `[revert]` reverting a previous commit

Examples:

- `[feat] add cohort filter to strategy dashboard`
- `[fix] handle null industry values in market summary`
- `[refactor] split opportunity scoring into dedicated module`

## Pre-Commit Quality Gate

Before each commit, verify all conditions:

- Staged diff contains only one logical unit.
- Commit message follows `[type] ...` format.
- Message is in English and concise.
- No accidental debug code, logs, or secrets are included.

## Final Verification

After finishing all commits, run:

```bash
git status
git log --oneline -n 10
```

Confirm worktree cleanliness (or expected remaining files) and commit history clarity.
