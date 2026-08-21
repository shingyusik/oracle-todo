"use client";

import React, { useLayoutEffect, useRef } from "react";

import type { LedgerTablePageState } from "@/features/ledger/hooks/useLedgerController";
import type {
  AccountRow,
  AccountRowGroup,
} from "@/features/ledger/model/account-table";
import { formatMoney } from "@/features/ledger/ui/ledger-ui";
import { InfiniteTableFooter } from "@/features/workbench/ui/InfiniteTableFooter";

type AccountsTableProps = {
  groups: AccountRowGroup[];
  activeRowCount: number;
  selectedIds: string[];
  onOpen: (row: AccountRow) => void;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  page?: LedgerTablePageState;
  onLoadMore?: () => void;
  emptyMessage?: string;
};

export function AccountsTable({
  groups,
  activeRowCount,
  selectedIds,
  onOpen,
  onToggle,
  onToggleAll,
  page = emptyPage,
  onLoadMore = noop,
  emptyMessage,
}: AccountsTableProps) {
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
    <section className="items-section" aria-label="Accounts">
      <table className="items-table" aria-label="Accounts">
        <thead>
          <tr>
            <th scope="col" className="selection-column">
              <input
                ref={selectAllRef}
                type="checkbox"
                aria-label="Select all visible accounts"
                checked={allSelected}
                onChange={onToggleAll}
              />
            </th>
            <th scope="col">Account</th>
            <th scope="col">Account type</th>
            <th scope="col">Current balance</th>
          </tr>
        </thead>
        {page.moreStatus === "error" && rows.length === 0 ? <tbody /> : <AccountTableBody
          groups={groups}
          rows={rows}
          selectedIds={selectedIds}
          emptyMessage={emptyMessage ?? (activeRowCount === 0
            ? "No accounts yet."
            : "No accounts match this view.")}
          onOpen={onOpen}
          onToggle={onToggle}
        />}
        <InfiniteTableFooter
          nextOffset={page.nextOffset}
          status={page.moreStatus}
          error={page.moreError}
          loadMore={onLoadMore}
          columnCount={4}
        />
      </table>
    </section>
  );
}

const emptyPage: LedgerTablePageState = {
  items: [], nextOffset: null, moreStatus: "idle", moreError: null, generation: 0,
};
const noop = () => undefined;

function AccountTableBody({
  groups,
  rows,
  selectedIds,
  emptyMessage,
  onOpen,
  onToggle,
}: {
  groups: AccountRowGroup[];
  rows: AccountRow[];
  selectedIds: string[];
  emptyMessage: string;
  onOpen: (row: AccountRow) => void;
  onToggle: (id: string) => void;
}) {
  if (rows.length === 0) {
    return (
      <tbody>
        <tr className="workspace-table-empty-row">
          <td className="items-message workspace-table-empty-cell" colSpan={4}>
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
              <th scope="rowgroup" colSpan={4}>{group.label}</th>
            </tr>
          ) : null}
          {group.rows.map((row) => (
            <AccountTableRow
              key={row.id}
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

function AccountTableRow({
  row,
  selected,
  onOpen,
  onToggle,
}: {
  row: AccountRow;
  selected: boolean;
  onOpen: (row: AccountRow) => void;
  onToggle: (id: string) => void;
}) {
  const accessibleContext = `${row.name}, ${row.accountTypeLabel}`;

  return (
    <tr
      role="button"
      tabIndex={0}
      aria-label={`Open details for ${accessibleContext}`}
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
          aria-label={`Select ${accessibleContext}`}
          checked={selected}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
          onChange={() => onToggle(row.id)}
        />
      </td>
      <td>{row.name}</td>
      <td>{row.accountTypeLabel}</td>
      <td>{formatMoney(row.currentBalanceMinor, {
        code: row.currencyCode,
        decimalPlaces: row.decimalPlaces,
      })}</td>
    </tr>
  );
}
