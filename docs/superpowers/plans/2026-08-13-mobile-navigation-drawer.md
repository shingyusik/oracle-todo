# Mobile Navigation Drawer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the mobile navigation Close button fully visible without changing existing navigation behavior.

**Architecture:** Preserve the current React drawer and modify only its mobile CSS. Lock the intended width and Close-button flex behavior with the existing CSS architecture test, then reuse the current interaction tests for behavioral regression coverage.

**Tech Stack:** CSS, React 18, Vitest

---

## File Structure

- Modify `frontend/tests/architecture/design-boundaries.spec.ts`: assert the mobile-only drawer width and non-shrinking Close button contract.
- Modify `frontend/src/styles/globals.css`: widen the mobile drawer and keep the Close button at its intrinsic width.

### Task 1: Prevent Mobile Drawer Header Clipping

**Files:**
- Modify: `frontend/tests/architecture/design-boundaries.spec.ts:56-77`
- Modify: `frontend/src/styles/globals.css:2580-2625`

- [ ] **Step 1: Write the failing CSS boundary test**

Add this test after `keeps the one-column tree sidebar at the typed total width`:

```ts
it("keeps the mobile navigation header inside the drawer", async () => {
  const source = await readSource("src/styles/globals.css");

  expect(source).toMatch(
    /@media \(max-width: 760px\)[\s\S]*?\.workbench-nav\s*\{[^}]*width:\s*min\(320px, calc\(100vw - 24px\)\);/,
  );
  expect(source).toMatch(
    /@media \(max-width: 760px\)[\s\S]*?\.workbench-nav-close\s*\{[^}]*flex:\s*0 0 auto;/,
  );
});
```

- [ ] **Step 2: Run the new test and verify it fails**

Run:

```powershell
npm --prefix frontend test -- tests/architecture/design-boundaries.spec.ts -t "keeps the mobile navigation header inside the drawer" --reporter=dot
```

Expected: FAIL because the drawer still uses `var(--workbench-total-sidebar-width)` and `.workbench-nav-close` has no non-shrinking flex rule.

- [ ] **Step 3: Apply the minimal CSS fix**

In the existing `@media (max-width: 760px)` block, change the drawer width and add one declaration to the Close button:

```css
.workbench-nav {
  width: min(320px, calc(100vw - 24px));
}

.workbench-nav-close {
  flex: 0 0 auto;
  margin-left: auto;
  padding: 0 8px;
}
```

Keep every other drawer rule unchanged.

- [ ] **Step 4: Run focused regression tests**

Run:

```powershell
npm --prefix frontend test -- tests/architecture/design-boundaries.spec.ts tests/presentation/workbench-wireframe.spec.tsx -t "mobile navigation header|mobile navigation as a modal drawer|body scroll locked" --reporter=dot
```

Expected: 3 tests pass with no failures.

- [ ] **Step 5: Run frontend verification**

Run:

```powershell
npm --prefix frontend test
npm --prefix frontend run typecheck
```

Expected: all frontend tests pass and TypeScript exits with code 0.

- [ ] **Step 6: Perform mobile UAT**

At 360px and 320px viewport widths:

1. Open the navigation with Menu.
2. Confirm the full logo, wordmark, tagline, and Close button are visible.
3. Close with Close, outside tap, and Escape.
4. Confirm focus returns to Menu and the page scroll lock is released.

Expected: the header does not clip and all existing dismissal paths behave unchanged.

- [ ] **Step 7: Commit the implementation**

Stage only the CSS and architecture test, inspect the staged diff, then commit using the project format:

```powershell
git add -- frontend/src/styles/globals.css frontend/tests/architecture/design-boundaries.spec.ts
git diff --cached
git commit -m @'
[FIX] Keep mobile navigation header visible

- 모바일 drawer 폭을 화면에 맞춰 최대 320px까지 확장
- Close 버튼 수축을 막아 drawer 밖으로 밀리는 현상 방지
- 기존 navigation 상호작용을 유지하는 회귀 테스트 추가
'@
```
