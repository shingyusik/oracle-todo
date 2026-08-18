import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { healthApi } from "@/features/health/api/health-api";
import {
  HealthMutationRefreshError,
  useHealthController,
} from "@/features/health/hooks/useHealthController";
import type { DietEntry, HealthTrends } from "@/features/health/model/health-model";

const entry: DietEntry = {
  id: "diet-1",
  occurredAt: "2026-08-18T03:00:00Z",
  mealType: "lunch",
  foodName: "Bibimbap",
  note: null,
  tags: ["rice"],
  mediaId: null,
  createdAt: "2026-08-18T03:00:00Z",
  updatedAt: "2026-08-18T03:00:00Z",
  deletedAt: null,
};
const trends = { days: 30 } as HealthTrends;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function mockOtherReads() {
  vi.spyOn(healthApi, "timeline").mockResolvedValue([]);
  vi.spyOn(healthApi, "trends").mockResolvedValue(trends);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));
}

describe("Health Diet controller", () => {
  afterEach(() => vi.restoreAllMocks());

  it("drains 200-row Diet pages and keeps the API response unchanged", async () => {
    mockOtherReads();
    const first = Array.from({ length: 200 }, (_, index) => ({
      ...entry,
      id: `diet-${index}`,
    }));
    const archivedFromApi = { ...entry, id: "diet-archived", deletedAt: entry.updatedAt };
    vi.spyOn(healthApi, "listDiet")
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce([archivedFromApi]);

    const { result } = renderHook(() => useHealthController());
    await waitFor(() => expect(result.current.state.dietStatus).toBe("loaded"));

    expect(healthApi.listDiet).toHaveBeenNthCalledWith(1, { limit: 200, offset: 0 });
    expect(healthApi.listDiet).toHaveBeenNthCalledWith(2, { limit: 200, offset: 200 });
    expect(result.current.state.dietEntries).toHaveLength(201);
    expect(result.current.state.dietEntries.at(-1)).toEqual(archivedFromApi);
  });

  it("coalesces concurrent refreshes and retains loaded rows on refresh failure", async () => {
    mockOtherReads();
    const pending = deferred<DietEntry[]>();
    vi.spyOn(healthApi, "listDiet")
      .mockResolvedValueOnce([entry])
      .mockImplementationOnce(() => pending.promise);
    const { result } = renderHook(() => useHealthController());
    await waitFor(() => expect(result.current.state.dietStatus).toBe("loaded"));

    let first!: Promise<boolean>;
    let second!: Promise<boolean>;
    await act(async () => {
      first = result.current.refreshDiet();
      second = result.current.refreshDiet();
      await Promise.resolve();
    });
    expect(healthApi.listDiet).toHaveBeenCalledTimes(2);
    await act(async () => pending.reject(new Error("Diet unavailable")));
    await expect(first).resolves.toBe(false);
    await expect(second).resolves.toBe(false);
    expect(result.current.state.dietStatus).toBe("loaded");
    expect(result.current.state.dietError).toBe("Diet unavailable");
    expect(result.current.state.dietEntries).toEqual([entry]);
  });

  it("uses a blocking error when the initial Diet load fails", async () => {
    mockOtherReads();
    vi.spyOn(healthApi, "listDiet").mockRejectedValue(new Error("No Diet"));
    const { result } = renderHook(() => useHealthController());
    await waitFor(() => expect(result.current.state.dietStatus).toBe("error"));
    expect(result.current.state.dietError).toBe("No Diet");
  });

  it("runs one Diet mutation route and refreshes Diet, Timeline, and Trends", async () => {
    mockOtherReads();
    vi.spyOn(healthApi, "listDiet").mockResolvedValue([]);
    const update = vi.spyOn(healthApi, "updateDiet").mockResolvedValue(entry);
    const updateWithImage = vi.spyOn(healthApi, "updateDietWithImage").mockResolvedValue(entry);
    const archive = vi.spyOn(healthApi, "archiveDiet").mockResolvedValue(entry);
    const { result } = renderHook(() => useHealthController());
    await waitFor(() => expect(result.current.state.dietStatus).toBe("loaded"));
    vi.mocked(healthApi.listDiet).mockClear();
    vi.mocked(healthApi.timeline).mockClear();
    vi.mocked(healthApi.trends).mockClear();

    const image = new Blob(["photo"], { type: "image/jpeg" });
    await act(async () => result.current.updateDiet("diet-1", { note: "updated" }, image));
    expect(update).not.toHaveBeenCalled();
    expect(updateWithImage).toHaveBeenCalledOnce();
    expect(healthApi.listDiet).toHaveBeenCalledOnce();
    expect(healthApi.timeline).toHaveBeenCalledOnce();
    expect(healthApi.trends).toHaveBeenCalledOnce();

    await act(async () => result.current.archiveDiet("diet-1"));
    expect(archive).toHaveBeenCalledOnce();
  });

  it("throws after a saved mutation if a read refresh fails without retrying it", async () => {
    mockOtherReads();
    vi.spyOn(healthApi, "listDiet")
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error("refresh failed"))
      .mockResolvedValueOnce([]);
    const create = vi.spyOn(healthApi, "createDiet").mockResolvedValue(entry);
    const { result } = renderHook(() => useHealthController());
    await waitFor(() => expect(result.current.state.dietStatus).toBe("loaded"));

    await act(async () => {
      await expect(result.current.createDiet({
        occurredAt: entry.occurredAt,
        mealType: entry.mealType,
        foodName: entry.foodName,
      })).rejects.toBeInstanceOf(HealthMutationRefreshError);
    });
    expect(create).toHaveBeenCalledOnce();
    await act(async () => {
      await expect(result.current.refreshDiet()).resolves.toBe(true);
    });
    expect(create).toHaveBeenCalledOnce();
  });

  it("starts a post-mutation Diet read after an earlier refresh finishes", async () => {
    mockOtherReads();
    const initial = deferred<DietEntry[]>();
    vi.spyOn(healthApi, "listDiet")
      .mockImplementationOnce(() => initial.promise)
      .mockResolvedValueOnce([entry]);
    vi.spyOn(healthApi, "createDiet").mockResolvedValue(entry);
    const { result } = renderHook(() => useHealthController());

    let mutation!: Promise<void>;
    await act(async () => {
      mutation = result.current.createDiet({
        occurredAt: entry.occurredAt,
        mealType: entry.mealType,
        foodName: entry.foodName,
      });
      await Promise.resolve();
    });
    await act(async () => initial.resolve([]));
    await act(async () => mutation);

    expect(healthApi.listDiet).toHaveBeenCalledTimes(2);
    expect(result.current.state.dietEntries).toEqual([entry]);
  });
});
