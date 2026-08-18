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

  it("uses exactly one route and three reads for every Diet mutation", async () => {
    mockOtherReads();
    vi.spyOn(healthApi, "listDiet").mockResolvedValue([]);
    const create = vi.spyOn(healthApi, "createDiet").mockResolvedValue(entry);
    const createWithImage = vi.spyOn(healthApi, "createDietWithImage").mockResolvedValue(entry);
    const update = vi.spyOn(healthApi, "updateDiet").mockResolvedValue(entry);
    const updateWithImage = vi.spyOn(healthApi, "updateDietWithImage").mockResolvedValue(entry);
    const archive = vi.spyOn(healthApi, "archiveDiet").mockResolvedValue(entry);
    const { result } = renderHook(() => useHealthController());
    await waitFor(() => expect(result.current.state.dietStatus).toBe("loaded"));
    const input = {
      occurredAt: entry.occurredAt,
      mealType: entry.mealType,
      foodName: entry.foodName,
    };
    const image = new Blob(["photo"], { type: "image/jpeg" });
    const mutations = [create, createWithImage, update, updateWithImage, archive];
    const cases = [
      { expected: create, run: () => result.current.createDiet(input) },
      { expected: createWithImage, run: () => result.current.createDiet(input, image) },
      { expected: update, run: () => result.current.updateDiet("diet-1", { note: "text" }) },
      {
        expected: updateWithImage,
        run: () => result.current.updateDiet("diet-1", { note: "photo" }, image),
      },
      { expected: archive, run: () => result.current.archiveDiet("diet-1") },
    ];

    for (const mutationCase of cases) {
      for (const mutation of mutations) mutation.mockClear();
      vi.mocked(healthApi.listDiet).mockClear();
      vi.mocked(healthApi.timeline).mockClear();
      vi.mocked(healthApi.trends).mockClear();

      await act(async () => mutationCase.run());

      expect(mutationCase.expected).toHaveBeenCalledOnce();
      expect(mutations.reduce((total, mutation) => total + mutation.mock.calls.length, 0))
        .toBe(1);
      expect(healthApi.listDiet).toHaveBeenCalledOnce();
      expect(healthApi.timeline).toHaveBeenCalledOnce();
      expect(healthApi.trends).toHaveBeenCalledOnce();
    }
  });

  it.each(["diet", "timeline", "trends"] as const)(
    "throws after a saved mutation when the %s refresh fails and retries reads only",
    async (failedRead) => {
    mockOtherReads();
    vi.spyOn(healthApi, "listDiet").mockResolvedValue([]);
    const read = failedRead === "diet"
      ? vi.mocked(healthApi.listDiet)
      : failedRead === "timeline"
        ? vi.mocked(healthApi.timeline)
        : vi.mocked(healthApi.trends);
    const create = vi.spyOn(healthApi, "createDiet").mockResolvedValue(entry);
    const { result } = renderHook(() => useHealthController());
    await waitFor(() => {
      expect(healthApi.listDiet).toHaveBeenCalledOnce();
      expect(healthApi.timeline).toHaveBeenCalledOnce();
      expect(healthApi.trends).toHaveBeenCalledOnce();
    });
    vi.mocked(healthApi.listDiet).mockClear();
    vi.mocked(healthApi.timeline).mockClear();
    vi.mocked(healthApi.trends).mockClear();
    read.mockRejectedValueOnce(new Error(`${failedRead} refresh failed`));

    await act(async () => {
      await expect(result.current.createDiet({
        occurredAt: entry.occurredAt,
        mealType: entry.mealType,
        foodName: entry.foodName,
      })).rejects.toBeInstanceOf(HealthMutationRefreshError);
    });
    expect(create).toHaveBeenCalledOnce();
    await act(async () => {
      await expect(result.current.refresh()).resolves.toBe(true);
    });
    expect(create).toHaveBeenCalledOnce();
    expect(healthApi.listDiet).toHaveBeenCalledTimes(2);
    expect(healthApi.timeline).toHaveBeenCalledTimes(2);
    expect(healthApi.trends).toHaveBeenCalledTimes(2);
  });

  it("keeps a stale pre-mutation Diet failure from replacing the newer result", async () => {
    mockOtherReads();
    const older = deferred<DietEntry[]>();
    const newer = deferred<DietEntry[]>();
    vi.spyOn(healthApi, "listDiet")
      .mockImplementationOnce(() => older.promise)
      .mockImplementationOnce(() => newer.promise);
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
    await waitFor(() => expect(healthApi.listDiet).toHaveBeenCalledTimes(2));
    await act(async () => newer.resolve([entry]));
    await act(async () => mutation);
    expect(result.current.state.dietEntries).toEqual([entry]);
    await act(async () => older.reject(new Error("stale failure")));
    expect(result.current.state.dietEntries).toEqual([entry]);
    expect(result.current.state.dietError).toBeNull();
  });

  it("keeps a stale pre-mutation Diet result from replacing the newer result", async () => {
    mockOtherReads();
    const older = deferred<DietEntry[]>();
    const newer = deferred<DietEntry[]>();
    vi.spyOn(healthApi, "listDiet")
      .mockImplementationOnce(() => older.promise)
      .mockImplementationOnce(() => newer.promise);
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
    await waitFor(() => expect(healthApi.listDiet).toHaveBeenCalledTimes(2));
    await act(async () => newer.resolve([entry]));
    await act(async () => mutation);
    await act(async () => older.resolve([{ ...entry, id: "stale" }]));

    expect(result.current.state.dietEntries).toEqual([entry]);
    expect(result.current.state.dietStatus).toBe("loaded");
    expect(result.current.state.dietError).toBeNull();
  });
});
