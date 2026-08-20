"use client";

import React, { useLayoutEffect, useRef } from "react";

import type { BowelRow, BowelRowGroup } from "@/features/health/model/bowel-table";

export function BowelTable({ groups, activeRowCount, selectedIds, onOpen, onToggle, onToggleAll }: {
  groups: BowelRowGroup[];
  activeRowCount: number;
  selectedIds: string[];
  onOpen(row: BowelRow, occurrence: string): void;
  onToggle(id: string): void;
  onToggleAll(): void;
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
      {rows.length === 0 ? <tbody><tr className="workspace-table-empty-row">
        <td className="items-message workspace-table-empty-cell" colSpan={5}>
          {activeRowCount === 0 ? "No bowel entries yet." : "No bowel entries match this view."}
        </td>
      </tr></tbody> : groups.map((group) =>
        <tbody key={group.key} aria-label={group.label ? `${group.label} group` : undefined}>
          {group.label ? <tr className="workspace-group-heading">
            <th scope="rowgroup" colSpan={5}>{group.label}</th></tr> : null}
          {group.rows.map((row, rowIndex) => {
            const context = `Type ${row.bristolScale}, ${row.date} ${row.timeLabel}, ${row.bloodLabel}`;
            const occurrence = `${group.key}-${row.id}-${rowIndex}`;
            return <tr key={occurrence} role="button" tabIndex={0}
              aria-label={`Open details for ${context}`}
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
    </table>
  </section>;
}
