# PR Automation Guide

Step-by-step instructions for a Codex agent to create a pull request
by inspecting the current branch, reading the template system, and
calling `gh pr create`.

---

## Prerequisites

- `gh` CLI is authenticated (`gh auth status`).
- Current branch has been pushed to `origin`.
- All commits are finalized (no uncommitted changes).

---
## Step 0 - Confirmation

Print below befre proceeding.

Prompt:
"[PR] <current-branch> → develop"

## Step 1 — Identify the base branch and diff

```bash
CURRENT=$(git branch --show-current)
BASE="origin/develop"

# Fetch the remote tip so the merge-base matches what GitHub sees.
git fetch origin develop
MERGE_BASE=$(git merge-base "$BASE" HEAD)

git log --oneline ${MERGE_BASE}..HEAD
git diff --stat ${MERGE_BASE}..HEAD
git diff ${MERGE_BASE}..HEAD
```

Record:
- Total commits and their messages.
- Which top-level directories were touched (`backend/`, `frontend/`, `supabase/`, or other).
- File-level summary of additions, modifications, and deletions.

---

## Step 2 — Detect touched areas

Classify every changed file into an area:

| Path prefix   | Area       |
|---------------|------------|
| `backend/`    | Backend    |
| `frontend/`   | Frontend   |
| `supabase/`   | Supabase   |
| anything else | (no area)  |

This determines which `### sub-sections` to keep and which to delete.

---

## Step 3 — Read the template system

Read these files to understand the structure and available quality gates:

```
.github/pull_request_template.md              ← main skeleton
.github/PULL_REQUEST_TEMPLATE/backend.md      ← if Backend touched
.github/PULL_REQUEST_TEMPLATE/frontend.md     ← if Frontend touched
.github/PULL_REQUEST_TEMPLATE/supabase.md     ← if Supabase touched
```

The main template contains an HTML-comment guide at the top that
explains the filling rules. Follow them exactly.

---

## Step 4 — Build the PR body

Assemble the body by filling the main template skeleton:

### Summary

Write one or two sentences covering what changed and why.
Derive this from the commit messages and the diff.

### Type

Pick exactly one: `Feature`, `Bug fix`, `Refactor`, or `Chore`.
Infer from the commit type prefixes (`[feat]`, `[fix]`, `[refactor]`, `[chore]`, etc.).

### What Changed

For each touched area, write a bullet list under its `### sub-section`.
Delete sub-sections for areas that were not touched.

Rules:
- Summarize by behavior change, not by file.
- Group related changes into a single bullet.
- Be concise but specific.

If no area was touched (e.g. CI-only change), remove all sub-sections
and write the changes directly under `## What Changed`.

### Quality Gates

For each touched area, copy the checkbox list from the matching
area file (`.github/PULL_REQUEST_TEMPLATE/<area>.md#Quality Gates`).
Delete sub-sections for untouched areas.

If no area was touched, remove all sub-sections.

Do NOT check the boxes — the PR author or CI will do that.

### Review Checklist

Keep as-is. Do not check the boxes.

### Notes

Add any relevant context: risks, migration steps, breaking changes,
or open questions. Leave the section empty if there is nothing to note.

---

## Step 5 — Derive the PR title

Format: `[type] imperative summary`

Use the same `[type]` as the commit messages. If the branch has
multiple types, pick the dominant one or use `[feat]` for mixed.

Examples:
- `[feat] add cohort filter to strategy dashboard`
- `[fix] handle null industry values in market summary`
- `[chore] restructure PR template into composable area-based blocks`

---

## Step 6 — Determine reviewer, labels, and assignee

### 6-1. Reviewer

The team has two members. Assign the *other* person as reviewer:

| `git config user.name` (or GitHub login) | `--reviewer` value |
|------------------------------------------|--------------------|
| `wonjunchoii`                            | `shingyusik`       |
| `shingyusik`                             | `wonjunchoii`      |

```bash
ME="$(gh api user --jq '.login')"
if [ "$ME" = "wonjunchoii" ]; then
  REVIEWER="shingyusik"
else
  REVIEWER="wonjunchoii"
fi
```

### 6-2. Labels

Pick from the allowed set based on touched areas and commit type.
Allowed labels: `backend`, `frontend`, `marketing`, `bug`, `documentation`, `database`.

| Condition | Label(s) |
|-----------|----------|
| `backend/` touched | `backend` |
| `frontend/` touched | `frontend` |
| `supabase/` touched | `database` |
| Commit type is `[fix]` | `bug` |
| Only `*.md` or `docs/` files changed | `documentation` |
| `frontend/src/components/landing/` or marketing-related pages touched | `marketing` |

Build a comma-separated string (no spaces):

```bash
LABELS=""
add_label() { LABELS="${LABELS:+${LABELS},}$1"; }

# area-based
echo "$CHANGED_FILES" | grep -q '^backend/'    && add_label "backend"
echo "$CHANGED_FILES" | grep -q '^frontend/'   && add_label "frontend"
echo "$CHANGED_FILES" | grep -q '^supabase/'   && add_label "database"

# type-based
[ "$TYPE" = "fix" ]                             && add_label "bug"

# content-based (apply only when ALL files match the pattern)
if echo "$CHANGED_FILES" | grep -qvE '\.(md|mdx)$|^docs/'; then
  :  # non-doc files exist, skip
else
  add_label "documentation"
fi

echo "$CHANGED_FILES" | grep -q 'landing\|marketing' && add_label "marketing"
```

`CHANGED_FILES` is the output of `git diff --name-only ${MERGE_BASE}..HEAD`.
`TYPE` is the commit type determined in Step 5.

### 6-3. Assignee

Always assign the PR to the current user:

```bash
ASSIGNEE="@me"
```

---

## Step 7 — Push and create (or update) the PR

```bash
git push -u origin HEAD

PR_NUMBER="$(gh pr list --base develop --head "$CURRENT" --state open \
              --json number --jq '.[0].number')"

BODY_FILE="$(mktemp)"
trap 'rm -f "$BODY_FILE"' EXIT

cat > "$BODY_FILE" <<'EOF'
<assembled PR body here>
EOF

if [ -n "$PR_NUMBER" ]; then
  gh pr edit "$PR_NUMBER" \
    --title "[type] imperative summary" \
    --body-file "$BODY_FILE" \
    --add-label "$LABELS" \
    --add-reviewer "$REVIEWER" \
    --add-assignee "$ASSIGNEE"
else
  gh pr create \
    --base develop \
    --head "$CURRENT" \
    --title "[type] imperative summary" \
    --body-file "$BODY_FILE" \
    --label "$LABELS" \
    --reviewer "$REVIEWER" \
    --assignee "$ASSIGNEE"
fi
```

---

## Step 8 — Verify

```bash
gh pr view --web
```

Confirm the PR renders correctly on GitHub.

---

## Full example output

```markdown
## Summary

Restructure the PR template into a composable, area-based block system
with dedicated sub-templates for backend, frontend, and supabase.

## Type

- [x] Chore (CI / docs / config)

## What Changed

### Backend
- Add area-specific PR sub-template with quality gate commands from backend-ci.yml

### Frontend
- Add area-specific PR sub-template with local quality gate commands from package.json

### Supabase
- Add area-specific PR sub-template with local migration verification commands

## Quality Gates

### Backend
- [ ] Ruff · `cd backend && uv run ruff check app/agents app/application app/infrastructure app/dependencies.py app/main.py app/state.py app/api/v1 tests`
- [ ] Architecture guard · `cd backend && uv run pytest tests/test_architecture_import_rules.py tests/test_router_dependency_rules.py tests/test_orchestrator_split_rules.py -q`
- [ ] LangGraph preflight · `cd backend && uv run pytest tests/infrastructure/test_langgraph_dependency_preflight.py -q`
- [ ] Pytest · `cd backend && uv run pytest -q`

### Frontend
- [ ] Build · `cd frontend && npm run build`
- [ ] Lint · `cd frontend && npm run lint`
- [ ] Type check · `cd frontend && npx tsc --noEmit`
- [ ] Tests · `cd frontend && npm run test`
- [ ] Architecture guard · `cd frontend && npm run test:arch`

### Supabase
- [ ] Migration applies cleanly · `supabase db reset`
- [ ] No residual diff · `supabase db diff`
- [ ] Backend tests still pass · `cd backend && uv run pytest -q`

## Review Checklist

- [ ] Self-reviewed the diff
- [ ] Tested changed user flows manually
- [ ] Rollback strategy considered

## Notes

<!-- Risks, open questions, anything reviewers should focus on. -->
```
