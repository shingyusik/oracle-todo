"use client";

import React, { useLayoutEffect, useRef } from "react";

import type {
  MedicationRow,
  MedicationRowGroup,
} from "@/features/health/model/medication-table";
import type { HealthTablePageState } from "@/features/health/hooks/useHealthController";
import { InfiniteTableFooter } from "@/features/workbench/ui/InfiniteTableFooter";

export function MedicationTable({
  groups,
  activeRowCount,
  selectedIds,
  onOpen,
  onToggle,
  onToggleAll,
  page = emptyPage, onLoadMore = noop, emptyMessage,
}: {
  groups: MedicationRowGroup[];
  activeRowCount: number;
  selectedIds: string[];
  onOpen?(row: MedicationRow, occurrence: string): void;
  onToggle(id: string): void;
  onToggleAll(): void;
  page?: HealthTablePageState; onLoadMore?: () => void; emptyMessage?: string;
}) {
  const selectAllRef = useRef<HTMLInputElement>(null);
  const rows = groups.flatMap(({ rows: groupRows }) => groupRows);
  const logicalIds = [...new Set(rows.map(({ id }) => id))];
  const selectedCount = logicalIds.filter((id) => selectedIds.includes(id)).length;
  const allSelected = logicalIds.length > 0 && selectedCount === logicalIds.length;
  useLayoutEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = selectedCount > 0 && !allSelected;
    }
  }, [allSelected, selectedCount]);

  return <section className="items-section" aria-label="Medication entries">
    <table className="items-table" aria-label="Medication entries">
      <thead><tr>
        <th scope="col" className="selection-column"><input ref={selectAllRef} type="checkbox"
          aria-label="Select all visible medication entries" checked={allSelected}
          onChange={onToggleAll} /></th>
        <th scope="col">Taken At</th><th scope="col">Medication</th><th scope="col">Dose</th>
        <th scope="col">Unit</th><th scope="col">Note</th>
      </tr></thead>
      {page.moreStatus === "error" && rows.length === 0 ? <tbody /> : rows.length === 0 ? <tbody><tr className="workspace-table-empty-row">
        <td className="items-message workspace-table-empty-cell" colSpan={6}
          role={page.generation === 0 || page.moreStatus === "loading" ? "status" : undefined}>
          {emptyMessage ?? (activeRowCount === 0
            ? "No medication entries yet."
            : "No medication entries match this view.")}
        </td>
      </tr></tbody> : groups.map((group) =>
        <tbody key={group.key} aria-label={group.label ? `${group.label} group` : undefined}>
          {group.label ? <tr className="workspace-group-heading">
            <th scope="rowgroup" colSpan={6}>{group.label}</th></tr> : null}
          {group.rows.map((row, rowIndex) => {
            const occurrence = (row as MedicationRow & { occurrenceKey?: string }).occurrenceKey
              ?? `${group.key}-${row.id}-${rowIndex}`;
            return <MedicationTableRow key={occurrence} row={row}
              occurrence={occurrence} selected={selectedIds.includes(row.id)}
              onOpen={onOpen} onToggle={onToggle} />;
          })}
        </tbody>)}
      <InfiniteTableFooter nextOffset={page.nextOffset} status={page.moreStatus}
        error={page.moreError} loadMore={onLoadMore} columnCount={6} />
    </table>
  </section>;
}

const emptyPage: HealthTablePageState = { items: [], nextOffset: null, moreStatus: "idle", moreError: null, generation: 0 };
const noop = () => undefined;

function MedicationTableRow({ row, occurrence, selected, onOpen, onToggle }: {
  row: MedicationRow;
  occurrence: string;
  selected: boolean;
  onOpen?(row: MedicationRow, occurrence: string): void;
  onToggle(id: string): void;
}) {
  const context = `${row.medicationName}, ${row.date} ${row.takenAtLabel}, ${row.dose} ${row.unitLabel}`;
  return <tr tabIndex={onOpen ? 0 : undefined}
    aria-label={onOpen ? `Open details for ${context}` : undefined}
    aria-description={onOpen ? "Press Enter or Space to open details." : undefined}
    data-medication-row-id={onOpen ? row.id : undefined}
    data-medication-occurrence={onOpen ? occurrence : undefined}
    onClick={onOpen ? () => onOpen(row, occurrence) : undefined}
    onKeyDown={onOpen ? (event) => {
      if (event.key === "Enter" || event.key === " " || event.key === "Space") {
        event.preventDefault();
        onOpen(row, occurrence);
      }
    } : undefined}>
    <td className="selection-column"><input type="checkbox" aria-label={`Select ${context}`}
      checked={selected} onChange={() => onToggle(row.id)}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()} /></td>
    <td>{row.takenAtLabel}</td>
    <td>{row.medicationName}</td><td>{String(row.dose)}</td>
    <td>{row.unitLabel}</td><td>{row.note}</td>
  </tr>;
}
