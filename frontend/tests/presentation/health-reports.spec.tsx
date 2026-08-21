import "@testing-library/jest-dom/vitest";

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { act, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import React, { StrictMode, type PropsWithChildren } from "react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LineChartSpec } from "@/features/dashboard/model/dashboard-widgets";
import { DashboardLineChart } from "@/features/dashboard/ui/DashboardLineChart";
import { healthApi } from "@/features/health/api/health-api";
import {
  useHealthController,
  type HealthController,
  type HealthState,
} from "@/features/health/hooks/useHealthController";
import type {
  HealthReport,
  HealthReportDrilldown,
} from "@/features/health/model/health-reports";
import { HealthReports } from "@/features/health/ui/HealthReports";

function report(from: string, to: string): HealthReport {
  return {
    range: { from, to },
    previousRange: { from, to },
    metrics: [],
    dietCount: { current: 0, previous: 0 },
    bowel: {
      currentCount: 0,
      previousCount: 0,
      currentAverage: null,
      previousAverage: null,
    },
    medicationCount: { current: 0, previous: 0 },
    bowelPoints: [],
    metricSeries: [],
    medicationFrequencies: [],
    dietTagFrequencies: [],
    dietTagBowelResponses: [],
    reactionDisclaimer: "",
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("Health Reports controller", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 7, 20, 12));
    vi.spyOn(healthApi, "listDiet").mockResolvedValue([]);
    vi.spyOn(healthApi, "listEvents").mockResolvedValue([]);
    vi.spyOn(healthApi, "timeline").mockResolvedValue([]);
    vi.spyOn(healthApi, "trends").mockResolvedValue({} as never);
    vi.spyOn(healthApi, "reports").mockResolvedValue(report("2026-07-22", "2026-08-20"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("mounts idle without eagerly reading reports or table collections", () => {
    const { result } = renderHook(() => useHealthController());

    expect(result.current.state).toMatchObject({
      metricsStatus: "idle",
      medicationStatus: "idle",
      bowelStatus: "idle",
      dietStatus: "idle",
      reportStatus: "idle",
      reportError: null,
      report: null,
      reportSelection: { preset: 30 },
    });

    expect(healthApi.listDiet).not.toHaveBeenCalled();
    expect(healthApi.listEvents).not.toHaveBeenCalled();
    expect(healthApi.timeline).not.toHaveBeenCalled();
    expect(healthApi.trends).not.toHaveBeenCalled();
    expect(healthApi.reports).not.toHaveBeenCalled();
    for (const legacyMember of [
      "timeline", "timelineStatus", "timelineError", "timelineHasMore",
      "trends", "trendsStatus", "trendsError",
    ]) expect(result.current.state).not.toHaveProperty(legacyMember);
    for (const legacyMethod of [
      "refreshTimeline", "loadMoreTimeline", "refreshTrends", "archive", "restore", "purge",
    ]) expect(result.current).not.toHaveProperty(legacyMethod);
  });

  it("runs the local 30-day range and rejects invalid custom ranges without a request", async () => {
    const { result } = renderHook(() => useHealthController());
    let valid = false;
    await act(async () => {
      valid = await result.current.runReports({ preset: 30 });
    });
    expect(valid).toBe(true);
    expect(healthApi.reports).toHaveBeenLastCalledWith({
      from: "2026-07-22", to: "2026-08-20",
    });

    vi.mocked(healthApi.reports).mockClear();
    let invalid = true;
    await act(async () => {
      invalid = await result.current.runReports({
        preset: "custom", from: "2026-08-21", to: "2026-08-20",
      });
    });
    expect(invalid).toBe(false);
    expect(healthApi.reports).not.toHaveBeenCalled();
    expect(result.current.state.reportStatus).toBe("error");
    expect(result.current.state.reportError).toBeTruthy();
    expect(result.current.state.reportSelection).toEqual({
      preset: "custom", from: "2026-08-21", to: "2026-08-20",
    });
  });

  it("coalesces the same exact range", async () => {
    const pending = deferred<HealthReport>();
    vi.mocked(healthApi.reports).mockReturnValue(pending.promise);
    const { result } = renderHook(() => useHealthController());
    let first!: Promise<boolean>;
    let second!: Promise<boolean>;
    act(() => {
      first = result.current.runReports({ preset: 30 });
      second = result.current.runReports({ preset: 30 });
    });
    expect(healthApi.reports).toHaveBeenCalledOnce();
    await act(async () => pending.resolve(report("2026-07-22", "2026-08-20")));
    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
  });

  it.each(["resolve", "reject"] as const)(
    "lets an older %s adopt the newer authoritative success",
    async (olderResult) => {
      const older = deferred<HealthReport>();
      const newer = deferred<HealthReport>();
      vi.mocked(healthApi.reports)
        .mockReturnValueOnce(older.promise)
        .mockReturnValueOnce(newer.promise);
      const { result } = renderHook(() => useHealthController());
      let oldCall!: Promise<boolean>;
      let newCall!: Promise<boolean>;
      act(() => {
        oldCall = result.current.runReports({ preset: 30 });
        newCall = result.current.runReports({ preset: 7 });
      });
      await act(async () => {
        if (olderResult === "resolve") older.resolve(report("old", "old"));
        else older.reject(new Error("old failed"));
        newer.resolve(report("2026-08-14", "2026-08-20"));
      });
      await expect(Promise.all([oldCall, newCall])).resolves.toEqual([true, true]);
      expect(result.current.state.report?.range).toEqual({
        from: "2026-08-14", to: "2026-08-20",
      });
      expect(result.current.state.reportError).toBeNull();
    },
  );

  it.each(["resolve", "reject"] as const)(
    "lets an older %s adopt the newer authoritative failure",
    async (olderResult) => {
      const older = deferred<HealthReport>();
      const newer = deferred<HealthReport>();
      vi.mocked(healthApi.reports)
        .mockReturnValueOnce(older.promise)
        .mockReturnValueOnce(newer.promise);
      const { result } = renderHook(() => useHealthController());
      let oldCall!: Promise<boolean>;
      let newCall!: Promise<boolean>;
      act(() => {
        oldCall = result.current.runReports({ preset: 30 });
        newCall = result.current.runReports({ preset: 7 });
      });
      await act(async () => {
        if (olderResult === "resolve") older.resolve(report("old", "old"));
        else older.reject(new Error("old failed"));
        newer.reject(new Error("new failed"));
      });
      await expect(Promise.all([oldCall, newCall])).resolves.toEqual([false, false]);
      expect(result.current.state).toMatchObject({
        reportStatus: "error",
        reportError: "new failed",
        report: null,
        reportSelection: { preset: 7 },
      });
    },
  );

  it("reuses an older in-flight range when it becomes authoritative again", async () => {
    const rangeA = deferred<HealthReport>();
    const rangeB = deferred<HealthReport>();
    vi.mocked(healthApi.reports)
      .mockReturnValueOnce(rangeA.promise)
      .mockReturnValueOnce(rangeB.promise);
    const { result } = renderHook(() => useHealthController());
    let firstA!: Promise<boolean>;
    let callB!: Promise<boolean>;
    let latestA!: Promise<boolean>;
    act(() => {
      firstA = result.current.runReports({ preset: 30 });
      callB = result.current.runReports({ preset: 7 });
      latestA = result.current.runReports({ preset: 30 });
    });
    expect(healthApi.reports).toHaveBeenCalledTimes(2);
    await act(async () => rangeA.resolve(report("2026-07-22", "2026-08-20")));
    await expect(latestA).resolves.toBe(true);
    await act(async () => rangeB.resolve(report("2026-08-14", "2026-08-20")));
    await expect(Promise.all([firstA, callB])).resolves.toEqual([true, true]);
    expect(result.current.state.report?.range).toEqual({
      from: "2026-07-22", to: "2026-08-20",
    });
    expect(result.current.state.reportSelection).toEqual({ preset: 30 });
  });

  it("retains the last report while loading and after the latest failure", async () => {
    const first = report("2026-07-22", "2026-08-20");
    vi.mocked(healthApi.reports).mockResolvedValueOnce(first);
    const { result } = renderHook(() => useHealthController());
    await act(async () => { await result.current.runReports({ preset: 30 }); });

    const pending = deferred<HealthReport>();
    vi.mocked(healthApi.reports).mockReturnValueOnce(pending.promise);
    let call!: Promise<boolean>;
    act(() => { call = result.current.runReports({ preset: 7 }); });
    expect(result.current.state.reportStatus).toBe("loading");
    expect(result.current.state.report).toBe(first);
    await act(async () => pending.reject(new Error("Reports unavailable")));
    await expect(call).resolves.toBe(false);
    expect(result.current.state).toMatchObject({
      reportStatus: "error",
      reportError: "Reports unavailable",
      report: first,
    });
  });

  it("retries the last saved selection without repeating a mutation", async () => {
    vi.mocked(healthApi.reports)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(report("2026-08-14", "2026-08-20"));
    const { result } = renderHook(() => useHealthController());
    await act(async () => {
      expect(await result.current.runReports({ preset: 7 })).toBe(false);
      expect(await result.current.retryReports()).toBe(true);
    });
    expect(healthApi.reports).toHaveBeenCalledTimes(2);
    expect(healthApi.reports).toHaveBeenNthCalledWith(2, {
      from: "2026-08-14", to: "2026-08-20",
    });
  });

  it("does not settle report state after unmount", async () => {
    const pending = deferred<HealthReport>();
    vi.mocked(healthApi.reports).mockReturnValue(pending.promise);
    const { result, unmount } = renderHook(() => useHealthController());
    let call!: Promise<boolean>;
    act(() => { call = result.current.runReports({ preset: 30 }); });
    unmount();
    pending.resolve(report("2026-07-22", "2026-08-20"));
    await expect(call).resolves.toBe(true);
  });

  it("settles report state after Strict Mode replays the mount effect", async () => {
    const wrapper = ({ children }: PropsWithChildren) => <StrictMode>{children}</StrictMode>;
    const { result } = renderHook(() => useHealthController(), { wrapper });
    await act(async () => {
      expect(await result.current.runReports({ preset: 30 })).toBe(true);
    });
    expect(result.current.state.reportStatus).toBe("loaded");
  });

  it("refresh stays idle when no consumer has requested a scope", async () => {
    const { result } = renderHook(() => useHealthController());
    await act(async () => { expect(await result.current.refresh()).toBe(true); });
    expect(result.current.state).toMatchObject({
      metricsStatus: "idle",
      medicationStatus: "idle",
      bowelStatus: "idle",
      dietStatus: "idle",
      reportStatus: "idle",
    });
    expect(healthApi.listDiet).not.toHaveBeenCalled();
    expect(healthApi.listEvents).not.toHaveBeenCalled();
    expect(healthApi.timeline).not.toHaveBeenCalled();
    expect(healthApi.trends).not.toHaveBeenCalled();
    expect(healthApi.reports).not.toHaveBeenCalled();
  });
});

describe("Health Reports workspace", () => {
  function IntegratedReports() {
    const value = useHealthController();
    return <HealthReports controller={value} />;
  }

  function state(overrides: Partial<HealthState> = {}): HealthState {
    return {
      metricsStatus: "loaded", metricsError: null, metricsEntries: [],
      medicationStatus: "loaded", medicationError: null, medicationEntries: [],
      bowelStatus: "loaded", bowelError: null, bowelEntries: [],
      dietStatus: "loaded", dietError: null, dietEntries: [],
      reportStatus: "loaded", reportError: null, report: populatedReport(),
      reportSelection: { preset: 30 },
      ...overrides,
    };
  }

  function controller(overrides: Partial<HealthState> = {}): HealthController {
    return {
      state: state(overrides),
      runReports: vi.fn().mockResolvedValue(true),
      retryReports: vi.fn().mockResolvedValue(true),
    } as unknown as HealthController;
  }

  it("requests the default range once in Strict Mode and validates custom dates locally", async () => {
    const user = userEvent.setup();
    const value = controller({ reportStatus: "idle", report: null });
    render(<StrictMode><HealthReports controller={value} /></StrictMode>);

    await waitFor(() => expect(value.runReports).toHaveBeenCalledTimes(1));
    expect(value.runReports).toHaveBeenCalledWith({ preset: 30 });
    expect(screen.getAllByRole("button").slice(0, 4).map((button) => button.textContent))
      .toEqual(["7 days", "14 days", "30 days", "90 days"]);

    vi.mocked(value.runReports).mockClear();
    for (const preset of [7, 14, 30, 90] as const) {
      await user.click(screen.getByRole("button", { name: `${preset} days` }));
    }
    expect(value.runReports).toHaveBeenCalledTimes(4);
    expect(vi.mocked(value.runReports).mock.calls.map(([selection]) => selection))
      .toEqual([{ preset: 7 }, { preset: 14 }, { preset: 30 }, { preset: 90 }]);

    vi.mocked(value.runReports).mockClear();
    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(screen.getByRole("alert")).toHaveTextContent("valid From and To dates");
    expect(value.runReports).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("From"), "2026-08-20");
    expect(screen.queryByRole("alert")).toBeNull();
    await user.type(screen.getByLabelText("To"), "2026-08-19");
    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(screen.getByRole("alert")).toHaveTextContent("start on or before");
    expect(value.runReports).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText("To"));
    expect(screen.queryByRole("alert")).toBeNull();
    await user.type(screen.getByLabelText("To"), "2026-08-19");
    await user.click(screen.getByRole("button", { name: "Apply" }));
    await user.clear(screen.getByLabelText("From"));
    await user.type(screen.getByLabelText("From"), "2025-08-18");
    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(screen.getByRole("alert")).toHaveTextContent("366 days or fewer");
    expect(value.runReports).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText("From"));
    await user.type(screen.getByLabelText("From"), "2026-08-01");
    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(value.runReports).toHaveBeenCalledOnce();
    expect(value.runReports).toHaveBeenCalledWith({
      preset: "custom", from: "2026-08-01", to: "2026-08-19",
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("loads only the report aggregate when the real workspace mounts", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 7, 20, 12));
    const reports = vi.spyOn(healthApi, "reports")
      .mockResolvedValue(report("2026-07-22", "2026-08-20"));
    const listDiet = vi.spyOn(healthApi, "listDiet").mockResolvedValue([]);
    const listEvents = vi.spyOn(healthApi, "listEvents").mockResolvedValue([]);
    const timeline = vi.spyOn(healthApi, "timeline").mockResolvedValue([]);
    const trends = vi.spyOn(healthApi, "trends").mockResolvedValue({} as never);

    render(<StrictMode><IntegratedReports /></StrictMode>);

    await waitFor(() => expect(reports).toHaveBeenCalledOnce());
    expect(reports).toHaveBeenCalledWith({
      from: "2026-07-22", to: "2026-08-20",
    });
    expect(listDiet).not.toHaveBeenCalled();
    expect(listEvents).not.toHaveBeenCalled();
    expect(timeline).not.toHaveBeenCalled();
    expect(trends).not.toHaveBeenCalled();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("renders blocking loading and retry states, then retains busy analysis on refresh errors", async () => {
    const user = userEvent.setup();
    const loading = controller({ reportStatus: "loading", report: null });
    const view = render(<HealthReports controller={loading} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading reports…");

    const failed = controller({
      reportStatus: "error", report: null, reportError: "Reports unavailable",
    });
    view.rerender(<HealthReports controller={failed} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Reports unavailable");
    await user.click(screen.getByRole("button", { name: "Retry reports" }));
    expect(failed.retryReports).toHaveBeenCalledOnce();

    const retained = controller({
      reportStatus: "loading", reportError: null, report: populatedReport(),
    });
    view.rerender(<HealthReports controller={retained} />);
    expect(screen.getByRole("region", { name: "Health report analysis" }))
      .toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("heading", { name: "Summary" })).toBeVisible();

    const retainedError = controller({
      reportStatus: "error", reportError: "Refresh failed", report: populatedReport(),
    });
    view.rerender(<HealthReports controller={retainedError} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Refresh failed");
    expect(screen.getByRole("heading", { name: "Summary" })).toBeVisible();
  });

  it("keeps retry disabled while pending and permits another attempt after false", async () => {
    const user = userEvent.setup();
    const pending = deferred<boolean>();
    const value = controller({
      reportStatus: "error", report: null, reportError: "Reports unavailable",
    });
    vi.mocked(value.retryReports)
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(true);
    render(<HealthReports controller={value} />);

    const retry = screen.getByRole("button", { name: "Retry reports" });
    await user.click(retry);
    expect(retry).toBeDisabled();
    await act(async () => pending.resolve(false));
    await waitFor(() => expect(retry).toBeEnabled());
    await user.click(retry);
    expect(value.retryReports).toHaveBeenCalledTimes(2);
  });

  it("renders ordered comparisons, isolated metric units, all frequency rows, and typed drilldowns", async () => {
    const user = userEvent.setup();
    const onDrilldown = vi.fn<(target: HealthReportDrilldown) => void>();
    render(<HealthReports controller={controller()} onDrilldown={onDrilldown} />);

    const summary = screen.getByRole("region", { name: "Summary" });
    expect(within(summary).getAllByRole("button").map((button) =>
      button.getAttribute("data-report-card"))).toEqual([
      "Weight", "Sleep", "CRP", "Calprotectin", "Condition",
      "Diet count", "Bowel count", "Bowel average", "Medication count",
    ]);
    expect(within(summary).getByRole("button", { name: /View Weight records/ }))
      .toHaveTextContent("72 kg");
    expect(within(summary).getByRole("button", { name: /View Weight records/ }))
      .toHaveTextContent("Previous 71 kg · +1 kg");
    expect(within(summary).getByRole("button", { name: /View CRP records/ }))
      .toHaveTextContent("Unavailable");
    await user.click(within(summary).getByRole("button", { name: /View Diet count records/ }));
    expect(onDrilldown).toHaveBeenLastCalledWith({
      tab: "diet", range: { start: "2026-08-01", end: "2026-08-20" },
    });

    const bowelChart = screen.getByRole("group", {
      name: "Bowel Bristol scale. Typical Bristol band 3 to 5",
    });
    expect(bowelChart).toBeInTheDocument();
    expect(within(bowelChart).getAllByRole("img").map((point) =>
      point.getAttribute("aria-label"))).toEqual([
      `${new Date("2026-08-10T08:30:00Z").toLocaleString()}: Bristol 4`,
      `${new Date("2026-08-12T09:45:00Z").toLocaleString()}: Bristol 6`,
    ]);
    expect(within(bowelChart).queryByRole("img", {
      name: "2026-08-12 09:45: Bristol 6",
    })).toBeNull();
    await user.click(screen.getByRole("button", { name: "View abnormal bowel records" }));
    expect(onDrilldown).toHaveBeenLastCalledWith({
      tab: "bowel", field: "bristol_scale",
      range: { start: "2026-08-01", end: "2026-08-20" },
    });

    const selector = screen.getByRole("combobox", { name: "Metric" });
    expect(within(selector).getAllByRole("option").map((option) => option.textContent))
      .toEqual(["Weight", "Sleep", "CRP", "Calprotectin", "Condition"]);
    expect(screen.getByRole("group", { name: "Weight (kg)" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: /Sleep.*hours/ })).toBeNull();
    await user.selectOptions(selector, "sleep_duration");
    expect(screen.getByRole("group", { name: "Sleep (hours)" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Weight (kg)" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "View sleep records" }));
    expect(onDrilldown).toHaveBeenLastCalledWith({
      tab: "health-metrics", field: "sleep",
      range: { start: "2026-08-01", end: "2026-08-20" },
    });

    const medications = screen.getByRole("region", { name: "Medication frequency" });
    expect(within(medications).getAllByRole("button").map((button) => button.textContent))
      .toEqual(["Mesalamine3", "Vitamin D1"]);
    const medication = within(medications).getByRole("button", { name: "Mesalamine, 3 records" });
    medication.focus();
    await user.keyboard("{Enter}");
    expect(onDrilldown).toHaveBeenLastCalledWith({
      tab: "medication", field: "medication_name", value: "Mesalamine",
      range: { start: "2026-08-01", end: "2026-08-20" },
    });

    const dietTags = screen.getByRole("region", { name: "Diet tag frequency" });
    expect(within(dietTags).getAllByRole("button").map((button) => button.textContent))
      .toEqual(["spicy2", "fiber1"]);
    const spicyFrequency = within(dietTags).getByRole("button", {
      name: "spicy, 2 records",
    });
    spicyFrequency.focus();
    await user.keyboard("{Enter}");
    expect(onDrilldown).toHaveBeenLastCalledWith({
      tab: "diet", field: "tags", value: "spicy",
      range: { start: "2026-08-01", end: "2026-08-20" },
    });

    const responses = screen.getByRole("region", { name: "Diet-tag bowel response" });
    const zeroEligible = within(responses).getByRole("button", {
      name: "fiber, 0 / 0 (0%)",
    });
    expect(zeroEligible).toHaveTextContent("fiber0 / 0 (0%)");
    expect(within(responses).getByRole("button", { name: "spicy, 1 / 2 (50%)" }))
      .toHaveTextContent("spicy1 / 2 (50%)");
    zeroEligible.focus();
    await user.keyboard("{Enter}");
    expect(onDrilldown).toHaveBeenLastCalledWith({
      tab: "diet", field: "tags", value: "fiber",
      range: { start: "2026-08-01", end: "2026-08-20" },
    });
    expect(within(responses).getByText(
      "Observed associations only; they do not establish causation.",
    )).toBeInTheDocument();
    expect(document.querySelector(".health-report-chart-grid")).toBeInTheDocument();
    expect(document.querySelector(".health-report-summary-metrics")).toBeInTheDocument();
  });

  it("defaults to the first metric with points and keeps later units isolated", async () => {
    const user = userEvent.setup();
    const value = populatedReport();
    value.metricSeries = value.metricSeries.map((series) =>
      series.metric === "body_weight" ? { ...series, points: [] } : series);
    value.metrics = value.metrics.map((metric) =>
      metric.metric === "crp" ? {
        ...metric,
        current: { localDate: "2026-08-20", occurredAt: "2026-08-20T12:00:00Z", value: 68.2 },
        previous: { localDate: "2026-07-31", occurredAt: "2026-07-31T12:00:00Z", value: 68.1 },
      } : metric.metric === "overall_condition" ? {
        ...metric,
        current: { localDate: "2026-08-20", occurredAt: "2026-08-20T12:00:00Z", value: -0 },
        previous: { localDate: "2026-07-31", occurredAt: "2026-07-31T12:00:00Z", value: -0 },
      } : metric);
    const view = render(<HealthReports controller={controller({ report: value })} />);

    const selector = screen.getByRole("combobox", { name: "Metric" });
    expect(selector).toHaveValue("sleep_duration");
    expect(screen.getByRole("group", { name: "Sleep (hours)" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: /Weight.*kg/ })).toBeNull();

    await user.selectOptions(selector, "fecal_calprotectin");
    expect(screen.getByRole("group", { name: "Calprotectin (µg/g)" }))
      .toBeInTheDocument();
    expect(screen.queryByRole("group", { name: /hours/ })).toBeNull();

    await user.selectOptions(selector, "crp");
    const replacement = {
      ...value,
      metricSeries: value.metricSeries.map((series) =>
        series.metric === "crp" ? {
          ...series,
          points: [{
            localDate: "2026-08-20", occurredAt: "2026-08-20T12:00:00Z",
            value: 0.123456789012345,
          }],
        } : series),
    };
    view.rerender(<HealthReports controller={controller({ report: replacement })} />);
    expect(selector).toHaveValue("crp");
    expect(screen.getByRole("group", { name: "CRP (mg/L)" })).toBeInTheDocument();
    expect(screen.getByRole("img", {
      name: `${new Date("2026-08-20T12:00:00Z").toLocaleString()}: 0.123456789012345 mg/L`,
    })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "CRP" }))
      .toHaveTextContent("68.2 mg/L2026-08-20Previous 68.1 mg/L · +0.1 mg/L");
    expect(screen.getByRole("group", { name: "Condition" }))
      .toHaveTextContent("02026-08-20Previous 0 · 0");
  });

  it("uses unique chart point keys when timestamps repeat", () => {
    const value = populatedReport();
    value.bowelPoints = [
      { localDate: "2026-08-10", occurredAt: "2026-08-10T08:30:00Z", bristolScale: 3 },
      { localDate: "2026-08-10", occurredAt: "2026-08-10T08:30:00Z", bristolScale: 4 },
    ];
    value.metricSeries = value.metricSeries.map((series) =>
      series.metric === "body_weight" ? {
        ...series,
        points: [
          { localDate: "2026-08-10", occurredAt: "2026-08-10T08:30:00Z", value: 71 },
          { localDate: "2026-08-10", occurredAt: "2026-08-10T08:30:00Z", value: 72 },
        ],
      } : series);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(<HealthReports controller={controller({ report: value })} />);

    expect(within(screen.getByRole("group", {
      name: "Bowel Bristol scale. Typical Bristol band 3 to 5",
    })).getAllByRole("img")).toHaveLength(2);
    expect(within(screen.getByRole("group", { name: "Weight (kg)" }))
      .getAllByRole("img")).toHaveLength(2);
    const errors = consoleError.mock.calls.flat().join(" ");
    consoleError.mockRestore();
    expect(errors).not.toMatch(/same key|unique.*key/i);
  });

  it("renders the disclaimer supplied by the report", () => {
    const value = populatedReport();
    value.reactionDisclaimer = "Typed association disclaimer.";
    render(<HealthReports controller={controller({ report: value })} />);

    expect(screen.getByText("Typed association disclaimer.")).toBeInTheDocument();
    expect(screen.queryByText(
      "Observed associations only; they do not establish causation.",
    )).toBeNull();
  });

  it("shows the exact whole-report empty copy and source-specific chart copy", async () => {
    const empty = report("2026-08-01", "2026-08-20");
    render(<HealthReports controller={controller({ report: empty })} />);
    expect(screen.getByText("No health records are available for this period."))
      .toBeInTheDocument();
    expect(screen.getByText("No bowel Bristol readings are available for this period."))
      .toBeInTheDocument();
    expect(screen.getByText("No weight readings are available for this period."))
      .toBeInTheDocument();
  });

  it("positions one aria-hidden reference band without changing existing chart callers", () => {
    const chart: LineChartSpec = {
      kind: "line", ariaLabel: "Bristol. Typical Bristol band 3 to 5", total: 1,
      points: [{ id: "one", label: "2026-08-10", value: 4, ariaLabel: "Bristol 4" }],
    };
    const { container, rerender } = render(
      <DashboardLineChart
        chart={chart}
        referenceBand={{ minimum: 3, maximum: 5, label: "Typical Bristol 3 to 5" }}
      />,
    );
    const band = container.querySelector(".dashboard-line-reference-band");
    expect(band).toHaveAttribute("aria-hidden", "true");
    expect(band).toHaveTextContent("Typical Bristol 3 to 5");
    expect(container.querySelectorAll(".dashboard-line-reference-band")).toHaveLength(1);

    rerender(<DashboardLineChart chart={chart} />);
    expect(container.querySelector(".dashboard-line-reference-band")).toBeNull();
  });

  it("stacks every report grid at the existing narrow breakpoint", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles/globals.css"), "utf8");
    const narrow = cssBlock(css, "@media (max-width: 760px)", css.indexOf(".health-reports"));
    for (const selector of [
      ".health-report-summary-metrics",
      ".health-report-summary-counts",
      ".health-report-chart-grid",
      ".health-report-list-grid",
    ]) expect(narrow).toContain(selector);
    expect(narrow).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  });
});

function populatedReport(): HealthReport {
  const range = { from: "2026-08-01", to: "2026-08-20" };
  const reading = (localDate: string, value: number) => ({
    localDate, occurredAt: `${localDate}T08:30:00Z`, value,
  });
  return {
    range,
    previousRange: { from: "2026-07-12", to: "2026-07-31" },
    metrics: [
      { metric: "body_weight", name: "Weight", unit: "kg", current: reading("2026-08-20", 72), previous: reading("2026-07-31", 71) },
      { metric: "sleep_duration", name: "Sleep", unit: "hours", current: reading("2026-08-19", 7.5), previous: reading("2026-07-30", 7) },
      { metric: "crp", name: "CRP", unit: "mg/L", current: null, previous: null },
      { metric: "fecal_calprotectin", name: "Calprotectin", unit: "µg/g", current: reading("2026-08-15", 80), previous: null },
      { metric: "overall_condition", name: "Condition", unit: null, current: reading("2026-08-20", 8), previous: reading("2026-07-31", 6) },
    ],
    dietCount: { current: 8, previous: 6 },
    bowel: { currentCount: 5, previousCount: 4, currentAverage: 3.6, previousAverage: 4 },
    medicationCount: { current: 4, previous: 3 },
    bowelPoints: [
      { localDate: "2026-08-12", occurredAt: "2026-08-12T09:45:00Z", bristolScale: 6 },
      { localDate: "2026-08-10", occurredAt: "2026-08-10T08:30:00Z", bristolScale: 4 },
    ],
    metricSeries: [
      { metric: "body_weight", points: [reading("2026-08-10", 71.5), reading("2026-08-20", 72)] },
      { metric: "sleep_duration", points: [reading("2026-08-19", 7.5)] },
      { metric: "crp", points: [] },
      { metric: "fecal_calprotectin", points: [reading("2026-08-15", 80)] },
      { metric: "overall_condition", points: [reading("2026-08-20", 8)] },
    ],
    medicationFrequencies: [{ name: "Mesalamine", count: 3 }, { name: "Vitamin D", count: 1 }],
    dietTagFrequencies: [{ name: "spicy", count: 2 }, { name: "fiber", count: 1 }],
    dietTagBowelResponses: [
      { tag: "fiber", positiveMeals: 0, eligibleMeals: 0, rate: 0 },
      { tag: "spicy", positiveMeals: 1, eligibleMeals: 2, rate: 0.5 },
    ],
    reactionDisclaimer: "Observed associations only; they do not establish causation.",
  };
}

function cssBlock(source: string, marker: string, from = 0): string {
  const start = source.indexOf("{", source.indexOf(marker, from));
  let depth = 1;
  for (let index = start + 1; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}" && --depth === 0) return source.slice(start + 1, index);
  }
  throw new Error(`Unclosed CSS block: ${marker}`);
}
