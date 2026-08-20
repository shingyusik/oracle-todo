"use client";

import React, { useLayoutEffect, useRef } from "react";

import type {
  HealthMetricsRow,
  HealthMetricsRowGroup,
} from "@/features/health/model/health-metrics-table";

export function HealthMetricsTable({ groups, activeRowCount, selectedDates, onOpen,
  onToggle, onToggleAll }: {
  groups: HealthMetricsRowGroup[];
  activeRowCount: number;
  selectedDates: string[];
  onOpen(row: HealthMetricsRow, occurrence: string): void;
  onToggle(date: string): void;
  onToggleAll(): void;
}) {
  const selectAllRef = useRef<HTMLInputElement>(null);
  const rows = groups.flatMap(({ rows }) => rows);
  const logicalDates = [...new Set(rows.map(({ date }) => date))];
  const selectedCount = logicalDates.filter((date) => selectedDates.includes(date)).length;
  const allSelected = logicalDates.length > 0 && selectedCount === logicalDates.length;
  useLayoutEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = selectedCount > 0 && !allSelected;
  }, [allSelected, selectedCount]);

  return <section className="items-section" aria-label="Health metrics">
    <table className="items-table" aria-label="Health metrics">
      <thead><tr>
        <th scope="col" className="selection-column"><input ref={selectAllRef} type="checkbox"
          aria-label="Select all visible health metrics" checked={allSelected}
          onChange={onToggleAll} /></th>
        <th scope="col">Date</th><th scope="col">Weight</th><th scope="col">Sleep</th>
        <th scope="col">CRP</th><th scope="col">Calprotectin</th>
        <th scope="col">Condition</th><th scope="col">Note</th>
      </tr></thead>
      {rows.length === 0 ? <tbody><tr className="workspace-table-empty-row">
        <td className="items-message workspace-table-empty-cell" colSpan={8}>
          {activeRowCount === 0 ? "No health metrics yet." : "No health metrics match this view."}
        </td>
      </tr></tbody> : groups.map((group) =>
        <tbody key={group.key} aria-label={group.label ? `${group.label} group` : undefined}>
          {group.label ? <tr className="workspace-group-heading">
            <th scope="rowgroup" colSpan={8}>{group.label}</th></tr> : null}
          {group.rows.map((row, index) => {
            const occurrence = `${group.key}-${row.date}-${index}`;
            return <tr key={occurrence}>
              <td className="selection-column"><input type="checkbox"
                aria-label={`Select health metrics for ${row.date}`}
                checked={selectedDates.includes(row.date)} onChange={() => onToggle(row.date)} /></td>
              <td><button type="button" data-health-metrics-date={row.date}
                data-health-metrics-occurrence={occurrence}
                aria-label={`Open health metrics for ${row.date}`}
                onClick={() => onOpen(row, occurrence)}>{row.date}</button></td>
              <td>{metric(row.weight, "kg")}</td><td>{metric(row.sleep, "hours")}</td>
              <td>{metric(row.crp, "mg/L")}</td><td>{metric(row.calprotectin, "µg/g")}</td>
              <td>{row.condition ?? "-"}</td><td>{row.note}</td>
            </tr>;
          })}
        </tbody>)}
    </table>
  </section>;
}

function metric(value: number | null, unit: string): string {
  return value === null ? "-" : `${value} ${unit}`;
}
