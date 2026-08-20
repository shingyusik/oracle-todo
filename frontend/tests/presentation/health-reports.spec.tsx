import "@testing-library/jest-dom/vitest";

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

  it("mounts reports idle and reads only the four dedicated collections", async () => {
    const { result } = renderHook(() => useHealthController());

    expect(result.current.state).toMatchObject({
      reportStatus: "idle",
      reportError: null,
      report: null,
      reportSelection: { preset: 30 },
    });
    await waitFor(() => expect(result.current.state.metricsStatus).toBe("loaded"));

    expect(healthApi.listDiet).toHaveBeenCalledWith({ limit: 200, offset: 0 });
    expect(healthApi.listEvents).toHaveBeenCalledTimes(3);
    expect(healthApi.listEvents).toHaveBeenCalledWith({
      category: "bowel", limit: 200, offset: 0,
    });
    expect(healthApi.listEvents).toHaveBeenCalledWith({
      category: "medication", limit: 200, offset: 0,
    });
    expect(healthApi.listEvents).toHaveBeenCalledWith({
      dailyOnly: true, limit: 200, offset: 0,
    });
    expect(healthApi.timeline).not.toHaveBeenCalled();
    expect(healthApi.trends).not.toHaveBeenCalled();
    expect(healthApi.reports).not.toHaveBeenCalled();
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

  it("aggregate refresh reads the four dedicated collections and no reports or legacy feeds", async () => {
    const { result } = renderHook(() => useHealthController());
    await waitFor(() => expect(result.current.state.metricsStatus).toBe("loaded"));
    vi.clearAllMocks();
    await act(async () => { expect(await result.current.refresh()).toBe(true); });
    expect(healthApi.listDiet).toHaveBeenCalledOnce();
    expect(healthApi.listEvents).toHaveBeenCalledTimes(3);
    expect(healthApi.timeline).not.toHaveBeenCalled();
    expect(healthApi.trends).not.toHaveBeenCalled();
    expect(healthApi.reports).not.toHaveBeenCalled();
  });
});

describe("Health Reports workspace", () => {
  function state(overrides: Partial<HealthState> = {}): HealthState {
    return {
      metricsStatus: "loaded", metricsError: null, metricsEntries: [],
      medicationStatus: "loaded", medicationError: null, medicationEntries: [],
      bowelStatus: "loaded", bowelError: null, bowelEntries: [],
      dietStatus: "loaded", dietError: null, dietEntries: [],
      timelineStatus: "idle", timelineError: null, timeline: [], timelineHasMore: false,
      trendsStatus: "idle", trendsError: null, trends: null,
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
    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(screen.getByRole("alert")).toHaveTextContent("valid From and To dates");
    expect(value.runReports).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("From"), "2026-08-20");
    await user.type(screen.getByLabelText("To"), "2026-08-19");
    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(screen.getByRole("alert")).toHaveTextContent("start on or before");
    expect(value.runReports).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText("From"));
    await user.type(screen.getByLabelText("From"), "2025-08-18");
    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(screen.getByRole("alert")).toHaveTextContent("366 days or fewer");
    expect(value.runReports).not.toHaveBeenCalled();
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

    expect(screen.getByRole("group", {
      name: "Bowel Bristol scale. Typical Bristol band 3 to 5",
    })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /2026-08-10 08:30.*Bristol 4/ }))
      .toBeInTheDocument();

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

    const responses = screen.getByRole("region", { name: "Diet-tag bowel response" });
    expect(within(responses).getByRole("button", { name: "fiber, 0 / 0 (0%)" }))
      .toHaveTextContent("fiber0 / 0 (0%)");
    expect(within(responses).getByRole("button", { name: "spicy, 1 / 2 (50%)" }))
      .toHaveTextContent("spicy1 / 2 (50%)");
    expect(within(responses).getByText(
      "Observed associations only; they do not establish causation.",
    )).toBeInTheDocument();
    expect(document.querySelector(".health-report-chart-grid")).toBeInTheDocument();
    expect(document.querySelector(".health-report-summary-metrics")).toBeInTheDocument();
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
      { localDate: "2026-08-10", occurredAt: "2026-08-10T08:30:00Z", bristolScale: 4 },
      { localDate: "2026-08-12", occurredAt: "2026-08-12T09:45:00Z", bristolScale: 6 },
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
