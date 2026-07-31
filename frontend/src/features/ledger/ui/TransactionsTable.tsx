"use client";

import React, { useRef, useState } from "react";

import type { LedgerController } from "@/features/ledger/hooks/useLedgerController";
import type { LedgerEntryView } from "@/features/ledger/model/ledger-model";
import { formatMoney, useLifecycleAction } from "@/features/ledger/ui/ledger-ui";
import { DestructiveConfirmationDialog } from "@/features/workbench/ui/DestructiveConfirmationDialog";

type TransactionsTableProps = {
  controller: LedgerController;
  onEdit: (entry: LedgerEntryView) => void;
};

export function TransactionsTable({ controller, onEdit }: TransactionsTableProps) {
  const { entries } = controller.state;
  const actions = useLifecycleAction();
  const [purgeTarget, setPurgeTarget] = useState<LedgerEntryView | null>(null);
  const sectionRef = useRef<HTMLElement>(null);

  if (entries.length === 0) {
    return <p className="items-message">No transactions yet.</p>;
  }

  async function purge(entry: LedgerEntryView) {
    await actions.run(`purge:${entry.entry.id}`, async () => {
      const preview = await controller.previewPurge(entry.entry.id);
      await controller.purge(entry.entry.id, preview.confirmationId);
    });
    setPurgeTarget(null);
  }

  return (
    <section
      ref={sectionRef}
      className="items-section"
      aria-label="Transactions"
      tabIndex={-1}
    >
      {actions.error && <p role="alert" className="items-message">{actions.error}</p>}
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
            const actionContext = entryActionContext(entry);
            return (
              <tr key={entry.entry.id}>
                <td>{entry.entry.date}</td>
                <td>{entry.entry.content}</td>
                <td>{entry.entry.entryType.replaceAll("_", " ")}</td>
                <td>{entry.accountName ?? "—"}</td>
                <td>{entry.categoryName ?? "—"}</td>
                <td>
                  {formatMoney(
                    entry.entry.amountMinor,
                    controller.state.currencies.find(
                      (currency) => currency.id === entry.entry.currencyId,
                    ),
                    entry.currencyCode ?? "",
                  )}
                </td>
                <td>
                  <button
                    type="button"
                    aria-label={`Edit ${actionContext}`}
                    onClick={() => onEdit(entry)}
                  >
                    Edit {entry.entry.content}
                  </button>
                  {archived ? (
                    <button
                      type="button"
                      aria-label={`Restore ${actionContext}`}
                      disabled={actions.isPending(`restore:${entry.entry.id}`)}
                      onClick={() => {
                        if (window.confirm(`Restore ${entry.entry.content}?`)) {
                          void actions.run(
                            `restore:${entry.entry.id}`,
                            () => controller.restore(entry.entry.id),
                          );
                        }
                      }}
                    >
                      Restore {entry.entry.content}
                    </button>
                  ) : (
                    <button
                      type="button"
                      aria-label={`Archive ${actionContext}`}
                      disabled={actions.isPending(`archive:${entry.entry.id}`)}
                      onClick={() => {
                        if (window.confirm(`Archive ${entry.entry.content}?`)) {
                          void actions.run(
                            `archive:${entry.entry.id}`,
                            () => controller.archive(entry.entry.id),
                          );
                        }
                      }}
                    >
                      Archive {entry.entry.content}
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label={`Purge ${actionContext}`}
                    disabled={actions.isPending(`purge:${entry.entry.id}`)}
                    onClick={() => setPurgeTarget(entry)}
                  >
                    Purge {entry.entry.content}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {purgeTarget ? (
        <DestructiveConfirmationDialog
          title={`Permanently purge ${entryActionContext(purgeTarget)}?`}
          description="This transaction will be permanently removed. This cannot be undone."
          fallbackFocusRef={sectionRef}
          onCancel={() => setPurgeTarget(null)}
          onConfirm={() => purge(purgeTarget)}
        />
      ) : null}
    </section>
  );
}

function entryActionContext(entry: LedgerEntryView): string {
  return `${entry.entry.content}, ${entry.entry.date}, ${
    entry.accountName ?? "Unknown account"
  } (${entry.entry.id})`;
}
