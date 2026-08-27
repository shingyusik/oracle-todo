# Root Category Parent Label Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Categories table accept the API's root-category shape and display `No parent`.

**Architecture:** Normalize the root-category label at the existing ledger wire boundary. Keep strict validation for categories that reference a parent, so malformed linked-parent responses still fail instead of being hidden.

**Tech Stack:** TypeScript, Vitest

---

### Task 1: Normalize root category parent labels

**Files:**
- Modify: `frontend/tests/domain/ledger-model.spec.ts`
- Modify: `frontend/src/features/ledger/model/ledger-model.ts:454-465`

- [ ] **Step 1: Write the failing regression test**

Add `mapLedgerTablePage` to the existing model imports and add this case inside `describe("Ledger wire boundary", ...)`:

```ts
it("maps a root category with no parent label", () => {
  const page = mapLedgerTablePage({
    items: [{
      key: "category-root",
      group_key: null,
      group_label: null,
      record: {
        id: "category-root",
        category: {
          id: "category-root",
          name: "Food",
          parent_id: null,
          kind: "expense",
          active: true,
        },
        name: "Food",
        kind: "expense",
        kind_label: "Expense",
        parent_id: null,
        parent_label: "",
      },
    }],
    next_offset: null,
  }, "ledger.categories");

  expect(page.items[0]?.record).toMatchObject({
    parentId: null,
    parentLabel: "No parent",
  });
});
```

- [ ] **Step 2: Run the focused test and confirm the defect**

Run: `npm --prefix frontend test -- tests/domain/ledger-model.spec.ts`

Expected: FAIL with `Raven API returned invalid ledger category table record.parent_label.`.

- [ ] **Step 3: Implement the minimal wire-boundary normalization**

Update `mapCategoryTableRecord` to parse the parent ID once and use the existing display label only for root categories:

```ts
function mapCategoryTableRecord(value: unknown): LedgerCategoryTableRecord {
  const wire = record(value, "ledger category table record");
  const parentId = nullableString(wire.parent_id, "ledger category table record.parent_id");
  return {
    id: id(wire.id, "ledger category table record.id"),
    category: mapTransactionCategory(wire.category),
    name: nonEmptyString(wire.name, "ledger category table record.name"),
    kind: categoryKind(wire.kind),
    kindLabel: categoryKindLabel(wire.kind_label),
    parentId,
    parentLabel: parentId === null
      ? "No parent"
      : nonEmptyString(wire.parent_label, "ledger category table record.parent_label"),
  };
}
```

- [ ] **Step 4: Run focused and static verification**

Run: `npm --prefix frontend test -- tests/domain/ledger-model.spec.ts`

Expected: PASS.

Run: `npm --prefix frontend run typecheck`

Expected: exits with code 0.

- [ ] **Step 5: Commit the bug fix**

```powershell
git add -- frontend/tests/domain/ledger-model.spec.ts frontend/src/features/ledger/model/ledger-model.ts
git commit -m "[FIX] Map root category parent labels"
```
