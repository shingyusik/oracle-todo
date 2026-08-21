"use client";

import React, { useLayoutEffect, useRef } from "react";

import type { BowelRow, BowelRowGroup } from "@/features/health/model/bowel-table";
import type { HealthTablePageState } from "@/features/health/hooks/useHealthController";
import { InfiniteTableFooter } from "@/features/workbench/ui/InfiniteTableFooter";

export function BowelTable({ groups, activeRowCount, selectedIds, onOpen, onToggle, onToggleAll,
  page = emptyPage, onLoadMore = noop, emptyMessage }: {
  groups: BowelRowGroup[];
  activeRowCount: number;
  selectedIds: string[];
  onOpen(row: BowelRow, occurrence: string): void;
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
    if (selectAllRef.current) selectAllRef.current.indeterminate = selectedCount > 0 && !allSelected;
  }, [allSelected, selectedCount]);

  return <section className="items-section" aria-label="Bowel entries">
    <table className="items-table" aria-label="Bowel entries">
      <thead><tr>
        <th scope="col" className="selection-column"><input ref={selectAllRef} type="checkbox"
          aria-label="Select all visible bowel entries" checked={allSelected} onChange={onToggleAll} /></th>
        <th scope="col">Time</th><th scope="col">Bristol Scale</th>
        <th scope="col">Blood Visible</th><th scope="col">Note</th>
      </tr></thead>
      {page.moreStatus === "error" && rows.length === 0 ? <tbody /> : rows.length === 0 ? <tbody><tr className="workspace-table-empty-row">
        <td className="items-message workspace-table-empty-cell" colSpan={5}
          role={page.generation === 0 || page.moreStatus === "loading" ? "status" : undefined}>
          {emptyMessage ?? (activeRowCount === 0 ? "No bowel entries yet." : "No bowel entries match this view.")}
        </td>
      </tr></tbody> : groups.map((group) =>
        <tbody key={group.key} aria-label={group.label ? `${group.label} group` : undefined}>
          {group.label ? <tr className="workspace-group-heading">
            <th scope="rowgroup" colSpan={5}>{group.label}</th></tr> : null}
          {group.rows.map((row, rowIndex) => {
            const context = `Type ${row.bristolScale}, ${row.date} ${row.timeLabel}, ${row.bloodLabel}`;
            const occurrence = (row as BowelRow & { occurrenceKey?: string }).occurrenceKey
              ?? `${group.key}-${row.id}-${rowIndex}`;
            return <tr key={occurrence} tabIndex={0}
              aria-label={`Open details for ${context}`}
              aria-description="Press Enter or Space to open details."
              data-bowel-row-id={row.id} data-bowel-occurrence={occurrence}
              onClick={() => onOpen(row, occurrence)} onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " " || event.key === "Space") {
                  event.preventDefault();
                  onOpen(row, occurrence);
                }
              }}>
              <td className="selection-column"><input type="checkbox" aria-label={`Select ${context}`}
                checked={selectedIds.includes(row.id)} onChange={() => onToggle(row.id)}
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()} /></td>
              <td>{row.timeLabel}</td>
              <td>{`Type ${row.bristolScale}`}</td><td>{row.bloodLabel}</td><td>{row.note}</td>
            </tr>;
          })}
      </tbody>)}
      <InfiniteTableFooter nextOffset={page.nextOffset} status={page.moreStatus}
        error={page.moreError} loadMore={onLoadMore} columnCount={5} />
    </table>
  </section>;
}

const emptyPage: HealthTablePageState = { items: [], nextOffset: null, moreStatus: "idle", moreError: null, generation: 0 };
const noop = () => undefined;
