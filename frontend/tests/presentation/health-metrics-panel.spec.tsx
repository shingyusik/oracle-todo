import "@testing-library/jest-dom/vitest";

import { act, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { healthApi, type DailyMetricsMutation } from "@/features/health/api/health-api";
import {
  HealthMutationRefreshError,
  useHealthController,
} from "@/features/health/hooks/useHealthController";
import type { HealthEvent, HealthTrends, TimelineItem } from "@/features/health/model/health-model";
import type { HealthController, HealthState } from "@/features/health/hooks/useHealthController";
import { defaultHealthTableSettings } from "@/features/health/model/health-table-views";
import { deriveHealthMetricsGroups } from "@/features/health/model/health-metrics-table";
import { HealthMetricsPanel } from "@/features/health/ui/HealthMetricsPanel";
import { HealthMetricsTable } from "@/features/health/ui/HealthMetricsTable";

const event: HealthEvent = {
  id: "metric-1", occurredAt: "2026-08-19T03:00:00Z", category: "lab",
  metricKey: "crp", name: "CRP", value: 0.4, unit: "mg/L", note: null,
  attributes: { kind: "lab", metricKey: "crp", name: "CRP", value: 0.4, unit: "mg/L" },
  createdAt: "2026-08-19T03:00:00Z", updatedAt: "2026-08-19T03:00:00Z", deletedAt: null,
};
const trends = { days: 30 } as HealthTrends;
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

function mockBaseReads() {
  vi.spyOn(healthApi, "listDiet").mockResolvedValue([]);
  vi.spyOn(healthApi, "listEvents").mockResolvedValue([]);
  vi.spyOn(healthApi, "timeline").mockResolvedValue([]);
  vi.spyOn(healthApi, "trends").mockResolvedValue(trends);
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
    expect(healthApi.timeline).toHaveBeenCalledOnce();
    expect(healthApi.trends).toHaveBeenCalledOnce();
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

  it("uses one atomic mutation and exactly Metrics, Timeline, and Trends reads", async () => {
    mockBaseReads(); const save = vi.spyOn(healthApi, "saveDailyMetrics").mockResolvedValue([event]);
    const { result } = await mountedController();
    vi.mocked(healthApi.listEvents).mockClear(); vi.mocked(healthApi.timeline).mockClear(); vi.mocked(healthApi.trends).mockClear();

    await act(async () => result.current.saveMetrics(mutation));

    expect(save).toHaveBeenCalledOnce(); expect(save).toHaveBeenCalledWith(mutation);
    expect(vi.mocked(healthApi.listEvents).mock.calls.filter(([query]) => query?.dailyOnly)).toHaveLength(1);
    expect(healthApi.timeline).toHaveBeenCalledOnce(); expect(healthApi.trends).toHaveBeenCalledOnce();
  });

  it.each([true, false])("makes an older Metrics mutation adopt the newer outcome (success: %s)", async (newerOk) => {
    mockBaseReads(); vi.spyOn(healthApi, "saveDailyMetrics").mockResolvedValue([event]);
    const { result } = await mountedController();
    const olderMetrics = deferred<HealthEvent[]>(); const newerMetrics = deferred<HealthEvent[]>();
    const olderTimeline = deferred<TimelineItem[]>(); const newerTimeline = deferred<TimelineItem[]>();
    const olderTrends = deferred<HealthTrends>(); const newerTrends = deferred<HealthTrends>();
    vi.mocked(healthApi.listEvents).mockReset()
      .mockImplementationOnce(() => olderMetrics.promise).mockImplementationOnce(() => newerMetrics.promise);
    vi.mocked(healthApi.timeline).mockReset()
      .mockImplementationOnce(() => olderTimeline.promise).mockImplementationOnce(() => newerTimeline.promise);
    vi.mocked(healthApi.trends).mockReset()
      .mockImplementationOnce(() => olderTrends.promise).mockImplementationOnce(() => newerTrends.promise);
    let first!: Promise<void>; let second!: Promise<void>;
    await act(async () => { first = result.current.saveMetrics(mutation); await Promise.resolve(); second = result.current.saveMetrics(mutation); await Promise.resolve(); });
    const outcomes = [first, second].map((promise) => promise.then(() => true, (error: unknown) => error));
    await act(async () => {
      if (newerOk) newerMetrics.resolve([event]); else newerMetrics.reject(new Error("newer failed"));
      newerTimeline.resolve([]); newerTrends.resolve(trends);
    });
    await act(async () => { olderMetrics.resolve([{ ...event, id: "stale" }]); olderTimeline.resolve([]); olderTrends.resolve(trends); });
    for (const outcome of outcomes) {
      if (newerOk) await expect(outcome).resolves.toBe(true);
      else await expect(outcome).resolves.toBeInstanceOf(HealthMutationRefreshError);
    }
    expect(result.current.state.metricsEntries).toEqual(newerOk ? [event] : []);
  });

  it.each([true, false])("makes a Metrics mutation adopt a newer aggregate outcome (success: %s)", async (newerOk) => {
    mockBaseReads(); vi.spyOn(healthApi, "saveDailyMetrics").mockResolvedValue([event]);
    const { result } = await mountedController();
    const metrics = deferred<HealthEvent[]>();
    const olderTimeline = deferred<TimelineItem[]>(); const newerTimeline = deferred<TimelineItem[]>();
    const olderTrends = deferred<HealthTrends>(); const newerTrends = deferred<HealthTrends>();
    vi.mocked(healthApi.listEvents).mockReset().mockImplementation((query) => {
      if (!query?.dailyOnly) return Promise.resolve([]);
      return metrics.promise;
    });
    vi.mocked(healthApi.timeline).mockReset()
      .mockImplementationOnce(() => olderTimeline.promise).mockImplementationOnce(() => newerTimeline.promise);
    vi.mocked(healthApi.trends).mockReset()
      .mockImplementationOnce(() => olderTrends.promise).mockImplementationOnce(() => newerTrends.promise);
    let saved!: Promise<void>; let refreshed!: Promise<boolean>;
    await act(async () => { saved = result.current.saveMetrics(mutation); await Promise.resolve(); refreshed = result.current.refresh(); await Promise.resolve(); });
    const savedOutcome = saved.then(() => true, (error: unknown) => error);
    await act(async () => {
      metrics.resolve([event]); newerTimeline.resolve([]);
      if (newerOk) newerTrends.resolve(trends); else newerTrends.reject(new Error("newer failed"));
    });
    await act(async () => { olderTimeline.resolve([]); olderTrends.resolve(trends); });
    await expect(refreshed).resolves.toBe(newerOk);
    if (newerOk) await expect(savedOutcome).resolves.toBe(true);
    else await expect(savedOutcome).resolves.toBeInstanceOf(HealthMutationRefreshError);
  });

  it.each(["metrics", "timeline", "trends"] as const)("recovers a committed mutation after the %s read fails without resubmitting", async (failed) => {
    mockBaseReads(); const save = vi.spyOn(healthApi, "saveDailyMetrics").mockResolvedValue([event]);
    const { result } = await mountedController();
    vi.mocked(healthApi.listEvents).mockClear(); vi.mocked(healthApi.timeline).mockClear(); vi.mocked(healthApi.trends).mockClear();
    if (failed === "metrics") vi.mocked(healthApi.listEvents).mockRejectedValueOnce(new Error("failed"));
    else if (failed === "timeline") vi.mocked(healthApi.timeline).mockRejectedValueOnce(new Error("failed"));
    else vi.mocked(healthApi.trends).mockRejectedValueOnce(new Error("failed"));

    await act(async () => expect(result.current.saveMetrics(mutation)).rejects.toBeInstanceOf(HealthMutationRefreshError));
    await act(async () => expect(result.current.refreshMetrics()).resolves.toBe(true));

    expect(save).toHaveBeenCalledOnce();
    expect(vi.mocked(healthApi.listEvents).mock.calls.filter(([query]) => query?.dailyOnly)).toHaveLength(2);
    expect(healthApi.timeline).toHaveBeenCalledTimes(2); expect(healthApi.trends).toHaveBeenCalledTimes(2);
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

  it.each(["diet", "bowel", "medication", "generic"] as const)("does not leak a daily-only read into %s mutations", async (kind) => {
    mockBaseReads();
    vi.spyOn(healthApi, "createDiet").mockResolvedValue({
      id: "diet-1", occurredAt: event.occurredAt, mealType: "lunch", foodName: "Rice",
      note: null, tags: [], mediaId: null, createdAt: event.createdAt,
      updatedAt: event.updatedAt, deletedAt: null,
    });
    vi.spyOn(healthApi, "createEvent").mockResolvedValue(event);
    vi.spyOn(healthApi, "archiveEvent").mockResolvedValue(event);
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
      else await result.current.archive("event", event.id);
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

function panelController(entries: HealthEvent[] = [weight, sleep, event, condition],
  settings = defaultHealthTableSettings("health.metrics")): HealthController {
  const state = {
    metricsStatus: "loaded", metricsError: null, metricsEntries: entries,
    medicationStatus: "loaded", medicationError: null, medicationEntries: [],
    bowelStatus: "loaded", bowelError: null, bowelEntries: [],
    dietStatus: "loaded", dietError: null, dietEntries: [],
    timelineStatus: "loaded", timelineError: null, timeline: [], timelineHasMore: false,
    trendsStatus: "loaded", trendsError: null, trends,
  } satisfies HealthState;
  return {
    state, tableViewSaveError: null, tableViewConfirmation: null,
    retryTableViewSave: vi.fn(), tableTabs: () => ({ tabs: [{ id: "metrics", name: "Table", settings }],
      activeTabId: "metrics", draftSettings: settings }), tableSettings: () => settings,
    tableIsDirty: vi.fn(() => false), updateTableSettings: vi.fn(), selectTableTab: vi.fn(),
    saveTableTab: vi.fn(), createTableTab: vi.fn(() => true), renameTableTab: vi.fn(() => true),
    requestDeleteTableTab: vi.fn(), confirmTableViewAction: vi.fn(), cancelTableViewAction: vi.fn(),
    refresh: vi.fn(), refreshMetrics: vi.fn(), refreshMedication: vi.fn(), refreshBowel: vi.fn(),
    refreshDiet: vi.fn(), refreshTimeline: vi.fn(), loadMoreTimeline: vi.fn(), refreshTrends: vi.fn(),
    createDiet: vi.fn(), updateDiet: vi.fn(), archiveDiet: vi.fn(), createBowel: vi.fn(),
    updateBowel: vi.fn(), archiveBowel: vi.fn(), createMedication: vi.fn(), updateMedication: vi.fn(),
    archiveMedication: vi.fn(), upsertMetrics: vi.fn(), saveMetrics: vi.fn(), archive: vi.fn(),
    restore: vi.fn(), purge: vi.fn(),
  };
}

describe("Health Metrics table", () => {
  afterEach(() => vi.restoreAllMocks());

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
    expect(screen.getByText("Steady")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add health metrics entry" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Archive selected health metrics entries" }))
      .toBeDisabled();
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
});
