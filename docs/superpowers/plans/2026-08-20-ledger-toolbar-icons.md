# Ledger Toolbar Icons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Ledger table-header action text with accessible Lucide icons for transactions, accounts, and categories.

**Architecture:** Keep the change in the existing shared `LedgerTableViewHeader`; callers continue supplying action labels and callbacks unchanged. Add one presentation test that renders each Ledger leaf through `LedgerPanel` and verifies icon content, accessible names, and native tooltips.

**Tech Stack:** React 18, TypeScript, `lucide-react`, Vitest, Testing Library

---

### Task 1: Render Ledger header actions as icons

**Files:**
- Modify: `frontend/tests/presentation/ledger-panel.spec.tsx`
- Modify: `frontend/src/features/ledger/ui/LedgerTableViewHeader.tsx`

- [ ] **Step 1: Write the failing presentation test**

Add this test near the existing Ledger header-layout test in
`frontend/tests/presentation/ledger-panel.spec.tsx`:

```tsx
it("renders icon-only actions with accessible names and tooltips", () => {
  function expectIconButton(name: string, iconClass: string) {
    const button = screen.getByRole("button", { name });
    expect(button).toHaveAttribute("title", name);
    expect(button).toContainElement(button.querySelector(`.${iconClass}`));
    expect(button).not.toHaveTextContent(name);
  }

  const ledger = controller();
  const view = render(<LedgerPanel controller={ledger} />);
  expectIconButton("Add transaction", "lucide-plus");
  expectIconButton("Archive selected transactions", "lucide-trash-2");

  view.rerender(<LedgerPanel controller={ledger} leafTabId="accounts" />);
  expectIconButton("Account settings", "lucide-settings");
  expectIconButton("Add account", "lucide-plus");
  expectIconButton("Delete selected", "lucide-trash-2");

  view.rerender(<LedgerPanel controller={ledger} leafTabId="categories" />);
  expectIconButton("Add category", "lucide-plus");
  expectIconButton("Delete selected", "lucide-trash-2");
});
```

- [ ] **Step 2: Run the test and verify the missing icons fail**

Run:

```powershell
npm --prefix frontend test -- ledger-panel.spec.tsx -t "renders icon-only actions"
```

Expected: FAIL because the add and settings buttons still contain visible text and do not
render the requested Lucide icons or `title` attributes.

- [ ] **Step 3: Replace header action text with icons**

In `frontend/src/features/ledger/ui/LedgerTableViewHeader.tsx`, extend the existing Lucide
import and resolve the three labels once:

```tsx
import { Plus, Settings, Trash2 } from "lucide-react";

// Inside LedgerTableViewHeader, before the return statement:
const resolvedSettingsLabel = settingsLabel ?? "Account settings";
const resolvedAddLabel = addLabel ?? "Add transaction";
const resolvedArchiveLabel = archiveSelectedLabel ?? "Archive selected transactions";
```

Render the three action buttons with their resolved labels and decorative icons:

```tsx
{isAccounts && onSettings ? (
  <button
    ref={settingsButtonRef as React.RefObject<HTMLButtonElement> | undefined}
    className="items-toolbar-button"
    type="button"
    aria-label={resolvedSettingsLabel}
    title={resolvedSettingsLabel}
    aria-haspopup="dialog"
    onClick={onSettings}
  >
    <Settings size={16} aria-hidden="true" />
  </button>
) : null}
{onAdd ? (
  <button
    ref={addButtonRef}
    className="items-toolbar-button"
    type="button"
    aria-label={resolvedAddLabel}
    title={resolvedAddLabel}
    aria-haspopup="dialog"
    onClick={onAdd}
  >
    <Plus size={16} aria-hidden="true" />
  </button>
) : null}
{onArchiveSelected ? (
  <button
    className="items-toolbar-button"
    type="button"
    aria-label={resolvedArchiveLabel}
    title={resolvedArchiveLabel}
    disabled={archiveDisabled}
    onClick={onArchiveSelected}
  >
    <Trash2 size={16} aria-hidden="true" />
  </button>
) : null}
```

Do not add a new component or CSS rule; `items-toolbar-button` already provides the required
36px icon-button layout.

- [ ] **Step 4: Run the focused presentation test**

Run:

```powershell
npm --prefix frontend test -- ledger-panel.spec.tsx -t "renders icon-only actions"
```

Expected: PASS.

- [ ] **Step 5: Run Ledger presentation coverage and type checking**

Run:

```powershell
npm --prefix frontend test -- ledger-panel.spec.tsx accounts-panel.spec.tsx categories-panel.spec.tsx
npm --prefix frontend run typecheck
```

Expected: all selected tests pass and TypeScript reports no errors.

- [ ] **Step 6: Commit the implementation**

Stage only the implementation and test files; leave the pre-existing
`frontend/package-lock.json` change untouched.

```powershell
git add -- frontend/src/features/ledger/ui/LedgerTableViewHeader.tsx frontend/tests/presentation/ledger-panel.spec.tsx
git commit -m @'
[UPDATE] Render Ledger toolbar actions as icons

- 거래, 계정, 카테고리 상단 동작을 일관된 Lucide 아이콘으로 표시
- 접근성 이름과 툴팁을 유지하고 공통 헤더 표현을 검증
'@
```
