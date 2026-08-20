import "@testing-library/jest-dom/vitest";

import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { healthApi } from "@/features/health/api/health-api";
import {
  HealthMutationRefreshError,
  useHealthController,
} from "@/features/health/hooks/useHealthController";
import type { DietEntry } from "@/features/health/model/health-model";
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
  createdAt: "2026-08-18T03:01:02Z",
  updatedAt: "2026-08-18T04:05:06Z",
  deletedAt: null,
};
const loadedState: HealthState = {
  metricsStatus: "loaded", metricsError: null, metricsEntries: [],
  medicationStatus: "loaded", medicationError: null, medicationEntries: [],
  bowelStatus: "loaded",
  bowelError: null,
  bowelEntries: [],
  dietStatus: "loaded",
  dietError: null,
  dietEntries: [entry],
  reportStatus: "idle",
  reportError: null,
  report: null,
  reportSelection: { preset: 30 },
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
    refreshMetrics: vi.fn().mockResolvedValue(true),
    refreshMedication: vi.fn().mockResolvedValue(true),
    refreshBowel: vi.fn().mockResolvedValue(true),
    refreshDiet: vi.fn().mockResolvedValue(true),
    runReports: vi.fn(),
    retryReports: vi.fn(),
    createDiet: vi.fn(),
    updateDiet: vi.fn(),
    archiveDiet: vi.fn().mockResolvedValue(undefined),
    createBowel: vi.fn(),
    updateBowel: vi.fn(),
    archiveBowel: vi.fn(),
    createMedication: vi.fn(),
    updateMedication: vi.fn(), archiveMedication: vi.fn(),
    upsertMetrics: vi.fn(),
    saveMetrics: vi.fn(),
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
  vi.spyOn(healthApi, "listEvents").mockResolvedValue([]);
  vi.spyOn(healthApi, "reports").mockResolvedValue({} as never);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));
}

function readSet() {
  return {
    diet: deferred<DietEntry[]>(),
  };
}

function mockOverlappingReads() {
  const older = readSet();
  const newer = readSet();
  vi.mocked(healthApi.listDiet).mockReset()
    .mockImplementationOnce(() => older.diet.promise)
    .mockImplementationOnce(() => newer.diet.promise);
  return { older, newer };
}

function resolveReads(reads: ReturnType<typeof readSet>, dietEntries: DietEntry[] = []) {
  reads.diet.resolve(dietEntries);
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

  it("uses exactly one route and one Diet read for every Diet mutation", async () => {
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
      vi.mocked(healthApi.listEvents).mockClear();

      await act(async () => mutationCase.run());

      expect(mutationCase.expected).toHaveBeenCalledOnce();
      expect(mutations.reduce((total, mutation) => total + mutation.mock.calls.length, 0))
        .toBe(1);
      expect(healthApi.listDiet).toHaveBeenCalledOnce();
      expect(vi.mocked(healthApi.listEvents).mock.calls
        .filter(([request]) => request?.category === "medication")).toHaveLength(0);
      expect(healthApi.reports).not.toHaveBeenCalled();
    }
  });

  it("refreshes only each dedicated event collection", async () => {
    mockOtherReads();
    vi.spyOn(healthApi, "listDiet").mockResolvedValue([]);
    const create = vi.spyOn(healthApi, "createEvent").mockResolvedValue({} as never);
    const upsert = vi.spyOn(healthApi, "upsertDailyMetrics").mockResolvedValue([]);
    const { result } = renderHook(() => useHealthController());
    await waitFor(() => expect(result.current.state.dietStatus).toBe("loaded"));
    vi.mocked(healthApi.listDiet).mockClear();
    vi.mocked(healthApi.listDiet).mockRejectedValue(new Error("Diet unavailable"));
    vi.mocked(healthApi.listEvents).mockClear();

    const bowel = {
      occurredAt: entry.occurredAt,
      details: { kind: "bowel", bristolScale: 4, bloodVisible: false },
    } as const;
    const mutations = [create, upsert];
    const cases = [
      { eventRead: true, medicationReads: 0, run: () => result.current.createBowel(bowel) },
      { eventRead: true, medicationReads: 1, run: () => result.current.createMedication({
        occurredAt: entry.occurredAt,
        details: { kind: "medication", medicationName: "Tablet", dose: 1, unit: "tablet" },
      }) },
      { eventRead: true, medicationReads: 0, run: () => result.current.upsertMetrics([]) },
    ];

    for (const mutationCase of cases) {
      for (const mutation of mutations) mutation.mockClear();
      vi.mocked(healthApi.listEvents).mockClear();
      await act(async () => expect(mutationCase.run()).resolves.toBeUndefined());
      expect(mutations.reduce((count, mutation) => count + mutation.mock.calls.length, 0)).toBe(1);
      expect(healthApi.listDiet).not.toHaveBeenCalled();
      expect(healthApi.listEvents).toHaveBeenCalledTimes(mutationCase.eventRead ? 1 : 0);
      expect(vi.mocked(healthApi.listEvents).mock.calls
        .filter(([request]) => request?.category === "medication"))
        .toHaveLength(mutationCase.medicationReads);
      expect(healthApi.reports).not.toHaveBeenCalled();
    }
  });

  it("throws after a saved mutation when Diet refresh fails and retries reads only", async () => {
    mockOtherReads();
    vi.spyOn(healthApi, "listDiet").mockResolvedValue([]);
    const create = vi.spyOn(healthApi, "createDiet").mockResolvedValue(entry);
    const { result } = renderHook(() => useHealthController());
    await waitFor(() => {
      expect(healthApi.listDiet).toHaveBeenCalledOnce();
    });
    vi.mocked(healthApi.listDiet).mockClear();
    vi.mocked(healthApi.listDiet).mockRejectedValueOnce(new Error("Diet refresh failed"));

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

});

describe("DietPanel table", () => {
  afterEach(() => vi.restoreAllMocks());

  it("uses one browser history entry for clean Diet Back and Forward", async () => {
    const user = userEvent.setup();
    window.history.replaceState({ preserved: "diet" }, "");
    const pushState = vi.spyOn(window.history, "pushState");
    render(<DietPanel controller={controller()} />);

    await user.click(screen.getByRole("button", { name: /Open details for Bibimbap/ }));
    expect(pushState).toHaveBeenCalledOnce();
    expect(window.history.state).toMatchObject({
      preserved: "diet",
      __ravenHealthDietDetailId: "diet-1",
    });
    act(() => window.history.back());
    expect(await screen.findByRole("button", { name: /Open details for Bibimbap/ }))
      .toBeInTheDocument();
    act(() => window.history.forward());
    expect(await screen.findByText("Diet entry details")).toBeInTheDocument();
    expect(pushState).toHaveBeenCalledOnce();
  });

  it("repairs dirty browser Back on cancel and discards on confirm", async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, "");
    render(<DietPanel controller={controller()} />);
    await user.click(screen.getByRole("button", { name: /Open details for Bibimbap/ }));
    await user.type(screen.getByLabelText("Note"), "draft");

    act(() => window.history.back());
    const dialog = await screen.findByRole("dialog", { name: "Discard unsaved changes?" });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.getByLabelText("Note")).toHaveValue("draft");
    act(() => window.history.back());
    await user.click(within(await screen.findByRole("dialog", {
      name: "Discard unsaved changes?",
    })).getByRole("button", { name: "Discard changes" }));
    expect(await screen.findByRole("button", { name: /Open details for Bibimbap/ }))
      .toBeInTheDocument();
  });

  it("normalizes a stale Diet Forward entry without reopening or looping", async () => {
    const user = userEvent.setup();
    window.history.replaceState({ preserved: "stale" }, "");
    const view = render(
      <DietPanelView controller={controller()} tombstonedIds={new Set()} />,
    );
    await user.click(screen.getByRole("button", { name: /Open details for Bibimbap/ }));
    act(() => window.history.back());
    await screen.findByRole("button", { name: /Open details for Bibimbap/ });

    view.rerender(
      <DietPanelView controller={controller()} tombstonedIds={new Set(["diet-1"])} />,
    );
    act(() => window.history.forward());

    await waitFor(() => expect(window.history.state).toMatchObject({
      preserved: "stale",
      __ravenHealthDietDetailId: null,
    }));
    expect(screen.queryByText("Diet entry details")).toBeNull();
    act(() => window.history.back());
    await waitFor(() => expect(screen.queryByText("Diet entry details")).toBeNull());
  });

  it("closes a successful save through Diet history without a duplicate entry", async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, "");
    const pushState = vi.spyOn(window.history, "pushState");
    const health = controller();
    render(<DietPanel controller={health} />);
    await user.click(screen.getByRole("button", { name: /Open details for Bibimbap/ }));
    await user.type(screen.getByLabelText("Note"), "saved");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await screen.findByRole("button", { name: /Open details for Bibimbap/ });
    expect(health.updateDiet).toHaveBeenCalledOnce();
    expect(pushState).toHaveBeenCalledOnce();
    act(() => window.history.forward());
    expect(await screen.findByText("Diet entry details")).toBeInTheDocument();
    expect(pushState).toHaveBeenCalledOnce();
  });

  it("removes an archived Diet detail from its Forward history entry", async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, "");
    const health = controller();
    render(<DietPanel controller={health} />);
    await user.click(screen.getByRole("button", { name: /Open details for Bibimbap/ }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(within(screen.getByRole("dialog", {
      name: "Archive Bibimbap?",
    })).getByRole("button", { name: "Archive" }));

    await waitFor(() => expect(screen.queryByText("Diet entry details")).toBeNull());
    act(() => window.history.forward());
    await waitFor(() => expect(window.history.state.__ravenHealthDietDetailId).toBeNull());
    expect(screen.queryByText("Diet entry details")).toBeNull();
  });

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
    let row = screen.getByRole("button", { name: /Open details for Bibimbap/ });
    expect(row.tagName).toBe("TR");
    expect(row).toHaveAttribute("tabindex", "0");
    expect(within(row).queryByRole("button")).toBeNull();
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
    await user.click(within(row).getByText("Lunch"));
    expect(screen.getByText("Diet entry details")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "< Back" }));
    row = screen.getByRole("button", { name: /Open details for Bibimbap/ });
    row.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByText("Diet entry details")).toBeInTheDocument();
  });

  it("opens detail by click or Enter, renders the approved editor order, and restores row focus", async () => {
    const user = userEvent.setup();
    render(<DietPanel controller={controller()} />);
    const row = screen.getByRole("button", { name: /Open details for Bibimbap/ });

    await user.click(row);
    const detailHeader = screen.getByRole("region", { name: "Edit diet properties" })
      .closest(".detail-view")!.querySelector("header")!;
    expect(within(detailHeader).getAllByRole("button").map((button) => button.getAttribute("aria-label")))
      .toEqual(["< Back", "Undo", "Redo", "Save", "Delete"]);
    expect(screen.getByText(`Created ${new Date(entry.createdAt).toLocaleString()}`))
      .toBeInTheDocument();
    expect(screen.getByText(`Updated ${new Date(entry.updatedAt).toLocaleString()}`))
      .toBeInTheDocument();
    expect([...screen.getByRole("region", { name: "Edit diet properties" }).children]
      .map((field) => field.textContent?.trim())).toEqual([
        "Time", "MealBreakfastLunchDinnerSnackLate night", "Food", "TagsriceAdd", "PhotoNo photo", "Note",
      ]);

    await user.click(screen.getByRole("button", { name: "< Back" }));
    const restoredRow = await screen.findByRole("button", { name: /Open details for Bibimbap/ });
    await waitFor(() => expect(restoredRow).toHaveFocus());
    restoredRow.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("region", { name: "Edit diet properties" })).toBeInTheDocument();
  });

  it("uses shared tag behavior and coalesces text history while keeping distinct actions separate", async () => {
    const user = userEvent.setup();
    const dinner = { ...entry, id: "dinner", foodName: "Soup", tags: ["warm"] };
    render(<DietPanel controller={controller({ ...loadedState, dietEntries: [entry, dinner] })} />);
    await user.click(screen.getByRole("button", { name: /Open details for Bibimbap/ }));
    const food = screen.getByLabelText("Food");

    await user.clear(food);
    await user.type(food, "Rice bowl");
    await user.click(screen.getByRole("button", { name: "Tags" }));
    await user.click(screen.getByRole("option", { name: "warm" }));
    await user.click(screen.getByRole("button", { name: "Remove rice tag" }));
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByRole("button", { name: "Remove rice tag" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.queryByRole("button", { name: "Remove warm tag" })).toBeNull();
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(food).toHaveValue("Bibimbap");
    fireEvent.keyDown(window, { key: "z", ctrlKey: true, shiftKey: true });
    expect(food).toHaveValue("Rice bowl");
    await user.type(food, "!");
    expect(screen.getByRole("button", { name: "Redo" })).toBeDisabled();
  });

  it("caps draft history at 50 distinct steps while retaining the newest states", async () => {
    const user = userEvent.setup();
    render(<DietPanel controller={controller()} />);
    await user.click(screen.getByRole("button", { name: /Open details for Bibimbap/ }));
    const meal = screen.getByLabelText("Meal");
    for (let index = 0; index < 52; index += 1) {
      fireEvent.change(meal, { target: { value: index % 2 === 0 ? "breakfast" : "dinner" } });
    }
    for (let index = 0; index < 50; index += 1) {
      await user.click(screen.getByRole("button", { name: "Undo" }));
    }

    expect(meal).toHaveValue("dinner");
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
  });

  it("confirms dirty Back, keeps focus on cancel, and discards on confirmation", async () => {
    const user = userEvent.setup();
    render(<DietPanel controller={controller()} />);
    await user.click(screen.getByRole("button", { name: /Open details for Bibimbap/ }));
    await user.type(screen.getByLabelText("Note"), "changed");
    const back = screen.getByRole("button", { name: "< Back" });
    await user.click(back);
    const dialog = screen.getByRole("dialog", { name: "Discard unsaved changes?" });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(back).toHaveFocus());
    expect(screen.getByLabelText("Note")).toHaveValue("changed");
    await user.click(back);
    await user.click(within(screen.getByRole("dialog", {
      name: "Discard unsaved changes?",
    })).getByRole("button", { name: "Discard changes" }));
    expect(screen.getByRole("button", { name: /Open details for Bibimbap/ })).toBeInTheDocument();
  });

  it("saves only changed scalar and tag fields with the current row version", async () => {
    const user = userEvent.setup();
    const health = controller();
    render(<DietPanel controller={health} />);
    await user.click(screen.getByRole("button", { name: /Open details for Bibimbap/ }));
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await user.selectOptions(screen.getByLabelText("Meal"), "dinner");
    await user.click(screen.getByRole("button", { name: "Tags" }));
    await user.type(screen.getByRole("combobox", { name: "Tags" }), "Straße,wheat{Enter}");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(health.updateDiet).toHaveBeenCalledWith("diet-1", {
      mealType: "dinner",
      tags: ["rice", "Straße", "wheat"],
      expectedUpdatedAt: entry.updatedAt,
    }, undefined));
    expect(screen.getByRole("button", { name: /Open details for Bibimbap/ })).toBeInTheDocument();
  });

  it("freezes the opened version and restores focus by ID after refreshed labels change", async () => {
    const user = userEvent.setup();
    const saved = deferred<void>();
    const health = controller();
    health.updateDiet = vi.fn(() => saved.promise);
    const view = render(<DietPanel controller={health} />);
    await user.click(screen.getByRole("button", { name: /Open details for Bibimbap/ }));
    await user.type(screen.getByLabelText("Note"), "user edit");

    const refreshed = {
      ...entry,
      occurredAt: "2026-08-18T06:30:00Z",
      mealType: "dinner" as const,
      foodName: "Server meal",
      tags: ["server"],
      updatedAt: "2026-08-18T06:31:00Z",
    };
    view.rerender(<DietPanel controller={{
      ...health,
      state: { ...health.state, dietEntries: [refreshed] },
    }} />);
    expect(screen.getByLabelText("Food")).toHaveValue("Bibimbap");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(health.updateDiet).toHaveBeenCalledWith("diet-1", {
      note: "user edit",
      expectedUpdatedAt: entry.updatedAt,
    }, undefined);

    await act(async () => saved.resolve());
    const refreshedRow = await screen.findByRole("button", { name: /Open details for Server meal/ });
    await waitFor(() => expect(refreshedRow).toHaveFocus());
  });

  it("uses canonical scalar values and exact unordered tag sets for no-op checks", async () => {
    const user = userEvent.setup();
    const tagged = { ...entry, tags: ["rice", "warm", "𐐨"] };
    const health = controller({ ...loadedState, dietEntries: [tagged] });
    render(<DietPanel controller={health} />);
    await user.click(screen.getByRole("button", { name: /Open details for Bibimbap/ }));
    fireEvent.change(screen.getByLabelText("Food"), { target: { value: "  Bibimbap  " } });
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "   " } });
    const time = screen.getByLabelText("Time") as HTMLInputElement;
    fireEvent.change(time, {
      target: { value: time.value.length === 16 ? `${time.value}:00` : time.value.slice(0, 16) },
    });
    await user.click(screen.getByRole("button", { name: "Remove rice tag" }));
    await user.click(screen.getByRole("button", { name: "Remove warm tag" }));
    await user.click(screen.getByRole("button", { name: "Remove 𐐨 tag" }));
    await user.click(screen.getByRole("button", { name: "Tags" }));
    await user.type(screen.getByRole("combobox", { name: "Tags" }), "𐐨,warm,rice,rice{Enter}");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(health.updateDiet).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Food"), { target: { value: "  Kimchi  " } });
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(health.updateDiet).toHaveBeenCalledWith("diet-1", {
      foodName: "Kimchi",
      expectedUpdatedAt: entry.updatedAt,
    }, undefined);
  });

  it.each([
    ["i", "ı"],
    ["Straße", "STRASSE"],
    ["ẞ", "ss"],
    ["ＦＵＬＬ", "FULL"],
  ])("defers the %s to %s tag spelling change to the server", async (original, changed) => {
    const user = userEvent.setup();
    const tagged = { ...entry, tags: [original] };
    const health = controller({ ...loadedState, dietEntries: [tagged] });
    render(<DietPanel controller={health} />);
    await user.click(screen.getByRole("button", { name: /Open details for Bibimbap/ }));
    await user.click(screen.getByRole("button", { name: `Remove ${original} tag` }));
    await user.click(screen.getByRole("button", { name: "Tags" }));
    await user.type(screen.getByRole("combobox", { name: "Tags" }), `${changed}{Enter}`);

    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(health.updateDiet).toHaveBeenCalledWith("diet-1", {
      tags: [changed],
      expectedUpdatedAt: entry.updatedAt,
    }, undefined);
  });

  it("sends an exact RFC3339 instant across the local timezone boundary", async () => {
    const user = userEvent.setup();
    const health = controller();
    render(<DietPanel controller={health} />);
    await user.click(screen.getByRole("button", { name: /Open details for Bibimbap/ }));
    const localDate = new Date(2026, 7, 19, 0, 15, 0, 0);
    fireEvent.change(screen.getByLabelText("Time"), { target: { value: "2026-08-19T00:15:00" } });
    await user.click(screen.getByRole("button", { name: "Save" }));
    const submitted = vi.mocked(health.updateDiet).mock.calls[0]![1].occurredAt!;
    expect(health.updateDiet).toHaveBeenCalledWith("diet-1", {
      occurredAt: localDate.toISOString(),
      expectedUpdatedAt: entry.updatedAt,
    }, undefined);
    const roundTrip = new Date(submitted);
    expect([
      roundTrip.getFullYear(), roundTrip.getMonth(), roundTrip.getDate(),
      roundTrip.getHours(), roundTrip.getMinutes(), roundTrip.getSeconds(),
    ]).toEqual([2026, 7, 19, 0, 15, 0]);
  });

  it("rejects a nonexistent Diet detail wall time without losing the draft", async () => {
    const previousTimezone = process.env.TZ;
    process.env.TZ = "America/New_York";
    try {
      const health = controller();
      render(<DietPanel controller={health} />);
      await userEvent.click(screen.getByRole("button", { name: /Open details for Bibimbap/ }));
      fireEvent.change(screen.getByLabelText("Time"), {
        target: { value: "2026-03-08T02:30" },
      });

      expect(screen.getByRole("alert")).toHaveTextContent(
        "Time must be a valid local date and time",
      );
      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
      fireEvent.keyDown(window, { key: "s", ctrlKey: true });
      expect(health.updateDiet).not.toHaveBeenCalled();
      expect(screen.getByLabelText("Time")).toHaveValue("2026-03-08T02:30");
    } finally {
      if (previousTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = previousTimezone;
    }
  });

  it("keeps draft and history after save failure", async () => {
    const user = userEvent.setup();
    const health = controller();
    health.updateDiet = vi.fn().mockRejectedValue(new Error("Save failed"));
    render(<DietPanel controller={health} />);
    await user.click(screen.getByRole("button", { name: /Open details for Bibimbap/ }));
    await user.type(screen.getByLabelText("Note"), "first");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Save failed");
    expect(screen.getByLabelText("Note")).toHaveValue("first");
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByLabelText("Note")).toHaveValue("");
  });

  it("sends exactly one media update path and rejects non-images without changing intent", async () => {
    const user = userEvent.setup({ applyAccept: false });
    const withPhoto = { ...entry, mediaId: "media-1" };
    const health = controller({ ...loadedState, dietEntries: [withPhoto] });
    render(<DietPanel controller={health} />);
    await user.click(screen.getByRole("button", { name: /Open details for Bibimbap/ }));
    const photo = screen.getByLabelText("Photo");
    const invalid = new File(["text"], "notes.txt", { type: "text/plain" });
    await user.upload(photo, invalid);
    expect(screen.getByRole("alert")).toHaveTextContent("Meal image must be an image file");
    expect(screen.getByText("Current photo")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Note"), "kept");
    await user.upload(photo, invalid);
    expect(screen.getByLabelText("Note")).toHaveValue("kept");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(health.updateDiet).toHaveBeenLastCalledWith("diet-1", {
      note: "kept",
      expectedUpdatedAt: entry.updatedAt,
    }, undefined);

    await user.click(screen.getByRole("button", { name: /Open details for Bibimbap/ }));
    await user.click(screen.getByRole("button", { name: "Remove photo" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(health.updateDiet).toHaveBeenLastCalledWith("diet-1", {
      expectedUpdatedAt: entry.updatedAt,
      removeImage: true,
    }, undefined);

    await user.click(screen.getByRole("button", { name: /Open details for Bibimbap/ }));
    const image = new File(["photo"], "meal.png", { type: "image/png" });
    await user.click(screen.getByRole("button", { name: "Remove photo" }));
    await user.upload(screen.getByLabelText("Photo"), image);
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByLabelText("Photo")).toHaveProperty("files.length", 0);
    await user.click(screen.getByRole("button", { name: "Redo" }));
    expect(screen.getByText("meal.png")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(health.updateDiet).toHaveBeenLastCalledWith("diet-1", {
      expectedUpdatedAt: entry.updatedAt,
    }, image);
  });

  it("retries reads only when an update committed before refresh failed", async () => {
    const user = userEvent.setup();
    const health = controller();
    health.updateDiet = vi.fn().mockRejectedValue(new HealthMutationRefreshError());
    health.refresh = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    render(<DietPanel controller={health} />);
    await user.click(screen.getByRole("button", { name: /Open details for Bibimbap/ }));
    await user.type(screen.getByLabelText("Note"), "saved");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Changes were saved, but Health could not refresh.",
    );
    expect(screen.getByLabelText("Food")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Tags" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(health.refresh).toHaveBeenCalledOnce();
    expect(health.updateDiet).toHaveBeenCalledOnce();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Changes were saved, but Health could not refresh.",
    );
    expect(screen.getByLabelText("Note")).toHaveValue("saved");
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(health.refresh).toHaveBeenCalledTimes(2);
    expect(health.updateDiet).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: /Open details for Bibimbap/ })).toBeInTheDocument();
  });

  it("blocks invalid and pending edits, actions, shortcuts, and duplicate saves", async () => {
    const user = userEvent.setup();
    const saved = deferred<void>();
    const health = controller();
    health.updateDiet = vi.fn(() => saved.promise);
    render(<DietPanel controller={health} />);
    await user.click(screen.getByRole("button", { name: /Open details for Bibimbap/ }));
    await user.clear(screen.getByLabelText("Food"));
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    expect(health.updateDiet).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("Food"), "Dinner");
    fireEvent.keyDown(window, { key: "s", metaKey: true });
    await waitFor(() => expect(health.updateDiet).toHaveBeenCalledOnce());
    for (const name of ["< Back", "Undo", "Redo", "Save", "Delete"]) {
      expect(screen.getByRole("button", { name })).toBeDisabled();
    }
    expect(screen.getByLabelText("Food")).toBeDisabled();
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    fireEvent.keyDown(window, { key: "y", ctrlKey: true });
    expect(health.updateDiet).toHaveBeenCalledOnce();
    await act(async () => saved.resolve());
  });

  it("supports Meta undo, Shift redo, and the established Ctrl+Y alternative", async () => {
    const user = userEvent.setup();
    render(<DietPanel controller={controller()} />);
    await user.click(screen.getByRole("button", { name: /Open details for Bibimbap/ }));
    fireEvent.change(screen.getByLabelText("Food"), { target: { value: "Dinner" } });
    fireEvent.keyDown(window, { key: "z", metaKey: true });
    expect(screen.getByLabelText("Food")).toHaveValue("Bibimbap");
    fireEvent.keyDown(window, { key: "z", metaKey: true, shiftKey: true });
    expect(screen.getByLabelText("Food")).toHaveValue("Dinner");
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    fireEvent.keyDown(window, { key: "y", ctrlKey: true });
    expect(screen.getByLabelText("Food")).toHaveValue("Dinner");
  });

  it("treats detail archive refresh failure as committed and retries reads only", async () => {
    const user = userEvent.setup();
    const health = controller();
    health.archiveDiet = vi.fn().mockRejectedValue(new HealthMutationRefreshError());
    health.refresh = vi.fn().mockResolvedValue(true);
    render(<DietPanel controller={health} />);
    await user.click(screen.getByRole("button", { name: /Open details for Bibimbap/ }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(within(screen.getByRole("dialog", {
      name: "Archive Bibimbap?",
    })).getByRole("button", { name: "Archive" }));

    await waitFor(() => expect(screen.queryByText("Bibimbap")).toBeNull());
    expect(health.archiveDiet).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.getByRole("button", { name: "Add diet entry" })).toHaveFocus());
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(health.refresh).toHaveBeenCalledOnce();
    expect(health.archiveDiet).toHaveBeenCalledOnce();
  });

  it("archives from detail once and exits when active truth or a tombstone removes the row", async () => {
    const user = userEvent.setup();
    const health = controller();
    const view = render(<DietPanel controller={health} />);
    await user.click(screen.getByRole("button", { name: /Open details for Bibimbap/ }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(within(screen.getByRole("dialog", {
      name: "Archive Bibimbap?",
    })).getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(health.archiveDiet).toHaveBeenCalledOnce());
    expect(screen.queryByRole("region", { name: "Edit diet properties" })).toBeNull();

    view.unmount();
    const activeView = render(<DietPanel controller={health} />);
    await user.click(screen.getByRole("button", { name: /Open details for Bibimbap/ }));
    activeView.rerender(<DietPanel controller={{
      ...health,
      state: { ...health.state, dietEntries: [] },
    }} />);
    await waitFor(() => expect(screen.queryByRole("region", {
      name: "Edit diet properties",
    })).toBeNull());
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

  it("treats multi-tag occurrences as one logical selection and archive target", async () => {
    const user = userEvent.setup();
    const health = controller({
      ...loadedState,
      dietEntries: [{ ...entry, tags: ["rice", "spicy"] }],
    });
    const grouped = defaultHealthTableSettings("health.diet");
    grouped.groupSettings = { ...grouped.groupSettings, groupBy: "tag" };
    render(<DietPanel controller={{ ...health, tableSettings: () => grouped }} />);

    const occurrences = screen.getAllByRole("button", { name: /Open details for Bibimbap/ });
    expect(occurrences).toHaveLength(2);
    expect(occurrences[0]).not.toHaveAttribute("id");
    expect(occurrences[1]).not.toHaveAttribute("id");
    await user.click(screen.getAllByRole("checkbox", { name: /Select Bibimbap/ })[1]!);
    expect(screen.getByRole("checkbox", { name: "Select all visible diet entries" })).toBeChecked();
    await user.click(screen.getByRole("button", { name: "Archive selected diet entries" }));
    expect(screen.getByRole("dialog", { name: "Archive selected diet entries?" }))
      .toHaveTextContent("1 diet entries will be archived");
    await user.click(within(screen.getByRole("dialog", {
      name: "Archive selected diet entries?",
    })).getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(health.archiveDiet).toHaveBeenCalledOnce());
  });

  it("restores focus to the activated multi-tag occurrence", async () => {
    const user = userEvent.setup();
    const grouped = defaultHealthTableSettings("health.diet");
    grouped.groupSettings = { ...grouped.groupSettings, groupBy: "tag" };
    render(<DietPanel controller={{
      ...controller({ ...loadedState, dietEntries: [{ ...entry, tags: ["rice", "spicy"] }] }),
      tableSettings: () => grouped,
    }} />);

    const second = screen.getAllByRole("button", { name: /Open details for Bibimbap/ })[1]!;
    second.focus();
    await user.keyboard("{Enter}");
    await user.click(screen.getByRole("button", { name: "< Back" }));
    const restored = screen.getAllByRole("button", { name: /Open details for Bibimbap/ })[1]!;
    await waitFor(() => expect(restored).toHaveFocus());
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
