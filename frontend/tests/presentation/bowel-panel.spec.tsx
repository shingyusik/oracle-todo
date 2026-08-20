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
import type {
  EventInput,
  EventUpdate,
  HealthEvent,
  HealthTrends,
  TimelineItem,
} from "@/features/health/model/health-model";
import type { HealthController, HealthState } from "@/features/health/hooks/useHealthController";
import { deriveBowelGroups, type BowelRowGroup } from "@/features/health/model/bowel-table";
import { defaultHealthTableSettings } from "@/features/health/model/health-table-views";
import { BowelPanel } from "@/features/health/ui/BowelPanel";
import { BowelTable } from "@/features/health/ui/BowelTable";
import { localDateTimeToRfc3339 } from "@/features/health/ui/HealthForms";

const event: HealthEvent = {
  id: "bowel-1",
  occurredAt: "2026-08-19T01:00:00Z",
  category: "bowel",
  metricKey: "bowel",
  name: "Bowel",
  value: 4,
  unit: null,
  note: null,
  attributes: { kind: "bowel", bristolScale: 4, bloodVisible: false },
  createdAt: "2026-08-19T01:00:00Z",
  updatedAt: "2026-08-19T01:00:00Z",
  deletedAt: null,
};
const trends = { days: 30 } as HealthTrends;
const input: EventInput = {
  occurredAt: event.occurredAt,
  details: { kind: "bowel", bristolScale: 4, bloodVisible: false },
};
const update: EventUpdate = { note: "updated" };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function controlHistoryForward() {
  const forward = window.history.forward.bind(window.history);
  const pending: Array<() => void> = [];
  const spy = vi.spyOn(window.history, "forward").mockImplementation(() => {
    pending.push(forward);
  });
  return {
    spy,
    async releaseNext() {
      const next = pending.shift();
      if (!next) throw new Error("No pending history.forward() call");
      const popped = new Promise<void>((resolve) => {
        window.addEventListener("popstate", () => resolve(), { once: true });
      });
      await act(async () => {
        next();
        await popped;
      });
    },
  };
}

function mockBaseReads() {
  vi.spyOn(healthApi, "listDiet").mockResolvedValue([]);
  vi.spyOn(healthApi, "listEvents").mockResolvedValue([]);
  vi.spyOn(healthApi, "timeline").mockResolvedValue([]);
  vi.spyOn(healthApi, "trends").mockResolvedValue(trends);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));
}

type Reads = {
  bowel: ReturnType<typeof deferred<HealthEvent[]>>;
  timeline: ReturnType<typeof deferred<TimelineItem[]>>;
  trends: ReturnType<typeof deferred<HealthTrends>>;
};

function reads(): Reads {
  return {
    bowel: deferred<HealthEvent[]>(),
    timeline: deferred<TimelineItem[]>(),
    trends: deferred<HealthTrends>(),
  };
}

function resolveReads(set: Reads, entries: HealthEvent[] = []) {
  set.bowel.resolve(entries);
  set.timeline.resolve([]);
  set.trends.resolve(trends);
}

function mockOverlappingReads() {
  const older = reads();
  const newer = reads();
  vi.mocked(healthApi.listEvents).mockReset()
    .mockImplementationOnce(() => older.bowel.promise)
    .mockImplementationOnce(() => newer.bowel.promise);
  vi.mocked(healthApi.timeline).mockReset()
    .mockImplementationOnce(() => older.timeline.promise)
    .mockImplementationOnce(() => newer.timeline.promise);
  vi.mocked(healthApi.trends).mockReset()
    .mockImplementationOnce(() => older.trends.promise)
    .mockImplementationOnce(() => newer.trends.promise);
  return { older, newer };
}

async function mountedController() {
  const hook = renderHook(() => useHealthController());
  await waitFor(() => expect(hook.result.current.state.bowelStatus).toBe("loaded"));
  return hook;
}

describe("Health Bowel controller", () => {
  afterEach(() => vi.restoreAllMocks());

  it("loads Bowel initially, drains 200-row pages, and retains raw archived events", async () => {
    mockBaseReads();
    const first = Array.from({ length: 200 }, (_, index) => ({ ...event, id: `bowel-${index}` }));
    const archived = { ...event, id: "archived", deletedAt: event.updatedAt };
    let bowelPage = 0;
    vi.mocked(healthApi.listEvents).mockImplementation(async (query) => {
      if (query?.category !== "bowel") return [];
      return bowelPage++ === 0 ? first : [archived];
    });

    const { result } = renderHook(() => useHealthController());
    await waitFor(() => expect(result.current.state.bowelStatus).toBe("loaded"));

    const bowelCalls = vi.mocked(healthApi.listEvents).mock.calls
      .filter(([request]) => request?.category === "bowel");
    expect(bowelCalls[0]).toEqual([{
      category: "bowel", limit: 200, offset: 0,
    }]);
    expect(bowelCalls[1]).toEqual([{
      category: "bowel", limit: 200, offset: 200,
    }]);
    expect(result.current.state.bowelEntries).toHaveLength(201);
    expect(result.current.state.bowelEntries.at(-1)).toEqual(archived);
  });

  it("coalesces ordinary refreshes and retains loaded rows on refresh error", async () => {
    mockBaseReads();
    vi.mocked(healthApi.listEvents).mockResolvedValueOnce([event]);
    const { result } = await mountedController();
    const pending = deferred<HealthEvent[]>();
    vi.mocked(healthApi.listEvents).mockImplementationOnce(() => pending.promise);
    vi.mocked(healthApi.listEvents).mockClear();

    let first!: Promise<boolean>;
    let second!: Promise<boolean>;
    await act(async () => {
      first = result.current.refreshBowel();
      second = result.current.refreshBowel();
      await Promise.resolve();
    });
    expect(healthApi.listEvents).toHaveBeenCalledOnce();
    await act(async () => pending.reject(new Error("Bowel unavailable")));
    await expect(first).resolves.toBe(false);
    await expect(second).resolves.toBe(false);
    expect(result.current.state.bowelStatus).toBe("loaded");
    expect(result.current.state.bowelError).toBe("Bowel unavailable");
    expect(result.current.state.bowelEntries).toEqual([event]);
  });

  it("uses a blocking error when the initial Bowel load fails", async () => {
    mockBaseReads();
    vi.mocked(healthApi.listEvents).mockRejectedValue(new Error("No Bowel"));
    const { result } = renderHook(() => useHealthController());
    await waitFor(() => expect(result.current.state.bowelStatus).toBe("error"));
    expect(result.current.state.bowelError).toBe("No Bowel");
  });

  it("refreshBowel reads exactly Bowel, Timeline, and Trends", async () => {
    mockBaseReads();
    const { result } = await mountedController();
    vi.mocked(healthApi.listDiet).mockClear();
    vi.mocked(healthApi.listEvents).mockClear();
    vi.mocked(healthApi.timeline).mockClear();
    vi.mocked(healthApi.trends).mockClear();

    await act(async () => expect(result.current.refreshBowel()).resolves.toBe(true));

    expect(healthApi.listDiet).not.toHaveBeenCalled();
    expect(healthApi.listEvents).toHaveBeenCalledOnce();
    expect(healthApi.timeline).toHaveBeenCalledOnce();
    expect(healthApi.trends).toHaveBeenCalledOnce();
  });

  it.each(["create", "update", "archive"] as const)(
    "uses one %s mutation and exactly three Bowel reads",
    async (kind) => {
      mockBaseReads();
      const create = vi.spyOn(healthApi, "createEvent").mockResolvedValue(event);
      const updateEvent = vi.spyOn(healthApi, "updateEvent").mockResolvedValue(event);
      const archive = vi.spyOn(healthApi, "archiveEvent").mockResolvedValue(event);
      const { result } = await mountedController();
      for (const spy of [create, updateEvent, archive]) spy.mockClear();
      vi.mocked(healthApi.listEvents).mockClear();
      vi.mocked(healthApi.timeline).mockClear();
      vi.mocked(healthApi.trends).mockClear();

      await act(async () => {
        if (kind === "create") await result.current.createBowel(input);
        else if (kind === "update") await result.current.updateBowel(event.id, update);
        else await result.current.archiveBowel(event.id);
      });

      const expected = kind === "create" ? create : kind === "update" ? updateEvent : archive;
      expect(expected).toHaveBeenCalledOnce();
      expect(create.mock.calls.length + updateEvent.mock.calls.length + archive.mock.calls.length)
        .toBe(1);
      expect(healthApi.listEvents).toHaveBeenCalledOnce();
      expect(healthApi.timeline).toHaveBeenCalledOnce();
      expect(healthApi.trends).toHaveBeenCalledOnce();
    },
  );

  it.each(["bowel", "timeline", "trends"] as const)(
    "throws after commit when %s fails and retries only the three reads",
    async (failed) => {
      mockBaseReads();
      const create = vi.spyOn(healthApi, "createEvent").mockResolvedValue(event);
      const { result } = await mountedController();
      vi.mocked(healthApi.listEvents).mockClear();
      vi.mocked(healthApi.timeline).mockClear();
      vi.mocked(healthApi.trends).mockClear();
      const read = failed === "bowel" ? vi.mocked(healthApi.listEvents)
        : failed === "timeline" ? vi.mocked(healthApi.timeline) : vi.mocked(healthApi.trends);
      read.mockRejectedValueOnce(new Error(`${failed} failed`));

      await act(async () => {
        await expect(result.current.createBowel(input)).rejects
          .toBeInstanceOf(HealthMutationRefreshError);
      });
      await act(async () => expect(result.current.refreshBowel()).resolves.toBe(true));

      expect(create).toHaveBeenCalledOnce();
      expect(healthApi.listEvents).toHaveBeenCalledTimes(2);
      expect(healthApi.timeline).toHaveBeenCalledTimes(2);
      expect(healthApi.trends).toHaveBeenCalledTimes(2);
    },
  );

  it("keeps Diet and generic event mutation refresh boundaries independent of Bowel", async () => {
    mockBaseReads();
    const createDiet = vi.spyOn(healthApi, "createDiet").mockResolvedValue({} as never);
    const createEvent = vi.spyOn(healthApi, "createEvent").mockResolvedValue(event);
    const metrics = vi.spyOn(healthApi, "upsertDailyMetrics").mockResolvedValue([]);
    const { result } = await mountedController();
    vi.mocked(healthApi.listEvents).mockClear();
    vi.mocked(healthApi.listEvents).mockImplementation((query) => query?.category === "bowel"
      ? Promise.reject(new Error("Bowel unavailable"))
      : Promise.resolve([]));

    await act(async () => expect(result.current.createDiet({
      occurredAt: event.occurredAt, mealType: "lunch", foodName: "Soup",
    })).resolves.toBeUndefined());
    await act(async () => expect(result.current.createMedication({
      occurredAt: event.occurredAt,
      details: { kind: "medication", medicationName: "Tablet", dose: 1, unit: "tablet" },
    })).resolves.toBeUndefined());
    await act(async () => expect(result.current.upsertMetrics([])).resolves.toBeUndefined());

    expect(createDiet).toHaveBeenCalledOnce();
    expect(createEvent).toHaveBeenCalledOnce();
    expect(metrics).toHaveBeenCalledOnce();
    expect(vi.mocked(healthApi.listEvents).mock.calls
      .filter(([request]) => request?.category === "bowel")).toHaveLength(0);
    expect(vi.mocked(healthApi.listEvents).mock.calls
      .filter(([request]) => request?.category === "medication")).toHaveLength(1);
  });

  it.each([true, false])(
    "makes overlapping Bowel mutations adopt the newer outcome (success: %s)",
    async (newerSucceeds) => {
      mockBaseReads();
      const create = vi.spyOn(healthApi, "createEvent").mockResolvedValue(event);
      const { result } = await mountedController();
      const { older, newer } = mockOverlappingReads();

      let first!: Promise<void>;
      let second!: Promise<void>;
      await act(async () => {
        first = result.current.createBowel(input);
        await Promise.resolve();
        second = result.current.createBowel(input);
        await Promise.resolve();
      });
      const firstOutcome = first.then(() => true, (error: unknown) => error);
      const secondOutcome = second.then(() => true, (error: unknown) => error);
      await act(async () => {
        if (newerSucceeds) resolveReads(newer, [event]);
        else {
          newer.bowel.reject(new Error("newer failed"));
          newer.timeline.resolve([]);
          newer.trends.resolve(trends);
        }
      });
      await act(async () => resolveReads(older, [{ ...event, id: "stale" }]));

      if (newerSucceeds) {
        await expect(firstOutcome).resolves.toBe(true);
        await expect(secondOutcome).resolves.toBe(true);
        expect(result.current.state.bowelEntries).toEqual([event]);
      } else {
        await expect(firstOutcome).resolves.toBeInstanceOf(HealthMutationRefreshError);
        await expect(secondOutcome).resolves.toBeInstanceOf(HealthMutationRefreshError);
        expect(result.current.state.bowelError).toBe("newer failed");
      }
      expect(create).toHaveBeenCalledTimes(2);
    },
  );

  it.each([true, false])(
    "makes an old ordinary refresh adopt a forced mutation result without a promise cycle (success: %s)",
    async (newerSucceeds) => {
    mockBaseReads();
    vi.spyOn(healthApi, "createEvent").mockResolvedValue(event);
    const { result } = await mountedController();
    const { older, newer } = mockOverlappingReads();

    let refresh!: Promise<boolean>;
    let mutation!: Promise<void>;
    await act(async () => {
      refresh = result.current.refreshBowel();
      await Promise.resolve();
      mutation = result.current.createBowel(input);
      await Promise.resolve();
    });
    const mutationOutcome = mutation.then(() => true, (error: unknown) => error);
    await act(async () => {
      if (newerSucceeds) resolveReads(newer, [event]);
      else {
        newer.bowel.reject(new Error("forced Bowel failed"));
        newer.timeline.resolve([]);
        newer.trends.resolve(trends);
      }
    });
    await act(async () => resolveReads(older, [{ ...event, id: "stale" }]));

    await expect(refresh).resolves.toBe(newerSucceeds);
    if (newerSucceeds) {
      await expect(mutationOutcome).resolves.toBe(true);
      expect(result.current.state.bowelEntries).toEqual([event]);
    } else {
      await expect(mutationOutcome).resolves.toBeInstanceOf(HealthMutationRefreshError);
      expect(result.current.state.bowelError).toBe("forced Bowel failed");
    }
  });

  it.each([true, false])(
    "makes a Bowel mutation adopt a later aggregate outcome (success: %s)",
    async (newerSucceeds) => {
      mockBaseReads();
      const create = vi.spyOn(healthApi, "createEvent").mockResolvedValue(event);
      const { result } = await mountedController();
      const bowel = deferred<HealthEvent[]>();
      const older = reads();
      const newer = reads();
      vi.mocked(healthApi.listEvents).mockReset().mockImplementation(() => bowel.promise);
      vi.mocked(healthApi.timeline).mockReset()
        .mockImplementationOnce(() => older.timeline.promise)
        .mockImplementationOnce(() => newer.timeline.promise);
      vi.mocked(healthApi.trends).mockReset()
        .mockImplementationOnce(() => older.trends.promise)
        .mockImplementationOnce(() => newer.trends.promise);

      let mutation!: Promise<void>;
      let refresh!: Promise<boolean>;
      await act(async () => {
        mutation = result.current.createBowel(input);
        await Promise.resolve();
        refresh = result.current.refresh();
        await Promise.resolve();
      });
      const mutationOutcome = mutation.then(() => true, (error: unknown) => error);
      await act(async () => {
        bowel.resolve([event]);
        newer.timeline.resolve([]);
        if (newerSucceeds) newer.trends.resolve(trends);
        else newer.trends.reject(new Error("newer Trends failed"));
      });
      await act(async () => {
        older.timeline.resolve([]);
        older.trends.resolve(trends);
      });

      await expect(refresh).resolves.toBe(newerSucceeds);
      if (newerSucceeds) await expect(mutationOutcome).resolves.toBe(true);
      else await expect(mutationOutcome).resolves.toBeInstanceOf(HealthMutationRefreshError);
      expect(create).toHaveBeenCalledOnce();
      expect(vi.mocked(healthApi.listEvents).mock.calls
        .filter(([request]) => request?.category === "bowel")).toHaveLength(1);
    },
  );
});

const loadedState: HealthState = {
  medicationStatus: "loaded", medicationError: null, medicationEntries: [],
  bowelStatus: "loaded", bowelError: null, bowelEntries: [event],
  dietStatus: "loaded", dietError: null, dietEntries: [],
  timelineStatus: "loaded", timelineError: null, timeline: [], timelineHasMore: false,
  trendsStatus: "loaded", trendsError: null, trends,
};

function panelController(
  state: HealthState = loadedState,
  settings = defaultHealthTableSettings("health.bowel"),
): HealthController {
  return {
    state,
    tableViewSaveError: null,
    retryTableViewSave: vi.fn(),
    tableViewConfirmation: null,
    tableTabs: vi.fn((scope) => ({
      tabs: [{ id: `${scope}-table`, name: "Table", settings }],
      activeTabId: `${scope}-table`, draftSettings: settings,
    })),
    tableSettings: vi.fn(() => settings),
    tableIsDirty: vi.fn(() => false), updateTableSettings: vi.fn(),
    selectTableTab: vi.fn(), saveTableTab: vi.fn(), createTableTab: vi.fn(() => true),
    renameTableTab: vi.fn(() => true), requestDeleteTableTab: vi.fn(),
    confirmTableViewAction: vi.fn(), cancelTableViewAction: vi.fn(),
    refresh: vi.fn(), refreshMedication: vi.fn(), refreshBowel: vi.fn(), refreshDiet: vi.fn(), refreshTimeline: vi.fn(),
    loadMoreTimeline: vi.fn(), refreshTrends: vi.fn(),
    createDiet: vi.fn(), updateDiet: vi.fn(), archiveDiet: vi.fn(),
    createBowel: vi.fn(), updateBowel: vi.fn(), archiveBowel: vi.fn(),
    createMedication: vi.fn(), updateMedication: vi.fn(), archiveMedication: vi.fn(),
    upsertMetrics: vi.fn(), archive: vi.fn(), restore: vi.fn(), purge: vi.fn(),
  };
}

function BowelPanelHarness({ controller }: { controller: HealthController }) {
  const [tombstonedIds, setTombstonedIds] = React.useState<Set<string>>(() => new Set());
  const [refreshWarning, setRefreshWarning] = React.useState<string | null>(null);
  const [refreshPending, setRefreshPending] = React.useState(false);
  return <BowelPanel controller={controller} tombstonedIds={tombstonedIds}
    onArchiveCommitted={(id, warning) => {
      setTombstonedIds((current) => new Set(current).add(id));
      if (warning) setRefreshWarning(warning);
    }}
    refreshWarning={refreshWarning} refreshPending={refreshPending}
    onRetryRefresh={async () => {
      setRefreshPending(true);
      try {
        if (await controller.refreshBowel()) setRefreshWarning(null);
      } finally {
        setRefreshPending(false);
      }
    }} />;
}

describe("Bowel table workflow", () => {
  afterEach(() => vi.restoreAllMocks());
  it("opens Bowel details from a real contextual Time button without making the row interactive", async () => {
    const user = userEvent.setup();
    const open = vi.fn();
    const groups = deriveBowelGroups([event], defaultHealthTableSettings("health.bowel"));
    render(<BowelTable groups={groups} activeRowCount={1} selectedIds={[]}
      onOpen={open} onToggle={vi.fn()} onToggleAll={vi.fn()} />);
    expect(within(screen.getByRole("table", { name: "Bowel entries" }))
      .getAllByRole("columnheader").map((cell) => cell.textContent))
      .toEqual(["", "Time", "Bristol Scale", "Blood Visible", "Note"]);
    expect(screen.getByText("Type 4")).toBeInTheDocument();
    expect(screen.getByText("No")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Select Type 4.*No/ })).toBeInTheDocument();
    const button = screen.getByRole("button", { name: /Open details for Type 4/ });
    expect(button).toHaveAttribute("data-bowel-row-id", event.id);
    expect(button).toHaveAttribute("data-bowel-occurrence", "all-bowel-1-0");
    expect(button.closest("tr")).not.toHaveAttribute("tabindex");
    await user.click(button);
    expect(open).toHaveBeenCalledWith(groups[0]!.rows[0], "all-bowel-1-0");
  });

  it("deduplicates repeated logical rows across constructed groups", async () => {
    const user = userEvent.setup();
    const row = deriveBowelGroups([event], defaultHealthTableSettings("health.bowel"))[0]!.rows[0]!;
    const groups: BowelRowGroup[] = [
      { key: "first", label: "First", rows: [row] },
      { key: "second", label: "Second", rows: [row] },
    ];
    const toggle = vi.fn();
    const toggleAll = vi.fn();
    const view = render(<BowelTable groups={groups} activeRowCount={1} selectedIds={[]}
      onOpen={vi.fn()} onToggle={toggle} onToggleAll={toggleAll} />);
    await user.click(screen.getByRole("checkbox", { name: "Select all visible bowel entries" }));
    expect(toggleAll).toHaveBeenCalledOnce();
    view.rerender(<BowelTable groups={groups} activeRowCount={1} selectedIds={[event.id]}
      onOpen={vi.fn()} onToggle={toggle} onToggleAll={toggleAll} />);
    expect(screen.getByRole("checkbox", { name: "Select all visible bowel entries" })).toBeChecked();
    expect(screen.getAllByRole("checkbox", { name: /Select Type 4/ })).toHaveLength(2);
    await user.click(screen.getAllByRole("checkbox", { name: /Select Type 4/ })[1]!);
    expect(toggle).toHaveBeenCalledOnce();
    expect(toggle).toHaveBeenCalledWith(event.id);
  });

  it("edits a Bowel entry with canonical dirty state and a minimal optimistic patch", async () => {
    const user = userEvent.setup();
    const health = panelController();
    render(<BowelPanelHarness controller={health} />);
    await user.click(screen.getByRole("button", { name: /Open details for Type 4/ }));
    expect(screen.getByText("Bowel entry details")).toBeInTheDocument();
    expect([...screen.getByRole("region", { name: "Edit bowel properties" }).children]
      .map((node) => node.firstChild?.textContent?.trim()))
      .toEqual(["Time", "Bristol Scale", "Blood Visible", "Note"]);
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    await user.selectOptions(screen.getByLabelText("Bristol Scale"), "7");
    await user.click(screen.getByLabelText("Blood Visible"));
    await user.click(save);
    await waitFor(() => expect(health.updateBowel).toHaveBeenCalledWith("bowel-1", {
      details: { kind: "bowel", bristolScale: 7, bloodVisible: true },
      expectedUpdatedAt: event.updatedAt,
    }));
  });

  it("keeps the detail draft and returns focus to Delete after archive failure", async () => {
    const user = userEvent.setup();
    const health = panelController();
    health.archiveBowel = vi.fn().mockRejectedValue(new Error("Archive failed"));
    render(<BowelPanelHarness controller={health} />);
    await user.click(screen.getByRole("button", { name: /Open details for Type 4/ }));
    await user.type(screen.getByLabelText("Note"), "draft");
    const remove = screen.getByRole("button", { name: "Delete" });
    await user.click(remove);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByLabelText("Note")).toHaveValue("draft");
    expect(screen.getByRole("alert")).toHaveTextContent("Archive failed");
    await waitFor(() => expect(remove).toHaveFocus());
    expect(health.archiveBowel).toHaveBeenCalledOnce();
  });

  it("renders the exact Bowel detail contract and supports row, button, and checkbox interaction", async () => {
    const user = userEvent.setup();
    const distinct = { ...event, createdAt: "2026-08-18T01:00:00Z" };
    render(<BowelPanelHarness controller={panelController({ ...loadedState, bowelEntries: [distinct] })} />);
    const checkbox = screen.getByRole("checkbox", { name: /Select Type 4/ });
    await user.click(checkbox);
    checkbox.focus();
    await user.keyboard("{Enter} ");
    expect(screen.queryByText("Bowel entry details")).toBeNull();
    await user.click(screen.getByText("Type 4"));
    expect(screen.getByText("Bowel entry details")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Bowel · Type 4" })).toBeInTheDocument();
    expect(screen.getByText(`Created ${new Date(distinct.createdAt).toLocaleString()}`)).toBeInTheDocument();
    expect(screen.getByText(`Updated ${new Date(distinct.updatedAt).toLocaleString()}`)).toBeInTheDocument();
    const header = screen.getByRole("region", { name: "Edit bowel properties" })
      .closest(".detail-view")!.querySelector("header")!;
    expect(within(header).getAllByRole("button").map((button) => button.getAttribute("aria-label")))
      .toEqual(["< Back", "Undo", "Redo", "Save", "Delete"]);
    expect(within(header).getByRole("button", { name: "Undo" })).toHaveAttribute("title", "Undo (Ctrl/Cmd+Z)");
    expect(within(header).getByRole("button", { name: "Redo" })).toHaveAttribute("title", "Redo (Ctrl/Cmd+Shift+Z or Ctrl+Y)");
    await user.click(screen.getByRole("button", { name: "< Back" }));
    const open = await screen.findByRole("button", { name: /Open details for Type 4/ });
    await waitFor(() => expect(open).toHaveFocus());
    open.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByText("Bowel entry details")).toBeInTheDocument();
  });

  it("uses one browser entry for clean Back/Forward without a push loop", async () => {
    const user = userEvent.setup();
    window.history.replaceState({ preserved: "bowel" }, "");
    const pushState = vi.spyOn(window.history, "pushState");
    render(<BowelPanelHarness controller={panelController()} />);
    await user.click(screen.getByRole("button", { name: /Open details for Type 4/ }));
    expect(pushState).toHaveBeenCalledOnce();
    expect(window.history.state).toMatchObject({ preserved: "bowel", __ravenHealthBowelDetailId: event.id });
    act(() => window.history.back());
    await screen.findByRole("button", { name: /Open details for Type 4/ });
    act(() => window.history.forward());
    await screen.findByText("Bowel entry details");
    expect(pushState).toHaveBeenCalledOnce();
  });

  it("repairs dirty browser Back on cancel and discards without a loop", async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, "");
    const pushState = vi.spyOn(window.history, "pushState");
    render(<BowelPanelHarness controller={panelController()} />);
    await user.click(screen.getByRole("button", { name: /Open details for Type 4/ }));
    await user.type(screen.getByLabelText("Note"), "draft");
    act(() => window.history.back());
    const dialog = await screen.findByRole("dialog", { name: "Discard unsaved changes?" });
    expect(screen.getByLabelText("Note")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save", hidden: true })).toBeDisabled();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "< Back" })).toHaveFocus());
    expect(screen.getByLabelText("Note")).toHaveValue("draft");
    act(() => window.history.back());
    await user.click(within(await screen.findByRole("dialog", { name: "Discard unsaved changes?" }))
      .getByRole("button", { name: "Discard changes" }));
    await screen.findByRole("button", { name: /Open details for Type 4/ });
    expect(pushState).toHaveBeenCalledOnce();
  });

  it("repairs dirty browser Forward on cancel and confirm with Back focus", async () => {
    const user = userEvent.setup();
    window.history.pushState({ historySide: "back" }, "");
    const back = vi.spyOn(window.history, "back");
    const forward = vi.spyOn(window.history, "forward");
    render(<BowelPanelHarness controller={panelController()} />);
    await user.click(screen.getByRole("button", { name: /Open details for Type 4/ }));
    window.history.pushState({
      ...window.history.state,
      __ravenHealthBowelDetailId: null,
      __ravenHealthBowelDetailId__index:
        (window.history.state.__ravenHealthBowelDetailId__index as number) + 1,
      historySide: "forward",
    }, "");
    act(() => window.history.back());
    await waitFor(() => expect(window.history.state.__ravenHealthBowelDetailId).toBe(event.id));
    await user.type(screen.getByLabelText("Note"), "forward draft");

    act(() => window.history.forward());
    let dialog = await screen.findByRole("dialog", { name: "Discard unsaved changes?" });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "< Back" })).toHaveFocus());
    expect(screen.getByLabelText("Note")).toHaveValue("forward draft");

    act(() => window.history.forward());
    dialog = await screen.findByRole("dialog", { name: "Discard unsaved changes?" });
    await user.click(within(dialog).getByRole("button", { name: "Discard changes" }));
    await screen.findByRole("button", { name: /Open details for Type 4/ });
    await waitFor(() => expect(window.history.state).toMatchObject({
      __ravenHealthBowelDetailId: null,
      historySide: "forward",
    }));
    expect(forward).toHaveBeenCalledTimes(3);
    expect(back).toHaveBeenCalledTimes(3);
  });

  it("normalizes a stale Forward ID independently of tombstones", async () => {
    const user = userEvent.setup();
    window.history.replaceState({ preserved: "stale-id" }, "");
    render(<BowelPanelHarness controller={panelController()} />);
    await user.click(screen.getByRole("button", { name: /Open details for Type 4/ }));
    act(() => window.history.back());
    await screen.findByRole("button", { name: /Open details for Type 4/ });
    act(() => window.history.forward());
    await screen.findByText("Bowel entry details");
    window.history.replaceState({ ...window.history.state,
      __ravenHealthBowelDetailId: "missing-bowel" }, "");
    act(() => window.history.back());
    await screen.findByRole("button", { name: /Open details for Type 4/ });
    act(() => window.history.forward());
    await waitFor(() => expect(window.history.state).toMatchObject({
      preserved: "stale-id", __ravenHealthBowelDetailId: null,
    }));
    expect(screen.queryByText("Bowel entry details")).toBeNull();
  });

  it("normalizes stale or tombstoned Forward history without reopening", async () => {
    const user = userEvent.setup();
    window.history.replaceState({ preserved: "stale" }, "");
    const health = panelController();
    const view = render(<BowelPanel controller={health} tombstonedIds={new Set()}
      onArchiveCommitted={vi.fn()} refreshWarning={null} refreshPending={false}
      onRetryRefresh={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /Open details for Type 4/ }));
    act(() => window.history.back());
    await screen.findByRole("button", { name: /Open details for Type 4/ });
    view.rerender(<BowelPanel controller={health} tombstonedIds={new Set([event.id])}
      onArchiveCommitted={vi.fn()} refreshWarning={null} refreshPending={false}
      onRetryRefresh={vi.fn()} />);
    act(() => window.history.forward());
    await waitFor(() => expect(window.history.state.__ravenHealthBowelDetailId).toBeNull());
    expect(screen.queryByText("Bowel entry details")).toBeNull();
  });

  it("closes save through one history entry and restores focus by row ID when occurrence changes", async () => {
    const user = userEvent.setup();
    window.history.pushState({}, "");
    const pushState = vi.spyOn(window.history, "pushState");
    const saved = deferred<void>();
    const grouped = defaultHealthTableSettings("health.bowel");
    grouped.groupSettings = { ...grouped.groupSettings, groupBy: "day" };
    const health = panelController(loadedState, grouped);
    health.updateBowel = vi.fn(() => saved.promise);
    const view = render(<BowelPanelHarness controller={health} />);
    const origin = screen.getByRole("button", { name: /Open details for Type 4/ });
    const oldOccurrence = origin.dataset.bowelOccurrence;
    await user.click(origin);
    fireEvent.change(screen.getByLabelText("Time"), { target: { value: "2026-08-20T10:00" } });
    await user.click(screen.getByRole("button", { name: "Save" }));
    const refreshed = { ...event, occurredAt: "2026-08-20T01:00:00Z",
      updatedAt: "2026-08-20T01:01:00Z" };
    view.rerender(<BowelPanelHarness controller={{ ...health,
      state: { ...health.state, bowelEntries: [refreshed] } }} />);
    await act(async () => saved.resolve());
    const row = await screen.findByRole("button", { name: /Open details for Type 4/ });
    expect(row.dataset.bowelOccurrence).not.toBe(oldOccurrence);
    await waitFor(() => expect(row).toHaveFocus());
    expect(pushState).toHaveBeenCalledOnce();
    act(() => window.history.forward());
    await screen.findByText("Bowel entry details");
    expect(pushState).toHaveBeenCalledOnce();
  });

  it.each([
    ["time", "occurredAt", "2026-08-20T11:30", (value: string) => ({ occurredAt: localDateTimeToRfc3339(value) })],
    ["Bristol", "bristolScale", "1", () => ({ details: { kind: "bowel", bristolScale: 1, bloodVisible: false } })],
    ["blood", "bloodVisible", true, () => ({ details: { kind: "bowel", bristolScale: 4, bloodVisible: true } })],
    ["note", "note", "  changed  ", () => ({ note: "changed" })],
  ] as const)("sends one minimal %s-only patch", async (_name, field, value, expected) => {
    const user = userEvent.setup();
    const health = panelController();
    render(<BowelPanelHarness controller={health} />);
    await user.click(screen.getByRole("button", { name: /Open details for Type 4/ }));
    const input = screen.getByLabelText(field === "bristolScale" ? "Bristol Scale"
      : field === "bloodVisible" ? "Blood Visible" : field === "occurredAt" ? "Time" : "Note");
    if (field === "bristolScale") await user.selectOptions(input, value as string);
    else if (field === "bloodVisible") await user.click(input);
    else fireEvent.change(input, { target: { value } });
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(health.updateBowel).toHaveBeenCalledWith(event.id, {
      ...expected(value as string), expectedUpdatedAt: event.updatedAt,
    }));
    expect(health.updateBowel).toHaveBeenCalledOnce();
    await screen.findByRole("button", { name: /Open details for Type 4/ });
  });

  it("freezes the opened draft and optimistic version across a same-ID refresh", async () => {
    const user = userEvent.setup();
    const saved = deferred<void>();
    const health = panelController();
    health.updateBowel = vi.fn(() => saved.promise);
    const view = render(<BowelPanelHarness controller={health} />);
    await user.click(screen.getByRole("button", { name: /Open details for Type 4/ }));
    await user.type(screen.getByLabelText("Note"), "user edit");
    const refreshed = { ...event, occurredAt: "2026-08-20T03:00:00Z", updatedAt: "2026-08-20T03:01:00Z",
      attributes: { kind: "bowel" as const, bristolScale: 7, bloodVisible: true } };
    view.rerender(<BowelPanelHarness controller={{ ...health,
      state: { ...health.state, bowelEntries: [refreshed] } }} />);
    expect(screen.getByLabelText("Bristol Scale")).toHaveValue("4");
    expect(screen.getByLabelText("Blood Visible")).not.toBeChecked();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(health.updateBowel).toHaveBeenCalledWith(event.id, {
      note: "user edit", expectedUpdatedAt: event.updatedAt,
    });
    await act(async () => saved.resolve());
  });

  it("treats whitespace and equivalent local time as canonical no-ops and offers Type 1 through 7", async () => {
    const user = userEvent.setup();
    const health = panelController();
    render(<BowelPanelHarness controller={health} />);
    await user.click(screen.getByRole("button", { name: /Open details for Type 4/ }));
    const time = screen.getByLabelText("Time") as HTMLInputElement;
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "   " } });
    fireEvent.change(time, { target: { value: time.value.length === 16 ? `${time.value}:00` : time.value.slice(0, 16) } });
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(within(screen.getByLabelText("Bristol Scale")).getAllByRole("option")
      .map((option) => option.textContent)).toEqual([
        "Type 1", "Type 2", "Type 3", "Type 4", "Type 5", "Type 6", "Type 7",
      ]);
    await user.selectOptions(screen.getByLabelText("Bristol Scale"), "1");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    await user.selectOptions(screen.getByLabelText("Bristol Scale"), "7");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    expect(health.updateBowel).not.toHaveBeenCalled();
  });

  it("coalesces Time and Note, keeps Bristol and blood distinct, and invalidates Redo", async () => {
    const user = userEvent.setup();
    render(<BowelPanelHarness controller={panelController()} />);
    await user.click(screen.getByRole("button", { name: /Open details for Type 4/ }));
    const time = screen.getByLabelText("Time");
    const originalTime = (time as HTMLInputElement).value;
    fireEvent.change(time, { target: { value: "2026-08-20T09:00" } });
    fireEvent.change(time, { target: { value: "2026-08-20T10:00" } });
    fireEvent.blur(time);
    const note = screen.getByLabelText("Note");
    await user.type(note, "abc");
    fireEvent.blur(note);
    await user.selectOptions(screen.getByLabelText("Bristol Scale"), "5");
    await user.click(screen.getByLabelText("Blood Visible"));
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByLabelText("Blood Visible")).not.toBeChecked();
    await user.click(screen.getByRole("button", { name: "Redo" }));
    expect(screen.getByLabelText("Blood Visible")).toBeChecked();
    await user.click(screen.getByRole("button", { name: "Undo" }));
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(screen.getByLabelText("Bristol Scale")).toHaveValue("4");
    fireEvent.keyDown(window, { key: "z", metaKey: true });
    expect(note).toHaveValue("");
    fireEvent.keyDown(window, { key: "z", metaKey: true, shiftKey: true });
    expect(note).toHaveValue("abc");
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(time).toHaveValue(originalTime);
    fireEvent.keyDown(window, { key: "z", ctrlKey: true, shiftKey: true });
    fireEvent.keyDown(window, { key: "z", ctrlKey: true, shiftKey: true });
    expect(note).toHaveValue("abc");
    fireEvent.keyDown(window, { key: "y", ctrlKey: true });
    expect(screen.getByLabelText("Bristol Scale")).toHaveValue("5");
    await user.selectOptions(screen.getByLabelText("Bristol Scale"), "6");
    expect(screen.getByRole("button", { name: "Redo" })).toBeDisabled();
  });

  it("caps all distinct draft history pushes at 50 and retains the newest states", async () => {
    const user = userEvent.setup();
    render(<BowelPanelHarness controller={panelController()} />);
    await user.click(screen.getByRole("button", { name: /Open details for Type 4/ }));
    const blood = screen.getByLabelText("Blood Visible");
    for (let index = 0; index < 52; index += 1) fireEvent.click(blood);
    for (let index = 0; index < 50; index += 1) {
      await user.click(screen.getByRole("button", { name: "Undo" }));
    }
    expect(blood).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Redo" })).toBeEnabled();
  });

  it("rejects a nonexistent local wall time without losing the draft", async () => {
    vi.stubEnv("TZ", "America/New_York");
    const user = userEvent.setup();
    const health = panelController();
    render(<BowelPanelHarness controller={health} />);
    await user.click(screen.getByRole("button", { name: /Open details for Type 4/ }));
    fireEvent.change(screen.getByLabelText("Time"), { target: { value: "2026-03-08T02:30" } });
    expect(screen.getByRole("alert")).toHaveTextContent("Time must be a valid local date and time");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    expect(health.updateBowel).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Time")).toHaveValue("2026-03-08T02:30");
    vi.unstubAllEnvs();
  });

  it("keeps draft/history after one ordinary update failure and saves exactly once per action", async () => {
    const user = userEvent.setup();
    const health = panelController();
    health.updateBowel = vi.fn().mockRejectedValueOnce(new Error("Save failed"));
    render(<BowelPanelHarness controller={health} />);
    await user.click(screen.getByRole("button", { name: /Open details for Type 4/ }));
    await user.type(screen.getByLabelText("Note"), "draft");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Save failed");
    expect(screen.getByLabelText("Note")).toHaveValue("draft");
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByLabelText("Note")).toHaveValue("");
    expect(health.updateBowel).toHaveBeenCalledOnce();
  });

  it("blocks invalid, IME, pending, and confirmation shortcuts and duplicate actions", async () => {
    const user = userEvent.setup();
    const saved = deferred<void>();
    const health = panelController();
    health.updateBowel = vi.fn(() => saved.promise);
    render(<BowelPanelHarness controller={health} />);
    await user.click(screen.getByRole("button", { name: /Open details for Type 4/ }));
    fireEvent.change(screen.getByLabelText("Time"), { target: { value: "" } });
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    expect(health.updateBowel).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Time"), { target: { value: "2026-08-20T10:00" } });
    fireEvent.keyDown(window, { key: "s", ctrlKey: true, isComposing: true });
    expect(health.updateBowel).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(health.updateBowel).not.toHaveBeenCalled();
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    fireEvent.keyDown(window, { key: "s", metaKey: true });
    await waitFor(() => expect(health.updateBowel).toHaveBeenCalledOnce());
    for (const name of ["< Back", "Undo", "Redo", "Save", "Delete"]) {
      expect(screen.getByRole("button", { name })).toBeDisabled();
    }
    expect(screen.getByLabelText("Time")).toBeDisabled();
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    fireEvent.keyDown(window, { key: "y", ctrlKey: true });
    expect(health.updateBowel).toHaveBeenCalledOnce();
    await act(async () => saved.resolve());
  });

  it("freezes committed-update recovery, retries Bowel reads false then true, and never resubmits", async () => {
    const user = userEvent.setup();
    const health = panelController();
    health.updateBowel = vi.fn().mockRejectedValue(new HealthMutationRefreshError());
    health.refreshBowel = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    render(<BowelPanelHarness controller={health} />);
    await user.click(screen.getByRole("button", { name: /Open details for Type 4/ }));
    await user.type(screen.getByLabelText("Note"), "saved");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Changes were saved, but Health could not refresh.");
    for (const label of ["Time", "Bristol Scale", "Blood Visible", "Note"]) {
      expect(screen.getByLabelText(label)).toBeDisabled();
    }
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(screen.getByLabelText("Note")).toHaveValue("saved");
    expect(health.updateBowel).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByRole("button", { name: /Open details for Type 4/ });
    expect(health.refreshBowel).toHaveBeenCalledTimes(2);
    expect(health.updateBowel).toHaveBeenCalledOnce();
  });

  it("defers pending save completion until browser Back restoration settles", async () => {
    const user = userEvent.setup();
    window.history.pushState({}, "");
    const controlledForward = controlHistoryForward();
    const saved = deferred<void>();
    const health = panelController();
    health.updateBowel = vi.fn(() => saved.promise);
    render(<BowelPanelHarness controller={health} />);
    const origin = screen.getByRole("button", { name: /Open details for Type 4/ });
    await user.click(origin);
    await user.type(screen.getByLabelText("Note"), "saved during restoration");
    await user.click(screen.getByRole("button", { name: "Save" }));

    act(() => window.history.back());
    await waitFor(() => expect(controlledForward.spy).toHaveBeenCalledOnce());
    await act(async () => saved.resolve());
    expect(screen.getByText("Bowel entry details")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Discard unsaved changes?" })).toBeNull();

    await controlledForward.releaseNext();
    const restoredOrigin = await screen.findByRole("button", { name: /Open details for Type 4/ });
    await waitFor(() => expect(restoredOrigin).toHaveFocus());
    expect(screen.queryByRole("dialog", { name: "Discard unsaved changes?" })).toBeNull();
    expect(health.updateBowel).toHaveBeenCalledOnce();
  });

  it.each(["ordinary", "committed"] as const)(
    "defers %s save failure state until browser Back restoration settles",
    async (outcome) => {
      const user = userEvent.setup();
      window.history.pushState({}, "");
      const controlledForward = controlHistoryForward();
      const saved = deferred<void>();
      const health = panelController();
      health.updateBowel = vi.fn(() => saved.promise);
      render(<BowelPanelHarness controller={health} />);
      await user.click(screen.getByRole("button", { name: /Open details for Type 4/ }));
      await user.type(screen.getByLabelText("Note"), "failure draft");
      await user.click(screen.getByRole("button", { name: "Save" }));

      act(() => window.history.back());
      await waitFor(() => expect(controlledForward.spy).toHaveBeenCalledOnce());
      await act(async () => outcome === "ordinary"
        ? saved.reject(new Error("Save unavailable"))
        : saved.reject(new HealthMutationRefreshError()));
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
      expect(screen.getByLabelText("Note")).toBeDisabled();
      fireEvent.keyDown(window, { key: "s", ctrlKey: true });
      expect(screen.getByRole("button", { name: "< Back" })).toBeDisabled();
      fireEvent.click(screen.getByRole("button", { name: "< Back" }));
      expect(health.updateBowel).toHaveBeenCalledOnce();

      await controlledForward.releaseNext();
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(outcome === "ordinary"
        ? "Save unavailable" : "Changes were saved, but Health could not refresh.");
      expect(screen.queryByRole("dialog", { name: "Discard unsaved changes?" })).toBeNull();
      if (outcome === "ordinary") {
        expect(screen.getByLabelText("Note")).toBeEnabled();
        expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
      } else {
        expect(screen.getByLabelText("Note")).toBeDisabled();
        expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
      }
    },
  );

  it("defers refresh recovery Retry=false unlock until browser Back restoration settles", async () => {
    const user = userEvent.setup();
    window.history.pushState({}, "");
    const controlledForward = controlHistoryForward();
    const refreshed = deferred<boolean>();
    const health = panelController();
    health.updateBowel = vi.fn().mockRejectedValue(new HealthMutationRefreshError());
    health.refreshBowel = vi.fn(() => refreshed.promise);
    render(<BowelPanelHarness controller={health} />);
    await user.click(screen.getByRole("button", { name: /Open details for Type 4/ }));
    await user.type(screen.getByLabelText("Note"), "committed draft");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await user.click(await screen.findByRole("button", { name: "Retry" }));

    act(() => window.history.back());
    await waitFor(() => expect(controlledForward.spy).toHaveBeenCalledOnce());
    await act(async () => refreshed.resolve(false));
    expect(screen.getByRole("button", { name: "Retry" })).toBeDisabled();
    expect(screen.getByLabelText("Note")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(screen.getByRole("button", { name: "< Back" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "< Back" }));
    expect(health.refreshBowel).toHaveBeenCalledOnce();

    await controlledForward.releaseNext();
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled());
    expect(screen.getByLabelText("Note")).toBeDisabled();
    expect(screen.queryByRole("dialog", { name: "Discard unsaved changes?" })).toBeNull();
    expect(screen.getByText("Bowel entry details")).toBeInTheDocument();
  });

  it("defers archive cancellation until browser Back restoration settles", async () => {
    const user = userEvent.setup();
    window.history.pushState({}, "");
    const controlledForward = controlHistoryForward();
    render(<BowelPanelHarness controller={panelController()} />);
    await user.click(screen.getByRole("button", { name: /Open details for Type 4/ }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = screen.getByRole("dialog", { name: /Archive Bowel/ });

    act(() => window.history.back());
    await waitFor(() => expect(controlledForward.spy).toHaveBeenCalledOnce());
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(dialog).toBeInTheDocument();

    await controlledForward.releaseNext();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Archive Bowel/ })).toBeNull());
    await waitFor(() => expect(screen.getByRole("button", { name: "Delete" })).toHaveFocus());
    await user.click(screen.getByRole("button", { name: "< Back" }));
    await screen.findByRole("button", { name: /Open details for Type 4/ });
  });

  it.each(["ordinary", "committed"] as const)(
    "defers %s archive success until browser Back restoration settles",
    async (outcome) => {
      const user = userEvent.setup();
      window.history.pushState({}, "");
      const controlledForward = controlHistoryForward();
      const archived = deferred<void>();
      const health = panelController();
      health.archiveBowel = vi.fn(() => archived.promise);
      render(<BowelPanelHarness controller={health} />);
      await user.click(screen.getByRole("button", { name: /Open details for Type 4/ }));
      await user.click(screen.getByRole("button", { name: "Delete" }));
      await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Archive" }));

      act(() => window.history.back());
      await waitFor(() => expect(controlledForward.spy).toHaveBeenCalledOnce());
      await act(async () => outcome === "ordinary"
        ? archived.resolve()
        : archived.reject(new HealthMutationRefreshError()));
      expect(screen.getByText("Bowel entry details")).toBeInTheDocument();
      expect(screen.getByRole("dialog", { name: /Archive Bowel/ })).toBeInTheDocument();

      await controlledForward.releaseNext();
      await waitFor(() => expect(screen.queryByText("Bowel entry details")).toBeNull());
      await waitFor(() => expect(screen.getByRole("button", { name: "Add bowel entry" })).toHaveFocus());
      expect(screen.queryByRole("dialog", { name: "Discard unsaved changes?" })).toBeNull();
      expect(health.archiveBowel).toHaveBeenCalledOnce();
    },
  );

  it("defers ordinary archive failure cleanup until browser Back restoration settles", async () => {
    const user = userEvent.setup();
    window.history.pushState({}, "");
    const controlledForward = controlHistoryForward();
    const archived = deferred<void>();
    const health = panelController();
    health.archiveBowel = vi.fn(() => archived.promise);
    render(<BowelPanelHarness controller={health} />);
    await user.click(screen.getByRole("button", { name: /Open details for Type 4/ }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Archive" }));

    act(() => window.history.back());
    await waitFor(() => expect(controlledForward.spy).toHaveBeenCalledOnce());
    await act(async () => archived.reject(new Error("Archive unavailable")));
    expect(screen.getByRole("dialog", { name: /Archive Bowel/ })).toBeInTheDocument();

    await controlledForward.releaseNext();
    expect(await screen.findByRole("alert")).toHaveTextContent("Archive unavailable");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Archive Bowel/ })).toBeNull());
    await waitFor(() => expect(screen.getByRole("button", { name: "Delete" })).toHaveFocus());
    expect(screen.queryByRole("dialog", { name: "Discard unsaved changes?" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "< Back" }));
    await screen.findByRole("button", { name: /Open details for Type 4/ });
  });

  it("uses exact clean/dirty archive copy, cancel focus, and ordinary-success history cleanup", async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, "");
    const health = panelController();
    const pushState = vi.spyOn(window.history, "pushState");
    render(<BowelPanelHarness controller={health} />);
    await user.click(screen.getByRole("button", { name: /Open details for Type 4/ }));
    const remove = screen.getByRole("button", { name: "Delete" });
    await user.click(remove);
    expect(screen.getByRole("dialog", { name: "Archive Bowel · Type 4?" }))
      .toHaveTextContent("Move this bowel entry to Archive?");
    expect(screen.getByRole("dialog")).not.toHaveTextContent("Unsaved changes");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(remove).toHaveFocus());
    await user.type(screen.getByLabelText("Note"), "draft");
    await user.click(remove);
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Move this bowel entry to Archive? Unsaved changes will be discarded.",
    );
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(screen.queryByText("Bowel entry details")).toBeNull());
    expect(health.archiveBowel).toHaveBeenCalledOnce();
    expect(pushState).toHaveBeenCalledOnce();
    act(() => window.history.forward());
    await waitFor(() => expect(window.history.state.__ravenHealthBowelDetailId).toBeNull());
  });

  it("treats committed detail archive as success and retries without repeating it", async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, "");
    const pushState = vi.spyOn(window.history, "pushState");
    const health = panelController();
    health.archiveBowel = vi.fn().mockRejectedValue(new HealthMutationRefreshError());
    health.refreshBowel = vi.fn().mockResolvedValue(true);
    render(<BowelPanelHarness controller={health} />);
    await user.click(screen.getByRole("button", { name: /Open details for Type 4/ }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Archive" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Changes were saved, but Health could not refresh.");
    const add = screen.getByRole("button", { name: "Add bowel entry" });
    await waitFor(() => expect(add).toHaveFocus());
    expect(pushState).toHaveBeenCalledOnce();
    act(() => window.history.forward());
    await waitFor(() => expect(window.history.state.__ravenHealthBowelDetailId).toBeNull());
    expect(screen.queryByText("Bowel entry details")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(health.refreshBowel).toHaveBeenCalledOnce();
    expect(health.archiveBowel).toHaveBeenCalledOnce();
  });

  it.each(["Time", "Bristol Scale", "Blood Visible"])(
    "restores stable row focus after saving an edit to %s",
    async (label) => {
      const user = userEvent.setup();
      const health = panelController();
      render(<BowelPanelHarness controller={health} />);
      await user.click(screen.getByRole("button", { name: /Open details for Type 4/ }));
      if (label === "Time") {
        fireEvent.change(screen.getByLabelText(label), { target: { value: "2026-08-20T10:00" } });
      } else if (label === "Bristol Scale") {
        await user.selectOptions(screen.getByLabelText(label), "7");
      } else await user.click(screen.getByLabelText(label));
      await user.click(screen.getByRole("button", { name: "Save" }));
      const row = await screen.findByRole("button", { name: /Open details for Type 4/ });
      await waitFor(() => expect(row).toHaveFocus());
    },
  );

  it("exits an open detail when authoritative active truth removes it", async () => {
    const user = userEvent.setup();
    const health = panelController();
    const view = render(<BowelPanelHarness controller={health} />);
    await user.click(screen.getByRole("button", { name: /Open details for Type 4/ }));
    view.rerender(<BowelPanelHarness controller={{ ...health,
      state: { ...health.state, bowelEntries: [] } }} />);
    await waitFor(() => expect(screen.queryByText("Bowel entry details")).toBeNull());
    await waitFor(() => expect(screen.getByRole("button", { name: "Add bowel entry" })).toHaveFocus());
  });

  it("exits a tombstoned open detail and falls back to Add focus", async () => {
    const user = userEvent.setup();
    const health = panelController();
    const props = { controller: health, onArchiveCommitted: vi.fn(), refreshWarning: null,
      refreshPending: false, onRetryRefresh: vi.fn() };
    const view = render(<BowelPanel {...props} tombstonedIds={new Set()} />);
    await user.click(screen.getByRole("button", { name: /Open details for Type 4/ }));
    view.rerender(<BowelPanel {...props} tombstonedIds={new Set([event.id])} />);
    await waitFor(() => expect(screen.queryByText("Bowel entry details")).toBeNull());
    await waitFor(() => expect(screen.getByRole("button", { name: "Add bowel entry" })).toHaveFocus());
  });

  it("scopes saved views and exposes only Bowel filter, sort, and group choices", async () => {
    const user = userEvent.setup();
    const health = panelController();
    const view = render(<BowelPanelHarness controller={health} />);
    expect(health.tableSettings).toHaveBeenCalledWith("health.bowel");
    expect(health.tableTabs).toHaveBeenCalledWith("health.bowel");

    await user.click(screen.getByRole("button", { name: "Filter Bowel" }));
    const filter = screen.getByRole("dialog", { name: "Filter Bowel" });
    await user.click(within(filter).getByRole("button", { name: "Add filter rule" }));
    expect(within(filter).getAllByRole("option").map((option) => option.textContent))
      .toEqual(["Date", "Bristol Scale", "Blood Visible"]);
    await user.click(screen.getByRole("button", { name: "Filter Bowel" }));
    const filtered = defaultHealthTableSettings("health.bowel");
    filtered.filterRules = [
      { id: "bristol", field: "bristol_scale", type: "select", operator: "is", value: [] },
      { id: "blood", field: "blood_visible", type: "select", operator: "is", value: [] },
    ];
    view.rerender(<BowelPanelHarness controller={panelController(loadedState, filtered)} />);
    await user.click(screen.getByRole("button", { name: "Filter Bowel" }));
    const configuredFilter = screen.getByRole("dialog", { name: "Filter Bowel" });
    await user.click(within(configuredFilter).getByRole("button", {
      name: "Select Bristol Scale filter values",
    }));
    expect(within(configuredFilter).getAllByText(/^Type [1-7]$/).map((option) => option.textContent))
      .toEqual(["Type 1", "Type 2", "Type 3", "Type 4", "Type 5", "Type 6", "Type 7"]);
    await user.click(within(configuredFilter).getByRole("button", {
      name: "Select Blood Visible filter values",
    }));
    expect(within(configuredFilter).getByText("Yes")).toBeInTheDocument();
    expect(within(configuredFilter).getByText("No")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Filter Bowel" }));

    await user.click(screen.getByRole("button", { name: "Sort Bowel" }));
    const sortField = within(screen.getByRole("dialog", { name: "Sort Bowel" }))
      .getByLabelText("Sort field");
    expect(within(sortField).getAllByRole("option").map((option) => option.textContent))
      .toEqual(["Date", "Bristol Scale", "Created", "Updated"]);
    await user.click(screen.getByRole("button", { name: "Sort Bowel" }));

    await user.click(screen.getByRole("button", { name: "Group Bowel" }));
    const group = screen.getByRole("dialog", { name: "Group Bowel" });
    await user.click(within(group).getByRole("button", { name: "Choose group property" }));
    expect(within(group).getAllByRole("option").map((option) => option.textContent))
      .toEqual(["None", "Month", "Week", "Day", "Bristol Scale", "Blood Visible"]);
  });

  it("keeps hidden active selections and limits select-all and Delete to visible rows", async () => {
    const user = userEvent.setup();
    const second = { ...event, id: "bowel-2", value: 5,
      attributes: { kind: "bowel" as const, bristolScale: 5, bloodVisible: true } };
    const health = panelController({ ...loadedState, bowelEntries: [event, second] });
    const view = render(<BowelPanelHarness controller={health} />);
    await user.click(screen.getByRole("checkbox", { name: /Select Type 4/ }));
    const typeFiveOnly = defaultHealthTableSettings("health.bowel");
    typeFiveOnly.filterRules = [{ id: "five", field: "bristol_scale", type: "select",
      operator: "is", value: ["5"] }];
    view.rerender(<BowelPanelHarness controller={{ ...health, tableSettings: vi.fn(() => typeFiveOnly) }} />);
    expect(screen.getByRole("button", { name: "Archive selected bowel entries" })).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: "Select all visible bowel entries" }));
    expect(screen.getByRole("checkbox", { name: /Select Type 5/ })).toBeChecked();
    view.rerender(<BowelPanelHarness controller={health} />);
    expect(screen.getByRole("checkbox", { name: /Select Type 4/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Select Type 5/ })).toBeChecked();
  });

  it("uses active Bowel truth, exact header controls, and no inline form", async () => {
    const user = userEvent.setup();
    const health = panelController();
    render(<BowelPanelHarness controller={health} />);
    expect(screen.getByRole("tablist", { name: "Bowel views" })).toBeInTheDocument();
    const actions = screen.getByRole("button", { name: "Add bowel entry" }).parentElement!;
    expect([...actions.children]).toEqual([
      screen.getByRole("group", { name: "Bowel controls" }),
      screen.getByRole("button", { name: "Add bowel entry" }),
      screen.getByRole("button", { name: "Archive selected bowel entries" }),
    ]);
    expect(screen.queryByRole("form")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Add bowel entry" }));
    expect(screen.getByRole("dialog", { name: "Add bowel entry" })).toBeInTheDocument();
  });

  it("distinguishes loading, blocking error, empty, no-match, and stale refresh error", async () => {
    const retry = vi.fn();
    const view = render(<BowelPanelHarness controller={{ ...panelController({
      ...loadedState, bowelStatus: "loading", bowelEntries: [],
    }), refreshBowel: retry }} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading bowel entries");
    view.rerender(<BowelPanelHarness controller={{ ...panelController({
      ...loadedState, bowelStatus: "error", bowelEntries: [], bowelError: "Bowel unavailable",
    }), refreshBowel: retry }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Bowel unavailable");
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledOnce();
    view.rerender(<BowelPanelHarness controller={panelController({ ...loadedState, bowelEntries: [] })} />);
    expect(screen.getByText("No bowel entries yet.")).toBeInTheDocument();
    const hidden = defaultHealthTableSettings("health.bowel");
    hidden.filterRules = [{ id: "none", field: "bristol_scale", type: "select", operator: "is", value: ["7"] }];
    view.rerender(<BowelPanelHarness controller={panelController(loadedState, hidden)} />);
    expect(screen.getByText("No bowel entries match this view.")).toBeInTheDocument();
    view.rerender(<BowelPanelHarness controller={panelController({ ...loadedState, bowelError: "Refresh failed" })} />);
    expect(screen.getByText("Type 4")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Refresh failed");
  });

  it("snapshots visible logical rows and archives sequentially without repeating successes", async () => {
    const user = userEvent.setup();
    const second = { ...event, id: "bowel-2", value: 5,
      attributes: { kind: "bowel" as const, bristolScale: 5, bloodVisible: true } };
    const third = { ...event, id: "bowel-3", value: 6,
      attributes: { kind: "bowel" as const, bristolScale: 6, bloodVisible: false } };
    const health = panelController({ ...loadedState, bowelEntries: [event, second, third] });
    health.archiveBowel = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("Archive failed"));
    render(<BowelPanelHarness controller={health} />);
    await user.click(screen.getByRole("checkbox", { name: /Select Type 4/ }));
    await user.click(screen.getByRole("checkbox", { name: /Select Type 5/ }));
    await user.click(screen.getByRole("checkbox", { name: /Select Type 6/ }));
    const remove = screen.getByRole("button", { name: "Archive selected bowel entries" });
    await user.click(remove);
    await user.click(within(screen.getByRole("dialog", { name: "Archive selected bowel entries?" }))
      .getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(health.archiveBowel).toHaveBeenNthCalledWith(1, "bowel-1");
    expect(health.archiveBowel).toHaveBeenNthCalledWith(2, "bowel-2");
    expect(health.archiveBowel).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("alert")).toHaveTextContent("Archive failed");
    expect(screen.getByRole("checkbox", { name: /Select Type 5/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Select Type 6/ })).toBeChecked();
    await waitFor(() => expect(remove).toHaveFocus());
  });

  it("keeps the display-order archive snapshot through filter and authoritative row changes", async () => {
    const user = userEvent.setup();
    const first = deferred<void>();
    const second = { ...event, id: "bowel-2", occurredAt: "2026-08-19T02:00:00Z", value: 5,
      attributes: { kind: "bowel" as const, bristolScale: 5, bloodVisible: true } };
    const health = panelController({ ...loadedState, bowelEntries: [second, event] });
    health.archiveBowel = vi.fn((id) => id === second.id ? first.promise : Promise.resolve());
    const view = render(<BowelPanelHarness controller={health} />);
    await user.click(screen.getByRole("checkbox", { name: "Select all visible bowel entries" }));
    await user.click(screen.getByRole("button", { name: "Archive selected bowel entries" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Archive" }));
    expect(health.archiveBowel).toHaveBeenCalledWith(second.id);
    const noMatches = defaultHealthTableSettings("health.bowel");
    noMatches.filterRules = [{ id: "none", field: "bristol_scale", type: "select",
      operator: "is", value: ["7"] }];
    view.rerender(<BowelPanelHarness controller={{
      ...health,
      state: { ...health.state, bowelEntries: [] },
      tableSettings: vi.fn(() => noMatches),
    }} />);
    await act(async () => first.resolve());
    await waitFor(() => expect(health.archiveBowel).toHaveBeenNthCalledWith(2, event.id));
    expect(health.archiveBowel).toHaveBeenCalledTimes(2);
  });

  it("returns cancel to Delete and a full archive success to Add", async () => {
    const user = userEvent.setup();
    const health = panelController();
    render(<BowelPanelHarness controller={health} />);
    await user.click(screen.getByRole("checkbox", { name: /Select Type 4/ }));
    const remove = screen.getByRole("button", { name: "Archive selected bowel entries" });
    await user.click(remove);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(remove).toHaveFocus());
    await user.click(remove);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Add bowel entry" })).toHaveFocus());
  });

  it("treats refresh failure as committed, tombstones it, and retries Bowel reads only", async () => {
    const user = userEvent.setup();
    const committed = vi.fn();
    const refresh = vi.fn().mockResolvedValue(true);
    const health = panelController();
    health.archiveBowel = vi.fn().mockRejectedValue(new HealthMutationRefreshError());
    render(<BowelPanel controller={health} onArchiveCommitted={committed}
      tombstonedIds={new Set()} refreshWarning="Changes were saved, but Health could not refresh."
      refreshPending={false} onRetryRefresh={refresh} />);
    await user.click(screen.getByRole("checkbox", { name: /Select Type 4/ }));
    await user.click(screen.getByRole("button", { name: "Archive selected bowel entries" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(committed).toHaveBeenCalledWith("bowel-1", expect.any(String)));
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(refresh).toHaveBeenCalledOnce();
    expect(health.archiveBowel).toHaveBeenCalledOnce();
  });
});
