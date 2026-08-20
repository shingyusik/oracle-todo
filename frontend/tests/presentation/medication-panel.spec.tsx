import "@testing-library/jest-dom/vitest";

import { act, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { healthApi } from "@/features/health/api/health-api";
import {
  HealthMutationRefreshError,
  type HealthController,
  type HealthState,
  useHealthController,
} from "@/features/health/hooks/useHealthController";
import * as medicationTableModel from "@/features/health/model/medication-table";
import { deriveMedicationGroups } from "@/features/health/model/medication-table";
import { defaultHealthTableSettings } from "@/features/health/model/health-table-views";
import type { EventInput, EventUpdate, HealthEvent, HealthTrends, TimelineItem } from "@/features/health/model/health-model";
import { MedicationPanel } from "@/features/health/ui/MedicationPanel";
import { MedicationTable } from "@/features/health/ui/MedicationTable";

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

  it("lets controller composition own exactly one Medication initial read cycle", async () => {
    mockBaseReads();

    function MedicationComposition() {
      const health = useHealthController();
      return <MedicationPanel controller={health} tombstonedIds={new Set()}
        onArchiveCommitted={vi.fn()} refreshWarning={null} refreshPending={false}
        onRetryRefresh={vi.fn()} />;
    }

    render(<MedicationComposition />);
    await screen.findByText("No medication entries yet.");

    expect(vi.mocked(healthApi.listEvents).mock.calls
      .filter(([request]) => request?.category === "medication")).toHaveLength(1);
    expect(healthApi.timeline).toHaveBeenCalledOnce();
    expect(healthApi.trends).toHaveBeenCalledOnce();
  });

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

const loadedState: HealthState = {
  medicationStatus: "loaded", medicationError: null, medicationEntries: [event],
  bowelStatus: "loaded", bowelError: null, bowelEntries: [],
  dietStatus: "loaded", dietError: null, dietEntries: [],
  timelineStatus: "loaded", timelineError: null, timeline: [], timelineHasMore: false,
  trendsStatus: "loaded", trendsError: null, trends,
};

function panelController(
  state: HealthState = loadedState,
  settings = defaultHealthTableSettings("health.medication"),
): HealthController {
  return {
    state, tableViewSaveError: null, retryTableViewSave: vi.fn(), tableViewConfirmation: null,
    tableTabs: vi.fn((scope) => ({ tabs: [{ id: `${scope}-table`, name: "Table", settings }],
      activeTabId: `${scope}-table`, draftSettings: settings })),
    tableSettings: vi.fn(() => settings), tableIsDirty: vi.fn(() => false),
    updateTableSettings: vi.fn(), selectTableTab: vi.fn(), saveTableTab: vi.fn(),
    createTableTab: vi.fn(() => true), renameTableTab: vi.fn(() => true),
    requestDeleteTableTab: vi.fn(), confirmTableViewAction: vi.fn(), cancelTableViewAction: vi.fn(),
    refresh: vi.fn(), refreshMedication: vi.fn(), refreshBowel: vi.fn(), refreshDiet: vi.fn(),
    refreshTimeline: vi.fn(), loadMoreTimeline: vi.fn(), refreshTrends: vi.fn(),
    createDiet: vi.fn(), updateDiet: vi.fn(), archiveDiet: vi.fn(),
    createBowel: vi.fn(), updateBowel: vi.fn(), archiveBowel: vi.fn(),
    createMedication: vi.fn(), updateMedication: vi.fn(), archiveMedication: vi.fn(),
    upsertMetrics: vi.fn(), archive: vi.fn(), restore: vi.fn(), purge: vi.fn(),
  };
}

const recoveryProps = {
  tombstonedIds: new Set<string>(), onArchiveCommitted: vi.fn(), refreshWarning: null,
  refreshPending: false, onRetryRefresh: vi.fn(async () => false),
};

describe("MedicationPanel", () => {
  afterEach(() => vi.restoreAllMocks());

  it("renders the saved-view table with exact controls, columns, active rows, and no detail affordance", async () => {
    const archived = { ...event, id: "archived", deletedAt: event.updatedAt };
    const health = panelController({ ...loadedState, medicationEntries: [event, archived] });
    render(<MedicationPanel controller={health} {...recoveryProps} />);

    expect(health.tableSettings).toHaveBeenCalledWith("health.medication");
    expect(health.tableTabs).toHaveBeenCalledWith("health.medication");
    expect(screen.getByRole("tablist", { name: "Medication views" })).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader").map((cell) => cell.textContent))
      .toEqual(["", "Taken At", "Medication", "Dose", "Unit", "Note"]);
    expect(screen.getAllByText("Vitamin D")).toHaveLength(1);
    expect(screen.getByText("1000")).toBeInTheDocument();
    expect(screen.getByText("mg")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Open details/ })).toBeNull();
    const actions = screen.getByRole("button", { name: "Add medication entry" }).parentElement!;
    expect(within(actions).getAllByRole("button")).toEqual([
      screen.getByRole("button", { name: "Filter Medication" }),
      screen.getByRole("button", { name: "Sort Medication" }),
      screen.getByRole("button", { name: "Group Medication" }),
      screen.getByRole("button", { name: "Add medication entry" }),
      screen.getByRole("button", { name: "Archive selected medication entries" }),
    ]);
  });

  it("opens Add without an inline form and returns focus after save", async () => {
    const user = userEvent.setup();
    const health = panelController();
    render(<MedicationPanel controller={health} {...recoveryProps} />);
    expect(screen.queryByRole("form")).toBeNull();
    const add = screen.getByRole("button", { name: "Add medication entry" });
    await user.click(add);
    await user.type(screen.getByLabelText("Medication name"), "Calcium");
    await user.type(screen.getByLabelText("Dose"), "2");
    await user.click(screen.getByRole("button", { name: "Save medication" }));
    await waitFor(() => expect(add).toHaveFocus());
  });

  it("distinguishes initial loading, blocking error, empty, filtered empty, and stale error", async () => {
    const retry = vi.fn();
    const view = render(<MedicationPanel {...recoveryProps} controller={{ ...panelController({
      ...loadedState, medicationStatus: "loading", medicationEntries: [],
    }), refreshMedication: retry }} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading medication entries");
    view.rerender(<MedicationPanel {...recoveryProps} controller={{ ...panelController({
      ...loadedState, medicationStatus: "error", medicationEntries: [], medicationError: "Unavailable",
    }), refreshMedication: retry }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Unavailable");
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledOnce();
    view.rerender(<MedicationPanel {...recoveryProps} controller={panelController({
      ...loadedState, medicationEntries: [],
    })} />);
    expect(screen.getByText("No medication entries yet.")).toBeInTheDocument();
    const filtered = defaultHealthTableSettings("health.medication");
    filtered.filterRules = [{ id: "none", field: "medication_name", type: "text",
      operator: "contains", value: "missing" }];
    view.rerender(<MedicationPanel {...recoveryProps} controller={panelController(loadedState, filtered)} />);
    expect(screen.getByText("No medication entries match this view.")).toBeInTheDocument();
    view.rerender(<MedicationPanel {...recoveryProps} controller={panelController({
      ...loadedState, medicationError: "Refresh failed",
    })} />);
    expect(screen.getByText("Vitamin D")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Refresh failed");
  });

  it("keeps hidden selection and limits select-all and archive to visible logical rows", async () => {
    const user = userEvent.setup();
    const second = { ...event, id: "medication-2", name: "Calcium", metricKey: "Calcium",
      attributes: { kind: "medication" as const, medicationName: "Calcium", dose: 2, unit: "tablet" as const } };
    const health = panelController({ ...loadedState, medicationEntries: [event, second] });
    const view = render(<MedicationPanel controller={health} {...recoveryProps} />);
    await user.click(screen.getByRole("checkbox", { name: /Select Vitamin D/ }));
    const calciumOnly = defaultHealthTableSettings("health.medication");
    calciumOnly.filterRules = [{ id: "calcium", field: "medication_name", type: "text",
      operator: "contains", value: "Calcium" }];
    view.rerender(<MedicationPanel controller={{ ...health, tableSettings: vi.fn(() => calciumOnly) }}
      {...recoveryProps} />);
    expect(screen.getByRole("button", { name: "Archive selected medication entries" })).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: "Select all visible medication entries" }));
    await user.click(screen.getByRole("button", { name: "Archive selected medication entries" }));
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "1 medication entries will be archived and removed from Health views.",
    );
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    view.rerender(<MedicationPanel controller={health} {...recoveryProps} />);
    expect(screen.getByRole("checkbox", { name: /Select Vitamin D/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Select Calcium/ })).toBeChecked();
  });

  it("exposes only the approved Medication filter, sort, group, and unit options", async () => {
    const user = userEvent.setup();
    const health = panelController();
    const view = render(<MedicationPanel controller={health} {...recoveryProps} />);
    await user.click(screen.getByRole("button", { name: "Filter Medication" }));
    let dialog = screen.getByRole("dialog", { name: "Filter Medication" });
    await user.click(within(dialog).getByRole("button", { name: "Add filter rule" }));
    expect(within(dialog).getAllByRole("option").map((option) => option.textContent))
      .toEqual(["Date", "Medication", "Unit"]);
    await user.click(screen.getByRole("button", { name: "Filter Medication" }));

    const configured = defaultHealthTableSettings("health.medication");
    configured.filterRules = [{ id: "unit", field: "medication_unit", type: "select",
      operator: "is", value: [] }];
    view.rerender(<MedicationPanel controller={panelController(loadedState, configured)}
      {...recoveryProps} />);
    await user.click(screen.getByRole("button", { name: "Filter Medication" }));
    dialog = screen.getByRole("dialog", { name: "Filter Medication" });
    await user.click(within(dialog).getByRole("button", { name: "Select Unit filter values" }));
    for (const label of ["정", "캡슐", "포", "mg", "g", "ml", "방울", "회"]) {
      expect(within(dialog).getByText(label)).toBeInTheDocument();
    }
    await user.click(screen.getByRole("button", { name: "Filter Medication" }));
    await user.click(screen.getByRole("button", { name: "Sort Medication" }));
    expect(within(within(screen.getByRole("dialog", { name: "Sort Medication" }))
      .getByLabelText("Sort field")).getAllByRole("option").map((option) => option.textContent))
      .toEqual(["Date", "Medication", "Dose", "Created", "Updated"]);
    await user.click(screen.getByRole("button", { name: "Sort Medication" }));
    await user.click(screen.getByRole("button", { name: "Group Medication" }));
    dialog = screen.getByRole("dialog", { name: "Group Medication" });
    await user.click(within(dialog).getByRole("button", { name: "Choose group property" }));
    expect(within(dialog).getAllByRole("option").map((option) => option.textContent))
      .toEqual(["None", "Month", "Week", "Day", "Medication", "Unit"]);
  });

  it("renders duplicate occurrences with isolated checkboxes and a native non-interactive row", async () => {
    const groups = deriveMedicationGroups([event], defaultHealthTableSettings("health.medication"));
    const toggle = vi.fn();
    render(<MedicationTable groups={[groups[0], { ...groups[0], key: "duplicate" }]}
      activeRowCount={1} selectedIds={[]} onToggle={toggle} onToggleAll={vi.fn()} />);
    const checkboxes = screen.getAllByRole("checkbox", { name: /Select Vitamin D/ });
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes[0].closest("tr")).not.toHaveAttribute("tabindex");
    await userEvent.click(checkboxes[1]);
    expect(toggle).toHaveBeenCalledOnce();
    expect(toggle).toHaveBeenCalledWith(event.id);
  });

  it("deduplicates a valid logical row projected into two panel occurrences", async () => {
    const user = userEvent.setup();
    const projected = deriveMedicationGroups(
      [event], defaultHealthTableSettings("health.medication"),
    )[0].rows[0];
    vi.spyOn(medicationTableModel, "deriveMedicationGroups").mockReturnValue([
      { key: "first", label: "First", rows: [projected] },
      { key: "second", label: "Second", rows: [projected] },
    ]);
    const health = panelController();
    render(<MedicationPanel controller={health} {...recoveryProps} />);

    expect(screen.getAllByRole("checkbox", { name: /Select Vitamin D/ })).toHaveLength(2);
    await user.click(screen.getByRole("checkbox", { name: "Select all visible medication entries" }));
    for (const checkbox of screen.getAllByRole("checkbox", { name: /Select Vitamin D/ })) {
      expect(checkbox).toBeChecked();
    }
    await user.click(screen.getByRole("button", { name: "Archive selected medication entries" }));
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "1 medication entries will be archived and removed from Health views.",
    );
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(health.archiveMedication).toHaveBeenCalledOnce());
    expect(health.archiveMedication).toHaveBeenCalledWith(event.id);
  });

  it("uses native table semantics and an indeterminate visible select-all state", () => {
    const second = { ...event, id: "medication-2",
      attributes: { kind: "medication" as const, medicationName: "Calcium", dose: 2, unit: "tablet" as const } };
    const settings = defaultHealthTableSettings("health.medication");
    settings.groupSettings.groupBy = "medication_name";
    const groups = deriveMedicationGroups([event, second], settings);
    render(<MedicationTable groups={groups} activeRowCount={2} selectedIds={[event.id]}
      onToggle={vi.fn()} onToggleAll={vi.fn()} />);

    const table = screen.getByRole("table", { name: "Medication entries" });
    expect(table.tagName).toBe("TABLE");
    expect(within(table).getAllByRole("columnheader").map((header) => header.textContent))
      .toEqual(["", "Taken At", "Medication", "Dose", "Unit", "Note"]);
    expect(within(table).getByRole("rowheader", { name: "Vitamin D" }))
      .toHaveAttribute("scope", "rowgroup");
    expect(within(table).getByRole("checkbox", {
      name: "Select all visible medication entries",
    })).toBePartiallyChecked();
  });

  it("archives a stable display-order snapshot sequentially and retains failed and unattempted selection", async () => {
    const user = userEvent.setup();
    const second = { ...event, id: "medication-2", occurredAt: "2026-08-19T02:00:00Z",
      attributes: { kind: "medication" as const, medicationName: "Calcium", dose: 2, unit: "tablet" as const } };
    const third = { ...event, id: "medication-3", occurredAt: "2026-08-19T03:00:00Z",
      attributes: { kind: "medication" as const, medicationName: "Iron", dose: 3, unit: "capsule" as const } };
    const health = panelController({ ...loadedState, medicationEntries: [event, second, third] });
    health.archiveMedication = vi.fn().mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("Archive failed"));
    render(<MedicationPanel controller={health} {...recoveryProps} />);
    await user.click(screen.getByRole("checkbox", { name: "Select all visible medication entries" }));
    const remove = screen.getByRole("button", { name: "Archive selected medication entries" });
    await user.click(remove);
    expect(screen.getByRole("dialog", { name: "Archive selected medication entries?" }))
      .toHaveTextContent("3 medication entries will be archived and removed from Health views.");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(health.archiveMedication).toHaveBeenCalledTimes(2);
    expect(health.archiveMedication).toHaveBeenNthCalledWith(1, "medication-3");
    expect(health.archiveMedication).toHaveBeenNthCalledWith(2, "medication-2");
    expect(screen.getByRole("checkbox", { name: /Select Calcium/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Select Vitamin D/ })).toBeChecked();
    expect(screen.getByRole("alert")).toHaveTextContent("Archive failed");
    await waitFor(() => expect(remove).toHaveFocus());
  });

  it("keeps an in-flight display-order snapshot through a filter and authoritative rerender", async () => {
    const user = userEvent.setup();
    const first = deferred<void>();
    const second = { ...event, id: "medication-2", occurredAt: "2026-08-19T02:00:00Z",
      attributes: { kind: "medication" as const, medicationName: "Calcium", dose: 2, unit: "tablet" as const } };
    const health = panelController({ ...loadedState, medicationEntries: [second, event] });
    health.archiveMedication = vi.fn((id) => id === second.id ? first.promise : Promise.resolve());
    const view = render(<MedicationPanel controller={health} {...recoveryProps} />);
    await user.click(screen.getByRole("checkbox", { name: "Select all visible medication entries" }));
    await user.click(screen.getByRole("button", { name: "Archive selected medication entries" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Archive" }));
    expect(health.archiveMedication).toHaveBeenCalledWith(second.id);
    const noMatches = defaultHealthTableSettings("health.medication");
    noMatches.filterRules = [{ id: "none", field: "medication_name", type: "text",
      operator: "contains", value: "missing" }];
    view.rerender(<MedicationPanel {...recoveryProps} controller={{ ...health,
      state: { ...health.state, medicationEntries: [] }, tableSettings: vi.fn(() => noMatches) }} />);
    await act(async () => first.resolve());
    await waitFor(() => expect(health.archiveMedication).toHaveBeenNthCalledWith(2, event.id));
    expect(health.archiveMedication).toHaveBeenCalledTimes(2);
  });

  it("returns cancel to Delete and full success to Add", async () => {
    const user = userEvent.setup();
    const health = panelController();
    render(<MedicationPanel controller={health} {...recoveryProps} />);
    await user.click(screen.getByRole("checkbox", { name: /Select Vitamin D/ }));
    const remove = screen.getByRole("button", { name: "Archive selected medication entries" });
    await user.click(remove);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(remove).toHaveFocus());
    await user.click(remove);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Add medication entry" }))
      .toHaveFocus());
  });

  it("treats refresh failure as committed and retries reads without repeating archive", async () => {
    const user = userEvent.setup();
    const committed = vi.fn();
    const retry = vi.fn(async () => false);
    const health = panelController();
    health.archiveMedication = vi.fn().mockRejectedValue(new HealthMutationRefreshError());
    render(<MedicationPanel controller={health} tombstonedIds={new Set()}
      onArchiveCommitted={committed} refreshWarning="Changes were saved, but Health could not refresh."
      refreshPending={false} onRetryRefresh={retry} />);
    await user.click(screen.getByRole("checkbox", { name: /Select Vitamin D/ }));
    await user.click(screen.getByRole("button", { name: "Archive selected medication entries" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(committed).toHaveBeenCalledWith("medication-1", expect.any(String)));
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledOnce();
    expect(health.archiveMedication).toHaveBeenCalledOnce();
  });

  it("stops a committed archive refresh failure and retains every unattempted selection", async () => {
    const user = userEvent.setup();
    const second = { ...event, id: "medication-2", occurredAt: "2026-08-19T02:00:00Z",
      attributes: { kind: "medication" as const, medicationName: "Calcium", dose: 2, unit: "tablet" as const } };
    const third = { ...event, id: "medication-3", occurredAt: "2026-08-19T03:00:00Z",
      attributes: { kind: "medication" as const, medicationName: "Iron", dose: 3, unit: "capsule" as const } };
    const committed = vi.fn();
    const health = panelController({ ...loadedState, medicationEntries: [event, second, third] });
    health.archiveMedication = vi.fn().mockRejectedValue(new HealthMutationRefreshError());
    render(<MedicationPanel controller={health} tombstonedIds={new Set()}
      onArchiveCommitted={committed} refreshWarning={null} refreshPending={false}
      onRetryRefresh={vi.fn()} />);
    await user.click(screen.getByRole("checkbox", { name: "Select all visible medication entries" }));
    await user.click(screen.getByRole("button", { name: "Archive selected medication entries" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(committed).toHaveBeenCalledWith("medication-3", expect.any(String)));
    expect(health.archiveMedication).toHaveBeenCalledOnce();
    expect(screen.getByRole("checkbox", { name: /Select Calcium/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Select Vitamin D/ })).toBeChecked();
  });
});
