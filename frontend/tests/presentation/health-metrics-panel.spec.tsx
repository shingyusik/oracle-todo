import "@testing-library/jest-dom/vitest";

import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { healthApi, type DailyMetricsMutation } from "@/features/health/api/health-api";
import {
  HealthMutationRefreshError,
  useHealthController,
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
const mutation: DailyMetricsMutation = {
  metrics: [{ occurredAt: event.occurredAt, details: {
    kind: "lab", key: "crp", name: "CRP", value: 0.4, unit: "mg/L",
  } }],
  archives: [],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function controlHistoryForward() {
  const forward = window.history.forward.bind(window.history);
  const pending: Array<() => void> = [];
  const spy = vi.spyOn(window.history, "forward").mockImplementation(() => pending.push(forward));
  return { spy, async releaseNext() {
    const next = pending.shift();
    if (!next) throw new Error("No pending history.forward() call");
    const popped = new Promise<void>((resolve) =>
      window.addEventListener("popstate", () => resolve(), { once: true }));
    await act(async () => { next(); await popped; });
  } };
}

function mockBaseReads() {
  vi.spyOn(healthApi, "listDiet").mockResolvedValue([]);
  vi.spyOn(healthApi, "listEvents").mockResolvedValue([]);
  vi.spyOn(healthApi, "reports").mockResolvedValue({} as never);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));
}

async function mountedController() {
  const hook = renderHook(() => useHealthController());
  await waitFor(() => expect(hook.result.current.state.metricsStatus).toBe("loaded"));
  return hook;
}

describe("Health Metrics controller", () => {
  afterEach(() => vi.restoreAllMocks());

  it("drains 200-row daily pages and retains raw API events", async () => {
    mockBaseReads();
    const page = Array.from({ length: 200 }, (_, index) => index === 199
      ? { ...event, id: "custom-daily", metricKey: "custom_lab", name: "Custom lab" }
      : { ...event, id: `metric-${index}` });
    let calls = 0;
    vi.mocked(healthApi.listEvents).mockImplementation(async (query) =>
      query?.dailyOnly && calls++ === 0 ? page : []);

    const { result } = renderHook(() => useHealthController());
    await waitFor(() => expect(result.current.state.metricsStatus).toBe("loaded"));

    expect(vi.mocked(healthApi.listEvents).mock.calls.filter(([query]) => query?.dailyOnly))
      .toEqual([[{ dailyOnly: true, limit: 200, offset: 0 }], [{ dailyOnly: true, limit: 200, offset: 200 }]]);
    expect(result.current.state.metricsEntries).toEqual(page);
  });

  it("coalesces ordinary refreshes and keeps loaded rows on failure", async () => {
    mockBaseReads();
    vi.mocked(healthApi.listEvents).mockImplementation(async (query) => query?.dailyOnly ? [event] : []);
    const { result } = await mountedController();
    const pending = deferred<HealthEvent[]>();
    vi.mocked(healthApi.listEvents).mockImplementation((query) =>
      query?.dailyOnly ? pending.promise : Promise.resolve([])).mockClear();
    let first!: Promise<boolean>; let second!: Promise<boolean>;
    await act(async () => { first = result.current.refreshMetrics(); second = result.current.refreshMetrics(); await Promise.resolve(); });
    expect(vi.mocked(healthApi.listEvents).mock.calls.filter(([query]) => query?.dailyOnly)).toHaveLength(1);
    await act(async () => pending.reject(new Error("Metrics unavailable")));
    await expect(first).resolves.toBe(false); await expect(second).resolves.toBe(false);
    expect(result.current.state).toMatchObject({
      metricsStatus: "loaded", metricsError: "Metrics unavailable", metricsEntries: [event],
    });
    vi.mocked(healthApi.listEvents).mockImplementation(async (query) => query?.dailyOnly ? [event] : []);
    await act(async () => expect(result.current.refreshMetrics()).resolves.toBe(true));
    expect(result.current.state.metricsError).toBeNull();
  });

  it.each(["success", "error"] as const)("ignores stale %s after a forced mutation refresh", async (outcome) => {
    mockBaseReads(); const { result } = await mountedController();
    const older = deferred<HealthEvent[]>(); const newer = deferred<HealthEvent[]>();
    vi.mocked(healthApi.listEvents).mockImplementation((query) => {
      if (!query?.dailyOnly) return Promise.resolve([]);
      return vi.mocked(healthApi.listEvents).mock.calls.filter(([item]) => item?.dailyOnly).length === 1
        ? older.promise : newer.promise;
    }).mockClear();
    vi.spyOn(healthApi, "saveDailyMetrics").mockResolvedValue([event]);
    let stale!: Promise<boolean>; let saved!: Promise<void>;
    await act(async () => { stale = result.current.refreshMetrics(); await Promise.resolve(); saved = result.current.saveMetrics(mutation); await Promise.resolve(); });
    const savedOutcome = saved.then(() => true, (error: unknown) => error);
    await act(async () => newer.resolve([event]));
    await act(async () => outcome === "success" ? older.resolve([{ ...event, id: "stale" }]) : older.reject(new Error("stale")));
    await expect(stale).resolves.toBe(true); await expect(savedOutcome).resolves.toBe(true);
    expect(result.current.state.metricsEntries).toEqual([event]);
    expect(result.current.state.metricsError).toBeNull();
  });

  it("uses one atomic mutation and exactly one Metrics read", async () => {
    mockBaseReads(); const save = vi.spyOn(healthApi, "saveDailyMetrics").mockResolvedValue([event]);
    const { result } = await mountedController();
    vi.mocked(healthApi.listEvents).mockClear();

    await act(async () => result.current.saveMetrics(mutation));

    expect(save).toHaveBeenCalledOnce(); expect(save).toHaveBeenCalledWith(mutation);
    expect(vi.mocked(healthApi.listEvents).mock.calls.filter(([query]) => query?.dailyOnly)).toHaveLength(1);
    expect(healthApi.reports).not.toHaveBeenCalled();
  });

  it.each([true, false])("makes an older Metrics mutation adopt the newer outcome (success: %s)", async (newerOk) => {
    mockBaseReads(); vi.spyOn(healthApi, "saveDailyMetrics").mockResolvedValue([event]);
    const { result } = await mountedController();
    const olderMetrics = deferred<HealthEvent[]>(); const newerMetrics = deferred<HealthEvent[]>();
    vi.mocked(healthApi.listEvents).mockReset()
      .mockImplementationOnce(() => olderMetrics.promise).mockImplementationOnce(() => newerMetrics.promise);
    let first!: Promise<void>; let second!: Promise<void>;
    await act(async () => { first = result.current.saveMetrics(mutation); await Promise.resolve(); second = result.current.saveMetrics(mutation); await Promise.resolve(); });
    const outcomes = [first, second].map((promise) => promise.then(() => true, (error: unknown) => error));
    await act(async () => {
      if (newerOk) newerMetrics.resolve([event]); else newerMetrics.reject(new Error("newer failed"));
    });
    await act(async () => { olderMetrics.resolve([{ ...event, id: "stale" }]); });
    for (const outcome of outcomes) {
      if (newerOk) await expect(outcome).resolves.toBe(true);
      else await expect(outcome).resolves.toBeInstanceOf(HealthMutationRefreshError);
    }
    expect(result.current.state.metricsEntries).toEqual(newerOk ? [event] : []);
  });

  it("recovers a committed mutation after the Metrics read fails without resubmitting", async () => {
    mockBaseReads(); const save = vi.spyOn(healthApi, "saveDailyMetrics").mockResolvedValue([event]);
    const { result } = await mountedController();
    vi.mocked(healthApi.listEvents).mockClear();
    vi.mocked(healthApi.listEvents).mockRejectedValueOnce(new Error("failed"));

    await act(async () => expect(result.current.saveMetrics(mutation)).rejects.toBeInstanceOf(HealthMutationRefreshError));
    await act(async () => expect(result.current.refreshMetrics()).resolves.toBe(true));

    expect(save).toHaveBeenCalledOnce();
    expect(vi.mocked(healthApi.listEvents).mock.calls.filter(([query]) => query?.dailyOnly)).toHaveLength(2);
  });

  it("includes Metrics once in aggregate refresh and excludes it from category mutations", async () => {
    mockBaseReads(); vi.spyOn(healthApi, "createEvent").mockResolvedValue(event);
    const { result } = await mountedController();
    vi.mocked(healthApi.listEvents).mockClear();
    await act(async () => expect(result.current.refresh()).resolves.toBe(true));
    expect(vi.mocked(healthApi.listEvents).mock.calls.filter(([query]) => query?.dailyOnly)).toHaveLength(1);
    vi.mocked(healthApi.listEvents).mockClear();
    await act(async () => result.current.createBowel({ occurredAt: event.occurredAt,
      details: { kind: "bowel", bristolScale: 4, bloodVisible: false } }));
    expect(vi.mocked(healthApi.listEvents).mock.calls.filter(([query]) => query?.dailyOnly)).toHaveLength(0);
  });

  it.each(["diet", "bowel", "medication"] as const)("does not leak a daily-only read into %s mutations", async (kind) => {
    mockBaseReads();
    vi.spyOn(healthApi, "createDiet").mockResolvedValue({
      id: "diet-1", occurredAt: event.occurredAt, mealType: "lunch", foodName: "Rice",
      note: null, tags: [], mediaId: null, createdAt: event.createdAt,
      updatedAt: event.updatedAt, deletedAt: null,
    });
    vi.spyOn(healthApi, "createEvent").mockResolvedValue(event);
    const { result } = await mountedController();
    vi.mocked(healthApi.listEvents).mockClear();
    await act(async () => {
      if (kind === "diet") await result.current.createDiet({
        occurredAt: event.occurredAt, mealType: "lunch", foodName: "Rice",
      });
      else if (kind === "bowel") await result.current.createBowel({
        occurredAt: event.occurredAt,
        details: { kind: "bowel", bristolScale: 4, bloodVisible: false },
      });
      else if (kind === "medication") await result.current.createMedication({
        occurredAt: event.occurredAt,
        details: { kind: "medication", medicationName: "Vitamin D", dose: 1, unit: "tablet" },
      });
    });
    expect(vi.mocked(healthApi.listEvents).mock.calls.filter(([query]) => query?.dailyOnly)).toHaveLength(0);
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
    tableIsDirty: vi.fn(() => false), updateTableSettings: vi.fn(), selectTableTab: vi.fn(),
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

describe("Health Metrics table", () => {
  afterEach(() => vi.restoreAllMocks());

  it("opens a daily detail and saves one changed metric plus one cleared metric atomically", async () => {
    const user = userEvent.setup();
    const health = panelController();
    render(<HealthMetricsPanel controller={health} tombstonedIds={new Set()}
      onArchiveCommitted={vi.fn()} refreshWarning={null} refreshPending={false}
      onRetryRefresh={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Open health metrics for 2026-08-19" }));
    expect(screen.getByRole("heading", { name: "Health Metrics · 2026-08-19" })).toBeInTheDocument();
    expect(screen.getByText(`Created ${new Date(weight.createdAt).toLocaleString()}`)).toBeInTheDocument();
    expect(screen.getByText(`Updated ${new Date(weight.updatedAt).toLocaleString()}`)).toBeInTheDocument();
    expect(screen.getByLabelText("Date")).toHaveValue("2026-08-19");
    expect(screen.getByLabelText("Weight")).toHaveValue(72.5);
    expect(screen.getByLabelText("Sleep")).toHaveValue(7.5);
    expect(screen.getByLabelText("CRP")).toHaveValue(0.4);
    expect(screen.getByLabelText("Calprotectin")).toHaveValue(120);
    expect(screen.getByLabelText("Condition")).toHaveValue("8");
    expect(screen.getByLabelText("Note")).toHaveValue("Steady");
    expect(["Undo", "Redo", "Save", "Delete"].map((name) =>
      screen.getByRole("button", { name }))).toHaveLength(4);

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
  });

  it("uses canonical dirty state and bounded coalesced history with distinct Condition edits", async () => {
    const user = userEvent.setup();
    render(<HealthMetricsPanel controller={panelController()} tombstonedIds={new Set()}
      onArchiveCommitted={vi.fn()} refreshWarning={null} refreshPending={false}
      onRetryRefresh={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /Open health metrics/ }));
    expect(screen.getByLabelText("Date")).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Weight"), { target: { value: "72.50" } });
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: " Steady " } });
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Weight"), { target: { value: "70" } });
    fireEvent.change(screen.getByLabelText("Weight"), { target: { value: "69" } });
    fireEvent.blur(screen.getByLabelText("Weight"));
    await user.selectOptions(screen.getByLabelText("Condition"), "7");
    await user.selectOptions(screen.getByLabelText("Condition"), "6");
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByLabelText("Condition")).toHaveValue("7");
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(screen.getByLabelText("Condition")).toHaveValue("8");
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(screen.getByLabelText("Weight")).toHaveValue(72.5);
    fireEvent.keyDown(window, { key: "y", ctrlKey: true });
    expect(screen.getByLabelText("Weight")).toHaveValue(69);
    fireEvent.change(screen.getByLabelText("Sleep"), { target: { value: "8" } });
    fireEvent.keyDown(window, { key: "z", metaKey: true });
    expect(screen.getByLabelText("Sleep")).toHaveValue(7.5);
    fireEvent.keyDown(window, { key: "z", metaKey: true, shiftKey: true });
    expect(screen.getByLabelText("Sleep")).toHaveValue(8);
    fireEvent.keyDown(window, { key: "z", metaKey: true });
    fireEvent.change(screen.getByLabelText("Sleep"), { target: { value: "9" } });
    expect(screen.getByRole("button", { name: "Redo" })).toBeDisabled();

    for (let index = 0; index < 52; index += 1) {
      fireEvent.change(screen.getByLabelText("Condition"), {
        target: { value: String(index % 2 ? 9 : 10) },
      });
    }
    for (let index = 0; index < 50; index += 1) {
      fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    }
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
    expect(screen.getByLabelText("Weight")).toHaveValue(69);
  });

  it("clears and restores Condition plus Note as one atomic history transition", async () => {
    const user = userEvent.setup();
    render(<HealthMetricsPanel controller={panelController()} tombstonedIds={new Set()}
      onArchiveCommitted={vi.fn()} refreshWarning={null} refreshPending={false}
      onRetryRefresh={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /Open health metrics/ }));
    await user.selectOptions(screen.getByLabelText("Condition"), "");
    expect(screen.getByLabelText("Condition")).toHaveValue("");
    expect(screen.getByLabelText("Note")).toHaveValue("");
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByLabelText("Condition")).toHaveValue("8");
    expect(screen.getByLabelText("Note")).toHaveValue("Steady");
    fireEvent.keyDown(window, { key: "z", metaKey: true, shiftKey: true });
    expect(screen.getByLabelText("Condition")).toHaveValue("");
    expect(screen.getByLabelText("Note")).toHaveValue("");
  });

  it("isolates one Metrics browser entry and traverses clean Back and Forward without a push loop", async () => {
    const user = userEvent.setup();
    window.history.replaceState({ __ravenHealthDietDetailId: "keep-diet" }, "");
    const push = vi.spyOn(window.history, "pushState");
    render(<HealthMetricsPanel controller={panelController()} tombstonedIds={new Set()}
      onArchiveCommitted={vi.fn()} refreshWarning={null} refreshPending={false}
      onRetryRefresh={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /Open health metrics/ }));
    expect(push).toHaveBeenCalledOnce();
    expect(window.history.state).toMatchObject({
      __ravenHealthDietDetailId: "keep-diet",
      __ravenHealthMetricsDetailDate: "2026-08-19",
    });
    act(() => window.history.back());
    await screen.findByRole("button", { name: /Open health metrics/ });
    act(() => window.history.forward());
    await screen.findByRole("heading", { name: "Health Metrics · 2026-08-19" });
    expect(push).toHaveBeenCalledOnce();
  });

  it("retains detail on ordinary archive failure and tombstones a committed archive without resubmission", async () => {
    const user = userEvent.setup();
    const health = panelController();
    vi.mocked(health.saveMetrics).mockRejectedValueOnce(new Error("archive failed"))
      .mockRejectedValueOnce(new HealthMutationRefreshError());
    const committed = vi.fn();
    const view = render(<HealthMetricsPanel controller={health} tombstonedIds={new Set()}
      onArchiveCommitted={committed} refreshWarning={null} refreshPending={false}
      onRetryRefresh={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /Open health metrics/ }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Archive" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("archive failed");
    expect(health.saveMetrics).toHaveBeenNthCalledWith(1, { metrics: [], archives: [
      { id: "weight-1", expectedUpdatedAt: weight.updatedAt },
      { id: "sleep-1", expectedUpdatedAt: sleep.updatedAt },
      { id: "metric-1", expectedUpdatedAt: event.updatedAt },
      { id: "calprotectin-1", expectedUpdatedAt: calprotectin.updatedAt },
      { id: "condition-1", expectedUpdatedAt: condition.updatedAt },
    ] });
    expect(screen.getByLabelText("Weight")).toHaveValue(72.5);
    await waitFor(() => expect(screen.getByRole("button", { name: "Delete" })).toHaveFocus());

    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(committed).toHaveBeenCalledWith(
      ["weight-1", "sleep-1", "metric-1", "calprotectin-1", "condition-1"],
      expect.any(String),
    ));
    expect(health.saveMetrics).toHaveBeenCalledTimes(2);
    view.unmount();
    expect(window.history.state.__ravenHealthMetricsDetailDate).toBeNull();
  });

  it.each([
    ["Weight", "71", { kind: "weight", value: 71, unit: "kg" }, weight.updatedAt],
    ["Sleep", "8", { kind: "sleep", value: 8 }, sleep.updatedAt],
    ["CRP", "1.2", { kind: "lab", key: "crp", name: "CRP", value: 1.2, unit: "mg/L" }, event.updatedAt],
    ["Calprotectin", "100", { kind: "lab", key: "fecal_calprotectin",
      name: "Fecal calprotectin", value: 100, unit: "µg/g" }, calprotectin.updatedAt],
  ] as const)("sends only changed %s with its immutable optimistic version",
    async (label, next, details, expectedUpdatedAt) => {
      const user = userEvent.setup();
      const health = panelController();
      render(<HealthMetricsPanel controller={health} tombstonedIds={new Set()}
        onArchiveCommitted={vi.fn()} refreshWarning={null} refreshPending={false}
        onRetryRefresh={vi.fn()} />);
      await user.click(screen.getByRole("button", { name: /Open health metrics/ }));
      fireEvent.change(screen.getByLabelText(label), { target: { value: next } });
      await user.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(health.saveMetrics).toHaveBeenCalledWith({ metrics: [{
        occurredAt: expect.any(String), details, expectedUpdatedAt,
      }], archives: [] }));
    });

  it("sends Condition and trimmed Note together while omitting every unchanged identity", async () => {
    const user = userEvent.setup();
    const health = panelController();
    render(<HealthMetricsPanel controller={health} tombstonedIds={new Set()}
      onArchiveCommitted={vi.fn()} refreshWarning={null} refreshPending={false}
      onRetryRefresh={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /Open health metrics/ }));
    await user.clear(screen.getByLabelText("Note"));
    await user.type(screen.getByLabelText("Note"), "  Better  ");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(health.saveMetrics).toHaveBeenCalledWith({ metrics: [{
      occurredAt: expect.any(String), expectedUpdatedAt: condition.updatedAt,
      details: { kind: "overall_condition", score: 8, conditionNote: "Better" },
    }], archives: [] }));
  });

  it("sends a Condition-only edit with the fixed detail and immutable version", async () => {
    const user = userEvent.setup();
    const health = panelController();
    render(<HealthMetricsPanel controller={health} tombstonedIds={new Set()}
      onArchiveCommitted={vi.fn()} refreshWarning={null} refreshPending={false}
      onRetryRefresh={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /Open health metrics/ }));
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
    render(<HealthMetricsPanel controller={health} tombstonedIds={new Set()}
      onArchiveCommitted={vi.fn()} refreshWarning={null} refreshPending={false}
      onRetryRefresh={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /Open health metrics/ }));
    fireEvent.change(screen.getByLabelText("CRP"), { target: { value: "1.5" } });
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(health.saveMetrics).toHaveBeenCalledOnce());
    const input = vi.mocked(health.saveMetrics).mock.calls[0][0].metrics[0];
    expect(input).toMatchObject({ occurredAt: expect.any(String),
      details: { kind: "lab", key: "crp", name: "CRP", value: 1.5, unit: "mg/L" } });
    expect(input).not.toHaveProperty("expectedUpdatedAt");
  });

  it("keeps opened member values and versions immutable across same-date refreshes and filters", async () => {
    const user = userEvent.setup();
    const original = panelController();
    const view = render(<HealthMetricsPanel controller={original} tombstonedIds={new Set()}
      onArchiveCommitted={vi.fn()} refreshWarning={null} refreshPending={false}
      onRetryRefresh={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /Open health metrics/ }));
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

  it("falls focus from the exact occurrence to the same date after regrouping, then Add after removal", async () => {
    const user = userEvent.setup();
    const plain = panelController([weight]);
    const view = render(<HealthMetricsPanel controller={plain} tombstonedIds={new Set()}
      onArchiveCommitted={vi.fn()} refreshWarning={null} refreshPending={false}
      onRetryRefresh={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /Open health metrics/ }));
    const groupedSettings = defaultHealthTableSettings("health.metrics");
    groupedSettings.groupSettings.groupBy = "month";
    const grouped = panelController([weight], groupedSettings);
    view.rerender(<HealthMetricsPanel controller={grouped} tombstonedIds={new Set()}
      onArchiveCommitted={vi.fn()} refreshWarning={null} refreshPending={false}
      onRetryRefresh={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "< Back" }));
    const sameDate = await screen.findByRole("button", { name: /Open health metrics/ });
    expect(sameDate.dataset.healthMetricsOccurrence).not.toBe("all-2026-08-19-0");
    await waitFor(() => expect(sameDate).toHaveFocus());
    await user.click(sameDate);
    view.rerender(<HealthMetricsPanel controller={grouped} tombstonedIds={new Set([weight.id])}
      onArchiveCommitted={vi.fn()} refreshWarning={null} refreshPending={false}
      onRetryRefresh={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Add health metrics entry" }))
      .toHaveFocus());
  });

  it("blocks all-empty and invalid drafts, IME shortcuts, and duplicate pending saves", async () => {
    const user = userEvent.setup();
    const pending = deferred<void>();
    const health = panelController();
    vi.mocked(health.saveMetrics).mockImplementation(() => pending.promise);
    render(<HealthMetricsPanel controller={health} tombstonedIds={new Set()}
      onArchiveCommitted={vi.fn()} refreshWarning={null} refreshPending={false}
      onRetryRefresh={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /Open health metrics/ }));
    for (const label of ["Weight", "Sleep", "CRP", "Calprotectin"]) {
      fireEvent.change(screen.getByLabelText(label), { target: { value: "" } });
    }
    await user.selectOptions(screen.getByLabelText("Condition"), "");
    expect(screen.getByLabelText("Note")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    expect(health.saveMetrics).not.toHaveBeenCalled();
    for (const [label, invalid] of [["Weight", "0"], ["Sleep", "25"], ["CRP", "-1"],
      ["Calprotectin", "-1"]] as const) {
      fireEvent.change(screen.getByLabelText(label), { target: { value: invalid } });
      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
      fireEvent.change(screen.getByLabelText(label), { target: { value: "" } });
    }
    fireEvent.change(screen.getByLabelText("Weight"), { target: { value: "70" } });
    fireEvent.keyDown(window, { key: "s", ctrlKey: true, isComposing: true });
    expect(health.saveMetrics).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "s", metaKey: true });
    await waitFor(() => expect(health.saveMetrics).toHaveBeenCalledOnce());
    for (const name of ["< Back", "Undo", "Redo", "Save", "Delete"]) {
      expect(screen.getByRole("button", { name })).toBeDisabled();
    }
    for (const label of ["Date", "Weight", "Sleep", "CRP", "Calprotectin", "Condition", "Note"]) {
      expect(screen.getByLabelText(label)).toBeDisabled();
    }
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    expect(health.saveMetrics).toHaveBeenCalledOnce();
    await act(async () => pending.resolve());
  });

  it("retains draft/history after ordinary save failure and refreshes a committed save without resubmission", async () => {
    const user = userEvent.setup();
    const health = panelController();
    vi.mocked(health.saveMetrics).mockRejectedValueOnce(new Error("save failed"))
      .mockRejectedValueOnce(new HealthMutationRefreshError());
    vi.mocked(health.refreshMetrics).mockResolvedValue(false);
    render(<HealthMetricsPanel controller={health} tombstonedIds={new Set()}
      onArchiveCommitted={vi.fn()} refreshWarning={null} refreshPending={false}
      onRetryRefresh={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /Open health metrics/ }));
    fireEvent.change(screen.getByLabelText("Weight"), { target: { value: "70" } });
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("save failed");
    expect(screen.getByLabelText("Weight")).toHaveValue(70);
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByLabelText("Weight")).toHaveValue(72.5);
    fireEvent.change(screen.getByLabelText("Weight"), { target: { value: "69" } });
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("button", { name: "Retry" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(health.refreshMetrics).toHaveBeenCalledOnce();
    expect(health.saveMetrics).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText("Weight")).toHaveValue(69);
  });

  it("repairs dirty browser Back on cancel and discard, then restores the exact table occurrence", async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, "");
    render(<HealthMetricsPanel controller={panelController()} tombstonedIds={new Set()}
      onArchiveCommitted={vi.fn()} refreshWarning={null} refreshPending={false}
      onRetryRefresh={vi.fn()} />);
    const origin = screen.getByRole("button", { name: /Open health metrics/ });
    await user.click(origin);
    await user.type(screen.getByLabelText("Note"), " draft");
    act(() => window.history.back());
    let dialog = await screen.findByRole("dialog", { name: "Discard unsaved changes?" });
    for (const name of ["< Back", "Undo", "Redo", "Save", "Delete"]) {
      expect(screen.getByRole("button", { name, hidden: true })).toBeDisabled();
    }
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "< Back" })).toHaveFocus());
    act(() => window.history.back());
    dialog = await screen.findByRole("dialog", { name: "Discard unsaved changes?" });
    await user.click(within(dialog).getByRole("button", { name: "Discard changes" }));
    const restored = await screen.findByRole("button", { name: /Open health metrics/ });
    await waitFor(() => expect(restored).toHaveFocus());
  });

  it("defers a pending save settlement until browser-pop restoration completes", async () => {
    const user = userEvent.setup();
    window.history.pushState({}, "");
    const controlled = controlHistoryForward();
    const saved = deferred<void>();
    const health = panelController();
    vi.mocked(health.saveMetrics).mockImplementation(() => saved.promise);
    render(<HealthMetricsPanel controller={health} tombstonedIds={new Set()}
      onArchiveCommitted={vi.fn()} refreshWarning={null} refreshPending={false}
      onRetryRefresh={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /Open health metrics/ }));
    fireEvent.change(screen.getByLabelText("Weight"), { target: { value: "70" } });
    await user.click(screen.getByRole("button", { name: "Save" }));
    act(() => window.history.back());
    await waitFor(() => expect(controlled.spy).toHaveBeenCalledOnce());
    await act(async () => saved.resolve());
    expect(screen.getByRole("heading", { name: /Health Metrics ·/ })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Discard unsaved changes?" })).toBeNull();
    await controlled.releaseNext();
    const origin = await screen.findByRole("button", { name: /Open health metrics/ });
    await waitFor(() => expect(origin).toHaveFocus());
    expect(health.saveMetrics).toHaveBeenCalledOnce();
  });

  it.each(["ordinary", "committed"] as const)(
    "defers %s save failure until browser-pop restoration completes",
    async (outcome) => {
      const user = userEvent.setup();
      window.history.pushState({}, "");
      const controlled = controlHistoryForward();
      const saved = deferred<void>();
      const health = panelController();
      vi.mocked(health.saveMetrics).mockImplementation(() => saved.promise);
      render(<HealthMetricsPanel controller={health} tombstonedIds={new Set()}
        onArchiveCommitted={vi.fn()} refreshWarning={null} refreshPending={false}
        onRetryRefresh={vi.fn()} />);
      await user.click(screen.getByRole("button", { name: /Open health metrics/ }));
      fireEvent.change(screen.getByLabelText("Weight"), { target: { value: "70" } });
      await user.click(screen.getByRole("button", { name: "Save" }));
      act(() => window.history.back());
      await waitFor(() => expect(controlled.spy).toHaveBeenCalledOnce());
      await act(async () => saved.reject(outcome === "ordinary"
        ? new Error("save unavailable") : new HealthMutationRefreshError()));
      expect(screen.queryByRole("alert")).toBeNull();
      await controlled.releaseNext();
      expect(await screen.findByRole("alert")).toHaveTextContent(outcome === "ordinary"
        ? "save unavailable" : "Changes were saved, but Health could not refresh.");
      if (outcome === "ordinary") expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
      else expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
      expect(health.saveMetrics).toHaveBeenCalledOnce();
    },
  );

  it("defers refresh-recovery Retry=false until browser-pop restoration completes", async () => {
    const user = userEvent.setup();
    window.history.pushState({}, "");
    const controlled = controlHistoryForward();
    const refreshed = deferred<boolean>();
    const health = panelController();
    vi.mocked(health.saveMetrics).mockRejectedValue(new HealthMutationRefreshError());
    vi.mocked(health.refreshMetrics).mockImplementation(() => refreshed.promise);
    render(<HealthMetricsPanel controller={health} tombstonedIds={new Set()}
      onArchiveCommitted={vi.fn()} refreshWarning={null} refreshPending={false}
      onRetryRefresh={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /Open health metrics/ }));
    fireEvent.change(screen.getByLabelText("Weight"), { target: { value: "70" } });
    await user.click(screen.getByRole("button", { name: "Save" }));
    await user.click(await screen.findByRole("button", { name: "Retry" }));
    act(() => window.history.back());
    await waitFor(() => expect(controlled.spy).toHaveBeenCalledOnce());
    await act(async () => refreshed.resolve(false));
    expect(screen.getByRole("button", { name: "Retry" })).toBeDisabled();
    await controlled.releaseNext();
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled());
    expect(health.saveMetrics).toHaveBeenCalledOnce();
    expect(health.refreshMetrics).toHaveBeenCalledOnce();
  });

  it("defers refresh-recovery Retry=true close until browser-pop restoration completes", async () => {
    const user = userEvent.setup();
    window.history.pushState({}, "");
    const controlled = controlHistoryForward();
    const refreshed = deferred<boolean>();
    const health = panelController();
    vi.mocked(health.saveMetrics).mockRejectedValue(new HealthMutationRefreshError());
    vi.mocked(health.refreshMetrics).mockImplementation(() => refreshed.promise);
    render(<HealthMetricsPanel controller={health} tombstonedIds={new Set()}
      onArchiveCommitted={vi.fn()} refreshWarning={null} refreshPending={false}
      onRetryRefresh={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /Open health metrics/ }));
    fireEvent.change(screen.getByLabelText("Weight"), { target: { value: "70" } });
    await user.click(screen.getByRole("button", { name: "Save" }));
    await user.click(await screen.findByRole("button", { name: "Retry" }));
    act(() => window.history.back());
    await waitFor(() => expect(controlled.spy).toHaveBeenCalledOnce());
    await act(async () => refreshed.resolve(true));
    expect(screen.getByRole("heading", { name: /Health Metrics ·/ })).toBeInTheDocument();
    await controlled.releaseNext();
    await screen.findByRole("button", { name: /Open health metrics/ });
    expect(health.saveMetrics).toHaveBeenCalledOnce();
    expect(health.refreshMetrics).toHaveBeenCalledOnce();
  });

  it("defers committed archive recovery until browser-pop restoration and never repeats Delete", async () => {
    const user = userEvent.setup();
    window.history.pushState({}, "");
    const controlled = controlHistoryForward();
    const archived = deferred<void>();
    const health = panelController();
    vi.mocked(health.saveMetrics).mockImplementation(() => archived.promise);
    const committed = vi.fn();
    render(<HealthMetricsPanel controller={health} tombstonedIds={new Set()}
      onArchiveCommitted={committed} refreshWarning={null} refreshPending={false}
      onRetryRefresh={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /Open health metrics/ }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Archive" }));
    act(() => window.history.back());
    await waitFor(() => expect(controlled.spy).toHaveBeenCalledOnce());
    await act(async () => archived.reject(new HealthMutationRefreshError()));
    expect(screen.getByRole("dialog", { name: /Archive Health Metrics/ })).toBeInTheDocument();
    expect(committed).not.toHaveBeenCalled();
    await controlled.releaseNext();
    await waitFor(() => expect(committed).toHaveBeenCalledOnce());
    expect(health.saveMetrics).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.getByRole("button", { name: /Open health metrics/ }))
      .toHaveFocus());
  });

  it("defers ordinary archive success until browser-pop restoration completes", async () => {
    const user = userEvent.setup();
    window.history.pushState({}, "");
    const controlled = controlHistoryForward();
    const archived = deferred<void>();
    const health = panelController();
    vi.mocked(health.saveMetrics).mockImplementation(() => archived.promise);
    const committed = vi.fn();
    render(<HealthMetricsPanel controller={health} tombstonedIds={new Set()}
      onArchiveCommitted={committed} refreshWarning={null} refreshPending={false}
      onRetryRefresh={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /Open health metrics/ }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Archive" }));
    act(() => window.history.back());
    await waitFor(() => expect(controlled.spy).toHaveBeenCalledOnce());
    await act(async () => archived.resolve());
    expect(committed).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: /Archive Health Metrics/ })).toBeInTheDocument();
    await controlled.releaseNext();
    await waitFor(() => expect(committed).toHaveBeenCalledOnce());
    expect(health.saveMetrics).toHaveBeenCalledOnce();
  });

  it("defers ordinary archive failure cleanup until browser-pop restoration completes", async () => {
    const user = userEvent.setup();
    window.history.pushState({}, "");
    const controlled = controlHistoryForward();
    const archived = deferred<void>();
    const health = panelController();
    vi.mocked(health.saveMetrics).mockImplementation(() => archived.promise);
    render(<HealthMetricsPanel controller={health} tombstonedIds={new Set()}
      onArchiveCommitted={vi.fn()} refreshWarning={null} refreshPending={false}
      onRetryRefresh={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /Open health metrics/ }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Archive" }));
    act(() => window.history.back());
    await waitFor(() => expect(controlled.spy).toHaveBeenCalledOnce());
    await act(async () => archived.reject(new Error("archive unavailable")));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("dialog", { name: /Archive Health Metrics/ })).toBeInTheDocument();
    await controlled.releaseNext();
    expect(await screen.findByRole("alert")).toHaveTextContent("archive unavailable");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Archive Health Metrics/ })).toBeNull());
    await waitFor(() => expect(screen.getByRole("button", { name: "Delete" })).toHaveFocus());
    expect(health.saveMetrics).toHaveBeenCalledOnce();
  });

  it("defers archive cancellation during browser-pop repair and unlocks after restoration", async () => {
    const user = userEvent.setup();
    window.history.pushState({}, "");
    const controlled = controlHistoryForward();
    render(<HealthMetricsPanel controller={panelController()} tombstonedIds={new Set()}
      onArchiveCommitted={vi.fn()} refreshWarning={null} refreshPending={false}
      onRetryRefresh={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /Open health metrics/ }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = screen.getByRole("dialog", { name: /Archive Health Metrics/ });
    act(() => window.history.back());
    await waitFor(() => expect(controlled.spy).toHaveBeenCalledOnce());
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(dialog).toBeInTheDocument();
    await controlled.releaseNext();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Archive Health Metrics/ })).toBeNull());
    expect(screen.getByRole("button", { name: "Delete" })).toBeEnabled();
  });

  it("normalizes stale Forward after authoritative tombstones without reopening detail", async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, "");
    const health = panelController([weight]);
    const view = render(<HealthMetricsPanel controller={health} tombstonedIds={new Set()}
      onArchiveCommitted={vi.fn()} refreshWarning={null} refreshPending={false}
      onRetryRefresh={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /Open health metrics/ }));
    act(() => window.history.back());
    await screen.findByRole("button", { name: /Open health metrics/ });
    view.rerender(<HealthMetricsPanel controller={health} tombstonedIds={new Set([weight.id])}
      onArchiveCommitted={vi.fn()} refreshWarning={null} refreshPending={false}
      onRetryRefresh={vi.fn()} />);
    act(() => window.history.forward());
    await waitFor(() => expect(window.history.state.__ravenHealthMetricsDetailDate).toBeNull());
    expect(screen.queryByRole("heading", { name: /Health Metrics ·/ })).toBeNull();
  });

  it("repairs dirty browser Forward in the exact direction without a traversal loop", async () => {
    const user = userEvent.setup();
    window.history.pushState({ historySide: "back" }, "");
    const back = vi.spyOn(window.history, "back");
    const forward = vi.spyOn(window.history, "forward");
    render(<HealthMetricsPanel controller={panelController()} tombstonedIds={new Set()}
      onArchiveCommitted={vi.fn()} refreshWarning={null} refreshPending={false}
      onRetryRefresh={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /Open health metrics/ }));
    window.history.pushState({ ...window.history.state,
      __ravenHealthMetricsDetailDate: null,
      __ravenHealthMetricsDetailDate__index:
        (window.history.state.__ravenHealthMetricsDetailDate__index as number) + 1,
      historySide: "forward",
    }, "");
    act(() => window.history.back());
    await waitFor(() => expect(window.history.state.__ravenHealthMetricsDetailDate).toBe("2026-08-19"));
    await user.type(screen.getByLabelText("Note"), " forward draft");
    act(() => window.history.forward());
    let dialog = await screen.findByRole("dialog", { name: "Discard unsaved changes?" });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "< Back" })).toHaveFocus());
    act(() => window.history.forward());
    dialog = await screen.findByRole("dialog", { name: "Discard unsaved changes?" });
    await user.click(within(dialog).getByRole("button", { name: "Discard changes" }));
    await screen.findByRole("button", { name: /Open health metrics/ });
    await waitFor(() => expect(window.history.state).toMatchObject({
      __ravenHealthMetricsDetailDate: null, historySide: "forward",
    }));
    expect(forward).toHaveBeenCalledTimes(3);
    expect(back).toHaveBeenCalledTimes(3);
  });

  it("renders the saved-view header and fixed daily columns with units", () => {
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
    expect(screen.getByRole("button", { name: "Add health metrics entry" })).toBeInTheDocument();
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

  it("isolates duplicate occurrence checkboxes from native date buttons", async () => {
    const groups = deriveHealthMetricsGroups([weight], defaultHealthTableSettings("health.metrics"));
    const toggle = vi.fn();
    const open = vi.fn();
    render(<HealthMetricsTable groups={[groups[0], { ...groups[0], key: "duplicate" }]}
      activeRowCount={1} selectedDates={[]} onOpen={open} onToggle={toggle}
      onToggleAll={vi.fn()} />);
    const checkboxes = screen.getAllByRole("checkbox", { name: /Select health metrics for/ });
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes[0].closest("tr")).not.toHaveAttribute("tabindex");
    await userEvent.click(checkboxes[1]);
    expect(toggle).toHaveBeenCalledWith("2026-08-19");
    expect(open).not.toHaveBeenCalled();
    const buttons = screen.getAllByRole("button", { name: /Open health metrics for/ });
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

  it("uses native grouped table semantics and native date activation", async () => {
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
    const button = within(table).getByRole("button", { name: /Open health metrics/ });
    expect(button.closest("tr")).not.toHaveAttribute("tabindex");
    button.focus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    await user.click(button);
    expect(open).toHaveBeenCalledTimes(3);
    open.mockClear();
    await user.click(within(table).getByRole("checkbox", { name: /Select health metrics for/ }));
    expect(open).not.toHaveBeenCalled();
  });

  it("builds group candidates from unfiltered active Metrics truth", async () => {
    const user = userEvent.setup();
    const older = { ...weight, id: "weight-old", occurredAt: "2026-07-20T03:00:00Z" };
    const settings = defaultHealthTableSettings("health.metrics");
    settings.filterRules = [{ id: "none", field: "weight", type: "number",
      operator: "greater_than", value: "999" }];
    settings.groupSettings.groupBy = "month";
    render(<HealthMetricsPanel controller={panelController([weight, older], settings)}
      tombstonedIds={new Set()} onArchiveCommitted={vi.fn()} refreshWarning={null}
      refreshPending={false} onRetryRefresh={vi.fn()} />);
    expect(screen.getByText("No health metrics match this view.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Group Health Metrics" }));
    const dialog = screen.getByRole("dialog", { name: "Group Health Metrics" });
    expect(within(dialog).getByText("August 2026")).toBeInTheDocument();
    expect(within(dialog).getByText("July 2026")).toBeInTheDocument();
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
