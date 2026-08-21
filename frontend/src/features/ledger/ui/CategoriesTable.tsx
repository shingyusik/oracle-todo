"use client";

import React, { useLayoutEffect, useRef } from "react";

import type { LedgerTablePageState } from "@/features/ledger/hooks/useLedgerController";
import type {
  CategoryRow,
  CategoryRowGroup,
} from "@/features/ledger/model/category-table";
import { InfiniteTableFooter } from "@/features/workbench/ui/InfiniteTableFooter";

type CategoriesTableProps = {
  groups: CategoryRowGroup[];
  activeRowCount: number;
  selectedIds: string[];
  onOpen: (row: CategoryRow) => void;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  page?: LedgerTablePageState;
  onLoadMore?: () => void;
  emptyMessage?: string;
};

export function CategoriesTable({
  groups,
  activeRowCount,
  selectedIds,
  onOpen,
  onToggle,
  onToggleAll,
  page = emptyPage,
  onLoadMore = noop,
  emptyMessage,
}: CategoriesTableProps) {
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
    <section className="items-section" aria-label="Categories">
      <table className="items-table" aria-label="Categories">
        <thead>
          <tr>
            <th scope="col" className="selection-column">
              <input
                ref={selectAllRef}
                type="checkbox"
                aria-label="Select all visible categories"
                checked={allSelected}
                onChange={onToggleAll}
              />
            </th>
            <th scope="col">Category</th>
            <th scope="col">Type</th>
            <th scope="col">Parent category</th>
          </tr>
        </thead>
        <CategoryTableBody
          groups={groups}
          rows={rows}
          selectedIds={selectedIds}
          emptyMessage={emptyMessage ?? (activeRowCount === 0
            ? "No categories yet."
            : "No categories match this view.")}
          onOpen={onOpen}
          onToggle={onToggle}
        />
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

function CategoryTableBody({
  groups,
  rows,
  selectedIds,
  emptyMessage,
  onOpen,
  onToggle,
}: {
  groups: CategoryRowGroup[];
  rows: CategoryRow[];
  selectedIds: string[];
  emptyMessage: string;
  onOpen: (row: CategoryRow) => void;
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
            <CategoryTableRow
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

function CategoryTableRow({
  row,
  selected,
  onOpen,
  onToggle,
}: {
  row: CategoryRow;
  selected: boolean;
  onOpen: (row: CategoryRow) => void;
  onToggle: (id: string) => void;
}) {
  const accessibleContext = `${row.name}, ${row.kindLabel}, ${row.parentLabel}`;

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
      <td>{row.kindLabel}</td>
      <td>{row.parentLabel}</td>
    </tr>
  );
}
