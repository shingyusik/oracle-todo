"use client";

import React, { useLayoutEffect, useRef } from "react";

import type { LedgerController } from "@/features/ledger/hooks/useLedgerController";
import type {
  TransactionRow,
  TransactionRowGroup,
} from "@/features/ledger/model/transaction-table";
import { formatMoney } from "@/features/ledger/ui/ledger-ui";

type TransactionsTableProps = {
  controller: LedgerController;
  groups: TransactionRowGroup[];
  activeRowCount: number;
  selectedIds: string[];
  onOpen: (row: TransactionRow) => void;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
};

export function TransactionsTable({
  controller,
  groups,
  activeRowCount,
  selectedIds,
  onOpen,
  onToggle,
  onToggleAll,
}: TransactionsTableProps) {
  const selectAllRef = useRef<HTMLInputElement>(null);
  const rows = groups.flatMap((group) => group.rows);
  const selectedCount = rows.reduce(
    (count, row) => count + Number(selectedIds.includes(row.id)),
    0,
  );
  const allSelected = rows.length > 0 && selectedCount === rows.length;
  const partiallySelected = selectedCount > 0 && !allSelected;

  useLayoutEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = partiallySelected;
  }, [partiallySelected]);

  return (
    <section className="items-section" aria-label="Transactions">
      <table className="items-table" aria-label="Transactions">
        <thead>
          <tr>
            <th scope="col" className="selection-column">
              <input
                ref={selectAllRef}
                type="checkbox"
                aria-label="Select all visible transactions"
                checked={allSelected}
                onChange={onToggleAll}
              />
            </th>
            <th scope="col">Date</th>
            <th scope="col">Content</th>
            <th scope="col">Account</th>
            <th scope="col">Category</th>
            <th scope="col">Amount</th>
          </tr>
        </thead>
        <TransactionTableBody
          controller={controller}
          groups={groups}
          rows={rows}
          selectedIds={selectedIds}
          emptyMessage={activeRowCount === 0
            ? "No transactions yet."
            : "No transactions match this view."}
          onOpen={onOpen}
          onToggle={onToggle}
        />
      </table>
    </section>
  );
}

function TransactionTableBody({
  controller,
  groups,
  rows,
  selectedIds,
  emptyMessage,
  onOpen,
  onToggle,
}: {
  controller: LedgerController;
  groups: TransactionRowGroup[];
  rows: TransactionRow[];
  selectedIds: string[];
  emptyMessage: string;
  onOpen: (row: TransactionRow) => void;
  onToggle: (id: string) => void;
}) {
  if (rows.length === 0) {
    return (
      <tbody>
        <tr className="workspace-table-empty-row">
          <td className="items-message workspace-table-empty-cell" colSpan={6}>
            {emptyMessage}
          </td>
        </tr>
      </tbody>
    );
  }

  return (
    <>
      {groups.map((group) => (
        <tbody
          key={group.key}
          aria-label={group.label === null ? undefined : `${group.label} group`}
        >
          {group.label !== null ? (
            <tr className="workspace-group-heading">
              <th scope="rowgroup" colSpan={6}>{group.label}</th>
            </tr>
          ) : null}
          {group.rows.map((row) => (
            <TransactionTableRow
              key={row.id}
              controller={controller}
              row={row}
              selected={selectedIds.includes(row.id)}
              onOpen={onOpen}
              onToggle={onToggle}
            />
          ))}
        </tbody>
      ))}
    </>
  );
}

function TransactionTableRow({
  controller,
  row,
  selected,
  onOpen,
  onToggle,
}: {
  controller: LedgerController;
  row: TransactionRow;
  selected: boolean;
  onOpen: (row: TransactionRow) => void;
  onToggle: (id: string) => void;
}) {
  const amount = formatMoney(
    Math.abs(row.amountMinor),
    controller.state.currencies.find(({ id }) => id === row.currencyId),
    row.currencyCode,
  );
  const displayAmount = row.kind === "income"
    ? `+${amount}`
    : row.kind === "expense"
      ? `−${amount}`
      : amount;

  return (
    <tr
      role="button"
      tabIndex={0}
      aria-label={`Open transaction ${row.content}`}
      onClick={() => onOpen(row)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " " || event.key === "Space") {
          event.preventDefault();
          onOpen(row);
        }
      }}
    >
      <td className="selection-column">
        <input
          type="checkbox"
          aria-label={`Select ${row.content}`}
          checked={selected}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
          onChange={() => onToggle(row.id)}
        />
      </td>
      <td>{row.date}</td>
      <td>{row.content}</td>
      <td>{row.accountLabel}</td>
      <td>{row.categoryLabel}</td>
      <td className={`ledger-amount-${
        row.kind === "transfer" ? "neutral" : row.kind === "income" ? "positive" : "negative"
      }`}>
        {displayAmount}
      </td>
    </tr>
  );
}
