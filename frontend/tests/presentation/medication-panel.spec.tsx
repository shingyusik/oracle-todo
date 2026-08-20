import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { healthApi } from "@/features/health/api/health-api";
import {
  HealthMutationRefreshError,
  useHealthController,
} from "@/features/health/hooks/useHealthController";
import type { EventInput, EventUpdate, HealthEvent, HealthTrends, TimelineItem } from "@/features/health/model/health-model";

const event: HealthEvent = {
  id: "medication-1", occurredAt: "2026-08-19T01:00:00Z", category: "medication",
  metricKey: "Vitamin D", name: "Vitamin D", value: 1000, unit: "mg", note: null,
  attributes: { kind: "medication", medicationName: "Vitamin D", dose: 1000, unit: "mg" },
  createdAt: "2026-08-19T01:00:00Z", updatedAt: "2026-08-19T01:00:00Z", deletedAt: null,
};
const trends = { days: 30 } as HealthTrends;
const input: EventInput = { occurredAt: event.occurredAt,
  details: { kind: "medication", medicationName: "Vitamin D", dose: 1000, unit: "mg" } };
const update: EventUpdate = { note: "updated" };

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
  await waitFor(() => expect(hook.result.current.state.medicationStatus).toBe("loaded"));
  return hook;
}

type Reads = {
  medication: ReturnType<typeof deferred<HealthEvent[]>>;
  timeline: ReturnType<typeof deferred<TimelineItem[]>>;
  trends: ReturnType<typeof deferred<HealthTrends>>;
};
function reads(): Reads {
  return { medication: deferred(), timeline: deferred(), trends: deferred() };
}
function settle(set: Reads, ok: boolean, entries: HealthEvent[] = []) {
  if (ok) set.medication.resolve(entries); else set.medication.reject(new Error("newer failed"));
  set.timeline.resolve([]); set.trends.resolve(trends);
}

describe("Health Medication controller", () => {
  afterEach(() => vi.restoreAllMocks());

  it("loads one short Medication page once without duplicating related initial reads", async () => {
    mockBaseReads();
    vi.mocked(healthApi.listEvents).mockImplementation(async (query) =>
      query?.category === "medication" ? [event] : []);

    const { result } = renderHook(() => useHealthController());
    await waitFor(() => expect(result.current.state.medicationStatus).toBe("loaded"));

    expect(vi.mocked(healthApi.listEvents).mock.calls
      .filter(([request]) => request?.category === "medication")).toHaveLength(1);
    expect(healthApi.timeline).toHaveBeenCalledOnce();
    expect(healthApi.trends).toHaveBeenCalledOnce();
    expect(result.current.state.medicationEntries).toEqual([event]);
  });

  it("drains every 200-row Medication page", async () => {
    mockBaseReads();
    const events = Array.from({ length: 200 }, (_, index) => ({ ...event, id: `med-${index}` }));
    let medicationPage = 0;
    vi.mocked(healthApi.listEvents).mockImplementation(async (query) =>
      query?.category === "medication" && medicationPage++ === 0 ? events : []);
    const { result } = renderHook(() => useHealthController());
    await waitFor(() => expect(result.current.state.medicationStatus).toBe("loaded"));
    const medicationCalls = vi.mocked(healthApi.listEvents).mock.calls
      .filter(([request]) => request?.category === "medication");
    expect(medicationCalls[0]).toEqual([{
      category: "medication", limit: 200, offset: 0,
    }]);
    expect(medicationCalls[1]).toEqual([{
      category: "medication", limit: 200, offset: 200,
    }]);
    expect(result.current.state.medicationEntries).toEqual(events);
    expect(result.current.state.medicationStatus).toBe("loaded");
  });

  it("aggregate refresh reads each collection exactly once", async () => {
    mockBaseReads();
    const { result } = await mountedController();
    vi.mocked(healthApi.listDiet).mockClear();
    vi.mocked(healthApi.listEvents).mockClear();
    vi.mocked(healthApi.timeline).mockClear();
    vi.mocked(healthApi.trends).mockClear();

    await act(async () => expect(result.current.refresh()).resolves.toBe(true));

    expect(healthApi.listDiet).toHaveBeenCalledOnce();
    expect(vi.mocked(healthApi.listEvents).mock.calls
      .filter(([request]) => request?.category === "bowel")).toHaveLength(1);
    expect(vi.mocked(healthApi.listEvents).mock.calls
      .filter(([request]) => request?.category === "medication")).toHaveLength(1);
    expect(healthApi.timeline).toHaveBeenCalledOnce();
    expect(healthApi.trends).toHaveBeenCalledOnce();
  });

  it("coalesces ordinary refreshes and retains loaded data with a nonblocking error", async () => {
    mockBaseReads();
    vi.mocked(healthApi.listEvents).mockImplementation(async (query) =>
      query?.category === "medication" ? [event] : []);
    const { result } = await mountedController();
    const pending = deferred<HealthEvent[]>();
    vi.mocked(healthApi.listEvents).mockImplementation((query) =>
      query?.category === "medication" ? pending.promise : Promise.resolve([])).mockClear();
    let first!: Promise<boolean>; let second!: Promise<boolean>;
    await act(async () => { first = result.current.refreshMedication(); second = result.current.refreshMedication(); await Promise.resolve(); });
    expect(vi.mocked(healthApi.listEvents).mock.calls
      .filter(([request]) => request?.category === "medication")).toHaveLength(1);
    await act(async () => pending.reject(new Error("Medication unavailable")));
    await expect(first).resolves.toBe(false); await expect(second).resolves.toBe(false);
    expect(result.current.state).toMatchObject({
      medicationStatus: "loaded", medicationError: "Medication unavailable", medicationEntries: [event],
    });
  });

  it.each(["success", "error"] as const)("ignores stale %s without a promise cycle", async (outcome) => {
    mockBaseReads(); const { result } = await mountedController();
    const older = deferred<HealthEvent[]>(); const newer = deferred<HealthEvent[]>();
    vi.mocked(healthApi.listEvents).mockReset()
      .mockImplementationOnce(() => older.promise).mockImplementationOnce(() => newer.promise);
    let stale!: Promise<boolean>; let forced!: Promise<void>;
    vi.spyOn(healthApi, "createEvent").mockResolvedValue(event);
    await act(async () => { stale = result.current.refreshMedication(); await Promise.resolve(); forced = result.current.createMedication(input); await Promise.resolve(); });
    const forcedOutcome = forced.then(() => true, (error: unknown) => error);
    await act(async () => newer.resolve([event]));
    await act(async () => outcome === "success" ? older.resolve([{ ...event, id: "stale" }]) : older.reject(new Error("stale error")));
    await expect(stale).resolves.toBe(true); await expect(forcedOutcome).resolves.toBe(true);
    expect(result.current.state.medicationEntries).toEqual([event]);
    expect(result.current.state.medicationError).toBeNull();
  });

  it("uses a blocking error on initial failure", async () => {
    mockBaseReads(); vi.mocked(healthApi.listEvents).mockRejectedValue(new Error("No Medication"));
    const { result } = renderHook(() => useHealthController());
    await waitFor(() => expect(result.current.state.medicationStatus).toBe("error"));
    expect(result.current.state.medicationError).toBe("No Medication");
  });

  it.each(["create", "update", "archive"] as const)("uses one %s mutation and Medication, Timeline, Trends reads", async (kind) => {
    mockBaseReads();
    const create = vi.spyOn(healthApi, "createEvent").mockResolvedValue(event);
    const updateEvent = vi.spyOn(healthApi, "updateEvent").mockResolvedValue(event);
    const archive = vi.spyOn(healthApi, "archiveEvent").mockResolvedValue(event);
    const { result } = await mountedController();
    [create, updateEvent, archive].forEach((spy) => spy.mockClear());
    vi.mocked(healthApi.listEvents).mockClear(); vi.mocked(healthApi.timeline).mockClear(); vi.mocked(healthApi.trends).mockClear();
    await act(async () => {
      if (kind === "create") await result.current.createMedication(input);
      else if (kind === "update") await result.current.updateMedication(event.id, update);
      else await result.current.archiveMedication(event.id);
    });
    expect(create.mock.calls.length + updateEvent.mock.calls.length + archive.mock.calls.length).toBe(1);
    expect(healthApi.listEvents).toHaveBeenCalledOnce(); expect(healthApi.timeline).toHaveBeenCalledOnce(); expect(healthApi.trends).toHaveBeenCalledOnce();
  });

  it.each(["medication", "timeline", "trends"] as const)("throws after commit when %s fails and retries reads only", async (failed) => {
    mockBaseReads(); const create = vi.spyOn(healthApi, "createEvent").mockResolvedValue(event);
    const { result } = await mountedController();
    vi.mocked(healthApi.listEvents).mockClear(); vi.mocked(healthApi.timeline).mockClear(); vi.mocked(healthApi.trends).mockClear();
    const read = failed === "medication" ? vi.mocked(healthApi.listEvents) : failed === "timeline" ? vi.mocked(healthApi.timeline) : vi.mocked(healthApi.trends);
    read.mockRejectedValueOnce(new Error("failed"));
    await act(async () => { await expect(result.current.createMedication(input)).rejects.toBeInstanceOf(HealthMutationRefreshError); });
    await act(async () => expect(result.current.refreshMedication()).resolves.toBe(true));
    expect(create).toHaveBeenCalledOnce();
    expect(healthApi.listEvents).toHaveBeenCalledTimes(2); expect(healthApi.timeline).toHaveBeenCalledTimes(2); expect(healthApi.trends).toHaveBeenCalledTimes(2);
  });

  it.each([true, false])("makes an older mutation adopt the newer mutation outcome (success: %s)", async (newerOk) => {
    mockBaseReads(); const create = vi.spyOn(healthApi, "createEvent").mockResolvedValue(event);
    const { result } = await mountedController(); const older = reads(); const newer = reads();
    vi.mocked(healthApi.listEvents).mockReset().mockImplementationOnce(() => older.medication.promise).mockImplementationOnce(() => newer.medication.promise);
    vi.mocked(healthApi.timeline).mockReset().mockImplementationOnce(() => older.timeline.promise).mockImplementationOnce(() => newer.timeline.promise);
    vi.mocked(healthApi.trends).mockReset().mockImplementationOnce(() => older.trends.promise).mockImplementationOnce(() => newer.trends.promise);
    let first!: Promise<void>; let second!: Promise<void>;
    await act(async () => { first = result.current.createMedication(input); await Promise.resolve(); second = result.current.createMedication(input); await Promise.resolve(); });
    const outcomes = [first, second].map((promise) => promise.then(() => true, (error: unknown) => error));
    await act(async () => settle(newer, newerOk, [event])); await act(async () => settle(older, true, [{ ...event, id: "stale" }]));
    for (const outcome of outcomes) newerOk ? await expect(outcome).resolves.toBe(true) : await expect(outcome).resolves.toBeInstanceOf(HealthMutationRefreshError);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it.each([true, false])("makes a mutation adopt the newer aggregate outcome (success: %s)", async (newerOk) => {
    mockBaseReads(); vi.spyOn(healthApi, "createEvent").mockResolvedValue(event);
    const { result } = await mountedController(); const medication = deferred<HealthEvent[]>(); const older = reads(); const newer = reads();
    vi.mocked(healthApi.listEvents).mockReset().mockImplementation(() => medication.promise);
    vi.mocked(healthApi.timeline).mockReset().mockImplementationOnce(() => older.timeline.promise).mockImplementationOnce(() => newer.timeline.promise);
    vi.mocked(healthApi.trends).mockReset().mockImplementationOnce(() => older.trends.promise).mockImplementationOnce(() => newer.trends.promise);
    let mutation!: Promise<void>; let refresh!: Promise<boolean>;
    await act(async () => { mutation = result.current.createMedication(input); await Promise.resolve(); refresh = result.current.refresh(); await Promise.resolve(); });
    const mutationOutcome = mutation.then(() => true, (error: unknown) => error);
    await act(async () => { medication.resolve([event]); newer.timeline.resolve([]); newerOk ? newer.trends.resolve(trends) : newer.trends.reject(new Error("newer failed")); });
    await act(async () => { older.timeline.resolve([]); older.trends.resolve(trends); });
    await expect(refresh).resolves.toBe(newerOk);
    newerOk ? await expect(mutationOutcome).resolves.toBe(true) : await expect(mutationOutcome).resolves.toBeInstanceOf(HealthMutationRefreshError);
    expect(vi.mocked(healthApi.listEvents).mock.calls
      .filter(([request]) => request?.category === "medication")).toHaveLength(1);
  });
});
