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
    vi.mocked(healthApi.listEvents)
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce([archived]);

    const { result } = renderHook(() => useHealthController());
    await waitFor(() => expect(result.current.state.bowelStatus).toBe("loaded"));

    expect(healthApi.listEvents).toHaveBeenNthCalledWith(1, {
      category: "bowel", limit: 200, offset: 0,
    });
    expect(healthApi.listEvents).toHaveBeenNthCalledWith(2, {
      category: "bowel", limit: 200, offset: 200,
    });
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
    vi.mocked(healthApi.listEvents).mockRejectedValue(new Error("Bowel unavailable"));

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
    expect(healthApi.listEvents).not.toHaveBeenCalled();
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
      expect(healthApi.listEvents).toHaveBeenCalledOnce();
    },
  );
});

const loadedState: HealthState = {
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
    refresh: vi.fn(), refreshBowel: vi.fn(), refreshDiet: vi.fn(), refreshTimeline: vi.fn(),
    loadMoreTimeline: vi.fn(), refreshTrends: vi.fn(),
    createDiet: vi.fn(), updateDiet: vi.fn(), archiveDiet: vi.fn(),
    createBowel: vi.fn(), updateBowel: vi.fn(), archiveBowel: vi.fn(),
    createMedication: vi.fn(), upsertMetrics: vi.fn(), archive: vi.fn(), restore: vi.fn(), purge: vi.fn(),
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
