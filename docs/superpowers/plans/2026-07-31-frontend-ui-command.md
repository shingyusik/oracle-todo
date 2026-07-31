# Frontend UI Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `npm run ui` as the single authenticated local UI command from `frontend/`.

**Architecture:** An npm script composes the existing static frontend build with
the existing `raven-cli ui` command. The script uses the workspace manifest one
directory above and serves the generated `out/` directory.

**Tech Stack:** npm scripts, Next.js, Cargo, Vitest

---

### Task 1: Add the authenticated UI command

**Files:**
- Modify: `frontend/tests/architecture/package-scripts.spec.ts`
- Modify: `frontend/package.json`
- Modify: `frontend/README.md`

- [ ] **Step 1: Write the failing package-script assertion**

Add this property to the existing `toMatchObject` assertion:

```typescript
ui: "npm run build && cargo run --manifest-path ../Cargo.toml -p raven-cli -- ui --ui-path out",
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```powershell
npm --prefix frontend run test -- tests/architecture/package-scripts.spec.ts
```

Expected: FAIL because `packageJson.scripts.ui` is missing.

- [ ] **Step 3: Add the minimal npm script**

Add this property to `frontend/package.json`:

```json
"ui": "npm run build && cargo run --manifest-path ../Cargo.toml -p raven-cli -- ui --ui-path out",
```

- [ ] **Step 4: Run the focused test to verify it passes**

Run:

```powershell
npm --prefix frontend run test -- tests/architecture/package-scripts.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Document the short command**

Add the authenticated local command to `frontend/README.md`:

````markdown
Run the built frontend with browser session authentication:

```bash
npm run ui
```
````

State that the command builds the static frontend before Raven starts.

- [ ] **Step 6: Run verification**

Run:

```powershell
npm --prefix frontend run test -- tests/architecture/package-scripts.spec.ts
npm --prefix frontend run typecheck
npm --prefix frontend run build
```

Expected: all commands exit successfully.

- [ ] **Step 7: Commit**

```powershell
git add frontend/package.json frontend/tests/architecture/package-scripts.spec.ts frontend/README.md docs/superpowers/plans/2026-07-31-frontend-ui-command.md
git commit -m "[ADD] Add frontend UI command"
```
