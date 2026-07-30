"use client";

import React from "react";

import type { LedgerController } from "@/features/ledger/hooks/useLedgerController";
import type { LedgerEntryView } from "@/features/ledger/model/ledger-model";

type TransactionsTableProps = {
  controller: LedgerController;
  onEdit: (entry: LedgerEntryView) => void;
};

export function TransactionsTable({ controller, onEdit }: TransactionsTableProps) {
  const { entries } = controller.state;

  if (entries.length === 0) {
    return <p className="items-message">No transactions yet.</p>;
  }

  async function purge(entry: LedgerEntryView) {
    if (!window.confirm(`Permanently purge ${entry.entry.content}?`)) return;
    const preview = await controller.previewPurge(entry.entry.id);
    await controller.purge(entry.entry.id, preview.confirmationId);
  }

  return (
    <section className="items-section" aria-label="Transactions">
      <table className="items-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Content</th>
            <th>Type</th>
            <th>Account</th>
            <th>Category</th>
            <th>Amount</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            const archived = entry.entry.deletedAt !== null;
            return (
              <tr key={entry.entry.id}>
                <td>{entry.entry.date}</td>
                <td>{entry.entry.content}</td>
                <td>{entry.entry.entryType.replaceAll("_", " ")}</td>
                <td>{entry.accountName ?? "—"}</td>
                <td>{entry.categoryName ?? "—"}</td>
                <td>{entry.entry.amountMinor} {entry.currencyCode ?? ""}</td>
                <td>
                  <button type="button" onClick={() => onEdit(entry)}>
                    Edit {entry.entry.content}
                  </button>
                  {archived ? (
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(`Restore ${entry.entry.content}?`)) {
                          void controller.restore(entry.entry.id);
                        }
                      }}
                    >
                      Restore {entry.entry.content}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(`Archive ${entry.entry.content}?`)) {
                          void controller.archive(entry.entry.id);
                        }
                      }}
                    >
                      Archive {entry.entry.content}
                    </button>
                  )}
                  <button type="button" onClick={() => void purge(entry)}>
                    Purge {entry.entry.content}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
