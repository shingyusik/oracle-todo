import { act, renderHook, waitFor } from "@testing-library/react";
import React, { StrictMode, type PropsWithChildren } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { healthApi } from "@/features/health/api/health-api";
import { useHealthController } from "@/features/health/hooks/useHealthController";
import type { HealthReport } from "@/features/health/model/health-reports";

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
