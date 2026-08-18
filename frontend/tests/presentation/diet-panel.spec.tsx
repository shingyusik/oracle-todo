import "@testing-library/jest-dom/vitest";

import { act, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { healthApi } from "@/features/health/api/health-api";
import {
  HealthMutationRefreshError,
  useHealthController,
} from "@/features/health/hooks/useHealthController";
import type { DietEntry, HealthTrends } from "@/features/health/model/health-model";
import type { HealthController, HealthState } from "@/features/health/hooks/useHealthController";
import { defaultHealthTableSettings } from "@/features/health/model/health-table-views";
import { DietPanel as DietPanelView } from "@/features/health/ui/DietPanel";

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

const loadedState: HealthState = {
  dietStatus: "loaded",
  dietError: null,
  dietEntries: [entry],
  timelineStatus: "loaded",
  timelineError: null,
  timeline: [],
  timelineHasMore: false,
  trendsStatus: "loaded",
  trendsError: null,
  trends,
};

function controller(
  state: HealthState = loadedState,
  settings = defaultHealthTableSettings("health.diet"),
): HealthController {
  return {
    state,
    tableViewSaveError: null,
    retryTableViewSave: vi.fn(),
    tableViewConfirmation: null,
    tableTabs: () => ({
      tabs: [{ id: "health.diet-table", name: "Table", settings }],
      activeTabId: "health.diet-table",
      draftSettings: settings,
    }),
    tableSettings: () => settings,
    tableIsDirty: vi.fn(() => false),
    updateTableSettings: vi.fn(),
    selectTableTab: vi.fn(),
    saveTableTab: vi.fn(),
    createTableTab: vi.fn(() => true),
    renameTableTab: vi.fn(() => true),
    requestDeleteTableTab: vi.fn(),
    confirmTableViewAction: vi.fn(),
    cancelTableViewAction: vi.fn(),
    refresh: vi.fn(),
    refreshDiet: vi.fn().mockResolvedValue(true),
    refreshTimeline: vi.fn(),
    loadMoreTimeline: vi.fn(),
    refreshTrends: vi.fn(),
    createDiet: vi.fn(),
    updateDiet: vi.fn(),
    archiveDiet: vi.fn().mockResolvedValue(undefined),
    createBowel: vi.fn(),
    createMedication: vi.fn(),
    upsertMetrics: vi.fn(),
    archive: vi.fn(),
    restore: vi.fn(),
    purge: vi.fn(),
  };
}

function DietPanel({ controller: health }: { controller: HealthController }) {
  const [tombstonedIds, setTombstonedIds] = React.useState<Set<string>>(() => new Set());
  const [refreshWarning, setRefreshWarning] = React.useState<string | null>(null);
  const [refreshPending, setRefreshPending] = React.useState(false);

  return (
    <DietPanelView
      controller={health}
      tombstonedIds={tombstonedIds}
      onArchiveCommitted={(id, warning) => {
        setTombstonedIds((current) => new Set(current).add(id));
        if (warning) setRefreshWarning(warning);
      }}
      refreshWarning={refreshWarning}
      refreshPending={refreshPending}
      onRetryRefresh={async () => {
        setRefreshPending(true);
        try {
          if (await health.refresh()) setRefreshWarning(null);
        } finally {
          setRefreshPending(false);
        }
      }}
    />
  );
}

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

function readSet() {
  return {
    diet: deferred<DietEntry[]>(),
    timeline: deferred<Awaited<ReturnType<typeof healthApi.timeline>>>(),
    trends: deferred<HealthTrends>(),
  };
}

function mockOverlappingReads() {
  const older = readSet();
  const newer = readSet();
  vi.mocked(healthApi.listDiet).mockReset()
    .mockImplementationOnce(() => older.diet.promise)
    .mockImplementationOnce(() => newer.diet.promise);
  vi.mocked(healthApi.timeline).mockReset()
    .mockImplementationOnce(() => older.timeline.promise)
    .mockImplementationOnce(() => newer.timeline.promise);
  vi.mocked(healthApi.trends).mockReset()
    .mockImplementationOnce(() => older.trends.promise)
    .mockImplementationOnce(() => newer.trends.promise);
  return { older, newer };
}

function resolveReads(reads: ReturnType<typeof readSet>, dietEntries: DietEntry[] = []) {
  reads.diet.resolve(dietEntries);
  reads.timeline.resolve([]);
  reads.trends.resolve(trends);
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

  it("lets an older aggregate refresh adopt a newer successful mutation refresh", async () => {
    mockOtherReads();
    vi.spyOn(healthApi, "listDiet").mockResolvedValue([]);
    vi.spyOn(healthApi, "createDiet").mockResolvedValue(entry);
    const { result } = renderHook(() => useHealthController());
    await waitFor(() => expect(result.current.state.dietStatus).toBe("loaded"));
    const { older, newer } = mockOverlappingReads();

    let refresh!: Promise<boolean>;
    let mutation!: Promise<void>;
    await act(async () => {
      refresh = result.current.refresh();
      await Promise.resolve();
      mutation = result.current.createDiet({
        occurredAt: entry.occurredAt,
        mealType: entry.mealType,
        foodName: entry.foodName,
      });
      await Promise.resolve();
    });
    await waitFor(() => expect(healthApi.listDiet).toHaveBeenCalledTimes(2));
    await act(async () => resolveReads(newer, [entry]));
    await act(async () => mutation);
    await act(async () => resolveReads(older, [{ ...entry, id: "stale" }]));

    await expect(refresh).resolves.toBe(true);
    expect(result.current.state.dietEntries).toEqual([entry]);
  });

  it.each([true, false])(
    "makes overlapping mutations adopt a newer peer outcome (success: %s)",
    async (newerSucceeds) => {
      mockOtherReads();
      vi.spyOn(healthApi, "listDiet").mockResolvedValue([]);
      const create = vi.spyOn(healthApi, "createDiet").mockResolvedValue(entry);
      const { result } = renderHook(() => useHealthController());
      await waitFor(() => expect(result.current.state.dietStatus).toBe("loaded"));
      const { older, newer } = mockOverlappingReads();
      const input = {
        occurredAt: entry.occurredAt,
        mealType: entry.mealType,
        foodName: entry.foodName,
      };

      let first!: Promise<void>;
      let second!: Promise<void>;
      await act(async () => {
        first = result.current.createDiet(input);
        await Promise.resolve();
        second = result.current.createDiet(input);
        await Promise.resolve();
      });
      const firstOutcome = first.then(() => true, (error: unknown) => error);
      const secondOutcome = second.then(() => true, (error: unknown) => error);
      await waitFor(() => expect(healthApi.listDiet).toHaveBeenCalledTimes(2));
      await act(async () => {
        if (newerSucceeds) {
          resolveReads(newer, [entry]);
        } else {
          newer.diet.reject(new Error("newer Diet failed"));
          newer.timeline.resolve([]);
          newer.trends.resolve(trends);
        }
      });
      await act(async () => resolveReads(older, [{ ...entry, id: "stale" }]));

      if (newerSucceeds) {
        await expect(firstOutcome).resolves.toBe(true);
        await expect(secondOutcome).resolves.toBe(true);
        expect(result.current.state.dietEntries).toEqual([entry]);
        expect(result.current.state.dietError).toBeNull();
      } else {
        await expect(firstOutcome).resolves.toBeInstanceOf(HealthMutationRefreshError);
        await expect(secondOutcome).resolves.toBeInstanceOf(HealthMutationRefreshError);
        expect(result.current.state.dietError).toBe("newer Diet failed");
      }
      expect(create).toHaveBeenCalledTimes(2);
    },
  );

  it.each([true, false])(
    "makes a mutation adopt a later aggregate refresh outcome (success: %s)",
    async (newerSucceeds) => {
      mockOtherReads();
      vi.spyOn(healthApi, "listDiet").mockResolvedValue([]);
      const create = vi.spyOn(healthApi, "createDiet").mockResolvedValue(entry);
      const { result } = renderHook(() => useHealthController());
      await waitFor(() => expect(result.current.state.dietStatus).toBe("loaded"));
      const diet = deferred<DietEntry[]>();
      const older = readSet();
      const newer = readSet();
      vi.mocked(healthApi.listDiet).mockReset().mockImplementation(() => diet.promise);
      vi.mocked(healthApi.timeline).mockReset()
        .mockImplementationOnce(() => older.timeline.promise)
        .mockImplementationOnce(() => newer.timeline.promise);
      vi.mocked(healthApi.trends).mockReset()
        .mockImplementationOnce(() => older.trends.promise)
        .mockImplementationOnce(() => newer.trends.promise);

      let mutation!: Promise<void>;
      let refresh!: Promise<boolean>;
      await act(async () => {
        mutation = result.current.createDiet({
          occurredAt: entry.occurredAt,
          mealType: entry.mealType,
          foodName: entry.foodName,
        });
        await Promise.resolve();
        refresh = result.current.refresh();
        await Promise.resolve();
      });
      const mutationOutcome = mutation.then(() => true, (error: unknown) => error);
      await act(async () => {
        diet.resolve([entry]);
        newer.timeline.resolve([]);
        if (newerSucceeds) newer.trends.resolve(trends);
        else newer.trends.reject(new Error("newer Trends failed"));
      });
      await act(async () => {
        older.timeline.resolve([]);
        older.trends.resolve(trends);
      });

      await expect(refresh).resolves.toBe(newerSucceeds);
      if (newerSucceeds) {
        await expect(mutationOutcome).resolves.toBe(true);
        expect(result.current.state.trendsError).toBeNull();
      } else {
        await expect(mutationOutcome).resolves.toBeInstanceOf(HealthMutationRefreshError);
        expect(result.current.state.trendsError).toBe("newer Trends failed");
      }
      expect(create).toHaveBeenCalledOnce();
      expect(healthApi.listDiet).toHaveBeenCalledOnce();
    },
  );
});

describe("DietPanel table", () => {
  afterEach(() => vi.restoreAllMocks());

  it("renders active Diet rows in the required columns with accessible interaction", async () => {
    const user = userEvent.setup();
    const archived = { ...entry, id: "archived", foodName: "Old meal", deletedAt: entry.updatedAt };
    render(<DietPanel controller={controller({
      ...loadedState,
      dietEntries: [{ ...entry, note: "Good", mediaId: "photo-1" }, archived],
    })} />);

    expect(screen.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
      "", "Time", "Meal", "Food", "Tags", "Photo", "Note",
    ]);
    const row = screen.getByRole("button", { name: /Open details for Bibimbap/ });
    expect(within(row).getByText("Lunch")).toBeInTheDocument();
    expect(within(row).getByText("rice")).toBeInTheDocument();
    expect(within(row).getByText("Photo")).toBeInTheDocument();
    expect(within(row).getByText("Good")).toBeInTheDocument();
    expect(screen.queryByText("Old meal")).toBeNull();

    const checkbox = screen.getByRole("checkbox", { name: /Select Bibimbap/ });
    await user.click(checkbox);
    expect(screen.queryByText("Diet entry details")).toBeNull();
    checkbox.focus();
    await user.keyboard("{Enter} ");
    expect(screen.queryByText("Diet entry details")).toBeNull();
    row.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByText("Diet entry details")).toBeInTheDocument();
  });

  it("distinguishes no active entries from no matches", () => {
    const view = render(<DietPanel controller={controller({
      ...loadedState,
      dietEntries: [{ ...entry, deletedAt: entry.updatedAt }],
    })} />);
    expect(screen.getByText("No diet entries yet.")).toBeInTheDocument();

    const filtered = defaultHealthTableSettings("health.diet");
    filtered.filterRules = [{
      id: "dinner", field: "meal_type", type: "select", operator: "is", value: ["dinner"],
    }];
    view.rerender(<DietPanel controller={controller(loadedState, filtered)} />);
    expect(screen.getByText("No diet entries match this view.")).toBeInTheDocument();
  });

  it("selects visible rows only, keeps hidden active selections, and reconciles archived truth", async () => {
    const user = userEvent.setup();
    const dinner = { ...entry, id: "dinner", mealType: "dinner" as const, foodName: "Soup" };
    const health = controller({ ...loadedState, dietEntries: [entry, dinner] });
    const view = render(<DietPanel controller={health} />);
    const selectAll = screen.getByRole("checkbox", { name: "Select all visible diet entries" });
    await user.click(screen.getByRole("checkbox", { name: /Select Bibimbap/ }));
    expect(selectAll).toHaveProperty("indeterminate", true);

    const dinnerOnly = defaultHealthTableSettings("health.diet");
    dinnerOnly.filterRules = [{
      id: "dinner", field: "meal_type", type: "select", operator: "is", value: ["dinner"],
    }];
    view.rerender(<DietPanel controller={{ ...health, tableSettings: () => dinnerOnly }} />);
    await user.click(screen.getByRole("checkbox", { name: "Select all visible diet entries" }));
    view.rerender(<DietPanel controller={health} />);
    expect(screen.getByRole("checkbox", { name: /Select Bibimbap/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Select Soup/ })).toBeChecked();

    view.rerender(<DietPanel controller={{
      ...health,
      state: { ...health.state, dietEntries: [{ ...dinner, deletedAt: dinner.updatedAt }] },
    }} />);
    await waitFor(() => expect(screen.queryByRole("checkbox", { name: /Select Soup/ })).toBeNull());
  });

  it("disables an empty visible archive and snapshots only selected visible rows", async () => {
    const user = userEvent.setup();
    const dinner = { ...entry, id: "dinner", mealType: "dinner" as const, foodName: "Soup" };
    const health = controller({ ...loadedState, dietEntries: [entry, dinner] });
    const view = render(<DietPanel controller={health} />);
    await user.click(screen.getByRole("checkbox", { name: /Select Bibimbap/ }));

    const dinnerOnly = defaultHealthTableSettings("health.diet");
    dinnerOnly.filterRules = [{
      id: "dinner", field: "meal_type", type: "select", operator: "is", value: ["dinner"],
    }];
    view.rerender(<DietPanel controller={{ ...health, tableSettings: () => dinnerOnly }} />);
    const remove = screen.getByRole("button", { name: "Archive selected diet entries" });
    expect(remove).toBeDisabled();
    await user.click(remove);
    expect(screen.queryByRole("dialog", { name: "Archive selected diet entries?" })).toBeNull();

    await user.click(screen.getByRole("checkbox", { name: /Select Soup/ }));
    expect(remove).toBeEnabled();
    await user.click(remove);
    const dialog = screen.getByRole("dialog", { name: "Archive selected diet entries?" });
    expect(dialog).toHaveTextContent("1 diet entries will be archived");
    await user.click(within(dialog).getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(health.archiveDiet).toHaveBeenCalledWith("dinner"));
    expect(health.archiveDiet).not.toHaveBeenCalledWith("diet-1");

    view.rerender(<DietPanel controller={health} />);
    expect(screen.getByRole("checkbox", { name: /Select Bibimbap/ })).toBeChecked();
  });

  it("places saved views left and Filter Sort Group Add Delete actions right", () => {
    render(<DietPanel controller={controller()} />);
    const tabs = screen.getByRole("tablist", { name: "Diet views" });
    const actions = screen.getByRole("button", { name: "Add diet entry" }).parentElement!;
    expect(actions).toHaveClass("workspace-table-header-actions");
    expect(actions.parentElement?.firstElementChild).toBe(tabs);
    expect([...actions.children]).toEqual([
      screen.getByRole("group", { name: "Diet controls" }),
      screen.getByRole("button", { name: "Add diet entry" }),
      screen.getByRole("button", { name: "Archive selected diet entries" }),
    ]);
  });

  it("shows initial loading/error and retains rows for a refresh error", async () => {
    const retry = vi.fn();
    const view = render(<DietPanel controller={{
      ...controller({ ...loadedState, dietStatus: "loading", dietEntries: [] }),
      refreshDiet: retry,
    }} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading diet entries");
    view.rerender(<DietPanel controller={{
      ...controller({ ...loadedState, dietStatus: "error", dietEntries: [], dietError: "Diet unavailable" }),
      refreshDiet: retry,
    }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Diet unavailable");
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledOnce();
    view.rerender(<DietPanel controller={controller({ ...loadedState, dietError: "Refresh failed" })} />);
    expect(screen.getByText("Bibimbap")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Refresh failed");
  });

  it("archives a snapshotted visible selection sequentially and restores focus", async () => {
    const user = userEvent.setup();
    const first = deferred<void>();
    const dinner = { ...entry, id: "dinner", mealType: "dinner" as const, foodName: "Soup" };
    const health = controller({ ...loadedState, dietEntries: [entry, dinner] });
    health.archiveDiet = vi.fn((id) => id === entry.id ? first.promise : Promise.resolve());
    const view = render(<DietPanel controller={health} />);
    await user.click(screen.getByRole("checkbox", { name: /Select Bibimbap/ }));
    await user.click(screen.getByRole("checkbox", { name: /Select Soup/ }));
    const remove = screen.getByRole("button", { name: "Archive selected diet entries" });
    await user.click(remove);
    const dialog = screen.getByRole("dialog", { name: "Archive selected diet entries?" });
    await user.click(within(dialog).getByRole("button", { name: "Archive" }));
    expect(health.archiveDiet).toHaveBeenCalledWith(entry.id);
    view.rerender(<DietPanel controller={{ ...health, tableSettings: () => ({
      ...defaultHealthTableSettings("health.diet"),
      filterRules: [{ id: "none", field: "food", type: "text", operator: "contains", value: "zzz" }],
    }) }} />);
    await act(async () => first.resolve());
    await waitFor(() => expect(health.archiveDiet).toHaveBeenCalledWith(dinner.id));
    await waitFor(() => expect(screen.queryByRole("dialog", {
      name: "Archive selected diet entries?",
    })).toBeNull());
    await waitFor(() => expect(screen.getByRole("button", { name: "Add diet entry" })).toHaveFocus());
  });

  it("removes successes but retains failed and unattempted selections after archive failure", async () => {
    const user = userEvent.setup();
    const dinner = { ...entry, id: "dinner", mealType: "dinner" as const, foodName: "Soup" };
    const snack = { ...entry, id: "snack", mealType: "snack" as const, foodName: "Apple" };
    const health = controller({ ...loadedState, dietEntries: [entry, dinner, snack] });
    health.archiveDiet = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("Archive failed"));
    render(<DietPanel controller={health} />);
    for (const food of ["Bibimbap", "Soup", "Apple"]) {
      await user.click(screen.getByRole("checkbox", { name: new RegExp(`Select ${food}`) }));
    }
    const remove = screen.getByRole("button", { name: "Archive selected diet entries" });
    await user.click(remove);
    await user.click(within(screen.getByRole("dialog", {
      name: "Archive selected diet entries?",
    })).getByRole("button", { name: "Archive" }));

    await waitFor(() => expect(screen.queryByRole("dialog", {
      name: "Archive selected diet entries?",
    })).toBeNull());
    expect(screen.queryByRole("checkbox", { name: /Select Bibimbap/ })).toBeNull();
    expect(screen.getByRole("checkbox", { name: /Select Soup/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Select Apple/ })).toBeChecked();
    expect(screen.getByRole("alert")).toHaveTextContent("Archive failed");
    await waitFor(() => expect(remove).toHaveFocus());
  });

  it("treats a committed archive refresh failure as success and leaves later targets unattempted", async () => {
    const user = userEvent.setup();
    const dinner = { ...entry, id: "dinner", mealType: "dinner" as const, foodName: "Soup" };
    const snack = { ...entry, id: "snack", mealType: "snack" as const, foodName: "Apple" };
    const health = controller({ ...loadedState, dietEntries: [entry, dinner, snack] });
    health.archiveDiet = vi.fn().mockRejectedValue(new HealthMutationRefreshError());
    health.refresh = vi.fn().mockResolvedValue(true);
    render(<DietPanel controller={health} />);
    for (const food of ["Bibimbap", "Soup", "Apple"]) {
      await user.click(screen.getByRole("checkbox", { name: new RegExp(`Select ${food}`) }));
    }
    const remove = screen.getByRole("button", { name: "Archive selected diet entries" });
    await user.click(remove);
    await user.click(within(screen.getByRole("dialog", {
      name: "Archive selected diet entries?",
    })).getByRole("button", { name: "Archive" }));

    await waitFor(() => expect(screen.queryByRole("dialog", {
      name: "Archive selected diet entries?",
    })).toBeNull());
    expect(health.archiveDiet).toHaveBeenCalledTimes(1);
    expect(health.archiveDiet).toHaveBeenCalledWith("diet-1");
    expect(screen.queryByRole("checkbox", { name: /Select Bibimbap/ })).toBeNull();
    expect(screen.getByRole("checkbox", { name: /Select Soup/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Select Apple/ })).toBeChecked();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Changes were saved, but Health could not refresh.",
    );
    await waitFor(() => expect(remove).toHaveFocus());

    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(health.refresh).toHaveBeenCalledOnce();
    expect(health.archiveDiet).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByText(
      "Changes were saved, but Health could not refresh.",
    )).toBeNull());
    expect(screen.queryByText("Bibimbap")).toBeNull();
  });

  it("returns focus to Add when the sole archive committed before refresh failed", async () => {
    const user = userEvent.setup();
    const health = controller();
    health.archiveDiet = vi.fn().mockRejectedValue(new HealthMutationRefreshError());
    render(<DietPanel controller={health} />);
    await user.click(screen.getByRole("checkbox", { name: /Select Bibimbap/ }));
    await user.click(screen.getByRole("button", { name: "Archive selected diet entries" }));
    await user.click(within(screen.getByRole("dialog", {
      name: "Archive selected diet entries?",
    })).getByRole("button", { name: "Archive" }));

    await waitFor(() => expect(screen.queryByText("Bibimbap")).toBeNull());
    expect(screen.getByRole("button", { name: "Archive selected diet entries" })).toBeDisabled();
    await waitFor(() => expect(screen.getByRole("button", { name: "Add diet entry" })).toHaveFocus());
  });
});
