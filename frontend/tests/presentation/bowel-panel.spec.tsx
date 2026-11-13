import "@testing-library/jest-dom/vitest";

import { act, fireEvent, render,  screen, waitFor, within } from "@testing-library/react";
import React from "react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { healthApi } from "@/features/health/api/health-api";
import {
  HealthMutationRefreshError,
} from "@/features/health/hooks/useHealthController";
import type {
  HealthEvent,
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
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("Health Bowel paging", () => {
  afterEach(() => vi.restoreAllMocks());

  it("requests only the scoped first table page on mount", async () => {
    const legacy = vi.spyOn(healthApi, "listEvents");
    const health = panelController();
    render(<BowelPanelHarness controller={health} />);
    await waitFor(() => expect(health.ensureTable).toHaveBeenCalledWith("health.bowel"));
    expect(legacy).not.toHaveBeenCalled();
  });
});

const loadedState: HealthState = {
  metricsStatus: "loaded", metricsError: null, metricsEntries: [],
  medicationStatus: "loaded", medicationError: null, medicationEntries: [],
  bowelStatus: "loaded", bowelError: null, bowelEntries: [event],
  dietStatus: "loaded", dietError: null, dietEntries: [],
  reportStatus: "idle", reportError: null, report: null, reportSelection: { preset: 30 },
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
    tableIsDirty: vi.fn(() => false),
    tablePage: vi.fn(function (this: HealthController) { const status = this.state.bowelStatus; return {
      items: bowelOccurrences(this.state.bowelEntries, this.tableSettings("health.bowel")),
      nextOffset: status === "error" ? 0 : null,
      moreStatus: status === "loading" ? "loading" as const : status === "error" ? "error" as const : "idle" as const,
      moreError: this.state.bowelError, generation: status === "loading" ? 0 : 1,
    }; }),
    ensureTable: vi.fn().mockResolvedValue(undefined), loadMore: vi.fn().mockResolvedValue(undefined),
    ensureReferenceData: vi.fn().mockResolvedValue(true), hasReferenceData: vi.fn(() => false),
    updateTableSettings: vi.fn(),
    selectTableTab: vi.fn(), saveTableTab: vi.fn(), createTableTab: vi.fn(() => true),
    renameTableTab: vi.fn(() => true), requestDeleteTableTab: vi.fn(),
    confirmTableViewAction: vi.fn(), cancelTableViewAction: vi.fn(),
    refresh: vi.fn(), refreshMetrics: vi.fn(), refreshMedication: vi.fn(), refreshBowel: vi.fn(), refreshDiet: vi.fn(),
    runReports: vi.fn(), retryReports: vi.fn(),
    createDiet: vi.fn(), updateDiet: vi.fn(), archiveDiet: vi.fn(),
    createBowel: vi.fn(), updateBowel: vi.fn(), archiveBowel: vi.fn(),
    createMedication: vi.fn(), updateMedication: vi.fn(), archiveMedication: vi.fn(),
    upsertMetrics: vi.fn(), saveMetrics: vi.fn(),
  };
}

function bowelOccurrences(entries: readonly HealthEvent[], settings: ReturnType<typeof defaultHealthTableSettings>) {
  return deriveBowelGroups(entries, settings).flatMap((group) => group.rows.map((row) => ({
    key: `${group.key}:${row.id}`, scope: "health.bowel" as const,
    groupKey: group.label === null ? null : group.key, groupLabel: group.label,
    record: { kind: "bowel" as const, id: row.id, event: row.event, date: row.date,
      bristolScale: row.bristolScale, bloodVisible: row.bloodVisible,
      bloodLabel: row.bloodLabel, note: row.note },
  })));
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

  const rowName = /Open details for Type 4/;
  async function openEdit(user: ReturnType<typeof userEvent.setup>, health = panelController()) {
    const view = render(<BowelPanelHarness controller={health} />);
    await user.click(screen.getByRole("row", { name: rowName }));
    return { health, view, dialog: screen.getByRole("dialog", { name: "Edit bowel entry" }) };
  }

  it("opens the Add popup in edit mode, pre-filled, from click, Enter, and Space", async () => {
    const user = userEvent.setup();
    const { dialog, health } = await openEdit(user);
    expect(within(dialog).getByRole("heading", { name: "Edit bowel entry" })).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Bristol Scale")).toHaveValue("4");
    expect(within(dialog).getByLabelText("Blood Visible")).not.toBeChecked();
    expect(within(dialog).getByLabelText("Note")).toHaveValue("");
    expect(within(dialog).getByRole("button", { name: "Close Edit bowel entry" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeEnabled();
    expect(within(dialog).queryByRole("button", { name: /Undo|Redo|Delete/ })).toBeNull();
    expect(health.ensureReferenceData).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const row = screen.getByRole("row", { name: rowName });
    await waitFor(() => expect(row).toHaveFocus());
    await user.keyboard("{Enter}");
    expect(screen.getByRole("dialog", { name: "Edit bowel entry" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(row).toHaveFocus());
    await user.keyboard(" ");
    expect(screen.getByRole("dialog", { name: "Edit bowel entry" })).toBeInTheDocument();
  });

  it("closes a clean popup with the Close button and returns focus to the row", async () => {
    const user = userEvent.setup();
    await openEdit(user);
    await user.click(screen.getByRole("button", { name: "Close Edit bowel entry" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(screen.getByRole("row", { name: rowName })).toHaveFocus());
  });

  it("asks before Escape discards a dirty popup", async () => {
    const user = userEvent.setup();
    await openEdit(user);
    await user.type(screen.getByLabelText("Note"), "changed");
    await user.keyboard("{Escape}");
    const confirm = screen.getByRole("dialog", { name: "Discard unsaved changes?" });
    await user.click(within(confirm).getByRole("button", { name: "Cancel" }));
    expect(screen.getByLabelText("Note")).toHaveValue("changed");
    await user.keyboard("{Escape}");
    await user.click(within(screen.getByRole("dialog", { name: "Discard unsaved changes?" }))
      .getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(screen.getByRole("row", { name: rowName })).toHaveFocus());
  });

  it("opens Add immediately after closing the edit popup", async () => {
    const user = userEvent.setup();
    const { health } = await openEdit(user);
    await user.click(screen.getByRole("button", { name: "Close Edit bowel entry" }));
    await user.click(await screen.findByRole("button", { name: "Add bowel entry" }));
    expect(screen.getByRole("dialog", { name: "Add bowel entry" })).toBeInTheDocument();
    expect(health.ensureReferenceData).not.toHaveBeenCalled();
  });

  it("preserves an open Bowel draft while the table generation changes", async () => {
    const user = userEvent.setup();
    const health = panelController();
    const page = health.tablePage("health.bowel");
    let generation = page.generation;
    health.tablePage = vi.fn(() => ({ ...page, generation }));
    const view = render(<BowelPanelHarness controller={health} />);
    await user.click(screen.getByRole("button", { name: "Add bowel entry" }));
    await user.type(screen.getByLabelText("Note"), "Keep draft");
    generation += 1;
    view.rerender(<BowelPanelHarness controller={health} />);
    expect(screen.getByRole("dialog", { name: "Add bowel entry" })).toBeInTheDocument();
    expect(screen.getByLabelText("Note")).toHaveValue("Keep draft");
    expect(health.ensureReferenceData).not.toHaveBeenCalled();
  });

  it("opens Bowel details from the accessible row and isolates its checkbox", async () => {
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
    const row = screen.getByRole("row", { name: /Open details for Type 4/ });
    expect(row.tagName).toBe("TR");
    expect(row).toHaveRole("row");
    expect(row).toHaveAttribute("tabindex", "0");
    expect(row).toHaveAttribute("aria-description", "Press Enter or Space to open details.");
    expect(row).toHaveAttribute("data-bowel-row-id", event.id);
    expect(row).toHaveAttribute("data-bowel-occurrence", "all-bowel-1-0");
    expect(within(row).queryByRole("button")).toBeNull();
    await user.click(within(row).getByText(groups[0]!.rows[0]!.timeLabel));
    expect(open).toHaveBeenCalledWith(groups[0]!.rows[0], "all-bowel-1-0");
    open.mockClear();
    row.focus();
    for (const key of ["Enter", " ", "Space"]) {
      fireEvent.keyDown(row, { key });
      expect(open).toHaveBeenCalledOnce();
      open.mockClear();
    }
    const checkbox = within(row).getByRole("checkbox");
    await user.click(checkbox);
    fireEvent.keyDown(checkbox, { key: "Enter" });
    fireEvent.keyDown(checkbox, { key: " " });
    expect(open).not.toHaveBeenCalled();
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

  it("edits a Bowel entry and sends a minimal patch with the current version", async () => {
    const user = userEvent.setup();
    const { health } = await openEdit(user);
    await user.selectOptions(screen.getByLabelText("Bristol Scale"), "7");
    await user.click(screen.getByLabelText("Blood Visible"));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(health.updateBowel).toHaveBeenCalledWith("bowel-1", {
      details: { kind: "bowel", bristolScale: 7, bloodVisible: true },
      expectedUpdatedAt: event.updatedAt,
    }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(screen.getByRole("row", { name: rowName })).toHaveFocus());
  });

  it.each([
    ["time", "occurredAt", "2026-08-20T11:30", (value: string) => ({ occurredAt: localDateTimeToRfc3339(value) })],
    ["Bristol", "bristolScale", "1", () => ({ details: { kind: "bowel", bristolScale: 1, bloodVisible: false } })],
    ["blood", "bloodVisible", true, () => ({ details: { kind: "bowel", bristolScale: 4, bloodVisible: true } })],
    ["note", "note", "  changed  ", () => ({ note: "changed" })],
  ] as const)("sends one minimal %s-only patch", async (_name, field, value, expected) => {
    const user = userEvent.setup();
    const { health } = await openEdit(user);
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
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(screen.getByRole("row", { name: rowName })).toHaveFocus());
  });

  it("freezes the opened values and version across a same-ID refresh", async () => {
    const user = userEvent.setup();
    const saved = deferred<void>();
    const health = panelController();
    health.updateBowel = vi.fn(() => saved.promise);
    const { view } = await openEdit(user, health);
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

  it("treats whitespace and equivalent local time as no-ops: Save closes without a request", async () => {
    const user = userEvent.setup();
    const { health } = await openEdit(user);
    const time = screen.getByLabelText("Time") as HTMLInputElement;
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "   " } });
    fireEvent.change(time, { target: { value: time.value.length === 16 ? `${time.value}:00` : time.value.slice(0, 16) } });
    expect(within(screen.getByLabelText("Bristol Scale")).getAllByRole("option")
      .map((option) => option.textContent)).toEqual([
        "Type 1", "Type 2", "Type 3", "Type 4", "Type 5", "Type 6", "Type 7",
      ]);
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(health.updateBowel).not.toHaveBeenCalled();
    expect(health.createBowel).not.toHaveBeenCalled();
  });

  it("rejects a missing Health time without sending or losing the draft", async () => {
    const user = userEvent.setup();
    const { health } = await openEdit(user);
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "keep" } });
    fireEvent.change(screen.getByLabelText("Time"), { target: { value: "" } });
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(health.updateBowel).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Edit bowel entry" })).toBeInTheDocument();
    expect(screen.getByLabelText("Note")).toHaveValue("keep");
    expect(screen.getByLabelText("Time")).toHaveValue("");
  });

  it("keeps the draft after an ordinary update failure and allows a retry", async () => {
    const user = userEvent.setup();
    const health = panelController();
    health.updateBowel = vi.fn().mockRejectedValueOnce(new Error("Save failed"));
    await openEdit(user, health);
    await user.type(screen.getByLabelText("Note"), "draft");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Save failed");
    expect(screen.getByRole("dialog", { name: "Edit bowel entry" })).toBeInTheDocument();
    expect(screen.getByLabelText("Note")).toHaveValue("draft");
    expect(health.updateBowel).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(health.updateBowel).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("locks fields and Close while a save is pending and ignores Escape", async () => {
    const user = userEvent.setup();
    const saved = deferred<void>();
    const health = panelController();
    health.updateBowel = vi.fn(() => saved.promise);
    await openEdit(user, health);
    await user.type(screen.getByLabelText("Note"), "x");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(health.updateBowel).toHaveBeenCalledOnce());
    expect(screen.getByLabelText("Time")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Close Edit bowel entry" })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.getByRole("dialog", { name: "Edit bowel entry" })).toBeInTheDocument();
    await act(async () => saved.resolve());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(health.updateBowel).toHaveBeenCalledOnce();
  });

  it("freezes committed-update recovery, retries Bowel reads false then true, and never resubmits", async () => {
    const user = userEvent.setup();
    const health = panelController();
    health.updateBowel = vi.fn().mockRejectedValue(new HealthMutationRefreshError());
    health.refreshBowel = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await openEdit(user, health);
    await user.type(screen.getByLabelText("Note"), "saved");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Changes were saved, but Health could not refresh.");
    for (const label of ["Time", "Bristol Scale", "Blood Visible", "Note"]) {
      expect(screen.getByLabelText(label)).toBeDisabled();
    }
    await user.click(screen.getByRole("button", { name: "Retry refresh" }));
    expect(screen.getByLabelText("Note")).toHaveValue("saved");
    expect(health.updateBowel).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Retry refresh" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(health.refreshBowel).toHaveBeenCalledTimes(2);
    expect(health.updateBowel).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.getByRole("row", { name: rowName })).toHaveFocus());
  });

  it("keeps an open edit popup while authoritative truth changes", async () => {
    const user = userEvent.setup();
    const health = panelController();
    const { view } = await openEdit(user, health);
    await user.type(screen.getByLabelText("Note"), "draft");
    view.rerender(<BowelPanelHarness controller={{ ...health,
      state: { ...health.state, bowelEntries: [] } }} />);
    expect(screen.getByRole("dialog", { name: "Edit bowel entry" })).toBeInTheDocument();
    expect(screen.getByLabelText("Note")).toHaveValue("draft");
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
    }), loadMore: retry }} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading bowel entries");
    view.rerender(<BowelPanelHarness controller={{ ...panelController({
      ...loadedState, bowelStatus: "error", bowelEntries: [], bowelError: "Bowel unavailable",
    }), loadMore: retry }} />);
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
