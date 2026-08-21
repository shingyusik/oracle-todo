import "@testing-library/jest-dom/vitest";

import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { healthApi } from "@/features/health/api/health-api";
import type {
  HealthController,
  HealthState,
} from "@/features/health/hooks/useHealthController";
import {
  HealthMutationRefreshError,
  useHealthController,
} from "@/features/health/hooks/useHealthController";
import { defaultHealthTableSettings } from "@/features/health/model/health-table-views";
import type {
  DietEntry,
  HealthEvent,
} from "@/features/health/model/health-model";
import { HealthPanel } from "@/features/health/ui/HealthPanel";

const diet: DietEntry = {
  id: "diet-1",
  occurredAt: "2026-07-30T03:00:00Z",
  mealType: "lunch",
  foodName: "Bibimbap",
  note: null,
  tags: ["rice"],
  mediaId: null,
  createdAt: "2026-07-30T03:00:00Z",
  updatedAt: "2026-07-30T03:00:00Z",
  deletedAt: null,
};

const bowel: HealthEvent = {
  id: "event-1",
  occurredAt: "2026-07-30T04:00:00Z",
  category: "bowel",
  metricKey: "bowel",
  name: "Bowel",
  value: 4,
  unit: null,
  note: null,
  attributes: { kind: "bowel", bristolScale: 4, bloodVisible: false },
  createdAt: "2026-07-30T04:00:00Z",
  updatedAt: "2026-07-30T04:00:00Z",
  deletedAt: null,
};

const medication: HealthEvent = {
  id: "medication-1",
  occurredAt: "2026-07-30T05:00:00Z",
  category: "medication",
  metricKey: "Vitamin D",
  name: "Vitamin D",
  value: 1000,
  unit: "mg",
  note: null,
  attributes: { kind: "medication", medicationName: "Vitamin D", dose: 1000, unit: "mg" },
  createdAt: "2026-07-30T05:00:00Z",
  updatedAt: "2026-07-30T05:00:00Z",
  deletedAt: null,
};

const metric: HealthEvent = {
  id: "weight-1",
  occurredAt: "2026-07-30T03:00:00Z",
  category: "weight",
  metricKey: "body_weight",
  name: "Body weight",
  value: 72.5,
  unit: "kg",
  note: null,
  attributes: { kind: "weight", metricKey: "body_weight", name: "Body weight", value: 72.5, unit: "kg" },
  createdAt: "2026-07-30T03:00:00Z",
  updatedAt: "2026-07-30T03:00:00Z",
  deletedAt: null,
};
const metricSleep: HealthEvent = {
  ...metric,
  id: "sleep-1",
  category: "sleep",
  metricKey: "sleep_duration",
  name: "Sleep",
  value: 7.5,
  unit: "hours",
  attributes: { kind: "sleep", metricKey: "sleep_duration", name: "Sleep", hours: 7.5 },
};

const loadedState: HealthState = {
  metricsStatus: "loaded",
  metricsError: null,
  metricsEntries: [],
  medicationStatus: "loaded",
  medicationError: null,
  medicationEntries: [],
  bowelStatus: "loaded",
  bowelError: null,
  bowelEntries: [bowel],
  dietStatus: "loaded",
  dietError: null,
  dietEntries: [diet],
  reportStatus: "idle",
  reportError: null,
  report: null,
  reportSelection: { preset: 30 },
};

function controller(state: HealthState = loadedState): HealthController {
  const settings = defaultHealthTableSettings("health.diet");
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
    refreshMetrics: vi.fn(),
    refreshMedication: vi.fn(),
    refreshBowel: vi.fn(),
    refreshDiet: vi.fn(),
    runReports: vi.fn().mockResolvedValue(true),
    retryReports: vi.fn().mockResolvedValue(true),
    createDiet: vi.fn(),
    updateDiet: vi.fn(),
    archiveDiet: vi.fn(),
    createBowel: vi.fn(),
    updateBowel: vi.fn(),
    archiveBowel: vi.fn(),
    createMedication: vi.fn(),
    updateMedication: vi.fn(),
    archiveMedication: vi.fn(),
    upsertMetrics: vi.fn(),
    saveMetrics: vi.fn(),
  };
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

describe("HealthPanel", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses Diet as the default and fallback leaf and has no Overview", () => {
    render(<HealthPanel controller={controller()} />);

    expect(screen.getByRole("heading", { name: "Diet" })).toBeInTheDocument();
    expect(screen.getByText("Bibimbap")).toBeInTheDocument();
    expect(screen.queryByText("Overview")).not.toBeInTheDocument();

    render(<HealthPanel controller={controller()} leafTabId={"missing" as never} />);
    expect(screen.getAllByRole("heading", { name: "Diet" })).toHaveLength(2);
  });

  it("mounts Reports with one default 30-day request", async () => {
    const health = controller();
    render(<HealthPanel controller={health} leafTabId={"reports" as never} />);

    expect(await screen.findByRole("heading", { name: "Reports" })).toBeInTheDocument();
    await waitFor(() => expect(health.runReports).toHaveBeenCalledOnce());
    expect(health.runReports).toHaveBeenCalledWith({ preset: 30 });
    expect(screen.queryByRole("heading", { name: "Timeline" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Trends" })).toBeNull();
  });

  it("cleans Diet detail history and its listener when the Health leaf changes", async () => {
    const user = userEvent.setup();
    window.history.replaceState({ preserved: "health" }, "");
    const removeEventListener = vi.spyOn(window, "removeEventListener");
    const health = controller();
    const view = render(<HealthPanel controller={health} leafTabId="diet" />);
    await user.click(screen.getByRole("row", { name: /Open details for Bibimbap/ }));
    expect(window.history.state).toMatchObject({
      preserved: "health",
      __ravenHealthDietDetailId: "diet-1",
    });

    view.rerender(<HealthPanel controller={health} leafTabId="bowel" />);

    expect(screen.getByRole("heading", { name: "Bowel" })).toBeInTheDocument();
    expect(window.history.state).toMatchObject({
      preserved: "health",
      __ravenHealthDietDetailId: null,
    });
    expect(removeEventListener).toHaveBeenCalledWith("popstate", expect.any(Function));
  });

  it("cleans only Bowel detail history when the Health leaf changes", async () => {
    const user = userEvent.setup();
    window.history.replaceState({ __ravenHealthDietDetailId: "keep-diet" }, "");
    const removeEventListener = vi.spyOn(window, "removeEventListener");
    const health = controller();
    const view = render(<HealthPanel controller={health} leafTabId="bowel" />);
    await user.click(screen.getByRole("row", { name: /Open details for Type 4/ }));
    expect(window.history.state).toMatchObject({
      __ravenHealthDietDetailId: "keep-diet",
      __ravenHealthBowelDetailId: bowel.id,
    });

    view.rerender(<HealthPanel controller={health} leafTabId="reports" />);

    expect(window.history.state).toMatchObject({
      __ravenHealthDietDetailId: "keep-diet",
      __ravenHealthBowelDetailId: null,
    });
    expect(removeEventListener).toHaveBeenCalledWith("popstate", expect.any(Function));
  });

  it("preserves committed Diet archive recovery across Health leaf tabs", async () => {
    const user = userEvent.setup();
    const health = controller();
    health.archiveDiet = vi.fn().mockRejectedValue(new HealthMutationRefreshError());
    health.refresh = vi.fn().mockResolvedValue(true);
    const view = render(<HealthPanel controller={health} leafTabId="diet" />);

    await user.click(screen.getByRole("checkbox", { name: /Select Bibimbap/ }));
    await user.click(screen.getByRole("button", { name: "Archive selected diet entries" }));
    await user.click(within(screen.getByRole("dialog", {
      name: "Archive selected diet entries?",
    })).getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(screen.queryByText("Bibimbap")).toBeNull());

    view.rerender(<HealthPanel controller={health} leafTabId="bowel" />);
    view.rerender(<HealthPanel controller={health} leafTabId="diet" />);
    expect(screen.queryByText("Bibimbap")).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Changes were saved, but Health could not refresh.",
    );

    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(health.refresh).toHaveBeenCalledOnce();
    expect(health.archiveDiet).toHaveBeenCalledOnce();
    expect(screen.queryByText("Bibimbap")).toBeNull();

    view.rerender(<HealthPanel controller={{
      ...health,
      state: { ...health.state, dietEntries: [], dietError: null },
    }} leafTabId="diet" />);
    await waitFor(() => expect(screen.queryByText(
      "Changes were saved, but Health could not refresh.",
    )).toBeNull());
    expect(screen.queryByText("Bibimbap")).toBeNull();
  });

  it("reconciles committed Bowel recovery only from new authoritative loaded arrays", async () => {
    const user = userEvent.setup();
    const health = controller();
    health.archiveBowel = vi.fn().mockRejectedValue(new HealthMutationRefreshError());
    health.refreshBowel = vi.fn().mockResolvedValue(true);
    const view = render(<HealthPanel controller={health} leafTabId="bowel" />);

    await user.click(screen.getByRole("checkbox", { name: /Select Type 4/ }));
    await user.click(screen.getByRole("button", { name: "Archive selected bowel entries" }));
    await user.click(within(screen.getByRole("dialog", {
      name: "Archive selected bowel entries?",
    })).getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(screen.queryByText("Type 4")).toBeNull());

    view.rerender(<HealthPanel controller={{ ...health, state: {
      ...health.state, bowelStatus: "loading",
    } }} leafTabId="bowel" />);
    expect(screen.queryByText("Type 4")).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent("could not refresh");
    view.rerender(<HealthPanel controller={{ ...health, state: {
      ...health.state, bowelError: "stale refresh error",
    } }} leafTabId="bowel" />);
    expect(screen.queryByText("Type 4")).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent("could not refresh");
    view.rerender(<HealthPanel controller={health} leafTabId="diet" />);
    view.rerender(<HealthPanel controller={health} leafTabId="bowel" />);
    expect(screen.queryByText("Type 4")).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Changes were saved, but Health could not refresh.",
    );
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(health.refreshBowel).toHaveBeenCalledOnce();
    expect(health.refresh).not.toHaveBeenCalled();
    expect(health.archiveBowel).toHaveBeenCalledOnce();
    expect(screen.queryByText("Type 4")).toBeNull();

    const stillActive = [{ ...bowel }];
    view.rerender(<HealthPanel controller={{
      ...health,
      state: { ...health.state, bowelEntries: stillActive, bowelError: null },
    }} leafTabId="bowel" />);
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(screen.queryByText("Type 4")).toBeNull();

    const withoutArchived: HealthEvent[] = [];
    view.rerender(<HealthPanel controller={{
      ...health,
      state: { ...health.state, bowelEntries: withoutArchived, bowelError: null },
    }} leafTabId="bowel" />);
    expect(screen.getByText("No bowel entries yet.")).toBeInTheDocument();
    view.rerender(<HealthPanel controller={{
      ...health,
      state: { ...health.state, bowelEntries: [{ ...bowel }], bowelError: null },
    }} leafTabId="bowel" />);
    await waitFor(() => expect(screen.getByText("Type 4")).toBeInTheDocument());
  });

  it("cleans only Medication detail history and its listener when the Health leaf changes", async () => {
    const user = userEvent.setup();
    window.history.replaceState({
      __ravenHealthDietDetailId: "keep-diet",
      __ravenHealthBowelDetailId: "keep-bowel",
    }, "");
    const removeEventListener = vi.spyOn(window, "removeEventListener");
    const health = controller({ ...loadedState, medicationEntries: [medication] });
    const view = render(<HealthPanel controller={health} leafTabId="medication" />);
    await user.click(screen.getByRole("row", { name: /Open details for Vitamin D/ }));
    expect(window.history.state).toMatchObject({
      __ravenHealthDietDetailId: "keep-diet",
      __ravenHealthBowelDetailId: "keep-bowel",
      __ravenHealthMedicationDetailId: medication.id,
    });

    view.rerender(<HealthPanel controller={health} leafTabId="reports" />);

    expect(window.history.state).toMatchObject({
      __ravenHealthDietDetailId: "keep-diet",
      __ravenHealthBowelDetailId: "keep-bowel",
      __ravenHealthMedicationDetailId: null,
    });
    expect(removeEventListener).toHaveBeenCalledWith("popstate", expect.any(Function));
  });

  it("preserves and reconciles committed Medication recovery across Health leaf tabs", async () => {
    const user = userEvent.setup();
    const health = controller({ ...loadedState, medicationEntries: [medication] });
    health.archiveMedication = vi.fn().mockRejectedValue(new HealthMutationRefreshError());
    health.refreshMedication = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const view = render(<HealthPanel controller={health} leafTabId="medication" />);
    await user.click(screen.getByRole("checkbox", { name: /Select Vitamin D/ }));
    await user.click(screen.getByRole("button", { name: "Archive selected medication entries" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(screen.queryByText("Vitamin D")).toBeNull());

    view.rerender(<HealthPanel controller={{ ...health, state: {
      ...health.state, medicationStatus: "loading",
    } }} leafTabId="medication" />);
    expect(screen.queryByText("Vitamin D")).toBeNull();
    view.rerender(<HealthPanel controller={{ ...health, state: {
      ...health.state, medicationError: "stale refresh error",
    } }} leafTabId="medication" />);
    expect(screen.queryByText("Vitamin D")).toBeNull();
    view.rerender(<HealthPanel controller={health} leafTabId="diet" />);
    view.rerender(<HealthPanel controller={health} leafTabId="medication" />);
    expect(screen.queryByText("Vitamin D")).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent("could not refresh");

    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(health.refreshMedication).toHaveBeenCalledOnce();
    expect(screen.getByRole("alert")).toHaveTextContent("could not refresh");
    expect(health.archiveMedication).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(health.refreshMedication).toHaveBeenCalledTimes(2);

    const stillActive = [{ ...medication }];
    view.rerender(<HealthPanel controller={{ ...health, state: {
      ...health.state, medicationEntries: stillActive, medicationError: null,
    } }} leafTabId="medication" />);
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(screen.queryByText("Vitamin D")).toBeNull();
    view.rerender(<HealthPanel controller={{ ...health, state: {
      ...health.state, medicationEntries: [], medicationError: null,
    } }} leafTabId="medication" />);
    expect(screen.getByText("No medication entries yet.")).toBeInTheDocument();
    view.rerender(<HealthPanel controller={{ ...health, state: {
      ...health.state, medicationEntries: [{ ...medication }], medicationError: null,
    } }} leafTabId="medication" />);
    await waitFor(() => expect(screen.getByText("Vitamin D")).toBeInTheDocument());
  });

  it("preserves committed Metrics member tombstones across Health leaf tabs", async () => {
    const user = userEvent.setup();
    const health = controller({ ...loadedState, metricsEntries: [metric, metricSleep] });
    health.saveMetrics = vi.fn().mockRejectedValue(new HealthMutationRefreshError());
    health.refreshMetrics = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const view = render(<HealthPanel controller={health} leafTabId="health-metrics" />);

    await user.click(screen.getByRole("checkbox", { name: /Select health metrics for 2026-07-30/ }));
    await user.click(screen.getByRole("button", { name: "Archive selected health metrics entries" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(screen.queryByText("72.5 kg")).toBeNull());
    expect(screen.queryByText("7.5 hours")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Add health metrics entry" }));
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-07-30" } });
    await act(async () => Promise.resolve());
    expect(screen.getByLabelText("Weight")).toHaveValue(null);
    expect(screen.getByLabelText("Sleep")).toHaveValue(null);
    await user.click(screen.getByRole("button", { name: "Close Add health metrics" }));

    view.rerender(<HealthPanel controller={{ ...health, state: {
      ...health.state, metricsStatus: "loading",
    } }} leafTabId="health-metrics" />);
    expect(screen.queryByText("72.5 kg")).toBeNull();
    expect(screen.queryByText("7.5 hours")).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent("could not refresh");
    view.rerender(<HealthPanel controller={{ ...health, state: {
      ...health.state, metricsError: "stale refresh error",
    } }} leafTabId="health-metrics" />);
    expect(screen.queryByText("72.5 kg")).toBeNull();
    expect(screen.queryByText("7.5 hours")).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent("could not refresh");

    view.rerender(<HealthPanel controller={health} leafTabId="diet" />);
    view.rerender(<HealthPanel controller={health} leafTabId="health-metrics" />);
    expect(screen.queryByText("72.5 kg")).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent("could not refresh");
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(health.refreshMetrics).toHaveBeenCalledOnce();
    expect(health.saveMetrics).toHaveBeenCalledOnce();
    expect(screen.getByRole("alert")).toHaveTextContent("could not refresh");
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(health.refreshMetrics).toHaveBeenCalledTimes(2);

    view.rerender(<HealthPanel controller={{ ...health, state: {
      ...health.state, metricsEntries: [metricSleep], metricsError: null,
    } }} leafTabId="health-metrics" />);
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(screen.queryByText("72.5 kg")).toBeNull();
    expect(screen.queryByText("7.5 hours")).toBeNull();

    view.rerender(<HealthPanel controller={{ ...health, state: {
      ...health.state, metricsEntries: [metric], metricsError: null,
    } }} leafTabId="health-metrics" />);
    await waitFor(() => expect(screen.getByText("72.5 kg")).toBeInTheDocument());
    expect(screen.queryByText("7.5 hours")).toBeNull();
    view.rerender(<HealthPanel controller={{ ...health, state: {
      ...health.state, metricsEntries: [metric, metricSleep], metricsError: null,
    } }} leafTabId="health-metrics" />);
    await waitFor(() => expect(screen.getByText("72.5 kg")).toBeInTheDocument());
    expect(screen.getByText("7.5 hours")).toBeInTheDocument();
  });

  it("locks Metrics refresh recovery and restores Add focus without repeating mutation", async () => {
    const user = userEvent.setup();
    const first = deferred<boolean>();
    const second = deferred<boolean>();
    const health = controller({ ...loadedState, metricsEntries: [metric, metricSleep] });
    health.saveMetrics = vi.fn().mockRejectedValue(new HealthMutationRefreshError());
    health.refreshMetrics = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    render(<HealthPanel controller={health} leafTabId="health-metrics" />);
    await user.click(screen.getByRole("checkbox", { name: /Select health metrics for/ }));
    await user.click(screen.getByRole("button", { name: "Archive selected health metrics entries" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Archive" }));

    const retry = await screen.findByRole("button", { name: "Retry" });
    await user.click(retry);
    expect(retry).toBeDisabled();
    expect(retry).toHaveFocus();
    fireEvent.click(retry);
    expect(health.refreshMetrics).toHaveBeenCalledOnce();
    await act(async () => first.resolve(false));
    await waitFor(() => expect(retry).toBeEnabled());
    expect(retry).toHaveFocus();
    await user.click(retry);
    await act(async () => second.resolve(true));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(health.refreshMetrics).toHaveBeenCalledTimes(2);
    expect(health.saveMetrics).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Add health metrics entry" })).toHaveFocus();
  });

  it("locks committed Medication refresh Retry and restores Add focus after recovery", async () => {
    const user = userEvent.setup();
    const first = deferred<boolean>();
    const second = deferred<boolean>();
    const health = controller({ ...loadedState, medicationEntries: [medication] });
    health.archiveMedication = vi.fn().mockRejectedValue(new HealthMutationRefreshError());
    health.refreshMedication = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    render(<HealthPanel controller={health} leafTabId="medication" />);
    await user.click(screen.getByRole("checkbox", { name: /Select Vitamin D/ }));
    await user.click(screen.getByRole("button", { name: "Archive selected medication entries" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Archive" }));

    const retry = await screen.findByRole("button", { name: "Retry" });
    await user.click(retry);
    expect(retry).toBeDisabled();
    expect(retry).toHaveFocus();
    fireEvent.click(retry);
    expect(health.refreshMedication).toHaveBeenCalledOnce();
    await act(async () => first.resolve(false));
    await waitFor(() => expect(retry).toBeEnabled());
    expect(retry).toHaveFocus();
    expect(screen.getByRole("alert")).toHaveTextContent("could not refresh");

    await user.click(retry);
    expect(retry).toBeDisabled();
    await act(async () => second.resolve(true));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(health.refreshMedication).toHaveBeenCalledTimes(2);
    expect(health.archiveMedication).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Add medication entry" })).toHaveFocus();
  });

  it("loads, normalizes, edits, and persists Health Diet views", async () => {
    vi.spyOn(healthApi, "listDiet").mockResolvedValue([]);
    vi.spyOn(healthApi, "listEvents").mockResolvedValue([]);
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      init
        ? new Response("{}", { status: 200 })
        : new Response(JSON.stringify({
          "health.diet": { tabs: [{
            id: "meals",
            name: "Meals",
            settings: {
              filterMode: "or",
              sortRules: [{ id: "food", field: "food", direction: "asc" }],
              groupSettings: { groupBy: "invalid" },
            },
          }] },
        }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useHealthController());
    await waitFor(() => expect(result.current.tableTabs("health.diet").activeTabId)
      .toBe("meals"));
    expect(result.current.tableSettings("health.diet").groupSettings.groupBy).toBe("none");

    act(() => expect(result.current.createTableTab("health.diet", "Photos")).toBe(true));
    const createdId = result.current.tableTabs("health.diet").activeTabId;
    act(() => {
      expect(result.current.renameTableTab("health.diet", createdId, "With photos"))
        .toBe(true);
      result.current.updateTableSettings("health.diet", (settings) => ({
        ...settings,
        groupSettings: { ...settings.groupSettings, groupBy: "has_photo" },
      }));
      result.current.saveTableTab("health.diet");
    });
    expect(result.current.tableIsDirty("health.diet")).toBe(false);
    act(() => result.current.updateTableSettings("health.diet", (settings) => ({
      ...settings,
      filterMode: "and",
    })));
    act(() => result.current.selectTableTab("health.diet", "meals"));
    expect(result.current.tableViewConfirmation).toMatchObject({
      kind: "select",
      target: { scope: "health.diet" },
      targetTabId: "meals",
    });
    act(() => result.current.confirmTableViewAction());
    act(() => result.current.requestDeleteTableTab("health.diet", createdId));
    expect(result.current.tableViewConfirmation).toMatchObject({
      kind: "delete",
      target: { scope: "health.diet" },
      targetTabId: createdId,
    });
    act(() => result.current.confirmTableViewAction());

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/preferences/health.views.v1",
      expect.objectContaining({ method: "PUT" }),
    ));
    expect(result.current.tableTabs("health.diet").tabs.map(({ name }) => name))
      .toEqual(["Meals"]);
  });

  it("replays queued Health view commands over stored preferences", async () => {
    vi.spyOn(healthApi, "listDiet").mockResolvedValue([]);
    vi.spyOn(healthApi, "listEvents").mockResolvedValue([]);
    const stored = deferred<Response>();
    const putBodies: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if (!init) return stored.promise;
      putBodies.push(JSON.parse(String(init.body)));
      return Promise.resolve(new Response("{}", { status: 200 }));
    }));

    const { result } = renderHook(() => useHealthController());
    act(() => expect(result.current.createTableTab("health.diet", "Early")).toBe(true));
    await act(async () => stored.resolve(new Response(JSON.stringify({
      "health.diet": { tabs: [{ id: "stored", name: "Stored", settings: {} }] },
    }), { status: 200 })));

    await waitFor(() => expect(result.current.tableTabs("health.diet").tabs
      .map(({ name }) => name)).toEqual(["Stored", "Early"]));
    await waitFor(() => expect(putBodies).toHaveLength(1));
  });

  it("uses last-write-wins Health view errors and retries the current state", async () => {
    vi.spyOn(healthApi, "listDiet").mockResolvedValue([]);
    vi.spyOn(healthApi, "listEvents").mockResolvedValue([]);
    let putCount = 0;
    vi.stubGlobal("fetch", vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if (!init) return Promise.resolve(new Response("{}", { status: 200 }));
      putCount += 1;
      return Promise.resolve(new Response("{}", { status: putCount === 2 ? 500 : 200 }));
    }));

    const { result } = renderHook(() => useHealthController());
    await waitFor(() => expect(result.current.tableTabs("health.diet").activeTabId)
      .toBe("health.diet-table"));
    act(() => result.current.createTableTab("health.diet", "First"));
    const id = result.current.tableTabs("health.diet").activeTabId;
    act(() => result.current.renameTableTab("health.diet", id, "Latest"));
    await waitFor(() => expect(putCount).toBe(2));
    await waitFor(() => expect(result.current.tableViewSaveError)
      .toBe("Could not save Health views."));
    act(() => result.current.retryTableViewSave());
    await waitFor(() => expect(putCount).toBe(3));
    await waitFor(() => expect(result.current.tableViewSaveError).toBeNull());
  });

  it("renders Health view selection confirmation and supports cancel and confirm", async () => {
    const user = userEvent.setup();
    const health = controller();
    health.tableViewConfirmation = {
      kind: "select",
      target: { scope: "health.diet" },
      targetTabId: "other",
    };
    health.tableIsDirty = vi.fn(() => true);

    const view = render(<HealthPanel controller={health} />);
    const dialog = screen.getByRole("dialog", {
      name: "Discard unsaved view changes?",
    });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(health.cancelTableViewAction).toHaveBeenCalledOnce();

    view.rerender(<HealthPanel controller={{ ...health }} />);
    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(health.confirmTableViewAction).toHaveBeenCalledOnce();
  });

  it("renders Health view delete confirmation and retries save failures", async () => {
    const user = userEvent.setup();
    const health = controller();
    health.tableViewSaveError = "Could not save Health views.";
    const confirmation = {
      kind: "delete",
      target: { scope: "health.diet" },
      targetTabId: "health.diet-table",
    } as const;
    health.tableIsDirty = vi.fn(() => true);

    const view = render(<HealthPanel controller={health} />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not save Health views.",
    );
    await user.click(screen.getByRole("button", { name: "Retry view save" }));
    expect(health.retryTableViewSave).toHaveBeenCalledOnce();

    health.tableViewConfirmation = confirmation;
    view.rerender(<HealthPanel controller={{ ...health }} />);
    expect(screen.getByText(/unsaved filter, sort, and group changes/i))
      .toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(health.confirmTableViewAction).toHaveBeenCalledOnce();
  });

  it("ignores an older Health view write failure after a newer save succeeds", async () => {
    vi.spyOn(healthApi, "listDiet").mockResolvedValue([]);
    vi.spyOn(healthApi, "listEvents").mockResolvedValue([]);
    let putCount = 0;
    vi.stubGlobal("fetch", vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if (!init) return Promise.resolve(new Response("{}", { status: 200 }));
      putCount += 1;
      return Promise.resolve(new Response("{}", { status: putCount === 1 ? 500 : 200 }));
    }));

    const { result } = renderHook(() => useHealthController());
    await waitFor(() => expect(result.current.tableTabs("health.diet").activeTabId)
      .toBe("health.diet-table"));
    act(() => result.current.createTableTab("health.diet", "Queued"));
    const id = result.current.tableTabs("health.diet").activeTabId;
    act(() => result.current.renameTableTab("health.diet", id, "Queued latest"));

    await waitFor(() => expect(putCount).toBe(2));
    expect(result.current.tableViewSaveError).toBeNull();
  });
});
