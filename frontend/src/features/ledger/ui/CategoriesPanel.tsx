"use client";

import React, { useState } from "react";

import type { LedgerController } from "@/features/ledger/hooks/useLedgerController";
import type {
  TransactionCategory,
  TransactionCategoryKind,
} from "@/features/ledger/model/ledger-model";

export function CategoriesPanel({ controller }: { controller: LedgerController }) {
  const [editing, setEditing] = useState<TransactionCategory | null>(null);
  const [draft, setDraft] = useState(categoryDraft(null));
  const [error, setError] = useState<string | null>(null);

  function edit(category: TransactionCategory | null) {
    setEditing(category);
    setDraft(categoryDraft(category));
    setError(null);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const input = {
        name: draft.name,
        parent: draft.parent || null,
        kind: draft.kind,
      };
      if (editing) await controller.updateCategory(editing.id, input);
      else await controller.createCategory(input);
      edit(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save category");
    }
  }

  async function purge(category: TransactionCategory) {
    if (!window.confirm(`Permanently purge ${category.name}?`)) return;
    const preview = await controller.previewCategoryPurge(category.id);
    await controller.purgeCategory(category.id, preview.confirmationId);
  }

  const names = new Map(
    controller.state.categories.map((category) => [category.id, category.name]),
  );

  return (
    <section aria-labelledby="ledger-categories-heading">
      <header className="workspace-table-header">
        <h1 id="ledger-categories-heading">Categories</h1>
      </header>
      <form aria-label={editing ? "Edit category" : "New category"} onSubmit={save}>
        <label className="field-label">
          Category name
          <input
            required
            value={draft.name}
            onChange={(event) =>
              setDraft((current) => ({ ...current, name: event.target.value }))}
          />
        </label>
        <label className="field-label">
          Category kind
          <select
            value={draft.kind}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                kind: event.target.value as TransactionCategoryKind,
              }))}
          >
            <option value="expense">Expense</option>
            <option value="income">Income</option>
          </select>
        </label>
        <label className="field-label">
          Parent category
          <select
            value={draft.parent}
            onChange={(event) =>
              setDraft((current) => ({ ...current, parent: event.target.value }))}
          >
            <option value="">No parent</option>
            {controller.state.categories
              .filter((item) =>
                item.active && item.kind === draft.kind && item.id !== editing?.id)
              .map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
          </select>
        </label>
        {error && <p role="alert" className="items-message">{error}</p>}
        <button type="submit">{editing ? "Update category" : "Add category"}</button>
        {editing && <button type="button" onClick={() => edit(null)}>Cancel edit</button>}
      </form>
      {controller.state.categories.length === 0 ? (
        <p className="items-message">No transaction categories yet.</p>
      ) : (
        <div className="items-section">
          <table className="items-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Kind</th>
                <th>Parent</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {controller.state.categories.map((category) => (
                <tr key={category.id}>
                  <td>{category.name}</td>
                  <td>{category.kind}</td>
                  <td>{category.parentId ? names.get(category.parentId) ?? "—" : "—"}</td>
                  <td>{category.active ? "Active" : "Archived"}</td>
                  <td>
                    <button type="button" onClick={() => edit(category)}>
                      Edit {category.name}
                    </button>
                    {category.active ? (
                      <button
                        type="button"
                        onClick={() => {
                          if (window.confirm(`Archive ${category.name}?`)) {
                            void controller.archiveCategory(category.id);
                          }
                        }}
                      >
                        Archive {category.name}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          if (window.confirm(`Restore ${category.name}?`)) {
                            void controller.restoreCategory(category.id);
                          }
                        }}
                      >
                        Restore {category.name}
                      </button>
                    )}
                    <button type="button" onClick={() => void purge(category)}>
                      Purge {category.name}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function categoryDraft(category: TransactionCategory | null): {
  name: string;
  parent: string;
  kind: TransactionCategoryKind;
} {
  return {
    name: category?.name ?? "",
    parent: category?.parentId ?? "",
    kind: category?.kind ?? "expense",
  };
}
