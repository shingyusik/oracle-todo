import { describe, expect, it } from "vitest";

import type { HealthEvent } from "@/features/health/model/health-model";
import { deriveMedicationGroups } from "@/features/health/model/medication-table";
import { defaultHealthTableSettings } from "@/features/health/model/health-table-views";
import type { PlannerFilterRule, PlannerTableSettings } from "@/features/workbench/model/planner-model";

const id = (suffix: string) => `00000000-0000-4000-8000-${suffix.padStart(12, "0")}`;

function medication(suffix: string, patch: Partial<HealthEvent> = {}): HealthEvent {
  return {
    id: id(suffix), occurredAt: "2026-07-08T12:00:00.000Z", category: "medication",
    metricKey: "medication", name: "Aspirin", value: 1, unit: "tablet", note: null,
    attributes: { kind: "medication", medicationName: "Aspirin", dose: 1, unit: "tablet" },
    createdAt: "2026-07-08T12:00:00.000Z", updatedAt: "2026-07-08T12:00:00.000Z",
    deletedAt: null, ...patch,
  };
}

function settings(patch: Omit<Partial<PlannerTableSettings>, "groupSettings"> & {
  groupSettings?: Partial<PlannerTableSettings["groupSettings"]>;
} = {}): PlannerTableSettings {
  const defaults = defaultHealthTableSettings("health.medication");
  return { ...defaults, ...patch, groupSettings: { ...defaults.groupSettings, ...patch.groupSettings } };
}

function localInstant(year: number, month: number, day: number, hour = 12): string {
  return new Date(year, month - 1, day, hour).toISOString();
}

describe("deriveMedicationGroups", () => {
  it("projects only active validated Medication events and defaults newest-first with id ties", () => {
    const events = [
      medication("3", { occurredAt: "2026-07-08T10:00:00Z" }),
      medication("2", { occurredAt: "2026-07-08T11:00:00Z", note: "after food" }),
      medication("1", { occurredAt: "2026-07-08T11:00:00Z", attributes: { kind: "medication", medicationName: "Vitamin C", dose: 2, unit: "capsule" } }),
      medication("4", { deletedAt: "2026-07-09T00:00:00Z" }),
      medication("5", { category: "sleep" }),
      medication("6", { attributes: { kind: "bowel", bristolScale: 4, bloodVisible: false } }),
    ];
    const rows = deriveMedicationGroups(events, settings())[0]!.rows;
    expect(rows.map(({ id: rowId }) => rowId)).toEqual([id("1"), id("2"), id("3")]);
    expect(rows[0]).toMatchObject({ event: events[2], medicationName: "Vitamin C", dose: 2, unit: "capsule", unitLabel: "캡슐", note: "" });
    expect(rows[1]).toMatchObject({ medicationName: "Aspirin", unitLabel: "정", note: "after food" });
  });

  it("uses local calendar dates for projection and relative-date filtering", () => {
    const occurredAt = ["2026-01-02T00:30:00+14:00", "2026-01-02T23:30:00-12:00"]
      .find((value) => new Date(value).getDate() !== Number(value.slice(8, 10)))!;
    const instant = new Date(occurredAt);
    const rows = deriveMedicationGroups([medication("1", { occurredAt })], settings({ filterRules: [{
      id: "today", field: "date", type: "date", operator: "is_relative_to_today",
      value: { amount: "0", unit: "day" },
    }] }), new Date(instant.getFullYear(), instant.getMonth(), instant.getDate(), 12))[0]!.rows;
    expect(rows[0]!.date).not.toBe(occurredAt.slice(0, 10));
  });

  it("applies effective Medication rules with AND and OR", () => {
    const rules: PlannerFilterRule[] = [
      { id: "name", field: "medication_name", type: "text", operator: "contains", value: "spir" },
      { id: "unit", field: "medication_unit", type: "select", operator: "is", value: ["capsule"] },
      { id: "leak", field: "food", type: "text", operator: "contains", value: "rice" },
    ];
    const events = [medication("1"), medication("2", { attributes: { kind: "medication", medicationName: "Vitamin C", dose: 2, unit: "capsule" } })];
    expect(deriveMedicationGroups(events, settings({ filterMode: "and", filterRules: rules }))[0]!.rows).toEqual([]);
    expect(deriveMedicationGroups(events, settings({ filterMode: "or", filterRules: rules }))[0]!.rows.map(({ id: rowId }) => rowId))
      .toEqual([id("1"), id("2")]);
  });

  it("sorts numeric dose, honors conflicting secondary sort, and uses id as final tie-break", () => {
    const rows = deriveMedicationGroups([
      medication("3", { occurredAt: "2026-07-10T00:00:00Z", attributes: { kind: "medication", medicationName: "B", dose: 10, unit: "mg" } }),
      medication("2", { occurredAt: "2026-07-08T00:00:00Z", attributes: { kind: "medication", medicationName: "B", dose: 2, unit: "mg" } }),
      medication("1", { occurredAt: "2026-07-09T00:00:00Z", attributes: { kind: "medication", medicationName: "A", dose: 2, unit: "mg" } }),
      medication("4", { occurredAt: "2026-07-07T00:00:00Z", attributes: { kind: "medication", medicationName: "A", dose: 2, unit: "mg" } }),
    ], settings({ sortRules: [
      { id: "dose", field: "dose", direction: "asc" },
      { id: "name", field: "medication_name", direction: "desc" },
    ] }))[0]!.rows;
    expect(rows.map(({ id: rowId }) => rowId)).toEqual([id("2"), id("1"), id("4"), id("3")]);
  });

  it.each([
    ["day", ["2026-01-05", "2025-12-31"]],
    ["week", ["2026-01-05", "2025-12-29"]],
    ["month", ["2026-01", "2025-12"]],
    ["medication_name", ["Vitamin C", "Aspirin"]],
    ["medication_unit", ["capsule", "tablet"]],
  ] as const)("groups by %s using local dates or Medication attributes", (groupBy, keys) => {
    const groups = deriveMedicationGroups([
      medication("1", { occurredAt: localInstant(2025, 12, 31) }),
      medication("2", { occurredAt: localInstant(2026, 1, 5), attributes: { kind: "medication", medicationName: "Vitamin C", dose: 2, unit: "capsule" } }),
    ], settings({ groupSettings: { groupBy } }));
    expect(groups.map(({ key }) => key).sort().reverse()).toEqual([...keys].sort().reverse());
  });

  it("honors alphabetical, reverse, manual, and hidden group ordering", () => {
    const events = [medication("1"), medication("2", { attributes: { kind: "medication", medicationName: "Vitamin C", dose: 2, unit: "capsule" } })];
    expect(deriveMedicationGroups(events, settings({ groupSettings: { groupBy: "medication_name", sort: "alphabetical" } })).map(({ key }) => key))
      .toEqual(["Aspirin", "Vitamin C"]);
    expect(deriveMedicationGroups(events, settings({ groupSettings: { groupBy: "medication_unit", sort: "reverse_alphabetical" } })).map(({ key, label }) => [key, label]))
      .toEqual([["capsule", "캡슐"], ["tablet", "정"]]);
    expect(deriveMedicationGroups(events, settings({ groupSettings: { groupBy: "medication_name", sort: "manual", manualOrder: ["Vitamin C", "Aspirin"], hiddenGroupKeys: ["Aspirin"] } })).map(({ key }) => key))
      .toEqual(["Vitamin C"]);
  });
});
