import "@testing-library/jest-dom/vitest";

import { act, fireEvent, render,  screen, waitFor, within } from "@testing-library/react";
import React from "react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { healthApi } from "@/features/health/api/health-api";
import {
  HealthMutationRefreshError,
  
} from "@/features/health/hooks/useHealthController";
import type { HealthEvent } from "@/features/health/model/health-model";
import type { HealthController, HealthState } from "@/features/health/hooks/useHealthController";
import { defaultHealthTableSettings } from "@/features/health/model/health-table-views";
import { deriveHealthMetricsGroups } from "@/features/health/model/health-metrics-table";
import * as healthMetricsTableModel from "@/features/health/model/health-metrics-table";
import { HealthMetricsPanel } from "@/features/health/ui/HealthMetricsPanel";
import { HealthMetricsTable } from "@/features/health/ui/HealthMetricsTable";

const event: HealthEvent = {
  id: "metric-1", occurredAt: "2026-08-19T03:00:00Z", category: "lab",
  metricKey: "crp", name: "CRP", value: 0.4, unit: "mg/L", note: null,
  attributes: { kind: "lab", metricKey: "crp", name: "CRP", value: 0.4, unit: "mg/L" },
  createdAt: "2026-08-19T03:00:00Z", updatedAt: "2026-08-19T03:00:00Z", deletedAt: null,
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("Health Metrics paging", () => {
  afterEach(() => vi.restoreAllMocks());

  it("requests only the scoped first table page on mount", async () => {
    const legacy = vi.spyOn(healthApi, "listEvents");
    const health = panelController();
    render(<HealthMetricsPanel controller={health} tombstonedIds={new Set()}
      onArchiveCommitted={vi.fn()} refreshWarning={null} refreshPending={false}
      onRetryRefresh={vi.fn(async () => false)} />);
    await waitFor(() => expect(health.ensureTable).toHaveBeenCalledWith("health.metrics"));
    expect(legacy).not.toHaveBeenCalled();
  });
});

const weight = { ...event, id: "weight-1", category: "weight", metricKey: "body_weight",
  name: "Body weight", value: 72.5, unit: "kg",
  attributes: { kind: "weight", value: 72.5, unit: "kg" } } as HealthEvent;
const sleep = { ...event, id: "sleep-1", category: "sleep", metricKey: "sleep_duration",
  name: "Sleep", value: 7.5, unit: "hours",
  attributes: { kind: "sleep", metricKey: "sleep_duration", name: "Sleep", hours: 7.5 } } as HealthEvent;
const condition = { ...event, id: "condition-1", category: "symptom",
  metricKey: "overall_condition", name: "Overall condition", value: 8, unit: null,
  attributes: { kind: "symptom", metricKey: "overall_condition", name: "Overall condition",
    score: 8, conditionNote: "Steady" } } as HealthEvent;
const calprotectin = { ...event, id: "calprotectin-1", metricKey: "fecal_calprotectin",
  name: "Fecal calprotectin", value: 120, unit: "µg/g",
  attributes: { kind: "lab", metricKey: "fecal_calprotectin",
    name: "Fecal calprotectin", value: 120, unit: "µg/g" } } as HealthEvent;

function panelController(entries: HealthEvent[] = [weight, sleep, event, calprotectin, condition],
  settings = defaultHealthTableSettings("health.metrics")): HealthController {
  const state = {
    metricsStatus: "loaded", metricsError: null, metricsEntries: entries,
    medicationStatus: "loaded", medicationError: null, medicationEntries: [],
    bowelStatus: "loaded", bowelError: null, bowelEntries: [],
    dietStatus: "loaded", dietError: null, dietEntries: [],
    reportStatus: "idle", reportError: null, report: null, reportSelection: { preset: 30 },
  } satisfies HealthState;
  return {
    state, tableViewSaveError: null, tableViewConfirmation: null,
    retryTableViewSave: vi.fn(), tableTabs: vi.fn(() => ({ tabs: [{ id: "metrics", name: "Table", settings }],
      activeTabId: "metrics", draftSettings: settings })), tableSettings: vi.fn(() => settings),
    tableIsDirty: vi.fn(() => false),
    tablePage: vi.fn(function (this: HealthController) { const status = this.state.metricsStatus; return {
      items: metricsOccurrences(this.state.metricsEntries, this.tableSettings("health.metrics")),
      nextOffset: status === "error" ? 0 : null,
      moreStatus: status === "loading" ? "loading" as const : status === "error" ? "error" as const : "idle" as const,
      moreError: this.state.metricsError, generation: status === "loading" ? 0 : 1,
    }; }),
    ensureTable: vi.fn().mockResolvedValue(undefined), loadMore: vi.fn().mockResolvedValue(undefined),
    ensureReferenceData: vi.fn().mockResolvedValue(true), hasReferenceData: vi.fn(() => false),
    updateTableSettings: vi.fn(), selectTableTab: vi.fn(),
    saveTableTab: vi.fn(), createTableTab: vi.fn(() => true), renameTableTab: vi.fn(() => true),
    requestDeleteTableTab: vi.fn(), confirmTableViewAction: vi.fn(), cancelTableViewAction: vi.fn(),
    refresh: vi.fn(), refreshMetrics: vi.fn(), refreshMedication: vi.fn(), refreshBowel: vi.fn(),
    refreshDiet: vi.fn(),
    runReports: vi.fn(), retryReports: vi.fn(),
    createDiet: vi.fn(), updateDiet: vi.fn(), archiveDiet: vi.fn(), createBowel: vi.fn(),
    updateBowel: vi.fn(), archiveBowel: vi.fn(), createMedication: vi.fn(), updateMedication: vi.fn(),
    archiveMedication: vi.fn(), upsertMetrics: vi.fn(), saveMetrics: vi.fn(),
  };
}

function metricsOccurrences(entries: readonly HealthEvent[], settings: ReturnType<typeof defaultHealthTableSettings>) {
  return deriveHealthMetricsGroups(entries, settings).flatMap((group) => group.rows.map((row) => ({
    key: `${group.key}:${row.id}`, scope: "health.metrics" as const,
    groupKey: group.label === null ? null : group.key, groupLabel: group.label,
    record: { kind: "metrics" as const, id: row.id, date: row.date,
      events: Object.values(row.events).filter((event): event is HealthEvent => event !== undefined),
      weight: row.weight, sleep: row.sleep, crp: row.crp, calprotectin: row.calprotectin,
      condition: row.condition, note: row.note, createdAt: row.createdAt, updatedAt: row.updatedAt },
  })));
}

describe("Health Metrics table", () => {
  afterEach(() => vi.restoreAllMocks());

  const renderPanel = (health: HealthController, extra: Partial<React.ComponentProps<typeof HealthMetricsPanel>> = {}) =>
    render(<HealthMetricsPanel controller={health} tombstonedIds={new Set()}
      onArchiveCommitted={vi.fn()} refreshWarning={null} refreshPending={false}
      onRetryRefresh={vi.fn()} {...extra} />);
  const openRow = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole("row", { name: /Open health metrics/ }));
    return screen.getByRole("dialog", { name: "Edit health metrics" });
  };

  it("opens the Add popup in edit mode, pre-filled, and a clean Escape closes it", async () => {
    const user = userEvent.setup();
    const health = panelController();
    renderPanel(health);
    const dialog = await openRow(user);
    expect(within(dialog).getByRole("heading", { name: "Edit health metrics" })).toBeInTheDocument();
    expect(screen.getByLabelText("Date")).toHaveValue("2026-08-19");
    expect(screen.getByLabelText("Date")).toBeDisabled();
    expect(screen.getByLabelText("Weight")).toHaveValue(72.5);
    expect(screen.getByLabelText("Sleep")).toHaveValue(7.5);
    expect(screen.getByLabelText("CRP")).toHaveValue(0.4);
    expect(screen.getByLabelText("Calprotectin")).toHaveValue(120);
    expect(screen.getByLabelText("Condition")).toHaveValue("8");
    expect(screen.getByLabelText("Note")).toHaveValue("Steady");
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Close Edit health metrics" })).toBeInTheDocument();
    for (const name of ["Undo", "Redo", "Delete"]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
    expect(health.ensureReferenceData).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(screen.getByRole("row", { name: /Open health metrics/ })).toHaveFocus());
  });

  it("opens from Enter and Space on the row", async () => {
    const user = userEvent.setup();
    renderPanel(panelController());
    for (const key of ["{Enter}", " "]) {
      screen.getByRole("row", { name: /Open health metrics/ }).focus();
      await user.keyboard(key);
      expect(screen.getByRole("dialog", { name: "Edit health metrics" })).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Close Edit health metrics" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    }
  });

  it("asks before Escape discards a dirty edit and keeps the draft on cancel", async () => {
    const user = userEvent.setup();
    renderPanel(panelController());
    await openRow(user);
    fireEvent.change(screen.getByLabelText("Weight"), { target: { value: "70" } });
    await user.keyboard("{Escape}");
    const confirm = await screen.findByRole("dialog", { name: /Discard/ });
    await user.click(within(confirm).getByRole("button", { name: /Keep|Cancel|Continue/ }));
    expect(screen.getByLabelText("Weight")).toHaveValue(70);
    await user.keyboard("{Escape}");
    await user.click(within(await screen.findByRole("dialog", { name: /Discard/ }))
      .getByRole("button", { name: /Discard/ }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(screen.getByRole("row", { name: /Open health metrics/ })).toHaveFocus());
  });

  it("preserves an open Metrics draft while the table generation changes", async () => {
    const user = userEvent.setup();
    const health = panelController();
    const page = health.tablePage("health.metrics");
    let generation = page.generation;
    health.tablePage = vi.fn(() => ({ ...page, generation }));
    const view = renderPanel(health);
    await user.click(screen.getByRole("button", { name: "Add health metrics entry" }));
    fireEvent.change(screen.getByLabelText("Weight"), { target: { value: "68" } });
    generation += 1;
    view.rerender(<HealthMetricsPanel controller={health} tombstonedIds={new Set()}
      onArchiveCommitted={vi.fn()} refreshWarning={null} refreshPending={false}
      onRetryRefresh={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: "Add health metrics" })).toBeInTheDocument();
    expect(screen.getByLabelText("Weight")).toHaveValue(68);
  });

  it("saves one changed metric plus one cleared metric atomically with current versions", async () => {
    const user = userEvent.setup();
    const health = panelController();
    renderPanel(health);
    await openRow(user);
    await user.clear(screen.getByLabelText("Weight"));
    await user.type(screen.getByLabelText("Weight"), "67.9");
    await user.clear(screen.getByLabelText("CRP"));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(health.saveMetrics).toHaveBeenCalledOnce());
    expect(health.saveMetrics).toHaveBeenCalledWith({
      metrics: [{
        occurredAt: expect.any(String),
        details: { kind: "weight", value: 67.9, unit: "kg" },
        expectedUpdatedAt: weight.updatedAt,
      }],
      archives: [{ id: event.id, expectedUpdatedAt: event.updatedAt }],
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("closes on Save without a request when nothing canonical changed", async () => {
    const user = userEvent.setup();
    const health = panelController();
    renderPanel(health);
    await openRow(user);
    fireEvent.change(screen.getByLabelText("Weight"), { target: { value: "72.50" } });
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: " Steady " } });
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(health.saveMetrics).not.toHaveBeenCalled();
  });

  it("clears Condition together with its Note by archiving the condition event", async () => {
    const user = userEvent.setup();
    const health = panelController();
    renderPanel(health);
    await openRow(user);
    await user.clear(screen.getByLabelText("Note"));
    await user.selectOptions(screen.getByLabelText("Condition"), "");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(health.saveMetrics).toHaveBeenCalledWith({
      metrics: [], archives: [{ id: condition.id, expectedUpdatedAt: condition.updatedAt }],
    }));
  });

  it.each([
    ["Weight", "71", { kind: "weight", value: 71, unit: "kg" }, weight.updatedAt],
    ["Sleep", "8", { kind: "sleep", value: 8 }, sleep.updatedAt],
    ["CRP", "1.2", { kind: "lab", key: "crp", name: "CRP", value: 1.2, unit: "mg/L" }, event.updatedAt],
    ["Calprotectin", "100", { kind: "lab", key: "fecal_calprotectin",
      name: "Fecal calprotectin", value: 100, unit: "µg/g" }, calprotectin.updatedAt],
  ] as const)("sends only changed %s with its version",
    async (label, next, details, expectedUpdatedAt) => {
      const user = userEvent.setup();
      const health = panelController();
      renderPanel(health);
      await openRow(user);
      fireEvent.change(screen.getByLabelText(label), { target: { value: next } });
      await user.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(health.saveMetrics).toHaveBeenCalledWith({ metrics: [{
        occurredAt: expect.any(String), details, expectedUpdatedAt,
      }], archives: [] }));
    });

  it("sends Condition and trimmed Note together while omitting unchanged metrics", async () => {
    const user = userEvent.setup();
    const health = panelController();
    renderPanel(health);
    await openRow(user);
    await user.clear(screen.getByLabelText("Note"));
    await user.type(screen.getByLabelText("Note"), "  Better  ");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(health.saveMetrics).toHaveBeenCalledWith({ metrics: [{
      occurredAt: expect.any(String), expectedUpdatedAt: condition.updatedAt,
      details: { kind: "overall_condition", score: 8, conditionNote: "Better" },
    }], archives: [] }));
  });

  it("sends a Condition-only edit keeping the existing note", async () => {
    const user = userEvent.setup();
    const health = panelController();
    renderPanel(health);
    await openRow(user);
    await user.selectOptions(screen.getByLabelText("Condition"), "7");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(health.saveMetrics).toHaveBeenCalledWith({ metrics: [{
      occurredAt: expect.any(String), expectedUpdatedAt: condition.updatedAt,
      details: { kind: "overall_condition", score: 7, conditionNote: "Steady" },
    }], archives: [] }));
  });

  it("creates a newly populated member without an optimistic version property", async () => {
    const user = userEvent.setup();
    const health = panelController([weight]);
    renderPanel(health);
    await openRow(user);
    fireEvent.change(screen.getByLabelText("CRP"), { target: { value: "1.5" } });
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(health.saveMetrics).toHaveBeenCalledOnce());
    const input = vi.mocked(health.saveMetrics).mock.calls[0][0].metrics[0];
    expect(input).toMatchObject({ occurredAt: expect.any(String),
      details: { kind: "lab", key: "crp", name: "CRP", value: 1.5, unit: "mg/L" } });
    expect(input).not.toHaveProperty("expectedUpdatedAt");
  });

  it("keeps opened member values and versions across same-date refreshes and filters", async () => {
    const user = userEvent.setup();
    const view = renderPanel(panelController());
    await openRow(user);
    const refreshedWeight = { ...weight, value: 99, updatedAt: "2026-08-20T00:00:00Z",
      attributes: { ...weight.attributes, value: 99 } } as HealthEvent;
    const hidden = panelController([refreshedWeight, sleep, event, calprotectin, condition], {
      ...defaultHealthTableSettings("health.metrics"), filterRules: [{ id: "hidden", field: "weight",
        type: "number", operator: "greater_than", value: "100" }],
    });
    view.rerender(<HealthMetricsPanel controller={hidden} tombstonedIds={new Set()}
      onArchiveCommitted={vi.fn()} refreshWarning={null} refreshPending={false}
      onRetryRefresh={vi.fn()} />);
    expect(screen.getByLabelText("Weight")).toHaveValue(72.5);
    fireEvent.change(screen.getByLabelText("Weight"), { target: { value: "71" } });
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(hidden.saveMetrics).toHaveBeenCalledWith({ metrics: [{
      occurredAt: expect.any(String), expectedUpdatedAt: weight.updatedAt,
      details: { kind: "weight", value: 71, unit: "kg" },
    }], archives: [] }));
  });

  it("returns focus to the row after Close", async () => {
    const user = userEvent.setup();
    renderPanel(panelController([weight]));
    await openRow(user);
    await user.click(screen.getByRole("button", { name: "Close Edit health metrics" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(screen.getByRole("row", { name: /Open health metrics/ })).toHaveFocus());
  });

  it("blocks invalid drafts with an error and disables the form while a save is pending", async () => {
    const user = userEvent.setup();
    const pending = deferred<void>();
    const health = panelController();
    vi.mocked(health.saveMetrics).mockImplementation(() => pending.promise);
    renderPanel(health);
    await openRow(user);
    fireEvent.change(screen.getByLabelText("Weight"), { target: { value: "0" } });
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Weight must be greater than zero");
    expect(health.saveMetrics).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Weight"), { target: { value: "70" } });
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(health.saveMetrics).toHaveBeenCalledOnce());
    expect(screen.getByRole("button", { name: "Close Edit health metrics" })).toBeDisabled();
    for (const label of ["Weight", "Sleep", "CRP", "Calprotectin", "Condition", "Note"]) {
      expect(screen.getByLabelText(label)).toBeDisabled();
    }
    await act(async () => pending.resolve());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(health.saveMetrics).toHaveBeenCalledOnce();
  });

  it("keeps the draft after an ordinary save failure", async () => {
    const user = userEvent.setup();
    const health = panelController();
    vi.mocked(health.saveMetrics).mockRejectedValueOnce(new Error("save failed"));
    renderPanel(health);
    await openRow(user);
    fireEvent.change(screen.getByLabelText("Weight"), { target: { value: "70" } });
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("save failed");
    expect(screen.getByLabelText("Weight")).toHaveValue(70);
    expect(screen.getByRole("dialog", { name: "Edit health metrics" })).toBeInTheDocument();
  });

  it("shows refresh recovery after a committed save and retries reads without resubmitting", async () => {
    const user = userEvent.setup();
    const health = panelController();
    vi.mocked(health.saveMetrics).mockRejectedValueOnce(new HealthMutationRefreshError());
    vi.mocked(health.refreshMetrics).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    renderPanel(health);
    await openRow(user);
    fireEvent.change(screen.getByLabelText("Weight"), { target: { value: "69" } });
    await user.click(screen.getByRole("button", { name: "Save" }));
    const retry = await screen.findByRole("button", { name: "Retry refresh" });
    expect(screen.getByLabelText("Weight")).toBeDisabled();
    await user.click(retry);
    await waitFor(() => expect(health.refreshMetrics).toHaveBeenCalledOnce());
    expect(screen.getByRole("button", { name: "Retry refresh" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry refresh" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(health.refreshMetrics).toHaveBeenCalledTimes(2);
    expect(health.saveMetrics).toHaveBeenCalledOnce();
  });

  it("renders the saved-view header and fixed daily columns with units", () => {
    const expectIconButton = (name: string, iconClass: string) => {
      const button = screen.getByRole("button", { name });
      expect(button).toHaveAttribute("title", name);
      expect(button).toContainElement(button.querySelector(`.${iconClass}`));
      expect(button).toHaveTextContent(/^\s*$/);
    };
    render(<HealthMetricsPanel controller={panelController()} tombstonedIds={new Set()}
      onArchiveCommitted={vi.fn()} refreshWarning={null} refreshPending={false}
      onRetryRefresh={vi.fn()} />);

    expect(screen.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
      "", "Date", "Weight", "Sleep", "CRP", "Calprotectin", "Condition", "Note",
    ]);
    expect(screen.getByText("72.5 kg")).toBeInTheDocument();
    expect(screen.getByText("7.5 hours")).toBeInTheDocument();
    expect(screen.getByText("0.4 mg/L")).toBeInTheDocument();
    expect(screen.getByText("120 µg/g")).toBeInTheDocument();
    expect(screen.getByText("Steady")).toBeInTheDocument();
    expectIconButton("Add health metrics entry", "tabler-icon-plus");
    expectIconButton("Archive selected health metrics entries", "tabler-icon-trash");
    expect(screen.getByRole("button", { name: "Archive selected health metrics entries" }))
      .toBeDisabled();
  });

  it("opens the real Add dialog and restores focus after closing", async () => {
    const user = userEvent.setup();
    render(<HealthMetricsPanel controller={panelController()} tombstonedIds={new Set()}
      onArchiveCommitted={vi.fn()} refreshWarning={null} refreshPending={false}
      onRetryRefresh={vi.fn()} />);
    const add = screen.getByRole("button", { name: "Add health metrics entry" });
    await user.click(add);
    const dialog = screen.getByRole("dialog", { name: "Add health metrics" });
    expect(within(dialog).getByLabelText("Date")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Weight")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Sleep")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("CRP")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Calprotectin")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Condition")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Note")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Close Add health metrics" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Add health metrics" })).toBeNull());
    expect(add).toHaveFocus();
  });

  it("preloads only non-tombstoned members and omits stale optimistic versions", async () => {
    const user = userEvent.setup();
    const health = panelController([weight, sleep]);
    render(<HealthMetricsPanel controller={health} tombstonedIds={new Set([weight.id])}
      onArchiveCommitted={vi.fn()} refreshWarning={null} refreshPending={false}
      onRetryRefresh={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Add health metrics entry" }));
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-08-19" } });
    await act(async () => Promise.resolve());
    expect(screen.getByLabelText("Weight")).toHaveValue(null);
    expect(screen.getByLabelText("Sleep")).toHaveValue(7.5);
    fireEvent.change(screen.getByLabelText("Weight"), { target: { value: "70" } });
    fireEvent.submit(screen.getByRole("form", { name: "Daily metrics" }));
    await waitFor(() => expect(health.saveMetrics).toHaveBeenCalledWith({ metrics: [
      expect.objectContaining({ details: { kind: "weight", value: 70, unit: "kg" } }),
      expect.objectContaining({ details: { kind: "sleep", value: 7.5 },
        expectedUpdatedAt: sleep.updatedAt }),
    ], archives: [] }));
    const payload = vi.mocked(health.saveMetrics).mock.calls[0]?.[0];
    expect(payload?.metrics[0]).not.toHaveProperty("id");
    expect(payload?.metrics[0]).not.toHaveProperty("expectedUpdatedAt");
  });

  it("archives every member of one selected date in one atomic mutation", async () => {
    const user = userEvent.setup();
    const health = panelController();
    render(<HealthMetricsPanel controller={health} tombstonedIds={new Set()}
      onArchiveCommitted={vi.fn()} refreshWarning={null} refreshPending={false}
      onRetryRefresh={vi.fn()} />);
    await user.click(screen.getByRole("checkbox", { name: /Select health metrics for 2026-08-19/ }));
    await user.click(screen.getByRole("button", { name: "Archive selected health metrics entries" }));
    await user.click(within(screen.getByRole("dialog", { name: "Archive selected health metrics?" }))
      .getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(health.saveMetrics).toHaveBeenCalledWith({ metrics: [], archives: [
      { id: "weight-1", expectedUpdatedAt: weight.updatedAt },
      { id: "sleep-1", expectedUpdatedAt: sleep.updatedAt },
      { id: "metric-1", expectedUpdatedAt: event.updatedAt },
      { id: "calprotectin-1", expectedUpdatedAt: calprotectin.updatedAt },
      { id: "condition-1", expectedUpdatedAt: condition.updatedAt },
    ] }));
  });

  it("archives selected dates sequentially and stops with failed dates selected", async () => {
    const user = userEvent.setup();
    const newer = { ...weight, id: "weight-2", occurredAt: "2026-08-20T03:00:00Z",
      createdAt: "2026-08-20T03:00:00Z", updatedAt: "2026-08-20T03:00:00Z" };
    const health = panelController([weight, newer]);
    vi.mocked(health.saveMetrics).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("conflict"));
    const committed = vi.fn();
    render(<HealthMetricsPanel controller={health} tombstonedIds={new Set()}
      onArchiveCommitted={committed} refreshWarning={null} refreshPending={false}
      onRetryRefresh={vi.fn()} />);

    await user.click(screen.getByRole("checkbox", { name: "Select all visible health metrics" }));
    await user.click(screen.getByRole("button", { name: "Archive selected health metrics entries" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Archive" }));

    await waitFor(() => expect(health.saveMetrics).toHaveBeenCalledTimes(2));
    expect(health.saveMetrics).toHaveBeenNthCalledWith(1, { metrics: [], archives: [
      { id: "weight-2", expectedUpdatedAt: newer.updatedAt },
    ] });
    expect(committed).toHaveBeenCalledWith(["weight-2"], undefined);
    expect(screen.getByRole("checkbox", { name: /Select health metrics for 2026-08-19/ }))
      .toBeChecked();
    expect(screen.getByRole("alert")).toHaveTextContent("conflict");
  });

  it("distinguishes empty data from a filtered empty view", () => {
    const empty = panelController([]);
    const view = render(<HealthMetricsPanel controller={empty} tombstonedIds={new Set()}
      onArchiveCommitted={vi.fn()} refreshWarning={null} refreshPending={false}
      onRetryRefresh={vi.fn()} />);
    expect(screen.getByText("No health metrics yet.")).toBeInTheDocument();
    const filtered = panelController();
    filtered.tableSettings = () => ({ ...defaultHealthTableSettings("health.metrics"),
      filterRules: [{ id: "no-match", field: "weight", type: "number",
        operator: "greater_than", value: "999" }] });
    view.rerender(<HealthMetricsPanel controller={filtered} tombstonedIds={new Set()}
      onArchiveCommitted={vi.fn()} refreshWarning={null} refreshPending={false}
      onRetryRefresh={vi.fn()} />);
    expect(screen.getByText("No health metrics match this view.")).toBeInTheDocument();
  });

  it("isolates duplicate occurrence checkboxes from detail rows", async () => {
    const groups = deriveHealthMetricsGroups([weight], defaultHealthTableSettings("health.metrics"));
    const toggle = vi.fn();
    const open = vi.fn();
    render(<HealthMetricsTable groups={[groups[0], { ...groups[0], key: "duplicate" }]}
      activeRowCount={1} selectedDates={[]} onOpen={open} onToggle={toggle}
      onToggleAll={vi.fn()} />);
    const checkboxes = screen.getAllByRole("checkbox", { name: /Select health metrics for/ });
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes[0].closest("tr")).toHaveAttribute("tabindex", "0");
    await userEvent.click(checkboxes[1]);
    expect(toggle).toHaveBeenCalledWith("2026-08-19");
    expect(open).not.toHaveBeenCalled();
    const buttons = screen.getAllByRole("row", { name: /Open health metrics for/ });
    expect(buttons.map((button) => button.dataset.healthMetricsOccurrence))
      .toEqual(["all-2026-08-19-0", "duplicate-2026-08-19-0"]);
  });

  it("keeps hidden active dates selected while Delete follows visible selection", async () => {
    const user = userEvent.setup();
    const newer = { ...weight, id: "weight-2", value: 80,
      attributes: { ...weight.attributes, value: 80 }, occurredAt: "2026-08-20T03:00:00Z" };
    const view = render(<HealthMetricsPanel controller={panelController([weight, newer])}
      tombstonedIds={new Set()} onArchiveCommitted={vi.fn()} refreshWarning={null}
      refreshPending={false} onRetryRefresh={vi.fn()} />);
    await user.click(screen.getByRole("checkbox", { name: /Select health metrics for 2026-08-19/ }));
    const onlyNewer = { ...defaultHealthTableSettings("health.metrics"), filterRules: [{
      id: "newer", field: "weight" as const, type: "number" as const,
      operator: "greater_than" as const, value: "75",
    }] };
    view.rerender(<HealthMetricsPanel controller={panelController([weight, newer], onlyNewer)}
      tombstonedIds={new Set()} onArchiveCommitted={vi.fn()} refreshWarning={null}
      refreshPending={false} onRetryRefresh={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Archive selected health metrics entries" }))
      .toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: "Select all visible health metrics" }));
    view.rerender(<HealthMetricsPanel controller={panelController([weight, newer])}
      tombstonedIds={new Set()} onArchiveCommitted={vi.fn()} refreshWarning={null}
      refreshPending={false} onRetryRefresh={vi.fn()} />);
    expect(screen.getAllByRole("checkbox", { name: /Select health metrics for/ })
      .every((checkbox) => (checkbox as HTMLInputElement).checked)).toBe(true);
  });

  it("shows exact loading, blocking error, and stale loaded-error states", () => {
    const loading = panelController([]);
    loading.state.metricsStatus = "loading";
    const view = render(<HealthMetricsPanel controller={loading} tombstonedIds={new Set()}
      onArchiveCommitted={vi.fn()} refreshWarning={null} refreshPending={false}
      onRetryRefresh={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading health metrics…");
    const blocked = panelController([]);
    blocked.state.metricsStatus = "error";
    blocked.state.metricsError = "Metrics unavailable";
    view.rerender(<HealthMetricsPanel controller={blocked} tombstonedIds={new Set()}
      onArchiveCommitted={vi.fn()} refreshWarning={null} refreshPending={false}
      onRetryRefresh={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Metrics unavailable");
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    const stale = panelController();
    stale.state.metricsError = "Refresh failed";
    view.rerender(<HealthMetricsPanel controller={stale} tombstonedIds={new Set()}
      onArchiveCommitted={vi.fn()} refreshWarning={null} refreshPending={false}
      onRetryRefresh={vi.fn()} />);
    expect(screen.getByRole("table", { name: "Health metrics" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Refresh failed");
  });

  it("scopes saved views and exposes exact Metrics filter, sort, and group options", async () => {
    const user = userEvent.setup();
    const health = panelController();
    const { container } = render(<HealthMetricsPanel controller={health} tombstonedIds={new Set()}
      onArchiveCommitted={vi.fn()} refreshWarning={null} refreshPending={false}
      onRetryRefresh={vi.fn()} />);
    expect(vi.mocked(health.tableSettings)).toHaveBeenCalledWith("health.metrics");
    expect(vi.mocked(health.tableTabs)).toHaveBeenCalledWith("health.metrics");
    expect([...container.querySelectorAll(".workspace-table-header-actions button")]
      .map((button) => button.getAttribute("aria-label") ?? button.textContent)).toEqual([
        "Filter Health Metrics", "Sort Health Metrics", "Group Health Metrics",
        "Add health metrics entry", "Archive selected health metrics entries",
      ]);
    await user.click(screen.getByRole("button", { name: "Filter Health Metrics" }));
    let dialog = screen.getByRole("dialog", { name: "Filter Health Metrics" });
    await user.click(within(dialog).getByRole("button", { name: "Add filter rule" }));
    expect(within(dialog).getAllByRole("option").map((option) => option.textContent))
      .toEqual(["Date", "Weight", "Sleep", "CRP", "Calprotectin", "Condition"]);
    await user.click(screen.getByRole("button", { name: "Filter Health Metrics" }));
    await user.click(screen.getByRole("button", { name: "Sort Health Metrics" }));
    dialog = screen.getByRole("dialog", { name: "Sort Health Metrics" });
    expect(within(within(dialog).getByLabelText("Sort field")).getAllByRole("option")
      .map((option) => option.textContent))
      .toEqual(["Date", "Weight", "Sleep", "CRP", "Calprotectin", "Condition"]);
    await user.click(screen.getByRole("button", { name: "Sort Health Metrics" }));
    await user.click(screen.getByRole("button", { name: "Group Health Metrics" }));
    dialog = screen.getByRole("dialog", { name: "Group Health Metrics" });
    await user.click(within(dialog).getByRole("button", { name: "Choose group property" }));
    expect(within(dialog).getAllByRole("option").map((option) => option.textContent))
      .toEqual(["None", "Month", "Week"]);
  });

  it("uses native grouped table semantics and accessible row activation", async () => {
    const user = userEvent.setup();
    const settings = defaultHealthTableSettings("health.metrics");
    settings.groupSettings.groupBy = "month";
    const groups = deriveHealthMetricsGroups([weight], settings);
    const open = vi.fn();
    render(<HealthMetricsTable groups={groups} activeRowCount={1} selectedDates={[]}
      onOpen={open} onToggle={vi.fn()} onToggleAll={vi.fn()} />);
    const table = screen.getByRole("table", { name: "Health metrics" });
    expect(table.tagName).toBe("TABLE");
    expect(within(table).getByRole("rowheader")).toHaveAttribute("scope", "rowgroup");
    const row = within(table).getByRole("row", { name: /Open health metrics/ });
    expect(row.tagName).toBe("TR");
    expect(row).toHaveRole("row");
    expect(row).toHaveAttribute("tabindex", "0");
    expect(row).toHaveAttribute("aria-description", "Press Enter or Space to open details.");
    expect(within(row).queryByRole("button")).toBeNull();
    await user.click(within(row).getByText("2026-08-19"));
    expect(open).toHaveBeenCalledOnce();
    open.mockClear();
    row.focus();
    for (const key of ["Enter", " ", "Space"]) {
      fireEvent.keyDown(row, { key });
      expect(open).toHaveBeenCalledOnce();
      open.mockClear();
    }
    const checkbox = within(table).getByRole("checkbox", { name: /Select health metrics for/ });
    await user.click(checkbox);
    fireEvent.keyDown(checkbox, { key: "Enter" });
    fireEvent.keyDown(checkbox, { key: " " });
    expect(open).not.toHaveBeenCalled();
  });

  it("builds group candidates from unfiltered active Metrics truth", async () => {
    const user = userEvent.setup();
    const older = { ...weight, id: "weight-old", occurredAt: "2026-07-20T03:00:00Z" };
    const settings = defaultHealthTableSettings("health.metrics");
    settings.filterRules = [{ id: "none", field: "weight", type: "number",
      operator: "greater_than", value: "999" }];
    settings.groupSettings.groupBy = "month";
    const summaries = vi.spyOn(healthApi, "tableGroups").mockResolvedValue([
      { key: "2026-08", label: "August 2026", count: 250 },
      { key: "2026-07", label: "July 2026", count: 1 },
    ]);
    render(<HealthMetricsPanel controller={panelController([weight, older], settings)}
      tombstonedIds={new Set()} onArchiveCommitted={vi.fn()} refreshWarning={null}
      refreshPending={false} onRetryRefresh={vi.fn()} />);
    expect(screen.getByText("No health metrics match this view.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Group Health Metrics" }));
    const dialog = screen.getByRole("dialog", { name: "Group Health Metrics" });
    expect(await within(dialog).findByText("August 2026")).toBeInTheDocument();
    expect(within(dialog).getByText("July 2026")).toBeInTheDocument();
    expect(within(dialog).getByText("250")).toBeInTheDocument();
    expect(summaries).toHaveBeenCalledWith("health.metrics", expect.objectContaining({ filterRules: [] }));
  });

  it("deduplicates duplicate grouped occurrences for selection and one daily archive", async () => {
    const user = userEvent.setup();
    const projected = deriveHealthMetricsGroups([weight],
      defaultHealthTableSettings("health.metrics"))[0].rows[0];
    vi.spyOn(healthMetricsTableModel, "deriveHealthMetricsGroups").mockReturnValue([
      { key: "first", label: "First", rows: [projected] },
      { key: "second", label: "Second", rows: [projected] },
    ]);
    const health = panelController([weight]);
    render(<HealthMetricsPanel controller={health} tombstonedIds={new Set()}
      onArchiveCommitted={vi.fn()} refreshWarning={null} refreshPending={false}
      onRetryRefresh={vi.fn()} />);
    expect(screen.getAllByRole("checkbox", { name: /Select health metrics for/ })).toHaveLength(2);
    await user.click(screen.getByRole("checkbox", { name: "Select all visible health metrics" }));
    await user.click(screen.getByRole("button", { name: "Archive selected health metrics entries" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("1 health metric dates");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(health.saveMetrics).toHaveBeenCalledOnce());
  });

  it("keeps the archive snapshot through an in-flight filtered authoritative rerender", async () => {
    const user = userEvent.setup();
    const pending = deferred<void>();
    const newer = { ...weight, id: "weight-2", occurredAt: "2026-08-20T03:00:00Z",
      updatedAt: "2026-08-20T03:00:00Z" };
    const health = panelController([weight, newer]);
    vi.mocked(health.saveMetrics).mockImplementationOnce(() => pending.promise)
      .mockResolvedValueOnce(undefined);
    const view = render(<HealthMetricsPanel controller={health} tombstonedIds={new Set()}
      onArchiveCommitted={vi.fn()} refreshWarning={null} refreshPending={false}
      onRetryRefresh={vi.fn()} />);
    await user.click(screen.getByRole("checkbox", { name: "Select all visible health metrics" }));
    await user.click(screen.getByRole("button", { name: "Archive selected health metrics entries" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Archive" }));
    expect(health.saveMetrics).toHaveBeenNthCalledWith(1, { metrics: [], archives: [
      { id: "weight-2", expectedUpdatedAt: newer.updatedAt },
    ] });
    const hidden = panelController([], { ...defaultHealthTableSettings("health.metrics"),
      filterRules: [{ id: "none", field: "weight", type: "number",
        operator: "greater_than", value: "999" }] });
    hidden.saveMetrics = health.saveMetrics;
    view.rerender(<HealthMetricsPanel controller={hidden} tombstonedIds={new Set()}
      onArchiveCommitted={vi.fn()} refreshWarning={null} refreshPending={false}
      onRetryRefresh={vi.fn()} />);
    await act(async () => pending.resolve());
    await waitFor(() => expect(health.saveMetrics).toHaveBeenNthCalledWith(2, {
      metrics: [], archives: [{ id: "weight-1", expectedUpdatedAt: weight.updatedAt }],
    }));
  });

  it("stops committed archive recovery, retains unattempted dates, and never resubmits", async () => {
    const user = userEvent.setup();
    const newer = { ...weight, id: "weight-2", occurredAt: "2026-08-20T03:00:00Z" };
    const health = panelController([weight, newer]);
    vi.mocked(health.saveMetrics).mockRejectedValue(new HealthMutationRefreshError());
    const committed = vi.fn();
    const retry = vi.fn(async () => false);
    render(<HealthMetricsPanel controller={health} tombstonedIds={new Set()}
      onArchiveCommitted={committed} refreshWarning="Changes were saved, but Health could not refresh."
      refreshPending={false} onRetryRefresh={retry} />);
    await user.click(screen.getByRole("checkbox", { name: "Select all visible health metrics" }));
    await user.click(screen.getByRole("button", { name: "Archive selected health metrics entries" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(committed).toHaveBeenCalledWith(["weight-2"], expect.any(String)));
    expect(health.saveMetrics).toHaveBeenCalledOnce();
    expect(screen.getByRole("checkbox", { name: /2026-08-19/ })).toBeChecked();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledOnce();
    expect(health.saveMetrics).toHaveBeenCalledOnce();
  });

  it("returns cancel and ordinary failure to Delete and full success to Add", async () => {
    const user = userEvent.setup();
    const health = panelController([weight]);
    render(<HealthMetricsPanel controller={health} tombstonedIds={new Set()}
      onArchiveCommitted={vi.fn()} refreshWarning={null} refreshPending={false}
      onRetryRefresh={vi.fn()} />);
    await user.click(screen.getByRole("checkbox", { name: /Select health metrics for/ }));
    const remove = screen.getByRole("button", { name: "Archive selected health metrics entries" });
    await user.click(remove);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(remove).toHaveFocus());
    vi.mocked(health.saveMetrics).mockRejectedValueOnce(new Error("failed"));
    await user.click(remove);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(remove).toHaveFocus());
    vi.mocked(health.saveMetrics).mockResolvedValueOnce(undefined);
    await user.click(remove);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Add health metrics entry" }))
      .toHaveFocus());
  });
});
