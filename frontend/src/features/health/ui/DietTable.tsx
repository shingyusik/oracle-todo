"use client";

import React, { useLayoutEffect, useRef } from "react";

import type { DietRow, DietRowGroup } from "@/features/health/model/diet-table";

export function DietTable({
  groups,
  activeRowCount,
  selectedIds,
  onOpen,
  onToggle,
  onToggleAll,
}: {
  groups: DietRowGroup[];
  activeRowCount: number;
  selectedIds: string[];
  onOpen(row: DietRow, occurrence: string): void;
  onToggle(id: string): void;
  onToggleAll(): void;
}) {
  const selectAllRef = useRef<HTMLInputElement>(null);
  const rows = groups.flatMap((group) => group.rows);
  const logicalIds = [...new Set(rows.map(({ id }) => id))];
  const selectedCount = logicalIds.filter((id) => selectedIds.includes(id)).length;
  const allSelected = logicalIds.length > 0 && selectedCount === logicalIds.length;

  useLayoutEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = selectedCount > 0 && !allSelected;
    }
  }, [allSelected, selectedCount]);

  return (
    <section className="items-section" aria-label="Diet entries">
      <table className="items-table" aria-label="Diet entries">
        <thead><tr>
          <th scope="col" className="selection-column">
            <input
              ref={selectAllRef}
              type="checkbox"
              aria-label="Select all visible diet entries"
              checked={allSelected}
              onChange={onToggleAll}
            />
          </th>
          <th scope="col">Time</th>
          <th scope="col">Meal</th>
          <th scope="col">Food</th>
          <th scope="col">Tags</th>
          <th scope="col">Photo</th>
          <th scope="col">Note</th>
        </tr></thead>
        {rows.length === 0 ? (
          <tbody><tr className="workspace-table-empty-row">
            <td className="items-message workspace-table-empty-cell" colSpan={7}>
              {activeRowCount === 0
                ? "No diet entries yet."
                : "No diet entries match this view."}
            </td>
          </tr></tbody>
        ) : groups.map((group, groupIndex) => (
          <tbody key={group.key} aria-label={group.label ? `${group.label} group` : undefined}>
            {group.label ? <tr className="workspace-group-heading">
              <th scope="rowgroup" colSpan={7}>{group.label}</th>
            </tr> : null}
            {group.rows.map((row, rowIndex) => (
              <DietTableRow
                key={row.id}
                row={row}
                occurrence={`${groupIndex}-${rowIndex}`}
                selected={selectedIds.includes(row.id)}
                onOpen={onOpen}
                onToggle={onToggle}
              />
            ))}
          </tbody>
        ))}
      </table>
    </section>
  );
}

function DietTableRow({
  row,
  occurrence,
  selected,
  onOpen,
  onToggle,
}: {
  row: DietRow;
  occurrence: string;
  selected: boolean;
  onOpen(row: DietRow, occurrence: string): void;
  onToggle(id: string): void;
}) {
  const context = `${row.food}, ${row.date} ${row.timeLabel}, ${row.mealLabel}`;
  return (
    <tr
      tabIndex={0}
      data-diet-row-id={row.id}
      data-diet-occurrence={occurrence}
      aria-label={`Open details for ${context}`}
      aria-description="Press Enter or Space to open details."
      onClick={() => onOpen(row, occurrence)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " " || event.key === "Space") {
          event.preventDefault();
          onOpen(row, occurrence);
        }
      }}
    >
      <td className="selection-column"><input
        type="checkbox"
        aria-label={`Select ${context}`}
        checked={selected}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
        onChange={() => onToggle(row.id)}
      /></td>
      <td>{row.timeLabel}</td>
      <td>{row.mealLabel}</td>
      <td>{row.food}</td>
      <td>{row.tags.map((tag) => <span className="tag-chip" key={tag}>{tag}</span>)}</td>
      <td>{row.hasPhoto ? "Photo" : "—"}</td>
      <td>{row.note}</td>
    </tr>
  );
}
