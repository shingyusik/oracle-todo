# Health Bowel Checkbox Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the Add Bowel `Blood Visible` checkbox as a compact, left-aligned 16×16 control with its label on the same line.

**Architecture:** Reuse the existing Ledger checkbox layout declarations through a neutral `.field-checkbox` selector, then apply that class only to the Bowel creation form label. Keep state, submission, pending, and recovery behavior unchanged.

**Tech Stack:** React, TypeScript, CSS, Vitest, Testing Library

---

### Task 1: Align the Bowel checkbox with Ledger

**Files:**
- Modify: `frontend/src/features/health/ui/HealthForms.tsx:283-290`
- Modify: `frontend/src/styles/globals.css:2275-2290`
- Test: `frontend/tests/presentation/health-forms.spec.tsx`
- Test: `frontend/tests/architecture/design-boundaries.spec.ts`

- [ ] **Step 1: Write the failing presentation test**

Extend the Bowel dialog assertion in `health-forms.spec.tsx`:

```tsx
const bloodVisible = within(dialog).getByLabelText("Blood Visible");
expect(bloodVisible).toHaveAttribute("type", "checkbox");
expect(bloodVisible.closest("label")).toHaveClass("field-checkbox");
```

- [ ] **Step 2: Write the failing CSS boundary test**

Add this assertion to `design-boundaries.spec.ts`:

```ts
expect(css).toContain(
  ".ledger-account-settings-checkbox,\n.field-checkbox {\n  display: inline-flex;",
);
expect(css).toContain(
  ".ledger-account-settings-checkbox input,\n.field-checkbox input {\n  width: 16px;\n  height: 16px;\n  margin: 0;\n}",
);
```

- [ ] **Step 3: Run the focused tests to verify RED**

Run:

```powershell
npm --prefix frontend test -- health-forms.spec.tsx design-boundaries.spec.ts
```

Expected: both new assertions fail because `.field-checkbox` is absent.

- [ ] **Step 4: Apply the neutral checkbox class**

Change the Bowel form markup in `HealthForms.tsx`:

```tsx
<label className="field-checkbox">
  <input
    type="checkbox"
    checked={bloodVisible}
    onChange={(event) => setBloodVisible(event.target.checked)}
  />
  Blood Visible
</label>
```

Share the current Ledger declarations in `globals.css` without changing their values:

```css
.ledger-account-settings-checkbox,
.field-checkbox {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  font-size: 14px;
  color: var(--color-shade-70);
  cursor: pointer;
}

.ledger-account-settings-checkbox input,
.field-checkbox input {
  width: 16px;
  height: 16px;
  margin: 0;
}
```

- [ ] **Step 5: Run focused and adjacent verification**

Run:

```powershell
npm --prefix frontend test -- health-forms.spec.tsx bowel-panel.spec.tsx design-boundaries.spec.ts
npm --prefix frontend run typecheck
npm --prefix frontend run build
git diff --check
```

Expected: all tests pass, type checking and build exit 0, and diff check emits no errors.

- [ ] **Step 6: Inspect and commit the single logical change**

Stage only the four implementation/test files; do not stage the existing `frontend/package-lock.json` change.

```powershell
git add -- frontend/src/features/health/ui/HealthForms.tsx frontend/src/styles/globals.css frontend/tests/presentation/health-forms.spec.tsx frontend/tests/architecture/design-boundaries.spec.ts
git diff --cached --check
git commit -m @'
[FIX] Align Health Bowel checkbox

- Blood Visible 체크박스를 Ledger와 같은 크기와 한 줄 배치로 정렬
- 체크박스 접근성 이름과 기존 저장 동작을 회귀 검증
'@
```
