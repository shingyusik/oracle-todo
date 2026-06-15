---
name: pr-to-develop
description: Create or update pull requests from the current branch to develop using this repository's template system and area-based quality gates. Use when asked to open, refresh, or automate a PR to develop, including generating title/body from git diff, selecting touched areas (backend/frontend/supabase), and running gh pr create or gh pr edit.
---

# PR To Develop

## Objective

Create a complete PR to `develop` that follows repository template rules and reflects the actual diff.

## Source of Truth

Read `references/pr-automation-guide.md` first and follow it exactly.

Then read these repository files referenced by the guide:

- `.github/pull_request_template.md`
- `.github/PULL_REQUEST_TEMPLATE/backend.md`
- `.github/PULL_REQUEST_TEMPLATE/frontend.md`
- `.github/PULL_REQUEST_TEMPLATE/supabase.md`

## Execution Rules

- Keep untouched area subsections out of `What Changed` and `Quality Gates`.
- Never pre-check checkboxes in `Quality Gates` or `Review Checklist`.
- Use title format `[type] imperative summary`.
- Create PR with `gh pr create` or update existing PR with `gh pr edit`.

## Output Contract

Return:

- Final PR title
- Final PR body markdown
- Whether PR was created or updated
- PR URL
