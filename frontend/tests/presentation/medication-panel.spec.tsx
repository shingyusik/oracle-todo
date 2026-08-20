import "@testing-library/jest-dom/vitest";

import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
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
import type { EventInput, EventUpdate, HealthEvent } from "@/features/health/model/health-model";
import { MedicationPanel } from "@/features/health/ui/MedicationPanel";
import { MedicationTable } from "@/features/health/ui/MedicationTable";
import { localDateTimeToRfc3339 } from "@/features/health/ui/HealthForms";

const event: HealthEvent = {
  id: "medication-1", occurredAt: "2026-08-19T01:00:00Z", category: "medication",
  metricKey: "Vitamin D", name: "Vitamin D", value: 1000, unit: "mg", note: null,
  attributes: { kind: "medication", medicationName: "Vitamin D", dose: 1000, unit: "mg" },
  createdAt: "2026-08-19T01:00:00Z", updatedAt: "2026-08-19T01:00:00Z", deletedAt: null,
};
const input: EventInput = { occurredAt: event.occurredAt,
  details: { kind: "medication", medicationName: "Vitamin D", dose: 1000, unit: "mg" } };
const update: EventUpdate = { note: "updated" };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function controlHistoryForward() {
  const forward = window.history.forward.bind(window.history);
  const pending: Array<() => void> = [];
  const spy = vi.spyOn(window.history, "forward").mockImplementation(() => pending.push(forward));
  return {
    spy,
    async releaseNext() {
      const next = pending.shift();
      if (!next) throw new Error("No pending history.forward() call");
      const popped = new Promise<void>((resolve) => {
        window.addEventListener("popstate", () => resolve(), { once: true });
      });
      await act(async () => { next(); await popped; });
    },
  };
}

function mockBaseReads() {
  vi.spyOn(healthApi, "listDiet").mockResolvedValue([]);
  vi.spyOn(healthApi, "listEvents").mockResolvedValue([]);
  vi.spyOn(healthApi, "reports").mockResolvedValue({} as never);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));
}

async function mountedController() {
  const hook = renderHook(() => useHealthController());
  await waitFor(() => expect(hook.result.current.state.medicationStatus).toBe("loaded"));
  return hook;
}

type Reads = {
  medication: ReturnType<typeof deferred<HealthEvent[]>>;
};
function reads(): Reads {
  return { medication: deferred() };
}
function settle(set: Reads, ok: boolean, entries: HealthEvent[] = []) {
  if (ok) set.medication.resolve(entries); else set.medication.reject(new Error("newer failed"));
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
  });

  it("loads one short Medication page once without duplicating related initial reads", async () => {
    mockBaseReads();
    vi.mocked(healthApi.listEvents).mockImplementation(async (query) =>
      query?.category === "medication" ? [event] : []);

    const { result } = renderHook(() => useHealthController());
    await waitFor(() => expect(result.current.state.medicationStatus).toBe("loaded"));

    expect(vi.mocked(healthApi.listEvents).mock.calls
      .filter(([request]) => request?.category === "medication")).toHaveLength(1);
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

    await act(async () => expect(result.current.refresh()).resolves.toBe(true));

    expect(healthApi.listDiet).toHaveBeenCalledOnce();
    expect(vi.mocked(healthApi.listEvents).mock.calls
      .filter(([request]) => request?.category === "bowel")).toHaveLength(1);
    expect(vi.mocked(healthApi.listEvents).mock.calls
      .filter(([request]) => request?.category === "medication")).toHaveLength(1);
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

  it.each(["create", "update", "archive"] as const)("uses one %s mutation and only a Medication read", async (kind) => {
    mockBaseReads();
    const create = vi.spyOn(healthApi, "createEvent").mockResolvedValue(event);
    const updateEvent = vi.spyOn(healthApi, "updateEvent").mockResolvedValue(event);
    const archive = vi.spyOn(healthApi, "archiveEvent").mockResolvedValue(event);
    const { result } = await mountedController();
    [create, updateEvent, archive].forEach((spy) => spy.mockClear());
    vi.mocked(healthApi.listEvents).mockClear();
    await act(async () => {
      if (kind === "create") await result.current.createMedication(input);
      else if (kind === "update") await result.current.updateMedication(event.id, update);
      else await result.current.archiveMedication(event.id);
    });
    expect(create.mock.calls.length + updateEvent.mock.calls.length + archive.mock.calls.length).toBe(1);
    expect(healthApi.listEvents).toHaveBeenCalledOnce();
    expect(healthApi.reports).not.toHaveBeenCalled();
  });

  it("throws after commit when Medication refresh fails and retries reads only", async () => {
    mockBaseReads(); const create = vi.spyOn(healthApi, "createEvent").mockResolvedValue(event);
    const { result } = await mountedController();
    vi.mocked(healthApi.listEvents).mockClear();
    vi.mocked(healthApi.listEvents).mockRejectedValueOnce(new Error("failed"));
    await act(async () => { await expect(result.current.createMedication(input)).rejects.toBeInstanceOf(HealthMutationRefreshError); });
    await act(async () => expect(result.current.refreshMedication()).resolves.toBe(true));
    expect(create).toHaveBeenCalledOnce();
    expect(healthApi.listEvents).toHaveBeenCalledTimes(2);
  });

  it.each([true, false])("makes an older mutation adopt the newer mutation outcome (success: %s)", async (newerOk) => {
    mockBaseReads(); const create = vi.spyOn(healthApi, "createEvent").mockResolvedValue(event);
    const { result } = await mountedController(); const older = reads(); const newer = reads();
    vi.mocked(healthApi.listEvents).mockReset().mockImplementationOnce(() => older.medication.promise).mockImplementationOnce(() => newer.medication.promise);
    let first!: Promise<void>; let second!: Promise<void>;
    await act(async () => { first = result.current.createMedication(input); await Promise.resolve(); second = result.current.createMedication(input); await Promise.resolve(); });
    const outcomes = [first, second].map((promise) => promise.then(() => true, (error: unknown) => error));
    await act(async () => settle(newer, newerOk, [event])); await act(async () => settle(older, true, [{ ...event, id: "stale" }]));
    for (const outcome of outcomes) newerOk ? await expect(outcome).resolves.toBe(true) : await expect(outcome).resolves.toBeInstanceOf(HealthMutationRefreshError);
    expect(create).toHaveBeenCalledTimes(2);
  });

});

const loadedState: HealthState = {
  metricsStatus: "loaded", metricsError: null, metricsEntries: [],
  medicationStatus: "loaded", medicationError: null, medicationEntries: [event],
  bowelStatus: "loaded", bowelError: null, bowelEntries: [],
  dietStatus: "loaded", dietError: null, dietEntries: [],
  reportStatus: "idle", reportError: null, report: null, reportSelection: { preset: 30 },
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
    refresh: vi.fn(), refreshMetrics: vi.fn(), refreshMedication: vi.fn(), refreshBowel: vi.fn(), refreshDiet: vi.fn(),
    runReports: vi.fn(), retryReports: vi.fn(),
    createDiet: vi.fn(), updateDiet: vi.fn(), archiveDiet: vi.fn(),
    createBowel: vi.fn(), updateBowel: vi.fn(), archiveBowel: vi.fn(),
    createMedication: vi.fn(), updateMedication: vi.fn(), archiveMedication: vi.fn(),
    upsertMetrics: vi.fn(), saveMetrics: vi.fn(),
  };
}

const recoveryProps = {
  tombstonedIds: new Set<string>(), onArchiveCommitted: vi.fn(), refreshWarning: null,
  refreshPending: false, onRetryRefresh: vi.fn(async () => false),
};

function MedicationPanelHarness({ controller }: { controller: HealthController }) {
  const [tombstonedIds, setTombstonedIds] = React.useState<Set<string>>(() => new Set());
  const [refreshWarning, setRefreshWarning] = React.useState<string | null>(null);
  const [refreshPending, setRefreshPending] = React.useState(false);
  return <MedicationPanel controller={controller} tombstonedIds={tombstonedIds}
    onArchiveCommitted={(id, warning) => {
      setTombstonedIds((current) => new Set(current).add(id));
      if (warning) setRefreshWarning(warning);
    }} refreshWarning={refreshWarning} refreshPending={refreshPending}
    onRetryRefresh={async () => {
      setRefreshPending(true);
      try {
        const ok = await controller.refreshMedication();
        if (ok) setRefreshWarning(null);
        return ok;
      }
      finally { setRefreshPending(false); }
    }} />;
}

describe("MedicationPanel", () => {
  afterEach(() => vi.restoreAllMocks());

  it("renders the saved-view table with exact controls, columns, active rows, and a contextual detail affordance", async () => {
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
    expect(screen.getByRole("button", { name: /Open details for Vitamin D/ }))
      .toHaveAttribute("data-medication-row-id", event.id);
    const actions = screen.getByRole("button", { name: "Add medication entry" }).parentElement!;
    expect(within(actions).getAllByRole("button")).toEqual([
      screen.getByRole("button", { name: "Filter Medication" }),
      screen.getByRole("button", { name: "Sort Medication" }),
      screen.getByRole("button", { name: "Group Medication" }),
      screen.getByRole("button", { name: "Add medication entry" }),
      screen.getByRole("button", { name: "Archive selected medication entries" }),
    ]);
  });

  it("opens and edits an immutable Medication occurrence with an exact minimal patch", async () => {
    const user = userEvent.setup();
    const health = panelController();
    render(<MedicationPanel controller={health} {...recoveryProps} />);

    await user.click(screen.getByRole("button", { name: /Open details for Vitamin D/ }));
    expect(screen.getByText("Medication entry")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Vitamin D" })).toBeInTheDocument();
    expect([...screen.getByRole("region", { name: "Edit medication properties" }).children]
      .map((node) => node.firstChild?.textContent?.trim()))
      .toEqual(["Taken at", "Medication name", "Dose", "Unit", "Note"]);
    expect(screen.getAllByRole("button").map((button) => button.getAttribute("aria-label"))
      .filter(Boolean).slice(-5)).toEqual(["< Back", "Undo", "Redo", "Save", "Delete"]);

    await user.clear(screen.getByLabelText("Medication name"));
    await user.type(screen.getByLabelText("Medication name"), "  Calcium  ");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(health.updateMedication).toHaveBeenCalledOnce());
    expect(health.updateMedication).toHaveBeenCalledWith(event.id, {
      expectedUpdatedAt: event.updatedAt,
      details: { kind: "medication", medicationName: "Calcium", dose: 1000, unit: "mg" },
    });
  });

  it("keeps a standalone Medication table noninteractive unless onOpen is supplied", () => {
    const groups = deriveMedicationGroups([event], defaultHealthTableSettings("health.medication"));
    render(<MedicationTable groups={groups} activeRowCount={1} selectedIds={[]}
      onToggle={vi.fn()} onToggleAll={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /Open details/ })).toBeNull();
  });

  it.each([
    ["Taken at", "2026-08-20T10:30", {
      occurredAt: localDateTimeToRfc3339("2026-08-20T10:30"),
    }],
    ["Medication name", "  Calcium  ", {
      details: { kind: "medication", medicationName: "Calcium", dose: 1000, unit: "mg" },
    }],
    ["Dose", "2.5", {
      details: { kind: "medication", medicationName: "Vitamin D", dose: 2.5, unit: "mg" },
    }],
    ["Note", " after food ", { note: "after food" }],
  ] as const)("sends only the changed %s field with the original optimistic token",
    async (label, value, expected) => {
      const user = userEvent.setup();
      const health = panelController();
      render(<MedicationPanel controller={health} {...recoveryProps} />);
      await user.click(screen.getByRole("button", { name: /Open details for Vitamin D/ }));
      const field = screen.getByLabelText(label);
      await user.clear(field);
      await user.type(field, value);
      await user.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(health.updateMedication).toHaveBeenCalledOnce());
      expect(health.updateMedication).toHaveBeenCalledWith(event.id, {
        expectedUpdatedAt: event.updatedAt, ...expected,
      });
    });

  it("sends a full Medication detail object for a unit-only edit", async () => {
    const user = userEvent.setup();
    const health = panelController();
    render(<MedicationPanel controller={health} {...recoveryProps} />);
    await user.click(screen.getByRole("button", { name: /Open details for Vitamin D/ }));
    await user.selectOptions(screen.getByLabelText("Unit"), "tablet");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(health.updateMedication).toHaveBeenCalledWith(event.id, {
      expectedUpdatedAt: event.updatedAt,
      details: { kind: "medication", medicationName: "Vitamin D", dose: 1000, unit: "tablet" },
    }));
  });

  it.each(["", "0", "-1", "Infinity", "NaN"])("blocks invalid dose %j for button and shortcut", async (dose) => {
    const user = userEvent.setup();
    const health = panelController();
    render(<MedicationPanel controller={health} {...recoveryProps} />);
    await user.click(screen.getByRole("button", { name: /Open details for Vitamin D/ }));
    fireEvent.change(screen.getByLabelText("Dose"), { target: { value: dose } });
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    expect(health.updateMedication).not.toHaveBeenCalled();
  });

  it("exposes native and accessible positive-dose validation", async () => {
    const user = userEvent.setup();
    const health = panelController();
    render(<MedicationPanel controller={health} {...recoveryProps} />);
    await user.click(screen.getByRole("button", { name: /Open details for Vitamin D/ }));
    const dose = screen.getByLabelText("Dose");
    expect(dose).toHaveAttribute("min", String(Number.MIN_VALUE));
    expect(dose).toHaveAttribute("step", "any");
    fireEvent.change(dose, { target: { value: "0" } });
    expect(dose).toHaveAttribute("aria-invalid", "true");
    const descriptionId = dose.getAttribute("aria-describedby");
    expect(descriptionId).toBeTruthy();
    expect(document.getElementById(descriptionId!)).toHaveTextContent(
      "Dose must be a finite number greater than zero",
    );
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    expect(health.updateMedication).not.toHaveBeenCalled();
    fireEvent.change(dose, { target: { value: "0.25" } });
    expect(dose).not.toHaveAttribute("aria-invalid");
    expect(dose).not.toHaveAttribute("aria-describedby");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("pushes once and traverses clean browser Back/Forward without a loop", async () => {
    const user = userEvent.setup();
    window.history.replaceState({ preserved: "medication" }, "");
    const pushState = vi.spyOn(window.history, "pushState");
    render(<MedicationPanel controller={panelController()} {...recoveryProps} />);
    await user.click(screen.getByRole("button", { name: /Open details for Vitamin D/ }));
    expect(pushState).toHaveBeenCalledOnce();
    expect(window.history.state).toMatchObject({
      preserved: "medication", __ravenHealthMedicationDetailId: event.id,
    });
    act(() => window.history.back());
    await screen.findByRole("button", { name: /Open details for Vitamin D/ });
    act(() => window.history.forward());
    await screen.findByText("Medication entry");
    expect(pushState).toHaveBeenCalledOnce();
  });

  it("repairs dirty browser Back on cancel and discards on confirm with Back focus", async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, "");
    render(<MedicationPanel controller={panelController()} {...recoveryProps} />);
    await user.click(screen.getByRole("button", { name: /Open details for Vitamin D/ }));
    await user.type(screen.getByLabelText("Note"), "draft");
    act(() => window.history.back());
    let dialog = await screen.findByRole("dialog", { name: "Discard unsaved changes?" });
    for (const name of ["< Back", "Undo", "Redo", "Save", "Delete"]) {
      expect(screen.getByRole("button", { name, hidden: true })).toBeDisabled();
    }
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "< Back" })).toHaveFocus());
    act(() => window.history.back());
    dialog = await screen.findByRole("dialog", { name: "Discard unsaved changes?" });
    await user.click(within(dialog).getByRole("button", { name: "Discard changes" }));
    await screen.findByRole("button", { name: /Open details for Vitamin D/ });
  });

  it("repairs dirty browser Forward in the exact direction without a loop", async () => {
    const user = userEvent.setup();
    window.history.pushState({ historySide: "back" }, "");
    const back = vi.spyOn(window.history, "back");
    const forward = vi.spyOn(window.history, "forward");
    render(<MedicationPanelHarness controller={panelController()} />);
    await user.click(screen.getByRole("button", { name: /Open details for Vitamin D/ }));
    window.history.pushState({ ...window.history.state,
      __ravenHealthMedicationDetailId: null,
      __ravenHealthMedicationDetailId__index:
        (window.history.state.__ravenHealthMedicationDetailId__index as number) + 1,
      historySide: "forward",
    }, "");
    act(() => window.history.back());
    await waitFor(() => expect(window.history.state.__ravenHealthMedicationDetailId).toBe(event.id));
    await user.type(screen.getByLabelText("Note"), "forward draft");

    act(() => window.history.forward());
    let dialog = await screen.findByRole("dialog", { name: "Discard unsaved changes?" });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "< Back" })).toHaveFocus());
    expect(screen.getByLabelText("Note")).toHaveValue("forward draft");
    act(() => window.history.forward());
    dialog = await screen.findByRole("dialog", { name: "Discard unsaved changes?" });
    await user.click(within(dialog).getByRole("button", { name: "Discard changes" }));
    await screen.findByRole("button", { name: /Open details for Vitamin D/ });
    await waitFor(() => expect(window.history.state).toMatchObject({
      __ravenHealthMedicationDetailId: null, historySide: "forward",
    }));
    expect(forward).toHaveBeenCalledTimes(3);
    expect(back).toHaveBeenCalledTimes(3);
  });

  it("normalizes a stale Forward ID independently of tombstones", async () => {
    const user = userEvent.setup();
    window.history.replaceState({ preserved: "stale-id" }, "");
    render(<MedicationPanelHarness controller={panelController()} />);
    await user.click(screen.getByRole("button", { name: /Open details for Vitamin D/ }));
    act(() => window.history.back());
    await screen.findByRole("button", { name: /Open details for Vitamin D/ });
    act(() => window.history.forward());
    await screen.findByText("Medication entry");
    window.history.replaceState({ ...window.history.state,
      __ravenHealthMedicationDetailId: "missing-medication" }, "");
    act(() => window.history.back());
    await screen.findByRole("button", { name: /Open details for Vitamin D/ });
    act(() => window.history.forward());
    await waitFor(() => expect(window.history.state).toMatchObject({
      preserved: "stale-id", __ravenHealthMedicationDetailId: null,
    }));
    expect(screen.queryByText("Medication entry")).toBeNull();
  });

  it("normalizes a tombstoned Forward ID without reopening", async () => {
    const user = userEvent.setup();
    window.history.replaceState({ preserved: "tombstone" }, "");
    const health = panelController();
    const view = render(<MedicationPanel controller={health} {...recoveryProps} />);
    await user.click(screen.getByRole("button", { name: /Open details for Vitamin D/ }));
    act(() => window.history.back());
    await screen.findByRole("button", { name: /Open details for Vitamin D/ });
    view.rerender(<MedicationPanel controller={health} {...recoveryProps}
      tombstonedIds={new Set([event.id])} />);
    act(() => window.history.forward());
    await waitFor(() => expect(window.history.state.__ravenHealthMedicationDetailId).toBeNull());
    expect(screen.queryByText("Medication entry")).toBeNull();
  });

  it("saves through one pushed entry, cleans history, and cannot reopen a duplicate detail", async () => {
    const user = userEvent.setup();
    window.history.pushState({}, "");
    const pushState = vi.spyOn(window.history, "pushState");
    const health = panelController();
    render(<MedicationPanelHarness controller={health} />);
    await user.click(screen.getByRole("button", { name: /Open details for Vitamin D/ }));
    await user.type(screen.getByLabelText("Note"), "saved");
    await user.click(screen.getByRole("button", { name: "Save" }));
    const row = await screen.findByRole("button", { name: /Open details for Vitamin D/ });
    await waitFor(() => expect(row).toHaveFocus());
    expect(pushState).toHaveBeenCalledOnce();
    expect(health.updateMedication).toHaveBeenCalledOnce();
    act(() => window.history.forward());
    await screen.findByText("Medication entry");
    expect(pushState).toHaveBeenCalledOnce();
    act(() => window.history.back());
    await screen.findByRole("button", { name: /Open details for Vitamin D/ });
  });

  it("coalesces text history, keeps unit distinct, and invalidates Redo", async () => {
    const user = userEvent.setup();
    render(<MedicationPanel controller={panelController()} {...recoveryProps} />);
    await user.click(screen.getByRole("button", { name: /Open details for Vitamin D/ }));
    await user.type(screen.getByLabelText("Medication name"), " AB");
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByLabelText("Medication name")).toHaveValue("Vitamin D");
    await user.click(screen.getByRole("button", { name: "Redo" }));
    expect(screen.getByLabelText("Medication name")).toHaveValue("Vitamin D AB");
    await user.selectOptions(screen.getByLabelText("Unit"), "tablet");
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByLabelText("Unit")).toHaveValue("mg");
    await user.type(screen.getByLabelText("Note"), "new");
    expect(screen.getByRole("button", { name: "Redo" })).toBeDisabled();
  });

  it("coalesces each Medication text field, keeps every unit transition distinct, and caps history at 50", async () => {
    const user = userEvent.setup();
    render(<MedicationPanelHarness controller={panelController()} />);
    await user.click(screen.getByRole("button", { name: /Open details for Vitamin D/ }));
    const takenAt = screen.getByLabelText("Taken at");
    const originalTakenAt = (takenAt as HTMLInputElement).value;
    fireEvent.change(takenAt, { target: { value: "2026-08-20T09:00" } });
    fireEvent.change(takenAt, { target: { value: "2026-08-20T10:00" } });
    fireEvent.blur(takenAt);
    for (const [label, value] of [["Medication name", "Calcium"], ["Dose", "2"],
      ["Note", "after food"]] as const) {
      const field = screen.getByLabelText(label);
      fireEvent.change(field, { target: { value: value.slice(0, -1) } });
      fireEvent.change(field, { target: { value } });
      fireEvent.blur(field);
    }
    await user.selectOptions(screen.getByLabelText("Unit"), "tablet");
    await user.selectOptions(screen.getByLabelText("Unit"), "capsule");
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByLabelText("Unit")).toHaveValue("tablet");
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByLabelText("Unit")).toHaveValue("mg");
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(screen.getByLabelText("Note")).toHaveValue("");
    fireEvent.keyDown(window, { key: "z", metaKey: true });
    expect(screen.getByLabelText("Dose")).toHaveValue(1000);
    fireEvent.keyDown(window, { key: "z", metaKey: true });
    expect(screen.getByLabelText("Medication name")).toHaveValue("Vitamin D");
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(takenAt).toHaveValue(originalTakenAt);
    fireEvent.keyDown(window, { key: "z", metaKey: true, shiftKey: true });
    expect(takenAt).toHaveValue("2026-08-20T10:00");
    fireEvent.keyDown(window, { key: "z", metaKey: true, shiftKey: true });
    expect(screen.getByLabelText("Medication name")).toHaveValue("Calcium");
    fireEvent.keyDown(window, { key: "z", metaKey: true, shiftKey: true });
    expect(screen.getByLabelText("Dose")).toHaveValue(2);
    fireEvent.keyDown(window, { key: "y", ctrlKey: true });
    expect(screen.getByLabelText("Note")).toHaveValue("after food");
    fireEvent.change(screen.getByLabelText("Medication name"), { target: { value: "New edit" } });
    expect(screen.getByRole("button", { name: "Redo" })).toBeDisabled();

    for (let index = 0; index < 52; index += 1) {
      fireEvent.change(screen.getByLabelText("Unit"), {
        target: { value: index % 2 ? "tablet" : "mg" },
      });
    }
    for (let index = 0; index < 50; index += 1) {
      fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    }
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
    expect(takenAt).not.toHaveValue(originalTakenAt);
  });

  it("treats whitespace and equivalent local time as no-ops and renders exact metadata and units", async () => {
    const user = userEvent.setup();
    const distinct = { ...event, createdAt: "2026-08-18T01:00:00Z" };
    render(<MedicationPanelHarness controller={panelController({
      ...loadedState, medicationEntries: [distinct],
    })} />);
    await user.click(screen.getByRole("button", { name: /Open details for Vitamin D/ }));
    const time = screen.getByLabelText("Taken at") as HTMLInputElement;
    fireEvent.change(screen.getByLabelText("Medication name"), { target: { value: " Vitamin D " } });
    fireEvent.change(screen.getByLabelText("Dose"), { target: { value: "1000.0" } });
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "   " } });
    fireEvent.change(time, { target: { value: time.value.length === 16
      ? `${time.value}:00` : time.value.slice(0, 16) } });
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByText(`Created ${new Date(distinct.createdAt).toLocaleString()}`))
      .toBeInTheDocument();
    expect(screen.getByText(`Updated ${new Date(distinct.updatedAt).toLocaleString()}`))
      .toBeInTheDocument();
    expect(within(screen.getByLabelText("Unit")).getAllByRole("option")
      .map((option) => [option.getAttribute("value"), option.textContent])).toEqual([
        ["tablet", "정"], ["capsule", "캡슐"], ["packet", "포"], ["mg", "mg"],
        ["g", "g"], ["ml", "ml"], ["drop", "방울"], ["dose", "회"],
      ]);
  });

  it("blocks a DST gap plus IME, pending, confirmation, and recovery shortcuts", async () => {
    vi.stubEnv("TZ", "America/New_York");
    const user = userEvent.setup();
    const saved = deferred<void>();
    const health = panelController();
    health.updateMedication = vi.fn(() => saved.promise);
    render(<MedicationPanelHarness controller={health} />);
    await user.click(screen.getByRole("button", { name: /Open details for Vitamin D/ }));
    fireEvent.change(screen.getByLabelText("Taken at"), { target: { value: "2026-03-08T02:30" } });
    expect(screen.getByRole("alert")).toHaveTextContent("Time must be a valid local date and time");
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    expect(health.updateMedication).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Taken at"), { target: { value: "2026-03-08T03:30" } });
    fireEvent.keyDown(window, { key: "s", ctrlKey: true, isComposing: true });
    expect(health.updateMedication).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(health.updateMedication).not.toHaveBeenCalled();
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    fireEvent.keyDown(window, { key: "s", metaKey: true });
    await waitFor(() => expect(health.updateMedication).toHaveBeenCalledOnce());
    for (const name of ["< Back", "Undo", "Redo", "Save", "Delete"]) {
      expect(screen.getByRole("button", { name })).toBeDisabled();
    }
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    fireEvent.keyDown(window, { key: "y", ctrlKey: true });
    expect(health.updateMedication).toHaveBeenCalledOnce();
    await act(async () => saved.resolve());
    vi.unstubAllEnvs();
  });

  it("blocks a blank Medication name for button and shortcut", async () => {
    const user = userEvent.setup();
    const health = panelController();
    render(<MedicationPanelHarness controller={health} />);
    await user.click(screen.getByRole("button", { name: /Open details for Vitamin D/ }));
    fireEvent.change(screen.getByLabelText("Medication name"), { target: { value: "   " } });
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    expect(health.updateMedication).not.toHaveBeenCalled();
  });

  it("retains draft and history after an ordinary save failure", async () => {
    vi.stubEnv("TZ", "America/New_York");
    const user = userEvent.setup();
    const health = panelController();
    health.updateMedication = vi.fn().mockRejectedValueOnce(new Error("Save unavailable"));
    render(<MedicationPanel controller={health} {...recoveryProps} />);
    await user.click(screen.getByRole("button", { name: /Open details for Vitamin D/ }));
    await user.type(screen.getByLabelText("Note"), "draft");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Save unavailable");
    expect(screen.getByLabelText("Note")).toHaveValue("draft");
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByLabelText("Note")).toHaveValue("");
    fireEvent.change(screen.getByLabelText("Taken at"), { target: { value: "2026-03-08T02:30" } });
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Save unavailable");
    expect(alert).toHaveTextContent("Time must be a valid local date and time");
    vi.unstubAllEnvs();
  });

  it("locks every detail action and field while archive confirmation remains usable", async () => {
    const user = userEvent.setup();
    const archived = deferred<void>();
    const health = panelController();
    health.archiveMedication = vi.fn(() => archived.promise);
    render(<MedicationPanel controller={health} {...recoveryProps} />);
    await user.click(screen.getByRole("button", { name: /Open details for Vitamin D/ }));
    await user.type(screen.getByLabelText("Note"), "draft");
    await user.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = screen.getByRole("dialog", { name: "Archive Vitamin D?" });
    for (const name of ["< Back", "Undo", "Redo", "Save", "Delete"]) {
      expect(screen.getByRole("button", { name, hidden: true })).toBeDisabled();
    }
    for (const label of ["Taken at", "Medication name", "Dose", "Unit", "Note"]) {
      expect(screen.getByLabelText(label, { selector: "input, select, textarea" })).toBeDisabled();
    }
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeEnabled();
    expect(within(dialog).getByRole("button", { name: "Archive" })).toBeEnabled();
    await user.click(within(dialog).getByRole("button", { name: "Archive" }));
    expect(dialog).toHaveAttribute("aria-busy", "true");
    for (const name of ["Cancel", "Archive"]) {
      expect(within(dialog).getByRole("button", { name })).toHaveAttribute("aria-disabled", "true");
    }
    fireEvent.click(within(dialog).getByRole("button", { name: "Archive" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(health.archiveMedication).toHaveBeenCalledOnce();
    expect(dialog).toBeInTheDocument();
    await act(async () => archived.resolve());
  });

  it("locks every field, action, shortcut, duplicate save, and navigation while save is pending", async () => {
    const user = userEvent.setup();
    const saved = deferred<void>();
    const health = panelController();
    health.updateMedication = vi.fn(() => saved.promise);
    health.archiveMedication = vi.fn();
    render(<MedicationPanelHarness controller={health} />);
    await user.click(screen.getByRole("button", { name: /Open details for Vitamin D/ }));
    await user.type(screen.getByLabelText("Note"), "pending");
    await user.click(screen.getByRole("button", { name: "Save" }));
    for (const label of ["Taken at", "Medication name", "Dose", "Unit", "Note"]) {
      expect(screen.getByLabelText(label)).toBeDisabled();
    }
    for (const name of ["< Back", "Undo", "Redo", "Save", "Delete"]) {
      const action = screen.getByRole("button", { name });
      expect(action).toBeDisabled();
      fireEvent.click(action);
    }
    for (const eventInit of [
      { key: "s", ctrlKey: true }, { key: "s", metaKey: true },
      { key: "z", ctrlKey: true }, { key: "z", metaKey: true, shiftKey: true },
      { key: "y", ctrlKey: true },
    ]) fireEvent.keyDown(window, eventInit);
    expect(health.updateMedication).toHaveBeenCalledOnce();
    expect(health.archiveMedication).not.toHaveBeenCalled();
    expect(screen.getByText("Medication entry")).toBeInTheDocument();
    await act(async () => saved.resolve());
  });

  it("freezes committed-save recovery and retries Medication reads without resubmitting", async () => {
    const user = userEvent.setup();
    const health = panelController();
    const recovered = deferred<boolean>();
    health.updateMedication = vi.fn().mockRejectedValue(new HealthMutationRefreshError());
    health.refreshMedication = vi.fn().mockResolvedValueOnce(false)
      .mockImplementationOnce(() => recovered.promise);
    render(<MedicationPanel controller={health} {...recoveryProps} />);
    await user.click(screen.getByRole("button", { name: /Open details for Vitamin D/ }));
    await user.type(screen.getByLabelText("Note"), "committed");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("could not refresh");
    for (const label of ["Taken at", "Medication name", "Dose", "Unit", "Note"]) {
      expect(screen.getByLabelText(label)).toBeDisabled();
    }
    for (const name of ["< Back", "Undo", "Redo", "Save", "Delete"]) {
      expect(screen.getByRole("button", { name })).toBeDisabled();
    }
    for (const eventInit of [
      { key: "s", ctrlKey: true }, { key: "z", ctrlKey: true },
      { key: "z", metaKey: true, shiftKey: true }, { key: "y", ctrlKey: true },
    ]) fireEvent.keyDown(window, eventInit);
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(health.refreshMedication).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(screen.getByRole("button", { name: "Retry" })).toBeDisabled();
    for (const label of ["Taken at", "Medication name", "Dose", "Unit", "Note"]) {
      expect(screen.getByLabelText(label)).toBeDisabled();
    }
    expect(health.refreshMedication).toHaveBeenCalledTimes(2);
    expect(health.updateMedication).toHaveBeenCalledOnce();
    await act(async () => recovered.resolve(true));
    await screen.findByRole("button", { name: /Open details for Vitamin D/ });
    expect(health.updateMedication).toHaveBeenCalledOnce();
  });

  it("defers successful save close until browser restoration settles", async () => {
    const user = userEvent.setup();
    window.history.pushState({}, "");
    const controlledForward = controlHistoryForward();
    const saved = deferred<void>();
    const health = panelController();
    health.updateMedication = vi.fn(() => saved.promise);
    render(<MedicationPanelHarness controller={health} />);
    await user.click(screen.getByRole("button", { name: /Open details for Vitamin D/ }));
    await user.type(screen.getByLabelText("Note"), "saved during restoration");
    await user.click(screen.getByRole("button", { name: "Save" }));
    act(() => window.history.back());
    await waitFor(() => expect(controlledForward.spy).toHaveBeenCalledOnce());
    await act(async () => saved.resolve());
    expect(screen.getByText("Medication entry")).toBeInTheDocument();
    expect(screen.getByLabelText("Note")).toBeDisabled();
    await controlledForward.releaseNext();
    const origin = await screen.findByRole("button", { name: /Open details for Vitamin D/ });
    await waitFor(() => expect(origin).toHaveFocus());
    expect(screen.queryByRole("dialog", { name: "Discard unsaved changes?" })).toBeNull();
    expect(health.updateMedication).toHaveBeenCalledOnce();
  });

  it.each(["ordinary", "committed"] as const)(
    "defers %s save failure state until browser restoration settles", async (outcome) => {
      const user = userEvent.setup();
      window.history.pushState({}, "");
      const controlledForward = controlHistoryForward();
      const saved = deferred<void>();
      const health = panelController();
      health.updateMedication = vi.fn(() => saved.promise);
      render(<MedicationPanelHarness controller={health} />);
      await user.click(screen.getByRole("button", { name: /Open details for Vitamin D/ }));
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
      expect(health.updateMedication).toHaveBeenCalledOnce();
      await controlledForward.releaseNext();
      expect(await screen.findByRole("alert")).toHaveTextContent(outcome === "ordinary"
        ? "Save unavailable" : "Changes were saved, but Health could not refresh.");
      expect(screen.queryByRole("dialog", { name: "Discard unsaved changes?" })).toBeNull();
      if (outcome === "ordinary") expect(screen.getByLabelText("Note")).toBeEnabled();
      else expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
    });

  it.each([false, true])("defers refresh Retry=%s settlement until browser restoration", async (ok) => {
    const user = userEvent.setup();
    window.history.pushState({}, "");
    const controlledForward = controlHistoryForward();
    const refreshed = deferred<boolean>();
    const health = panelController();
    health.updateMedication = vi.fn().mockRejectedValue(new HealthMutationRefreshError());
    health.refreshMedication = vi.fn(() => refreshed.promise);
    render(<MedicationPanelHarness controller={health} />);
    await user.click(screen.getByRole("button", { name: /Open details for Vitamin D/ }));
    await user.type(screen.getByLabelText("Note"), "committed draft");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await user.click(await screen.findByRole("button", { name: "Retry" }));
    act(() => window.history.back());
    await waitFor(() => expect(controlledForward.spy).toHaveBeenCalledOnce());
    await act(async () => refreshed.resolve(ok));
    expect(screen.getByRole("button", { name: "Retry" })).toBeDisabled();
    expect(screen.getByLabelText("Note")).toBeDisabled();
    expect(health.refreshMedication).toHaveBeenCalledOnce();
    expect(health.updateMedication).toHaveBeenCalledOnce();
    await controlledForward.releaseNext();
    if (ok) {
      await screen.findByRole("button", { name: /Open details for Vitamin D/ });
    } else {
      await waitFor(() => expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled());
      expect(screen.getByText("Medication entry")).toBeInTheDocument();
    }
    expect(screen.queryByRole("dialog", { name: "Discard unsaved changes?" })).toBeNull();
  });

  it("restores focus by row ID after occurrence changes, then to Add when the row disappears", async () => {
    const user = userEvent.setup();
    const settings = defaultHealthTableSettings("health.medication");
    settings.groupSettings.groupBy = "medication_name";
    const health = panelController(loadedState, settings);
    const view = render(<MedicationPanel controller={health} {...recoveryProps} />);
    await user.click(screen.getByRole("button", { name: /Open details for Vitamin D/ }));
    const renamed = { ...event, attributes: { ...event.attributes, medicationName: "Calcium" } };
    view.rerender(<MedicationPanel controller={{ ...health, state: {
      ...health.state, medicationEntries: [renamed],
    } }} {...recoveryProps} />);
    await user.click(screen.getByRole("button", { name: "< Back" }));
    const renamedOpen = await screen.findByRole("button", { name: /Open details for Calcium/ });
    await waitFor(() => expect(renamedOpen).toHaveFocus());
    await user.click(renamedOpen);
    view.rerender(<MedicationPanel controller={{ ...health, state: {
      ...health.state, medicationEntries: [],
    } }} {...recoveryProps} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Add medication entry" })).toHaveFocus());
  });

  it("restores the exact second projected occurrence after Back", async () => {
    const user = userEvent.setup();
    const projected = deriveMedicationGroups(
      [event], defaultHealthTableSettings("health.medication"),
    )[0].rows[0];
    vi.spyOn(medicationTableModel, "deriveMedicationGroups").mockReturnValue([
      { key: "first", label: "First", rows: [projected] },
      { key: "second", label: "Second", rows: [projected] },
    ]);
    render(<MedicationPanelHarness controller={panelController()} />);
    const occurrences = screen.getAllByRole("button", { name: /Open details for Vitamin D/ });
    expect(occurrences[1]).toHaveAttribute("data-medication-occurrence", "second-medication-1-0");
    await user.click(occurrences[1]);
    await user.click(screen.getByRole("button", { name: "< Back" }));
    await waitFor(() => expect(document.activeElement).toBe(
      screen.getAllByRole("button", { name: /Open details for Vitamin D/ })[1],
    ));
    expect((document.activeElement as HTMLElement).dataset.medicationOccurrence)
      .toBe("second-medication-1-0");
  });

  it("falls back to the stable row ID when a Taken At occurrence disappears", async () => {
    const user = userEvent.setup();
    const grouped = defaultHealthTableSettings("health.medication");
    grouped.groupSettings = { ...grouped.groupSettings, groupBy: "day" };
    const health = panelController(loadedState, grouped);
    const view = render(<MedicationPanelHarness controller={health} />);
    const origin = screen.getByRole("button", { name: /Open details for Vitamin D/ });
    const oldOccurrence = origin.dataset.medicationOccurrence;
    await user.click(origin);
    const moved = { ...event, occurredAt: "2026-08-20T01:00:00Z" };
    view.rerender(<MedicationPanelHarness controller={{ ...health,
      state: { ...health.state, medicationEntries: [moved] } }} />);
    await user.click(screen.getByRole("button", { name: "< Back" }));
    await waitFor(() => expect((document.activeElement as HTMLElement).dataset.medicationRowId)
      .toBe(event.id));
    expect((document.activeElement as HTMLElement).dataset.medicationOccurrence)
      .not.toBe(oldOccurrence);
  });

  it("uses row-ID focus when only the saved-view grouping changes the occurrence", async () => {
    const user = userEvent.setup();
    const health = panelController();
    const view = render(<MedicationPanelHarness controller={health} />);
    const origin = screen.getByRole("button", { name: /Open details for Vitamin D/ });
    const oldOccurrence = origin.dataset.medicationOccurrence;
    expect(oldOccurrence).toBe("all-medication-1-0");
    await user.click(origin);
    const grouped = defaultHealthTableSettings("health.medication");
    grouped.groupSettings = { ...grouped.groupSettings, groupBy: "medication_unit" };
    view.rerender(<MedicationPanelHarness controller={panelController(loadedState, grouped)} />);
    await user.click(screen.getByRole("button", { name: "< Back" }));
    const regrouped = await screen.findByRole("button", { name: /Open details for Vitamin D/ });
    expect(regrouped.dataset.medicationOccurrence).toBe("mg-medication-1-0");
    expect(regrouped.dataset.medicationOccurrence).not.toBe(oldOccurrence);
    expect(document.querySelector(`[data-medication-occurrence="${oldOccurrence}"]`)).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(regrouped));
    expect((document.activeElement as HTMLElement).dataset.medicationRowId).toBe(event.id);
    expect((document.activeElement as HTMLElement).dataset.medicationOccurrence)
      .toBe("mg-medication-1-0");
  });

  it("restores focus without parsing a quoted medication occurrence as CSS", async () => {
    const user = userEvent.setup();
    const quoted = { ...event, metricKey: 'Vitamin "D', name: 'Vitamin "D',
      attributes: { ...event.attributes, medicationName: 'Vitamin "D' } };
    const grouped = defaultHealthTableSettings("health.medication");
    grouped.groupSettings = { ...grouped.groupSettings, groupBy: "medication_name" };
    render(<MedicationPanelHarness controller={panelController({
      ...loadedState, medicationEntries: [quoted],
    }, grouped)} />);
    const origin = screen.getByRole("button", { name: /Open details for Vitamin "D/ });
    expect(origin.dataset.medicationOccurrence).toBe('Vitamin "D-medication-1-0');
    await user.click(origin);
    await user.click(screen.getByRole("button", { name: "< Back" }));
    const restored = await screen.findByRole("button", { name: /Open details for Vitamin "D/ });
    await waitFor(() => expect(document.activeElement).toBe(restored));
    expect((document.activeElement as HTMLElement).dataset.medicationOccurrence)
      .toBe('Vitamin "D-medication-1-0');
  });

  it("exits a tombstoned open Medication detail and focuses Add", async () => {
    const user = userEvent.setup();
    const health = panelController();
    const view = render(<MedicationPanel controller={health} {...recoveryProps} />);
    await user.click(screen.getByRole("button", { name: /Open details for Vitamin D/ }));
    view.rerender(<MedicationPanel controller={health} {...recoveryProps}
      tombstonedIds={new Set([event.id])} />);
    await waitFor(() => expect(screen.queryByText("Medication entry")).toBeNull());
    await waitFor(() => expect(screen.getByRole("button", { name: "Add medication entry" })).toHaveFocus());
  });

  it("keeps detail from unfiltered active truth until authoritative removal", async () => {
    const user = userEvent.setup();
    const health = panelController();
    const view = render(<MedicationPanelHarness controller={health} />);
    await user.click(screen.getByRole("button", { name: /Open details for Vitamin D/ }));
    const filtered = defaultHealthTableSettings("health.medication");
    filtered.filterRules = [{ id: "hide-vitamin", field: "medication_name", type: "text",
      operator: "is", value: "Calcium" }];
    filtered.groupSettings = { ...filtered.groupSettings, groupBy: "medication_unit" };
    view.rerender(<MedicationPanelHarness controller={panelController(loadedState, filtered)} />);
    expect(screen.getByText("Medication entry")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Vitamin D" })).toBeInTheDocument();
    view.rerender(<MedicationPanelHarness controller={panelController({
      ...loadedState, medicationEntries: [],
    }, filtered)} />);
    await waitFor(() => expect(screen.queryByText("Medication entry")).toBeNull());
    const add = screen.getByRole("button", { name: "Add medication entry" });
    await waitFor(() => expect(document.activeElement).toBe(add));
  });

  it("uses exact clean/dirty archive copy, cancel focus, cleanup, and no phantom Forward", async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, "");
    const health = panelController();
    const pushState = vi.spyOn(window.history, "pushState");
    render(<MedicationPanelHarness controller={health} />);
    await user.click(screen.getByRole("button", { name: /Open details for Vitamin D/ }));
    const remove = screen.getByRole("button", { name: "Delete" });
    await user.click(remove);
    expect(screen.getByRole("dialog", { name: "Archive Vitamin D?" }))
      .toHaveTextContent("Move this medication entry to Archive?");
    expect(screen.getByRole("dialog")).not.toHaveTextContent("Unsaved changes");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(remove).toHaveFocus());
    await user.type(screen.getByLabelText("Note"), "draft");
    await user.click(remove);
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Move this medication entry to Archive? Unsaved changes will be discarded.");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(screen.queryByText("Medication entry")).toBeNull());
    const add = screen.getByRole("button", { name: "Add medication entry" });
    await waitFor(() => expect(add).toHaveFocus());
    expect(health.archiveMedication).toHaveBeenCalledOnce();
    expect(pushState).toHaveBeenCalledOnce();
    act(() => window.history.forward());
    await waitFor(() => expect(window.history.state.__ravenHealthMedicationDetailId).toBeNull());
    expect(screen.queryByText("Medication entry")).toBeNull();
  });

  it("retains archive draft/error and restores Delete focus after ordinary failure", async () => {
    const user = userEvent.setup();
    const health = panelController();
    health.archiveMedication = vi.fn().mockRejectedValue(new Error("Archive unavailable"));
    render(<MedicationPanelHarness controller={health} />);
    await user.click(screen.getByRole("button", { name: /Open details for Vitamin D/ }));
    await user.type(screen.getByLabelText("Note"), "draft");
    const remove = screen.getByRole("button", { name: "Delete" });
    await user.click(remove);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Archive" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Archive unavailable");
    expect(screen.getByLabelText("Note")).toHaveValue("draft");
    await waitFor(() => expect(remove).toHaveFocus());
    expect(health.archiveMedication).toHaveBeenCalledOnce();
  });

  it("keeps archive and invalid-time errors visible with the retained draft", async () => {
    vi.stubEnv("TZ", "America/New_York");
    const user = userEvent.setup();
    const health = panelController();
    health.archiveMedication = vi.fn().mockRejectedValue(new Error("Archive unavailable"));
    render(<MedicationPanelHarness controller={health} />);
    await user.click(screen.getByRole("button", { name: /Open details for Vitamin D/ }));
    fireEvent.change(screen.getByLabelText("Taken at"), { target: { value: "2026-03-08T02:30" } });
    await user.type(screen.getByLabelText("Note"), "draft");
    const remove = screen.getByRole("button", { name: "Delete" });
    await user.click(remove);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Archive" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Archive unavailable");
    expect(alert).toHaveTextContent("Time must be a valid local date and time");
    expect(screen.getByLabelText("Taken at")).toHaveValue("2026-03-08T02:30");
    expect(screen.getByLabelText("Note")).toHaveValue("draft");
    await waitFor(() => expect(remove).toHaveFocus());
    vi.unstubAllEnvs();
  });

  it("treats committed detail archive as tombstoned success and retries reads only", async () => {
    const user = userEvent.setup();
    const health = panelController();
    health.archiveMedication = vi.fn().mockRejectedValue(new HealthMutationRefreshError());
    health.refreshMedication = vi.fn().mockResolvedValue(true);
    render(<MedicationPanelHarness controller={health} />);
    await user.click(screen.getByRole("button", { name: /Open details for Vitamin D/ }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Archive" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("could not refresh");
    await waitFor(() => expect(screen.getByRole("button", { name: "Add medication entry" })).toHaveFocus());
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(health.refreshMedication).toHaveBeenCalledOnce();
    expect(health.archiveMedication).toHaveBeenCalledOnce();
    expect(screen.queryByText("Medication entry")).toBeNull();
  });

  it("defers archive cancellation until browser restoration settles", async () => {
    const user = userEvent.setup();
    window.history.pushState({}, "");
    const controlledForward = controlHistoryForward();
    render(<MedicationPanelHarness controller={panelController()} />);
    await user.click(screen.getByRole("button", { name: /Open details for Vitamin D/ }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = screen.getByRole("dialog", { name: "Archive Vitamin D?" });
    act(() => window.history.back());
    await waitFor(() => expect(controlledForward.spy).toHaveBeenCalledOnce());
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(dialog).toBeInTheDocument();
    await controlledForward.releaseNext();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Archive Vitamin D?" })).toBeNull());
    await waitFor(() => expect(screen.getByRole("button", { name: "Delete" })).toHaveFocus());
  });

  it.each(["ordinary", "committed"] as const)(
    "defers %s archive success until browser restoration settles", async (outcome) => {
      const user = userEvent.setup();
      window.history.pushState({}, "");
      const controlledForward = controlHistoryForward();
      const archived = deferred<void>();
      const health = panelController();
      health.archiveMedication = vi.fn(() => archived.promise);
      render(<MedicationPanelHarness controller={health} />);
      await user.click(screen.getByRole("button", { name: /Open details for Vitamin D/ }));
      await user.click(screen.getByRole("button", { name: "Delete" }));
      await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Archive" }));
      act(() => window.history.back());
      await waitFor(() => expect(controlledForward.spy).toHaveBeenCalledOnce());
      await act(async () => outcome === "ordinary"
        ? archived.resolve() : archived.reject(new HealthMutationRefreshError()));
      expect(screen.getByText("Medication entry")).toBeInTheDocument();
      expect(screen.getByRole("dialog", { name: "Archive Vitamin D?" })).toBeInTheDocument();
      expect(screen.getByLabelText("Note")).toBeDisabled();
      await controlledForward.releaseNext();
      await waitFor(() => expect(screen.queryByText("Medication entry")).toBeNull());
      await waitFor(() => expect(screen.getByRole("button", { name: "Add medication entry" })).toHaveFocus());
      expect(health.archiveMedication).toHaveBeenCalledOnce();
    });

  it("defers ordinary archive failure cleanup until browser restoration settles", async () => {
    const user = userEvent.setup();
    window.history.pushState({}, "");
    const controlledForward = controlHistoryForward();
    const archived = deferred<void>();
    const health = panelController();
    health.archiveMedication = vi.fn(() => archived.promise);
    render(<MedicationPanelHarness controller={health} />);
    await user.click(screen.getByRole("button", { name: /Open details for Vitamin D/ }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Archive" }));
    act(() => window.history.back());
    await waitFor(() => expect(controlledForward.spy).toHaveBeenCalledOnce());
    await act(async () => archived.reject(new Error("Archive unavailable")));
    expect(screen.getByRole("dialog", { name: "Archive Vitamin D?" })).toBeInTheDocument();
    expect(screen.getByLabelText("Note")).toBeDisabled();
    await controlledForward.releaseNext();
    expect(await screen.findByRole("alert")).toHaveTextContent("Archive unavailable");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Archive Vitamin D?" })).toBeNull());
    await waitFor(() => expect(screen.getByRole("button", { name: "Delete" })).toHaveFocus());
  });

  it("keeps the opened snapshot and optimistic token stable through a same-ID refresh", async () => {
    const user = userEvent.setup();
    const health = panelController();
    const view = render(<MedicationPanel controller={health} {...recoveryProps} />);
    await user.click(screen.getByRole("button", { name: /Open details for Vitamin D/ }));
    await user.type(screen.getByLabelText("Note"), "draft");
    const refreshed = { ...event, updatedAt: "2026-08-20T01:00:00Z",
      attributes: { kind: "medication" as const, medicationName: "Server name",
        dose: 7, unit: "tablet" as const } };
    view.rerender(<MedicationPanel controller={{ ...health, state: {
      ...loadedState, medicationEntries: [refreshed],
    } }} {...recoveryProps} />);

    expect(screen.getByRole("heading", { name: "Vitamin D" })).toBeInTheDocument();
    expect(screen.getByLabelText("Dose")).toHaveValue(1000);
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(health.updateMedication).toHaveBeenCalledWith(event.id, {
      expectedUpdatedAt: event.updatedAt, note: "draft",
    }));
  });

  it("remounts a clean immutable baseline when a different Medication ID opens", async () => {
    const user = userEvent.setup();
    const second = { ...event, id: "medication-2", note: "server note",
      attributes: { kind: "medication" as const, medicationName: "Calcium", dose: 2,
        unit: "tablet" as const } };
    render(<MedicationPanelHarness controller={panelController({
      ...loadedState, medicationEntries: [event, second],
    })} />);
    await user.click(screen.getByRole("button", { name: /Open details for Vitamin D/ }));
    await user.type(screen.getByLabelText("Note"), "first draft");
    await user.click(screen.getByRole("button", { name: "< Back" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Discard changes" }));
    await user.click(await screen.findByRole("button", { name: /Open details for Calcium/ }));
    expect(screen.getByRole("heading", { name: "Calcium" })).toBeInTheDocument();
    expect(screen.getByLabelText("Note")).toHaveValue("server note");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("sends one exact combined patch and one update", async () => {
    const user = userEvent.setup();
    const health = panelController();
    render(<MedicationPanel controller={health} {...recoveryProps} />);
    await user.click(screen.getByRole("button", { name: /Open details for Vitamin D/ }));
    for (const [label, value] of [["Medication name", "Calcium"], ["Dose", "2.5"],
      ["Note", " after food "]] as const) {
      await user.clear(screen.getByLabelText(label));
      await user.type(screen.getByLabelText(label), value);
    }
    await user.selectOptions(screen.getByLabelText("Unit"), "tablet");
    await user.clear(screen.getByLabelText("Taken at"));
    await user.type(screen.getByLabelText("Taken at"), "2026-08-20T10:30");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(health.updateMedication).toHaveBeenCalledOnce());
    expect(health.updateMedication).toHaveBeenCalledWith(event.id, {
      expectedUpdatedAt: event.updatedAt,
      occurredAt: localDateTimeToRfc3339("2026-08-20T10:30"),
      details: { kind: "medication", medicationName: "Calcium", dose: 2.5, unit: "tablet" },
      note: "after food",
    });
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

  it("renders duplicate occurrences with isolated checkboxes and interactive rows", async () => {
    const groups = deriveMedicationGroups([event], defaultHealthTableSettings("health.medication"));
    const toggle = vi.fn();
    const open = vi.fn();
    render(<MedicationTable groups={[groups[0], { ...groups[0], key: "duplicate" }]}
      activeRowCount={1} selectedIds={[]} onOpen={open}
      onToggle={toggle} onToggleAll={vi.fn()} />);
    const checkboxes = screen.getAllByRole("checkbox", { name: /Select Vitamin D/ });
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes[0].closest("tr")).toHaveAttribute("tabindex", "0");
    await userEvent.click(checkboxes[1]);
    expect(toggle).toHaveBeenCalledOnce();
    expect(toggle).toHaveBeenCalledWith(event.id);
    expect(open).not.toHaveBeenCalled();
    const occurrences = screen.getAllByRole("button", { name: /Open details for Vitamin D/ });
    expect(occurrences.map((button) => button.dataset.medicationOccurrence))
      .toEqual(["all-medication-1-0", "duplicate-medication-1-0"]);
    await userEvent.click(occurrences[1]);
    expect(open).toHaveBeenCalledWith(groups[0].rows[0], "duplicate-medication-1-0");
  });

  it("opens from row pointer and keyboard activation but never from checkbox", async () => {
    const user = userEvent.setup();
    const groups = deriveMedicationGroups([event], defaultHealthTableSettings("health.medication"));
    const open = vi.fn();
    render(<MedicationTable groups={groups} activeRowCount={1} selectedIds={[]}
      onOpen={open} onToggle={vi.fn()} onToggleAll={vi.fn()} />);
    const row = screen.getByRole("button", { name: /Open details for Vitamin D/ });
    expect(row.tagName).toBe("TR");
    expect(row).toHaveAttribute("tabindex", "0");
    expect(within(row).queryByRole("button")).toBeNull();
    await user.click(screen.getByText("Vitamin D"));
    expect(open).toHaveBeenCalledOnce();
    expect(open).toHaveBeenLastCalledWith(groups[0].rows[0], "all-medication-1-0");
    open.mockClear();
    row.focus();
    for (const key of ["Enter", " ", "Space"]) {
      fireEvent.keyDown(row, { key });
      expect(open).toHaveBeenCalledOnce();
      open.mockClear();
    }
    const checkbox = screen.getByRole("checkbox", { name: /Select Vitamin D/ });
    await user.click(checkbox);
    fireEvent.keyDown(checkbox, { key: "Enter" });
    fireEvent.keyDown(checkbox, { key: " " });
    expect(open).not.toHaveBeenCalled();
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
