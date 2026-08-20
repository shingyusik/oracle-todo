# Health Journal Action Styles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Health rows the detail target, render Add/Delete as Ledger-style icons, and align all Health creation-dialog controls with Ledger.

**Architecture:** Reuse Ledger's row activation pattern, installed Lucide icons, shared `items-toolbar-button`, shared `.field-label` controls, and existing creation-dialog footer classes. Keep Health forms usable outside their dedicated dialogs by enabling the footer only when a dialog-close callback is supplied; do not add CSS or a shared action component.

**Tech Stack:** React 18, TypeScript, Lucide React, Vitest, Testing Library, existing global CSS

---

### Task 1: Move Health detail activation to the table row

**Files:**
- Modify: `frontend/tests/presentation/diet-panel.spec.tsx`
- Modify: `frontend/tests/presentation/bowel-panel.spec.tsx`
- Modify: `frontend/tests/presentation/medication-panel.spec.tsx`
- Modify: `frontend/tests/presentation/health-metrics-panel.spec.tsx`
- Modify: `frontend/src/features/health/ui/DietTable.tsx`
- Modify: `frontend/src/features/health/ui/BowelTable.tsx`
- Modify: `frontend/src/features/health/ui/MedicationTable.tsx`
- Modify: `frontend/src/features/health/ui/HealthMetricsTable.tsx`

- [ ] **Step 1: Change the direct table contracts to require row activation**

For each real table, assert the existing accessible detail target is the native table row and
contains no nested detail button:

```tsx
const row = screen.getByRole("button", { name: /Open details for/ });
expect(row.tagName).toBe("TR");
expect(within(row).queryByRole("button")).toBeNull();
expect(row).toHaveAttribute("tabindex", "0");
```

Exercise pointer click, Enter, and Space on rows, and assert clicking/keyboard-activating the
selection checkbox does not open detail. Keep the existing exact occurrence and focus restoration
assertions, which should continue to query the same accessible button role.

- [ ] **Step 2: Run the four focused row tests and verify RED**

Run:

```powershell
npm --prefix frontend test -- diet-panel.spec.tsx bowel-panel.spec.tsx medication-panel.spec.tsx health-metrics-panel.spec.tsx -t "native|row pointer|keyboard"
```

Expected: FAIL because the detail role currently belongs to a nested `BUTTON` cell control.

- [ ] **Step 3: Apply the existing Ledger row pattern**

Move each accessible label and `data-*-occurrence`/row identity attribute to the `<tr>`, render the
cell value as text, and use the established interaction shape:

```tsx
<tr
  role="button"
  tabIndex={0}
  aria-label={`Open details for ${context}`}
  data-medication-row-id={row.id}
  data-medication-occurrence={occurrence}
  onClick={() => onOpen(row, occurrence)}
  onKeyDown={(event) => {
    if (event.key === "Enter" || event.key === " " || event.key === "Space") {
      event.preventDefault();
      onOpen(row, occurrence);
    }
  }}
>
```

Stop checkbox click and keydown propagation exactly as Ledger does. Apply the equivalent identity
attributes for Diet, Bowel, and Health Metrics. Do not add a CSS class: the existing
`.items-table tbody tr[role="button"]` focus rule already covers keyboard focus.

- [ ] **Step 4: Run the four complete panel suites and verify GREEN**

Run:

```powershell
npm --prefix frontend test -- diet-panel.spec.tsx bowel-panel.spec.tsx medication-panel.spec.tsx health-metrics-panel.spec.tsx
```

Expected: all tests PASS; exact occurrence and row-ID focus restoration remain intact.

- [ ] **Step 5: Commit the row activation unit**

```text
[UPDATE] Open Health details from table rows

- 상세 열기용 셀 버튼을 제거하고 행 전체 클릭 및 키보드 조작으로 통일
- 선택 체크박스와 occurrence 기반 포커스 복원을 유지
```

### Task 2: Iconize Health table actions

**Files:**
- Modify: `frontend/tests/presentation/health-metrics-panel.spec.tsx`
- Modify: `frontend/src/features/health/ui/HealthTableViewHeader.tsx`

- [ ] **Step 1: Write the failing icon contract test**

Extend the existing Health Metrics header test with the same behavior-level helper used by Ledger:

```tsx
const expectIconButton = (name: string, iconClass: string) => {
  const button = screen.getByRole("button", { name });
  expect(button).toHaveAttribute("title", name);
  expect(button).toContainElement(button.querySelector(`.${iconClass}`));
  expect(button).not.toHaveTextContent(name);
};

expectIconButton("Add health metrics entry", "lucide-plus");
expectIconButton("Archive selected health metrics entries", "lucide-trash-2");
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npm --prefix frontend test -- health-metrics-panel.spec.tsx -t "scopes saved views"
```

Expected: FAIL because the Health buttons have no `title`, no Lucide icon, and visible Add/Delete text.

- [ ] **Step 3: Replace visible labels with installed icons**

In `HealthTableViewHeader.tsx`, import the existing package and retain the current accessible names:

```tsx
import { Plus, Trash2 } from "lucide-react";

const addLabel = `Add ${noun} entry`;
const archiveLabel = `Archive selected ${noun} entries`;

<button
  ref={addButtonRef}
  className="items-toolbar-button"
  type="button"
  aria-label={addLabel}
  title={addLabel}
  aria-haspopup="dialog"
  onClick={onAdd}
>
  <Plus size={16} aria-hidden="true" />
</button>
<button
  ref={archiveButtonRef}
  className="items-toolbar-button"
  type="button"
  aria-label={archiveLabel}
  title={archiveLabel}
  disabled={archiveDisabled}
  onClick={onArchiveSelected}
>
  <Trash2 size={16} aria-hidden="true" />
</button>
```

- [ ] **Step 4: Run the focused panel tests and verify GREEN**

Run:

```powershell
npm --prefix frontend test -- health-metrics-panel.spec.tsx health-panel.spec.tsx
```

Expected: all tests PASS; accessible names and button order remain unchanged.

- [ ] **Step 5: Commit the icon unit**

Stage only the two files, inspect the staged diff, and commit:

```text
[UPDATE] Iconize Health Journal table actions

- 목록 Add 및 Delete를 Ledger와 같은 Lucide 아이콘으로 표시
- 기존 접근성 이름과 툴팁 및 포커스 동작을 유지
```

### Task 3: Align Health creation-dialog actions with Ledger

**Files:**
- Modify: `frontend/tests/presentation/health-forms.spec.tsx`
- Modify: `frontend/src/features/health/ui/HealthForms.tsx`
- Modify: `frontend/src/features/health/ui/DietCreateDialog.tsx`
- Modify: `frontend/src/features/health/ui/BowelCreateDialog.tsx`
- Modify: `frontend/src/features/health/ui/MedicationCreateDialog.tsx`
- Modify: `frontend/src/features/health/ui/HealthMetricsCreateDialog.tsx`

- [ ] **Step 1: Write failing shared presentation assertions**

Add one table-driven test that renders the four real dialog harnesses and, for each dialog, asserts:

```tsx
const header = within(dialog).getByRole("heading", { name: title }).closest("header")!;
expect(within(header).queryByRole("button")).toBeNull();

const form = within(dialog).getByRole("form");
const close = within(form).getByRole("button", { name: `Close ${title}` });
const save = within(form).getByRole("button", { name: "Save" });
expect(close.parentElement).toBe(save.parentElement);
expect(close.parentElement).toHaveClass("ledger-create-dialog-actions");
expect(close).toHaveClass("items-toolbar-button");
expect(save).toHaveClass("items-toolbar-button", "ledger-create-dialog-save");
```

Use the actual titles `Add diet entry`, `Add bowel entry`, `Add medication entry`, and `Add health metrics`. Also assert representative input/select/textarea controls remain inside `.field-label` containers.

- [ ] **Step 2: Run the focused dialog test and verify RED**

Run:

```powershell
npm --prefix frontend test -- health-forms.spec.tsx -t "uses Ledger creation dialog actions"
```

Expected: FAIL because Close is in the header and form submission uses Health-specific visible text without Ledger footer classes.

- [ ] **Step 3: Add the optional dialog action contract to Health forms**

Extend `HealthFormProps` without affecting Quick Add or standalone callers:

```tsx
type HealthFormProps = {
  controller: HealthController;
  onSaved?: () => void;
  onPendingChange?: (pending: boolean) => void;
  onRecoveryChange?: (recovering: boolean) => void;
  dialogActions?: {
    closeLabel: string;
    onClose(): void;
  };
};
```

Destructure `dialogActions` in `DietForm`, `BowelForm`, `MedicationForm`, and `MetricsForm`. At each existing submit-button location, preserve the original standalone button when the prop is absent and use the Ledger footer when present:

```tsx
{dialogActions ? (
  <div className="ledger-create-dialog-actions">
    <button
      type="button"
      className="items-toolbar-button"
      aria-label={dialogActions.closeLabel}
      disabled={action.pending || refreshRecovery}
      onClick={dialogActions.onClose}
    >
      Close
    </button>
    <button
      type="submit"
      className="items-toolbar-button ledger-create-dialog-save"
      disabled={action.pending || refreshRecovery}
    >
      {action.pending ? "Saving…" : "Save"}
    </button>
  </div>
) : (
  <button type="submit" disabled={action.pending}>Save diet entry</button>
)}
```

Use the existing standalone literals `Save bowel entry`, `Save medication`, and
`mode === "create" ? "Save daily metrics" : "Save health metrics"` in the other three forms.
For Metrics, include its existing `mode` and recovery rules in the disabled expression.

- [ ] **Step 4: Connect each dedicated dialog and remove its header Close button**

Keep each heading and pass the existing guarded close function through the form:

```tsx
<header className="dashboard-widget-header">
  <h2>Add diet entry</h2>
</header>
<DietForm
  controller={controller}
  onSaved={onClose}
  onPendingChange={setPending}
  tagOptions={tagOptions}
  dialogActions={{ closeLabel: "Close Add diet entry", onClose }}
/>
```

Apply the same shape to Bowel, Medication, and Health Metrics, using their current guarded `close` callback where present. Do not change portal ownership, modal isolation, focus trap, backdrop/Escape guards, retry recovery, or trigger focus restoration.

- [ ] **Step 5: Update existing dialog queries to the approved Save label**

Only dedicated-dialog assertions should query `Save`. Keep standalone and Quick Add tests on their existing form-specific labels so they prove the optional contract does not leak.

- [ ] **Step 6: Run focused Health form and panel tests and verify GREEN**

Run:

```powershell
npm --prefix frontend test -- health-forms.spec.tsx health-panel.spec.tsx health-metrics-panel.spec.tsx diet-panel.spec.tsx bowel-panel.spec.tsx medication-panel.spec.tsx quick-add.spec.tsx
```

Expected: all tests PASS, including pending dismissal guards, refresh-only retry, and focus restoration.

- [ ] **Step 7: Commit the dialog unit**

Stage only the six files, inspect the staged diff, and commit:

```text
[UPDATE] Align Health creation dialog actions

- 네 Health Add 팝업의 Close와 Save를 Ledger footer에 배치
- Quick Add와 독립 폼의 기존 표시 및 저장 동작을 유지
- pending 및 refresh recovery 동안 닫기와 중복 저장을 계속 차단
```

### Task 4: Verify the integrated frontend

**Files:**
- Verify only; no source changes expected

- [ ] **Step 1: Run the complete frontend test suite**

Run:

```powershell
npm --prefix frontend test
```

Expected: all presentation and domain tests PASS.

- [ ] **Step 2: Run type checking**

Run:

```powershell
npm --prefix frontend run typecheck
```

Expected: exit code 0.

- [ ] **Step 3: Run the production build**

Run:

```powershell
npm --prefix frontend run build
```

Expected: exit code 0 and all static pages generated.

- [ ] **Step 4: Inspect final scope**

Run:

```powershell
git diff --check
git status --short
git diff -- frontend/package-lock.json
```

Expected: diff check passes; no new lockfile change is introduced; the pre-existing user-owned `frontend/package-lock.json` modification remains unstaged and untouched.
