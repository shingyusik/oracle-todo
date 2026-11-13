import "@testing-library/jest-dom/vitest";

import { act, fireEvent, render,  screen, waitFor, within } from "@testing-library/react";
import React from "react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { healthApi } from "@/features/health/api/health-api";
import {
  HealthMutationRefreshError,
  
} from "@/features/health/hooks/useHealthController";
import type { DietEntry } from "@/features/health/model/health-model";
import type { HealthController, HealthState } from "@/features/health/hooks/useHealthController";
import { deriveDietGroups } from "@/features/health/model/diet-table";
import { defaultHealthTableSettings } from "@/features/health/model/health-table-views";
import { DietPanel as DietPanelView } from "@/features/health/ui/DietPanel";
import { DietTable } from "@/features/health/ui/DietTable";

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
    tablePage: vi.fn(function (this: HealthController) { const status = this.state.dietStatus; return {
      items: dietOccurrences(this.state.dietEntries, this.tableSettings("health.diet")),
      nextOffset: status === "error" ? 0 : null,
      moreStatus: status === "loading" ? "loading" as const : status === "error" ? "error" as const : "idle" as const,
      moreError: this.state.dietError, generation: status === "loading" ? 0 : 1,
    }; }),
    ensureTable: vi.fn().mockResolvedValue(undefined),
    loadMore: vi.fn().mockResolvedValue(undefined),
    ensureReferenceData: vi.fn().mockResolvedValue(true),
    hasReferenceData: vi.fn(() => false),
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

function dietOccurrences(entries: readonly DietEntry[], settings: ReturnType<typeof defaultHealthTableSettings>) {
  return deriveDietGroups(entries, settings).flatMap((group) => group.rows.map((row) => ({
    key: `${group.key}:${row.id}`, scope: "health.diet" as const,
    groupKey: group.label === null ? null : group.key, groupLabel: group.label,
    record: { kind: "diet" as const, id: row.id, entry: row.entry, date: row.date,
      mealLabel: row.mealLabel, food: row.food, tags: row.tags,
      hasPhoto: row.hasPhoto, note: row.note },
  })));
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

describe("Health Diet paging", () => {
  afterEach(() => vi.restoreAllMocks());

  it("requests only the scoped first table page on mount", async () => {
    const legacy = vi.spyOn(healthApi, "listDiet");
    const health = controller();
    render(<DietPanel controller={health} />);
    await waitFor(() => expect(health.ensureTable).toHaveBeenCalledWith("health.diet"));
    expect(legacy).not.toHaveBeenCalled();
  });
});

describe("DietPanel table", () => {
  afterEach(() => vi.restoreAllMocks());

  const openRow = () => screen.getByRole("row", { name: /Open details for Bibimbap/ });
  const editDialog = () => screen.getByRole("dialog", { name: "Edit diet entry" });

  it("opens the add popup in edit mode, pre-filled, and leaves browser history alone", async () => {
    const user = userEvent.setup();
    window.history.replaceState({ preserved: "diet" }, "");
    const lengthBefore = window.history.length;
    render(<DietPanel controller={controller()} />);
    await user.click(openRow());

    const dialog = editDialog();
    expect(within(dialog).getByRole("heading", { name: "Edit diet entry" })).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Food")).toHaveValue("Bibimbap");
    expect(within(dialog).getByLabelText("Meal")).toHaveValue("lunch");
    expect(within(dialog).getByLabelText("Note")).toHaveValue("");
    expect(within(dialog).getByRole("button", { name: "Remove rice tag" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Close Edit diet entry" })).toBeInTheDocument();
    for (const name of ["Undo", "Redo", "Delete"]) {
      expect(within(dialog).queryByRole("button", { name })).toBeNull();
    }
    expect(window.history.length).toBe(lengthBefore);
    expect(window.history.state).toEqual({ preserved: "diet" });
  });

  it("closes a clean popup with Escape, Close or a backdrop click and restores row focus", async () => {
    const user = userEvent.setup();
    render(<DietPanel controller={controller()} />);
    await user.click(openRow());
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(openRow()).toHaveFocus());

    await user.click(openRow());
    await user.click(screen.getByRole("button", { name: "Close Edit diet entry" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(openRow()).toHaveFocus());

    await user.click(openRow());
    fireEvent.mouseDown(screen.getByRole("dialog").parentElement as HTMLElement);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("asks before Escape or Close discards a dirty popup", async () => {
    const user = userEvent.setup();
    render(<DietPanel controller={controller()} />);
    await user.click(openRow());
    await user.type(screen.getByLabelText("Note"), "changed");
    await user.keyboard("{Escape}");
    const confirm = screen.getByRole("dialog", { name: "Discard unsaved changes?" });
    await user.click(within(confirm).getByRole("button", { name: "Cancel" }));
    expect(screen.getByLabelText("Note")).toHaveValue("changed");
    await user.click(screen.getByRole("button", { name: "Close Edit diet entry" }));
    await user.click(within(screen.getByRole("dialog", { name: "Discard unsaved changes?" }))
      .getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(openRow()).toHaveFocus());
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
    let row = openRow();
    expect(row.tagName).toBe("TR");
    expect(row).toHaveRole("row");
    expect(row).toHaveAttribute("tabindex", "0");
    expect(row).toHaveAttribute("aria-description", "Press Enter or Space to open details.");
    expect(within(row).queryByRole("button")).toBeNull();
    expect(within(row).getByText("Lunch")).toBeInTheDocument();
    expect(within(row).getByText("rice")).toBeInTheDocument();
    expect(within(row).getByText("Photo")).toBeInTheDocument();
    expect(within(row).getByText("Good")).toBeInTheDocument();
    expect(screen.queryByText("Old meal")).toBeNull();

    const checkbox = screen.getByRole("checkbox", { name: /Select Bibimbap/ });
    await user.click(checkbox);
    expect(screen.queryByRole("dialog")).toBeNull();
    checkbox.focus();
    await user.keyboard("{Enter} ");
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(within(row).getByText("Lunch"));
    expect(editDialog()).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close Edit diet entry" }));
    row = openRow();
    row.focus();
    await user.keyboard("{Enter}");
    expect(editDialog()).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    row = openRow();
    row.focus();
    await user.keyboard(" ");
    expect(editDialog()).toBeInTheDocument();
  });

  it("opens a Diet row exactly once for each Space key spelling", () => {
    const groups = deriveDietGroups([entry], defaultHealthTableSettings("health.diet"));
    const open = vi.fn();
    render(<DietTable groups={groups} activeRowCount={1} selectedIds={[]}
      onOpen={open} onToggle={vi.fn()} onToggleAll={vi.fn()} />);
    const row = screen.getByRole("row", { name: /Open details for Bibimbap/ });

    for (const key of [" ", "Space"]) {
      fireEvent.keyDown(row, { key });
      expect(open).toHaveBeenCalledOnce();
      open.mockClear();
    }
  });

  it("keeps the Add layout order in edit mode", async () => {
    const user = userEvent.setup();
    render(<DietPanel controller={controller()} />);
    await user.click(openRow());
    const labels = [...editDialog().querySelectorAll("form .field-label")]
      .map((field) => field.firstChild?.textContent?.trim());
    expect(labels).toEqual(["Time", "Meal", "Food", "Tags", "Photo", "Note"]);
  });

  it("restores focus for an opaque occurrence key without parsing it as CSS", async () => {
    const user = userEvent.setup();
    const health = controller();
    const page = health.tablePage("health.diet");
    const occurrence = `tag:"quoted"]\\line\n${page.items[0]!.key}`;
    health.tablePage = vi.fn(() => ({ ...page, items: [{ ...page.items[0]!, key: occurrence }] }));
    render(<DietPanel controller={health} />);

    await user.click(openRow());
    await user.click(screen.getByRole("button", { name: "Close Edit diet entry" }));

    const restored = await screen.findByRole("row", { name: /Open details for Bibimbap/ });
    await waitFor(() => expect(restored).toHaveFocus());
    expect(restored).toHaveAttribute("data-diet-occurrence", occurrence);
  });

  it("opens the edit popup immediately and Add while compact tags are pending", async () => {
    const user = userEvent.setup();
    const health = controller();
    const references = deferred<boolean>();
    health.ensureQuickAddReferences = vi.fn(() => references.promise);
    render(<DietPanel controller={health} />);
    await user.click(openRow());
    expect(editDialog()).toBeInTheDocument();
    expect(health.ensureReferenceData).not.toHaveBeenCalled();
    await act(async () => references.resolve(true));
    await user.click(screen.getByRole("button", { name: "Close Edit diet entry" }));
    await screen.findByRole("button", { name: "Add diet entry" });
    await user.click(screen.getByRole("button", { name: "Add diet entry" }));
    expect(screen.getByRole("dialog", { name: "Add diet entry" })).toBeInTheDocument();
    expect(health.ensureReferenceData).not.toHaveBeenCalled();
  });

  it("preserves an open Diet draft while the table generation changes", async () => {
    const user = userEvent.setup();
    const health = controller();
    const page = health.tablePage("health.diet");
    let generation = page.generation;
    health.tablePage = vi.fn(() => ({ ...page, generation }));
    const view = render(<DietPanel controller={health} />);
    await user.click(screen.getByRole("button", { name: "Add diet entry" }));
    await user.type(screen.getByLabelText("Food"), "Keep draft");
    generation += 1;
    view.rerender(<DietPanel controller={health} />);
    expect(screen.getByRole("dialog", { name: "Add diet entry" })).toBeInTheDocument();
    expect(screen.getByLabelText("Food")).toHaveValue("Keep draft");
    expect(health.ensureReferenceData).not.toHaveBeenCalled();
  });

  it("keeps an open Diet dialog while a page appends", async () => {
    const user = userEvent.setup();
    const health = controller();
    const page = health.tablePage("health.diet");
    let appended = false;
    health.tablePage = vi.fn(() => ({ ...page,
      items: appended ? [...page.items] : page.items }));
    const pending = deferred<boolean>();
    health.ensureQuickAddReferences = vi.fn(() => pending.promise);
    const view = render(<DietPanel controller={health} />);

    await user.click(screen.getByRole("button", { name: "Add diet entry" }));
    appended = true;
    view.rerender(<DietPanel controller={health} />);
    await act(async () => pending.resolve(true));

    expect(screen.getByRole("dialog", { name: "Add diet entry" })).toBeInTheDocument();
  });

  it("saves only changed scalar and tag fields with the current row version", async () => {
    const user = userEvent.setup();
    const health = controller();
    render(<DietPanel controller={health} />);
    await user.click(openRow());
    await user.selectOptions(screen.getByLabelText("Meal"), "dinner");
    await user.click(screen.getByRole("button", { name: "Tags" }));
    await user.type(screen.getByRole("combobox", { name: "Tags" }), "Straße,wheat{Enter}");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(health.updateDiet).toHaveBeenCalledWith("diet-1", {
      mealType: "dinner",
      tags: ["rice", "Straße", "wheat"],
      expectedUpdatedAt: entry.updatedAt,
    }, undefined));
    expect(health.createDiet).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(openRow()).toHaveFocus());
  });

  it("freezes the opened version across a same-ID refresh", async () => {
    const user = userEvent.setup();
    const saved = deferred<void>();
    const health = controller();
    health.updateDiet = vi.fn(() => saved.promise);
    const view = render(<DietPanel controller={health} />);
    await user.click(openRow());
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
    const refreshedRow = await screen.findByRole("row", { name: /Open details for Server meal/ });
    await waitFor(() => expect(refreshedRow).toHaveFocus());
  });

  it("treats canonical-equal values as a no-op: Save closes without a request", async () => {
    const user = userEvent.setup();
    const tagged = { ...entry, tags: ["rice", "warm", "𐐨"] };
    const health = controller({ ...loadedState, dietEntries: [tagged] });
    render(<DietPanel controller={health} />);
    await user.click(openRow());
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
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(health.updateDiet).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("trims a changed Food before sending", async () => {
    const user = userEvent.setup();
    const health = controller();
    render(<DietPanel controller={health} />);
    await user.click(openRow());
    fireEvent.change(screen.getByLabelText("Food"), { target: { value: "  Kimchi  " } });
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(health.updateDiet).toHaveBeenCalledWith("diet-1", {
      foodName: "Kimchi",
      expectedUpdatedAt: entry.updatedAt,
    }, undefined));
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
    await user.click(openRow());
    await user.click(screen.getByRole("button", { name: `Remove ${original} tag` }));
    await user.click(screen.getByRole("button", { name: "Tags" }));
    await user.type(screen.getByRole("combobox", { name: "Tags" }), `${changed}{Enter}`);
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(health.updateDiet).toHaveBeenCalledWith("diet-1", {
      tags: [changed],
      expectedUpdatedAt: entry.updatedAt,
    }, undefined));
  });

  it("sends an exact RFC3339 instant across the UTC+09:00 date boundary", async () => {
    const user = userEvent.setup();
    const health = controller();
    render(<DietPanel controller={health} />);
    await user.click(openRow());
    fireEvent.change(screen.getByLabelText("Time"), { target: { value: "2026-08-19T00:15:00" } });
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(health.updateDiet).toHaveBeenCalledWith("diet-1", {
      occurredAt: "2026-08-18T15:15:00.000Z",
      expectedUpdatedAt: entry.updatedAt,
    }, undefined));
  });

  it("does not save a cleared Time and keeps the draft", async () => {
    const user = userEvent.setup();
    const health = controller();
    render(<DietPanel controller={health} />);
    await user.click(openRow());
    fireEvent.change(screen.getByLabelText("Time"), { target: { value: "" } });
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(health.updateDiet).not.toHaveBeenCalled();
    expect(editDialog()).toBeInTheDocument();
    expect(screen.getByLabelText("Time")).toHaveValue("");
  });

  it("keeps the draft and dialog after save failure", async () => {
    const user = userEvent.setup();
    const health = controller();
    health.updateDiet = vi.fn().mockRejectedValue(new Error("Save failed"));
    render(<DietPanel controller={health} />);
    await user.click(openRow());
    await user.type(screen.getByLabelText("Note"), "first");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Save failed");
    expect(screen.getByLabelText("Note")).toHaveValue("first");
    expect(editDialog()).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("rejects non-images, then removes or replaces the current photo", async () => {
    const user = userEvent.setup({ applyAccept: false });
    const withPhoto = { ...entry, mediaId: "media-1" };
    const health = controller({ ...loadedState, dietEntries: [withPhoto] });
    render(<DietPanel controller={health} />);
    await user.click(openRow());
    expect(screen.getByAltText("Saved meal")).toBeInTheDocument();
    expect(screen.getByText("Current photo")).toBeInTheDocument();
    const invalid = new File(["text"], "notes.txt", { type: "text/plain" });
    await user.upload(screen.getByLabelText("Photo"), invalid);
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Meal image must be an image file");
    expect(health.updateDiet).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Remove selected photo" }));
    expect(screen.getByText("Current photo")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Remove photo" }));
    expect(screen.getByText("Photo will be removed")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Keep photo" }));
    await user.click(screen.getByRole("button", { name: "Remove photo" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(health.updateDiet).toHaveBeenLastCalledWith("diet-1", {
      expectedUpdatedAt: entry.updatedAt,
      removeImage: true,
    }, undefined));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await user.click(openRow());
    const image = new File(["photo"], "meal.png", { type: "image/png" });
    await user.upload(screen.getByLabelText("Photo"), image);
    expect(screen.getByText("meal.png")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(health.updateDiet).toHaveBeenLastCalledWith("diet-1", {
      expectedUpdatedAt: entry.updatedAt,
    }, image));
  });

  it("shows recovery Retry when an update committed before refresh failed, without resubmitting", async () => {
    const user = userEvent.setup();
    const health = controller();
    health.updateDiet = vi.fn().mockRejectedValue(new HealthMutationRefreshError());
    health.refresh = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    render(<DietPanel controller={health} />);
    await user.click(openRow());
    await user.type(screen.getByLabelText("Note"), "saved");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Changes were saved, but Health could not refresh.",
    );
    expect(screen.getByLabelText("Food")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Retry refresh" }));
    expect(health.refresh).toHaveBeenCalledOnce();
    expect(health.updateDiet).toHaveBeenCalledOnce();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Changes were saved, but Health could not refresh.",
    );
    expect(screen.getByLabelText("Note")).toHaveValue("saved");
    await user.click(screen.getByRole("button", { name: "Retry refresh" }));
    expect(health.refresh).toHaveBeenCalledTimes(2);
    expect(health.updateDiet).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(openRow()).toHaveFocus());
  });

  it("locks the popup while saving and ignores a duplicate Save", async () => {
    const user = userEvent.setup();
    const saved = deferred<void>();
    const health = controller();
    health.updateDiet = vi.fn(() => saved.promise);
    render(<DietPanel controller={health} />);
    await user.click(openRow());
    await user.type(screen.getByLabelText("Note"), "x");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(health.updateDiet).toHaveBeenCalledOnce());
    expect(screen.getByLabelText("Food")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Close Edit diet entry" })).toBeDisabled();
    fireEvent.submit(screen.getByRole("form", { name: "Diet entry" }));
    await user.keyboard("{Escape}");
    expect(health.updateDiet).toHaveBeenCalledOnce();
    expect(editDialog()).toBeInTheDocument();
    await act(async () => saved.resolve());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("closes the edit popup without archive controls and leaves archiving to the table", async () => {
    const user = userEvent.setup();
    render(<DietPanel controller={controller()} />);
    await user.click(openRow());
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    expect(screen.queryByText(/Created /)).toBeNull();
    expect(screen.queryByText(/Updated /)).toBeNull();
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

    const occurrences = screen.getAllByRole("row", { name: /Open details for Bibimbap/ });
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

    const second = screen.getAllByRole("row", { name: /Open details for Bibimbap/ })[1]!;
    second.focus();
    await user.keyboard("{Enter}");
    await user.click(screen.getByRole("button", { name: "Close Edit diet entry" }));
    const restored = screen.getAllByRole("row", { name: /Open details for Bibimbap/ })[1]!;
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

  it("offers compact Diet tag lookups before rich reference data is loaded", async () => {
    const user = userEvent.setup();
    const filtered = defaultHealthTableSettings("health.diet");
    filtered.filterRules = [{ id: "tag", field: "tags", type: "multiSelect",
      operator: "is", value: [] }];
    const health = controller({ ...loadedState, dietEntries: [], tableLookups: {
      "health.diet": { tags: [{ id: "lookup-tag", label: "Lookup tag" }] },
      "health.bowel": {}, "health.medication": {}, "health.metrics": {},
    } }, filtered);

    render(<DietPanel controller={health} />);
    await user.click(screen.getByRole("button", { name: "Filter Diet" }));
    const filter = screen.getByRole("dialog", { name: "Filter Diet" });
    await user.click(within(filter).getByRole("button", { name: "Select Tags filter values" }));
    expect(within(filter).getByText("Lookup tag")).toBeInTheDocument();
    expect(health.ensureReferenceData).not.toHaveBeenCalled();
  });

  it("shows initial loading/error and retains rows for a refresh error", async () => {
    const retry = vi.fn();
    const view = render(<DietPanel controller={{
      ...controller({ ...loadedState, dietStatus: "loading", dietEntries: [] }),
      loadMore: retry,
    }} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading diet entries");
    view.rerender(<DietPanel controller={{
      ...controller({ ...loadedState, dietStatus: "error", dietEntries: [], dietError: "Diet unavailable" }),
      loadMore: retry,
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
