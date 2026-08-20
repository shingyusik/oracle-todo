import "@testing-library/jest-dom/vitest";

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import { renderToString } from "react-dom/server";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type {
  HealthController,
  HealthState,
} from "@/features/health/hooks/useHealthController";
import { HealthMutationRefreshError } from "@/features/health/hooks/useHealthController";
import { defaultHealthTableSettings } from "@/features/health/model/health-table-views";
import { BowelCreateDialog } from "@/features/health/ui/BowelCreateDialog";
import { BowelPanel } from "@/features/health/ui/BowelPanel";
import { DietPanel } from "@/features/health/ui/DietPanel";
import { DietCreateDialog } from "@/features/health/ui/DietCreateDialog";
import { HealthMetricsPanel } from "@/features/health/ui/HealthMetricsPanel";
import { MedicationPanel } from "@/features/health/ui/MedicationPanel";
import { MedicationCreateDialog } from "@/features/health/ui/MedicationCreateDialog";
import { TagsInput } from "@/features/workbench/ui/TagsInput";

const loadedState: HealthState = {
  medicationStatus: "loaded",
  medicationError: null,
  medicationEntries: [],
  bowelStatus: "loaded",
  bowelError: null,
  bowelEntries: [],
  dietStatus: "loaded",
  dietError: null,
  dietEntries: [],
  timelineStatus: "loaded",
  timelineError: null,
  timeline: [],
  timelineHasMore: false,
  trendsStatus: "idle",
  trendsError: null,
  trends: null,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function controller(
  overrides: Partial<HealthController> = {},
): HealthController {
  const settings = defaultHealthTableSettings("health.diet");
  return {
    state: loadedState,
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
    refreshMedication: vi.fn(),
    refreshBowel: vi.fn(),
    refreshDiet: vi.fn(),
    refreshTimeline: vi.fn(),
    loadMoreTimeline: vi.fn(),
    refreshTrends: vi.fn(),
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
    archive: vi.fn(),
    restore: vi.fn(),
    purge: vi.fn(),
    ...overrides,
  };
}

function DietDialogHarness({
  health,
  onClose = vi.fn(),
}: {
  health: HealthController;
  onClose?: () => void;
}) {
  const [open, setOpen] = React.useState(true);
  const returnFocusRef = React.useRef<HTMLButtonElement>(null);
  return <>
    <main data-testid="diet-dialog-background">
      <button ref={returnFocusRef}>Open diet</button>
    </main>
    {open ? <DietCreateDialog
      controller={health}
      onClose={() => {
        onClose();
        setOpen(false);
      }}
      returnFocusRef={returnFocusRef}
      tagOptions={[]}
    /> : null}
  </>;
}

function BowelDialogHarness({
  health,
  onClose = vi.fn(),
}: {
  health: HealthController;
  onClose?: () => void;
}) {
  const [open, setOpen] = React.useState(true);
  const returnFocusRef = React.useRef<HTMLButtonElement>(null);
  return <>
    <main data-testid="bowel-dialog-background">
      <button ref={returnFocusRef}>Open bowel</button>
    </main>
    {open ? <BowelCreateDialog
      controller={health}
      onClose={() => {
        onClose();
        setOpen(false);
      }}
      returnFocusRef={returnFocusRef}
    /> : null}
  </>;
}

function MedicationDialogHarness({
  health,
  onClose = vi.fn(),
}: {
  health: HealthController;
  onClose?: () => void;
}) {
  const [open, setOpen] = React.useState(true);
  const returnFocusRef = React.useRef<HTMLButtonElement>(null);
  return <>
    <main data-testid="medication-dialog-background">
      <button ref={returnFocusRef}>Add medication entry</button>
    </main>
    {open ? <MedicationCreateDialog
      controller={health}
      onClose={() => {
        onClose();
        setOpen(false);
      }}
      returnFocusRef={returnFocusRef}
    /> : null}
  </>;
}

function MedicationDialogLifecycleHarness({
  health,
  open,
}: {
  health: HealthController;
  open: boolean;
}) {
  const returnFocusRef = React.useRef<HTMLButtonElement>(null);
  return <main>
    <button ref={returnFocusRef}>Add medication lifecycle</button>
    {open ? <MedicationCreateDialog
      controller={health}
      onClose={vi.fn()}
      returnFocusRef={returnFocusRef}
    /> : null}
  </main>;
}

function BowelPanelHarness({ health }: { health: HealthController }) {
  const [tombstonedIds, setTombstonedIds] = React.useState<Set<string>>(() => new Set());
  const [refreshWarning, setRefreshWarning] = React.useState<string | null>(null);
  return <BowelPanel controller={health} tombstonedIds={tombstonedIds}
    onArchiveCommitted={(id, warning) => {
      setTombstonedIds((current) => new Set(current).add(id));
      if (warning) setRefreshWarning(warning);
    }}
    refreshWarning={refreshWarning} refreshPending={false}
    onRetryRefresh={async () => { await health.refreshBowel(); }} />;
}

describe("Health Journal forms", () => {
  it("gives each tag popup a distinct valid listbox relationship", async () => {
    const user = userEvent.setup();
    render(<>
      <TagsInput label="First tags" value={[]} tagOptions={["one"]} onCommit={vi.fn()} />
      <TagsInput label="Second tags" value={[]} tagOptions={["two"]} onCommit={vi.fn()} />
    </>);
    const first = screen.getByRole("button", { name: "First tags" });
    const second = screen.getByRole("button", { name: "Second tags" });

    await user.click(first);
    const firstSearch = screen.getByRole("combobox", { name: "First tags" });
    const firstListbox = screen.getByRole("listbox", { name: "First tags options" });
    expect(first).toHaveAttribute("aria-haspopup", "listbox");
    expect(first).toHaveAttribute("aria-controls", firstListbox.id);
    expect(firstSearch).toHaveAttribute("aria-controls", firstListbox.id);
    expect(firstSearch).toHaveAttribute("aria-expanded", "true");

    await user.keyboard("{Escape}");
    expect(first).toHaveFocus();
    expect(screen.queryByRole("listbox", { name: "First tags options" })).toBeNull();

    await user.click(second);
    const secondSearch = screen.getByRole("combobox", { name: "Second tags" });
    const secondListbox = screen.getByRole("listbox", { name: "Second tags options" });
    expect(second).toHaveAttribute("aria-controls", secondListbox.id);
    expect(secondSearch).toHaveAttribute("aria-controls", secondListbox.id);
    expect(secondListbox.id).not.toBe(firstListbox.id);
  });

  it("keeps tag controls as siblings inside the noninteractive input layout", () => {
    render(<TagsInput label="Tags" value={["rice"]} tagOptions={[]} onCommit={vi.fn()} />);

    const trigger = screen.getByRole("button", { name: "Tags" });
    const remove = screen.getByRole("button", { name: "Remove rice tag" });
    const inputLayout = trigger.closest(".tag-input");
    expect(trigger.tagName).toBe("BUTTON");
    expect(inputLayout).not.toBeNull();
    expect(inputLayout).not.toHaveAttribute("role");
    expect(remove.closest(".tag-input")).toBe(inputLayout);
    expect(remove.closest('[role="button"]')).toBeNull();
    expect(trigger.contains(remove)).toBe(false);
    expect(remove.contains(trigger)).toBe(false);
  });

  it("submits structured Bowel fields with a Bristol value from 1 to 7", async () => {
    const user = userEvent.setup();
    const health = controller();
    render(<BowelPanelHarness health={health} />);

    await user.click(screen.getByRole("button", { name: "Add bowel entry" }));
    expect(screen.getByRole("option", { name: "Type 1" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Type 7" })).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Bristol Scale"), "4");
    await user.click(screen.getByLabelText("Blood Visible"));
    await user.type(screen.getByLabelText("Note"), "After breakfast");
    await user.click(screen.getByRole("button", { name: "Save bowel entry" }));

    expect(health.createBowel).toHaveBeenCalledWith(expect.objectContaining({
      details: { kind: "bowel", bristolScale: 4, bloodVisible: true },
      note: "After breakfast",
    }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Add bowel entry" })).toBeNull());
    await user.click(screen.getByRole("button", { name: "Add bowel entry" }));
    expect(screen.getByLabelText("Bristol Scale")).toHaveValue("4");
    expect(screen.getByLabelText("Blood Visible")).not.toBeChecked();
    expect(screen.getByLabelText("Note")).toHaveValue("");
  });

  it("freezes a committed Bowel draft and retries only its refresh", async () => {
    const health = controller({
      createBowel: vi.fn().mockRejectedValue(new HealthMutationRefreshError()),
      refreshBowel: vi.fn().mockResolvedValue(false),
    });
    render(<BowelPanelHarness health={health} />);

    await userEvent.click(screen.getByRole("button", { name: "Add bowel entry" }));

    fireEvent.change(screen.getByLabelText("Time"), {
      target: { value: "2026-08-17T08:30" },
    });
    fireEvent.change(screen.getByLabelText("Bristol Scale"), { target: { value: "6" } });
    fireEvent.click(screen.getByLabelText("Blood Visible"));
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "Keep this" } });
    fireEvent.submit(screen.getByRole("form", { name: "Bowel entry" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Changes were saved, but Health could not refresh.",
    );
    expect(screen.getByLabelText("Time")).toBeDisabled();
    expect(screen.getByLabelText("Bristol Scale")).toHaveValue("6");
    expect(screen.getByLabelText("Blood Visible")).toBeChecked();
    expect(screen.getByLabelText("Note")).toHaveValue("Keep this");
    await userEvent.click(screen.getByRole("button", { name: "Retry refresh" }));
    expect(health.refreshBowel).toHaveBeenCalledOnce();
    expect(health.createBowel).toHaveBeenCalledOnce();
  });

  it("renders the Bowel dialog fields in order with native defaults", () => {
    render(<BowelDialogHarness health={controller()} />);
    const form = screen.getByRole("form", { name: "Bowel entry" });
    const controls = [
      within(form).getByLabelText("Time"),
      within(form).getByLabelText("Bristol Scale"),
      within(form).getByLabelText("Blood Visible"),
      within(form).getByLabelText("Note"),
    ];

    expect(controls[0]).toHaveAttribute("type", "datetime-local");
    expect(controls[0]).toBeRequired();
    expect(controls[1].tagName).toBe("SELECT");
    expect(controls[1]).toBeRequired();
    expect(controls[1]).toHaveValue("4");
    expect(within(controls[1]).getAllByRole("option").map((option) => option.textContent))
      .toEqual(["Type 1", "Type 2", "Type 3", "Type 4", "Type 5", "Type 6", "Type 7"]);
    expect(controls[2]).toHaveAttribute("type", "checkbox");
    expect(controls[2]).not.toBeChecked();
    for (let index = 1; index < controls.length; index += 1) {
      expect(controls[index - 1].compareDocumentPosition(controls[index]) & Node.DOCUMENT_POSITION_FOLLOWING)
        .toBeTruthy();
    }
  });

  it("submits one portable RFC3339 Bowel mutation and trims a blank note", async () => {
    const previousTimezone = process.env.TZ;
    process.env.TZ = "Asia/Seoul";
    try {
      const health = controller();
      render(<BowelDialogHarness health={health} />);
      fireEvent.change(screen.getByLabelText("Time"), {
        target: { value: "2026-07-30T09:00" },
      });
      fireEvent.change(screen.getByLabelText("Bristol Scale"), { target: { value: "7" } });
      fireEvent.click(screen.getByLabelText("Blood Visible"));
      fireEvent.change(screen.getByLabelText("Note"), { target: { value: "   " } });
      fireEvent.submit(screen.getByRole("form", { name: "Bowel entry" }));

      await waitFor(() => expect(health.createBowel).toHaveBeenCalledOnce());
      expect(health.createBowel).toHaveBeenCalledWith({
        occurredAt: "2026-07-30T00:00:00.000Z",
        details: { kind: "bowel", bristolScale: 7, bloodVisible: true },
        note: null,
      });
    } finally {
      if (previousTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = previousTimezone;
    }
  });

  it("preserves every Bowel field and exposes a safe error after save failure", async () => {
    const health = controller({
      createBowel: vi.fn().mockRejectedValue(new Error("Bowel save failed")),
    });
    render(<BowelDialogHarness health={health} />);
    fireEvent.change(screen.getByLabelText("Time"), {
      target: { value: "2026-08-17T08:30" },
    });
    fireEvent.change(screen.getByLabelText("Bristol Scale"), { target: { value: "6" } });
    fireEvent.click(screen.getByLabelText("Blood Visible"));
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "Keep this" } });
    fireEvent.submit(screen.getByRole("form", { name: "Bowel entry" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Bowel save failed");
    expect(screen.getByLabelText("Time")).toHaveValue("2026-08-17T08:30");
    expect(screen.getByLabelText("Bristol Scale")).toHaveValue("6");
    expect(screen.getByLabelText("Blood Visible")).toBeChecked();
    expect(screen.getByLabelText("Note")).toHaveValue("Keep this");
  });

  it("rejects a nonexistent Bowel wall time without losing the draft", async () => {
    const previousTimezone = process.env.TZ;
    process.env.TZ = "America/New_York";
    try {
      const health = controller();
      render(<BowelDialogHarness health={health} />);
      fireEvent.change(screen.getByLabelText("Time"), {
        target: { value: "2026-03-08T02:30" },
      });
      fireEvent.change(screen.getByLabelText("Bristol Scale"), { target: { value: "2" } });
      fireEvent.click(screen.getByLabelText("Blood Visible"));
      fireEvent.change(screen.getByLabelText("Note"), { target: { value: "Early" } });
      fireEvent.submit(screen.getByRole("form", { name: "Bowel entry" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Time must be a valid local date and time",
      );
      expect(health.createBowel).not.toHaveBeenCalled();
      expect(screen.getByLabelText("Time")).toHaveValue("2026-03-08T02:30");
      expect(screen.getByLabelText("Bristol Scale")).toHaveValue("2");
      expect(screen.getByLabelText("Blood Visible")).toBeChecked();
      expect(screen.getByLabelText("Note")).toHaveValue("Early");
    } finally {
      if (previousTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = previousTimezone;
    }
  });

  it("portals and isolates the Bowel dialog, then restores the page on close", async () => {
    const view = render(<BowelDialogHarness health={controller()} />);
    const dialog = screen.getByRole("dialog", { name: "Add bowel entry" });
    const host = dialog.closest<HTMLElement>("[data-raven-modal-host]");

    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(host?.parentElement).toBe(document.body);
    expect(view.container).toHaveAttribute("aria-hidden", "true");
    expect(view.container).toHaveAttribute("inert");
    expect(document.body.style.overflow).toBe("hidden");
    await userEvent.click(screen.getByRole("button", { name: "Close Add bowel entry" }));
    expect(document.querySelector("[data-raven-modal-host]")).toBeNull();
    expect(view.container).not.toHaveAttribute("aria-hidden");
    expect(view.container).not.toHaveAttribute("inert");
    expect(document.body.style.overflow).toBe("");
    expect(screen.getByRole("button", { name: "Open bowel" })).toHaveFocus();
  });

  it("wraps Bowel dialog focus and supports each idle dismissal", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<BowelDialogHarness health={controller()} onClose={onClose} />);
    const close = screen.getByRole("button", { name: "Close Add bowel entry" });
    const retrylessSave = screen.getByRole("button", { name: "Save bowel entry" });
    expect(close).toHaveFocus();
    close.focus();
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(retrylessSave).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();

    render(<BowelDialogHarness health={controller()} onClose={onClose} />);
    fireEvent.mouseDown(screen.getByRole("dialog", { name: "Add bowel entry" }).parentElement!);
    expect(onClose).toHaveBeenCalledTimes(2);

    render(<BowelDialogHarness health={controller()} onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "Close Add bowel entry" }));
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("locks Bowel dismissal and duplicate submits for the full mutation promise", async () => {
    const user = userEvent.setup();
    const save = deferred<void>();
    const onClose = vi.fn();
    const health = controller({ createBowel: vi.fn(() => save.promise) });
    render(<BowelDialogHarness health={health} onClose={onClose} />);
    fireEvent.submit(screen.getByRole("form", { name: "Bowel entry" }));

    await waitFor(() => expect(health.createBowel).toHaveBeenCalledOnce());
    const dialog = screen.getByRole("dialog", { name: "Add bowel entry" });
    const saveButton = screen.getByRole("button", { name: "Save bowel entry" });
    expect(dialog).toHaveAttribute("aria-busy", "true");
    expect(screen.getByLabelText("Time")).toBeDisabled();
    expect(saveButton).toBeDisabled();
    expect(screen.getByRole("button", { name: "Close Add bowel entry" })).toBeDisabled();
    fireEvent.submit(screen.getByRole("form", { name: "Bowel entry" }));
    await user.click(saveButton);
    fireEvent.keyDown(dialog, { key: "Escape" });
    fireEvent.mouseDown(dialog.parentElement!);
    fireEvent.click(screen.getByRole("button", { name: "Close Add bowel entry" }));
    expect(health.createBowel).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();

    save.resolve();
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it("closes and restores Bowel focus after a successful StrictMode save", async () => {
    const onClose = vi.fn();
    const health = controller();
    render(
      <React.StrictMode>
        <BowelDialogHarness health={health} onClose={onClose} />
      </React.StrictMode>,
    );

    fireEvent.submit(screen.getByRole("form", { name: "Bowel entry" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(screen.queryByRole("dialog", { name: "Add bowel entry" })).toBeNull();
    expect(screen.getByRole("button", { name: "Open bowel" })).toHaveFocus();
  });

  it("clears Bowel pending and retains the draft after a StrictMode failure", async () => {
    const health = controller({
      createBowel: vi.fn().mockRejectedValue(new Error("Bowel save failed")),
    });
    render(
      <React.StrictMode>
        <BowelDialogHarness health={health} />
      </React.StrictMode>,
    );
    fireEvent.change(screen.getByLabelText("Time"), {
      target: { value: "2026-08-17T08:30" },
    });
    fireEvent.change(screen.getByLabelText("Bristol Scale"), { target: { value: "6" } });
    fireEvent.click(screen.getByLabelText("Blood Visible"));
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "Keep this" } });
    fireEvent.submit(screen.getByRole("form", { name: "Bowel entry" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Bowel save failed");
    expect(screen.getByRole("dialog", { name: "Add bowel entry" }))
      .toHaveAttribute("aria-busy", "false");
    expect(screen.getByRole("button", { name: "Save bowel entry" })).toBeEnabled();
    expect(screen.getByLabelText("Time")).toHaveValue("2026-08-17T08:30");
    expect(screen.getByLabelText("Bristol Scale")).toHaveValue("6");
    expect(screen.getByLabelText("Blood Visible")).toBeChecked();
    expect(screen.getByLabelText("Note")).toHaveValue("Keep this");
  });

  it("keeps Bowel focus inside the dialog when pending leaves no enabled controls", async () => {
    const save = deferred<void>();
    const health = controller({ createBowel: vi.fn(() => save.promise) });
    render(<BowelDialogHarness health={health} />);
    fireEvent.submit(screen.getByRole("form", { name: "Bowel entry" }));

    const dialog = screen.getByRole("dialog", { name: "Add bowel entry" });
    await waitFor(() => expect(dialog).toHaveFocus());
    expect(dialog).toHaveAttribute("tabindex", "-1");

    const background = screen.getByRole("button", { name: "Open bowel", hidden: true });
    background.focus();
    const forward = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    dialog.dispatchEvent(forward);
    expect(forward.defaultPrevented).toBe(true);
    expect(dialog).toHaveFocus();

    background.focus();
    const reverse = new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    dialog.dispatchEvent(reverse);
    expect(reverse.defaultPrevented).toBe(true);
    expect(dialog).toHaveFocus();
  });

  it("freezes committed Bowel fields and retries false then true without remutation", async () => {
    const firstRefresh = deferred<boolean>();
    const onClose = vi.fn();
    const health = controller({
      createBowel: vi.fn().mockRejectedValue(new HealthMutationRefreshError()),
      refreshBowel: vi.fn()
        .mockImplementationOnce(() => firstRefresh.promise)
        .mockResolvedValueOnce(true),
    });
    render(<BowelDialogHarness health={health} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText("Time"), {
      target: { value: "2026-08-17T08:30" },
    });
    fireEvent.change(screen.getByLabelText("Bristol Scale"), { target: { value: "6" } });
    fireEvent.click(screen.getByLabelText("Blood Visible"));
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "Keep this" } });
    fireEvent.submit(screen.getByRole("form", { name: "Bowel entry" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Changes were saved, but Health could not refresh.",
    );
    for (const label of ["Time", "Bristol Scale", "Blood Visible", "Note"]) {
      expect(screen.getByLabelText(label)).toBeDisabled();
    }
    expect(screen.getByRole("button", { name: "Save bowel entry" })).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Note"), "Changed");
    fireEvent.submit(screen.getByRole("form", { name: "Bowel entry" }));
    expect(screen.getByLabelText("Note")).toHaveValue("Keep this");

    const retry = screen.getByRole("button", { name: "Retry refresh" });
    fireEvent.click(retry);
    expect(retry).toBeDisabled();
    firstRefresh.resolve(false);
    await waitFor(() => expect(health.refreshBowel).toHaveBeenCalledOnce());
    await waitFor(() => expect(retry).toBeEnabled());
    expect(screen.getByRole("dialog", { name: "Add bowel entry" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Retry refresh" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(health.refreshBowel).toHaveBeenCalledTimes(2);
    expect(health.createBowel).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Open bowel" })).toHaveFocus();
  });

  it("submits meal type, unique tags, and an image through the image path", async () => {
    const user = userEvent.setup();
    const health = controller();
    const image = new File(["photo"], "meal.png", { type: "image/png" });
    render(<DietPanel controller={health} />);
    await user.click(screen.getByRole("button", { name: "Add diet entry" }));

    await user.selectOptions(screen.getByLabelText("Meal"), "lunch");
    await user.type(screen.getByLabelText("Food"), "Bibimbap");
    await user.click(screen.getByRole("button", { name: "Tags" }));
    await user.type(screen.getByRole("combobox", { name: "Tags" }), "rice, spicy, rice{Enter}");
    await user.upload(screen.getByLabelText("Photo"), image);
    await user.click(screen.getByRole("button", { name: "Save diet entry" }));

    expect(health.createDiet).toHaveBeenCalledWith(
      expect.objectContaining({
        mealType: "lunch",
        foodName: "Bibimbap",
        tags: ["rice", "spicy"],
      }),
      image,
    );
    await user.click(screen.getByRole("button", { name: "Add diet entry" }));
    expect(screen.getByLabelText("Photo")).toHaveProperty("files.length", 0);
  });

  it("offers only existing Diet tags and supports selecting, creating, and removing tags", async () => {
    const user = userEvent.setup();
    const health = controller({
      state: {
        ...loadedState,
        dietEntries: [{
          id: "diet-1",
          occurredAt: "2026-08-18T03:00:00Z",
          mealType: "lunch",
          foodName: "Bibimbap",
          note: null,
          tags: ["rice", "spicy"],
          mediaId: null,
          createdAt: "2026-08-18T03:00:00Z",
          updatedAt: "2026-08-18T03:00:00Z",
          deletedAt: null,
        }],
      },
    });
    render(<DietPanel controller={health} />);
    await user.click(screen.getByRole("button", { name: "Add diet entry" }));

    await user.click(screen.getByRole("button", { name: "Tags" }));
    expect(screen.getByRole("option", { name: "rice" })).toBeVisible();
    expect(screen.getByRole("option", { name: "spicy" })).toBeVisible();
    expect(screen.queryByRole("option", { name: "todo-only" })).toBeNull();
    await user.click(screen.getByRole("option", { name: "rice" }));
    await user.type(screen.getByRole("combobox", { name: "Tags" }), " fresh, rice, vegan {Enter}");
    await user.click(screen.getByRole("button", { name: "Remove rice tag" }));
    await user.type(screen.getByLabelText("Food"), "Lunch");
    await user.click(screen.getByRole("button", { name: "Save diet entry" }));

    expect(health.createDiet).toHaveBeenCalledWith(
      expect.objectContaining({ tags: ["fresh", "vegan"] }),
      undefined,
    );
  });

  it("renders Diet controls in the requested order", () => {
    render(<DietPanel controller={controller()} />);
    fireEvent.click(screen.getByRole("button", { name: "Add diet entry" }));
    const form = screen.getByRole("form", { name: "Diet entry" });
    const controls = [
      within(form).getByLabelText("Time"),
      within(form).getByLabelText("Meal"),
      within(form).getByLabelText("Food"),
      within(form).getByRole("button", { name: "Tags" }),
      within(form).getByLabelText("Photo"),
      within(form).getByLabelText("Note"),
    ];
    for (let index = 1; index < controls.length; index += 1) {
      expect(controls[index - 1].compareDocumentPosition(controls[index]) & Node.DOCUMENT_POSITION_FOLLOWING)
        .toBeTruthy();
    }
  });

  it("keeps the Diet dialog open and preserves all inputs after validation or save failure", async () => {
    const user = userEvent.setup({ applyAccept: false });
    const health = controller({
      createDiet: vi.fn().mockRejectedValue(new Error("Diet save failed")),
    });
    const returnFocusRef = React.createRef<HTMLButtonElement>();
    render(<>
      <button ref={returnFocusRef}>Open diet</button>
      <DietCreateDialog
        controller={health}
        onClose={vi.fn()}
        returnFocusRef={returnFocusRef}
        tagOptions={["rice"]}
      />
    </>);

    fireEvent.change(screen.getByLabelText("Time"), {
      target: { value: "2026-08-17T08:30" },
    });
    await user.selectOptions(screen.getByLabelText("Meal"), "lunch");
    await user.type(screen.getByLabelText("Food"), "Bibimbap");
    await user.click(screen.getByRole("button", { name: "Tags" }));
    await user.click(screen.getByRole("option", { name: "rice" }));
    await user.type(screen.getByLabelText("Note"), "Keep this");
    const invalid = new File(["text"], "notes.txt", { type: "text/plain" });
    await user.upload(screen.getByLabelText("Photo"), invalid);
    await user.click(screen.getByRole("button", { name: "Save diet entry" }));

    expect(screen.getByRole("dialog", { name: "Add diet entry" })).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("Meal image must be an image file");
    expect(health.createDiet).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Food")).toHaveValue("Bibimbap");
    expect(screen.getByLabelText("Note")).toHaveValue("Keep this");
    expect(screen.getByLabelText("Photo")).toHaveProperty("files.length", 1);

    const image = new File(["photo"], "meal.png", { type: "image/png" });
    await user.upload(screen.getByLabelText("Photo"), image);
    await user.click(screen.getByRole("button", { name: "Save diet entry" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Diet save failed");
    expect(screen.getByLabelText("Time")).toHaveValue("2026-08-17T08:30");
    expect(screen.getByLabelText("Meal")).toHaveValue("lunch");
    expect(screen.getByLabelText("Food")).toHaveValue("Bibimbap");
    expect(screen.getByRole("button", { name: "Remove rice tag" })).toBeVisible();
    expect(screen.getByLabelText("Photo")).toHaveProperty("files.length", 1);
    expect(screen.getByLabelText("Note")).toHaveValue("Keep this");
  });

  it("portals the Diet dialog under body and isolates outside content", () => {
    const view = render(<DietDialogHarness health={controller()} />);
    const dialog = screen.getByRole("dialog", { name: "Add diet entry" });
    const host = dialog.closest<HTMLElement>("[data-raven-modal-host]");

    expect(host?.parentElement).toBe(document.body);
    expect(view.container).toHaveAttribute("aria-hidden", "true");
    expect(view.container).toHaveAttribute("inert");
    expect(document.body.style.overflow).toBe("hidden");
    let ancestor = dialog.parentElement;
    while (ancestor) {
      expect(ancestor).not.toHaveAttribute("aria-hidden", "true");
      expect(ancestor).not.toHaveAttribute("inert");
      ancestor = ancestor.parentElement;
    }
  });

  it("wraps Tab in both directions and closes from idle Escape or backdrop", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const first = render(<DietDialogHarness health={controller()} onClose={onClose} />);
    const close = screen.getByRole("button", { name: "Close Add diet entry" });
    const save = screen.getByRole("button", { name: "Save diet entry" });

    close.focus();
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(save).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Add diet entry" })).toBeNull();
    expect(onClose).toHaveBeenCalledOnce();
    first.unmount();

    render(<DietDialogHarness health={controller()} onClose={onClose} />);
    const backdrop = screen.getByRole("dialog", { name: "Add diet entry" }).parentElement;
    expect(backdrop).not.toBeNull();
    fireEvent.mouseDown(backdrop!);
    expect(screen.queryByRole("dialog", { name: "Add diet entry" })).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("uses the first Escape to close Diet tags and the second to close the dialog", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<DietDialogHarness health={controller()} onClose={onClose} />);
    const trigger = screen.getByRole("button", { name: "Tags" });

    await user.click(trigger);
    expect(screen.getByRole("combobox", { name: "Tags" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "Add diet entry" })).toBeVisible();
    expect(trigger).toHaveFocus();
    expect(onClose).not.toHaveBeenCalled();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Add diet entry" })).toBeNull();
    expect(screen.getByRole("button", { name: "Open diet" })).toHaveFocus();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("blocks Diet dialog dismissal and duplicate submission until save resolves", async () => {
    const user = userEvent.setup();
    const save = deferred<void>();
    const onClose = vi.fn();
    const health = controller({ createDiet: vi.fn(() => save.promise) });
    function Harness() {
      const [open, setOpen] = React.useState(true);
      const returnFocusRef = React.useRef<HTMLButtonElement>(null);
      return <>
        <button ref={returnFocusRef}>Open diet</button>
        {open ? <DietCreateDialog
          controller={health}
          onClose={() => {
            onClose();
            setOpen(false);
          }}
          returnFocusRef={returnFocusRef}
          tagOptions={[]}
        /> : null}
      </>;
    }
    render(<Harness />);

    await user.type(screen.getByLabelText("Food"), "Lunch");
    await user.click(screen.getByRole("button", { name: "Save diet entry" }));
    await user.keyboard("{Escape}");
    fireEvent.mouseDown(screen.getByRole("dialog", { name: "Add diet entry" }).parentElement!);
    await user.click(screen.getByRole("button", { name: "Save diet entry" }));
    expect(onClose).not.toHaveBeenCalled();
    expect(health.createDiet).toHaveBeenCalledOnce();

    save.resolve();
    expect(await screen.findByRole("button", { name: "Open diet" })).toHaveFocus();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("retries only reads after Diet creation committed and freezes the draft", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const health = controller({
      createDiet: vi.fn().mockRejectedValue(new HealthMutationRefreshError()),
      refresh: vi.fn()
        .mockResolvedValueOnce(false)
        .mockRejectedValueOnce(new Error("Refresh unavailable"))
        .mockResolvedValueOnce(true),
    });
    render(<DietDialogHarness health={health} onClose={onClose} />);

    await user.type(screen.getByLabelText("Food"), "Lunch");
    await user.click(screen.getByRole("button", { name: "Save diet entry" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Changes were saved, but Health could not refresh.",
    );
    expect(screen.getByLabelText("Food")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save diet entry" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Tags" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Food"), { target: { value: "Dinner" } });
    fireEvent.submit(screen.getByRole("form", { name: "Diet entry" }));

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await user.click(screen.getByRole("button", { name: "Retry refresh" }));
      await waitFor(() => expect(health.refresh).toHaveBeenCalledTimes(attempt));
      expect(health.createDiet).toHaveBeenCalledOnce();
    }
    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Open diet" })).toHaveFocus();
  });

  it("keeps diet inputs and exposes an accessible error after submission fails", async () => {
    const user = userEvent.setup();
    const health = controller({
      createDiet: vi.fn().mockRejectedValue(new Error("Image is too large")),
    });
    const image = new File(["photo"], "meal.png", { type: "image/png" });
    render(<DietPanel controller={health} />);
    await user.click(screen.getByRole("button", { name: "Add diet entry" }));

    await user.type(screen.getByLabelText("Food"), "Lunch");
    await user.upload(screen.getByLabelText("Photo"), image);
    await user.click(screen.getByRole("button", { name: "Save diet entry" }));

    expect(screen.getByLabelText("Food")).toHaveValue("Lunch");
    expect(screen.getByLabelText("Photo")).toHaveProperty("files.length", 1);
    expect(screen.getByRole("alert")).toHaveTextContent("Image is too large");
  });

  it("renders the Medication dialog in a body portal with isolated background and ordered fields", () => {
    const view = render(<MedicationDialogHarness health={controller()} />);
    const dialog = screen.getByRole("dialog", { name: "Add medication entry" });
    expect(within(dialog).getByRole("heading", { name: "Add medication entry" })).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "Close Add medication entry" })).toBeVisible();
    const host = dialog.closest<HTMLElement>("[data-raven-modal-host]");

    expect(host?.parentElement).toBe(document.body);
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-busy", "false");
    expect(view.container).toHaveAttribute("aria-hidden", "true");
    expect(view.container).toHaveAttribute("inert");
    expect(document.body.style.overflow).toBe("hidden");
    expect(screen.getByLabelText("Taken at")).toHaveFocus();
    const form = screen.getByRole("form", { name: "Medication entry" });
    const controls = ["Taken at", "Medication name", "Dose", "Unit", "Note"]
      .map((label) => within(form).getByLabelText(label));
    for (let index = 1; index < controls.length; index += 1) {
      expect(controls[index - 1].compareDocumentPosition(controls[index]) & Node.DOCUMENT_POSITION_FOLLOWING)
        .toBeTruthy();
    }
    expect(screen.getByLabelText("Unit")).toHaveValue("tablet");
    expect(within(screen.getByLabelText("Unit")).getAllByRole("option").map((option) => [
      option.getAttribute("value"), option.textContent,
    ])).toEqual([
      ["tablet", "정"], ["capsule", "캡슐"], ["packet", "포"], ["mg", "mg"],
      ["g", "g"], ["ml", "ml"], ["drop", "방울"], ["dose", "회"],
    ]);

    view.unmount();
    expect(document.body.style.overflow).toBe("");
  });

  it("restores the Medication dialog lifecycle exactly across StrictMode remounts", () => {
    const previousOverflow = document.body.style.overflow;
    const external = document.createElement("aside");
    document.body.append(external);
    document.body.style.overflow = "scroll";
    const view = render(
      <React.StrictMode>
        <MedicationDialogLifecycleHarness health={controller()} open={false} />
      </React.StrictMode>,
    );
    view.container.setAttribute("aria-hidden", "false");
    view.container.setAttribute("inert", "existing");

    try {
      view.rerender(
        <React.StrictMode>
          <MedicationDialogLifecycleHarness health={controller()} open />
        </React.StrictMode>,
      );
      expect(document.querySelectorAll("[data-raven-modal-host]")).toHaveLength(1);
      expect(view.container).toHaveAttribute("aria-hidden", "true");
      expect(view.container).toHaveAttribute("inert", "");
      expect(external).toHaveAttribute("aria-hidden", "true");
      expect(external).toHaveAttribute("inert", "");
      expect(document.body.style.overflow).toBe("hidden");

      view.rerender(
        <React.StrictMode>
          <MedicationDialogLifecycleHarness health={controller()} open={false} />
        </React.StrictMode>,
      );
      expect(document.querySelectorAll("[data-raven-modal-host]")).toHaveLength(0);
      expect(view.container).toHaveAttribute("aria-hidden", "false");
      expect(view.container).toHaveAttribute("inert", "existing");
      expect(external).not.toHaveAttribute("aria-hidden");
      expect(external).not.toHaveAttribute("inert");
      expect(document.body.style.overflow).toBe("scroll");

      view.rerender(
        <React.StrictMode>
          <MedicationDialogLifecycleHarness health={controller()} open />
        </React.StrictMode>,
      );
      expect(document.querySelectorAll("[data-raven-modal-host]")).toHaveLength(1);
      view.unmount();
      expect(document.querySelectorAll("[data-raven-modal-host]")).toHaveLength(0);
      expect(view.container).toHaveAttribute("aria-hidden", "false");
      expect(view.container).toHaveAttribute("inert", "existing");
      expect(external).not.toHaveAttribute("aria-hidden");
      expect(external).not.toHaveAttribute("inert");
      expect(document.body.style.overflow).toBe("scroll");
    } finally {
      view.unmount();
      external.remove();
      document.body.style.overflow = previousOverflow;
    }
  });

  it("renders the Medication dialog safely without browser globals on the server", () => {
    const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
    const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
    const consoleError = vi.spyOn(console, "error");
    Object.defineProperty(globalThis, "document", { configurable: true, value: undefined });
    Object.defineProperty(globalThis, "window", { configurable: true, value: undefined });
    try {
      expect(renderToString(
        <MedicationCreateDialog
          controller={controller()}
          onClose={vi.fn()}
          returnFocusRef={React.createRef<HTMLButtonElement>()}
        />,
      )).toBe("");
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      if (documentDescriptor) Object.defineProperty(globalThis, "document", documentDescriptor);
      if (windowDescriptor) Object.defineProperty(globalThis, "window", windowDescriptor);
      consoleError.mockRestore();
    }
  });

  it("submits the exact Medication payload and converts local time portably", async () => {
    const user = userEvent.setup();
    const health = controller();
    const onClose = vi.fn();
    render(<MedicationDialogHarness health={health} onClose={onClose} />);
    const localTime = "2026-07-30T09:00";
    const expectedRfc3339 = new Date(2026, 6, 30, 9, 0).toISOString();

    fireEvent.change(screen.getByLabelText("Taken at"), { target: { value: localTime } });
    await user.type(screen.getByLabelText("Medication name"), "Vitamin D");
    await user.type(screen.getByLabelText("Dose"), "1000");
    await user.selectOptions(screen.getByLabelText("Unit"), "mg");
    await user.type(screen.getByLabelText("Note"), "With breakfast");
    await user.click(screen.getByRole("button", { name: "Save medication" }));

    expect(health.createMedication).toHaveBeenCalledWith({
      occurredAt: expectedRfc3339,
      details: {
        kind: "medication",
        medicationName: "Vitamin D",
        dose: 1000,
        unit: "mg",
      },
      note: "With breakfast",
    });
    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Add medication entry" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Add medication entry" })).toHaveFocus();
  });

  it.each([
    ["name", "   ", "1000", "Medication name is required"],
    ["dose", "Vitamin D", "", "Dose must be a number"],
    ["dose", "Vitamin D", "0", "Dose must be greater than zero"],
    ["dose", "Vitamin D", "-1", "Dose must be greater than zero"],
    ["dose", "Vitamin D", "Infinity", "Dose must be a number"],
  ])("rejects invalid Medication %s drafts without calling the controller", async (_, name, dose, message) => {
    const health = controller();
    render(<MedicationDialogHarness health={health} />);
    fireEvent.change(screen.getByLabelText("Medication name"), { target: { value: name } });
    fireEvent.change(screen.getByLabelText("Dose"), { target: { value: dose } });
    fireEvent.submit(screen.getByRole("form", { name: "Medication entry" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(health.createMedication).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Medication name")).toHaveValue(name);
    expect(screen.getByLabelText("Dose")).toHaveValue(dose === "" || dose === "Infinity" ? null : Number(dose));
  });

  it("rejects a nonexistent Medication wall time and retains the draft", async () => {
    const previousTimezone = process.env.TZ;
    process.env.TZ = "America/New_York";
    try {
      const health = controller();
      render(<MedicationDialogHarness health={health} />);
      fireEvent.change(screen.getByLabelText("Taken at"), { target: { value: "2026-03-08T02:30" } });
      fireEvent.change(screen.getByLabelText("Medication name"), { target: { value: "Vitamin D" } });
      fireEvent.change(screen.getByLabelText("Dose"), { target: { value: "1000" } });
      fireEvent.submit(screen.getByRole("form", { name: "Medication entry" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("Time must be a valid local date and time");
      expect(health.createMedication).not.toHaveBeenCalled();
      expect(screen.getByLabelText("Taken at")).toHaveValue("2026-03-08T02:30");
      expect(screen.getByLabelText("Medication name")).toHaveValue("Vitamin D");
    } finally {
      if (previousTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = previousTimezone;
    }
  });

  it("wraps Medication focus and closes from idle controls", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<MedicationDialogHarness health={controller()} onClose={onClose} />);
    const close = screen.getByRole("button", { name: "Close Add medication entry" });
    const save = screen.getByRole("button", { name: "Save medication" });
    close.focus();
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(save).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();
    await user.click(close);
    expect(onClose).toHaveBeenCalledOnce();

    render(<MedicationDialogHarness health={controller()} onClose={onClose} />);
    fireEvent.mouseDown(screen.getByRole("dialog", { name: "Add medication entry" }).parentElement!);
    expect(onClose).toHaveBeenCalledTimes(2);
    render(<MedicationDialogHarness health={controller()} onClose={onClose} />);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("blocks Medication dismissal and duplicate submission while pending, including zero focusables", async () => {
    const user = userEvent.setup();
    const save = deferred<void>();
    const onClose = vi.fn();
    const health = controller({ createMedication: vi.fn(() => save.promise) });
    render(<MedicationDialogHarness health={health} onClose={onClose} />);
    await user.type(screen.getByLabelText("Medication name"), "Vitamin D");
    await user.type(screen.getByLabelText("Dose"), "1000");
    await user.click(screen.getByRole("button", { name: "Save medication" }));

    const dialog = screen.getByRole("dialog", { name: "Add medication entry" });
    expect(dialog).toHaveAttribute("aria-busy", "true");
    expect(dialog).toHaveFocus();
    await user.keyboard("{Tab}{Escape}");
    fireEvent.mouseDown(dialog.parentElement!);
    fireEvent.click(screen.getByRole("button", { name: "Close Add medication entry" }));
    fireEvent.click(screen.getByRole("button", { name: "Save medication" }));
    fireEvent.submit(screen.getByRole("form", { name: "Medication entry" }));
    expect(onClose).not.toHaveBeenCalled();
    expect(health.createMedication).toHaveBeenCalledOnce();

    save.resolve();
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it("keeps the Medication dialog usable with every draft field after an ordinary failure", async () => {
    const user = userEvent.setup();
    const health = controller({ createMedication: vi.fn().mockRejectedValue(new Error("Medication save failed")) });
    render(<MedicationDialogHarness health={health} />);
    fireEvent.change(screen.getByLabelText("Taken at"), { target: { value: "2026-08-17T08:30" } });
    await user.type(screen.getByLabelText("Medication name"), "Vitamin D");
    await user.type(screen.getByLabelText("Dose"), "1000");
    await user.selectOptions(screen.getByLabelText("Unit"), "mg");
    await user.type(screen.getByLabelText("Note"), "Keep this");
    await user.click(screen.getByRole("button", { name: "Save medication" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Medication save failed");
    expect(screen.getByRole("dialog", { name: "Add medication entry" })).toBeVisible();
    expect(screen.getByLabelText("Taken at")).toHaveValue("2026-08-17T08:30");
    expect(screen.getByLabelText("Medication name")).toHaveValue("Vitamin D");
    expect(screen.getByLabelText("Dose")).toHaveValue(1000);
    expect(screen.getByLabelText("Unit")).toHaveValue("mg");
    expect(screen.getByLabelText("Note")).toHaveValue("Keep this");
    expect(screen.getByLabelText("Medication name")).toBeEnabled();
    screen.getByLabelText("Medication name").focus();
    expect(screen.getByLabelText("Medication name")).toHaveFocus();
  });

  it("freezes committed Medication creation and retries refresh without resubmitting", async () => {
    const user = userEvent.setup();
    const retry = deferred<boolean>();
    const onClose = vi.fn();
    const health = controller({
      createMedication: vi.fn().mockRejectedValue(new HealthMutationRefreshError()),
      refreshMedication: vi.fn()
        .mockResolvedValueOnce(false)
        .mockImplementationOnce(() => retry.promise)
        .mockResolvedValueOnce(true),
    });
    render(<MedicationDialogHarness health={health} onClose={onClose} />);
    await user.type(screen.getByLabelText("Medication name"), "Vitamin D");
    await user.type(screen.getByLabelText("Dose"), "1000");
    await user.click(screen.getByRole("button", { name: "Save medication" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Changes were saved, but Health could not refresh.");
    expect(screen.getByLabelText("Medication name")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save medication" })).toBeDisabled();
    fireEvent.submit(screen.getByRole("form", { name: "Medication entry" }));
    expect(health.createMedication).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: "Retry refresh" }));
    expect(health.refreshMedication).toHaveBeenCalledOnce();
    expect(screen.getByRole("alert")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Retry refresh" }));
    expect(screen.getByRole("button", { name: "Retry refresh" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Retry refresh" }));
    expect(health.refreshMedication).toHaveBeenCalledTimes(2);
    retry.resolve(true);
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(health.createMedication).toHaveBeenCalledOnce();
  });

  it("ignores a successful Medication refresh retry after unmount", async () => {
    const user = userEvent.setup();
    const retry = deferred<boolean>();
    const onClose = vi.fn();
    const consoleError = vi.spyOn(console, "error");
    const health = controller({
      createMedication: vi.fn().mockRejectedValue(new HealthMutationRefreshError()),
      refreshMedication: vi.fn(() => retry.promise),
    });
    const view = render(<MedicationDialogHarness health={health} onClose={onClose} />);

    await user.type(screen.getByLabelText("Medication name"), "Vitamin D");
    await user.type(screen.getByLabelText("Dose"), "1000");
    await user.click(screen.getByRole("button", { name: "Save medication" }));
    await user.click(await screen.findByRole("button", { name: "Retry refresh" }));
    expect(health.refreshMedication).toHaveBeenCalledOnce();
    view.unmount();

    try {
      await act(async () => {
        retry.resolve(true);
        await retry.promise;
      });
      expect(onClose).not.toHaveBeenCalled();
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  it("submits a Medication dose using the selected medication unit", async () => {
    const user = userEvent.setup();
    const health = controller();
    render(<MedicationPanel controller={health} tombstonedIds={new Set()}
      onArchiveCommitted={vi.fn()} refreshWarning={null} refreshPending={false}
      onRetryRefresh={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Add medication entry" }));

    await user.type(screen.getByLabelText("Medication name"), "Vitamin D");
    await user.type(screen.getByLabelText("Dose"), "1000");
    await user.selectOptions(screen.getByLabelText("Unit"), "mg");
    await user.click(screen.getByRole("button", { name: "Save medication" }));

    expect(health.createMedication).toHaveBeenCalledWith(expect.objectContaining({
      details: {
        kind: "medication",
        medicationName: "Vitamin D",
        dose: 1000,
        unit: "mg",
      },
    }));
  });

  it("batches weight, sleep, overall condition, and lab daily metrics", async () => {
    const user = userEvent.setup();
    const health = controller();
    render(<HealthMetricsPanel controller={health} />);

    await user.type(screen.getByLabelText("Weight"), "72.5");
    await user.type(screen.getByLabelText("Sleep hours"), "7.25");
    await user.type(screen.getByLabelText("Overall condition score"), "3");
    await user.type(screen.getByLabelText("Condition note"), "Mild headache");
    await user.type(screen.getByLabelText("Lab metric key"), "fasting_glucose");
    await user.type(screen.getByLabelText("Lab name"), "Fasting glucose");
    await user.type(screen.getByLabelText("Lab value"), "92.4");
    await user.type(screen.getByLabelText("Lab unit"), "mg/dL");
    await user.click(screen.getByRole("button", { name: "Save daily metrics" }));

    expect(health.upsertMetrics).toHaveBeenCalledWith([
      expect.objectContaining({
        details: { kind: "weight", value: 72.5, unit: "kg" },
      }),
      expect.objectContaining({
        details: { kind: "sleep", value: 7.25 },
      }),
      expect.objectContaining({
        details: {
          kind: "overall_condition",
          score: 3,
          conditionNote: "Mild headache",
        },
      }),
      expect.objectContaining({
        details: {
          kind: "lab",
          key: "fasting_glucose",
          name: "Fasting glucose",
          value: 92.4,
          unit: "mg/dL",
        },
      }),
    ]);
  });

  it("rejects non-positive medication doses before the controller call", async () => {
    const health = controller();
    render(<MedicationPanel controller={health} tombstonedIds={new Set()}
      onArchiveCommitted={vi.fn()} refreshWarning={null} refreshPending={false}
      onRetryRefresh={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Add medication entry" }));

    fireEvent.change(screen.getByLabelText("Medication name"), {
      target: { value: "Vitamin D" },
    });
    fireEvent.change(screen.getByLabelText("Dose"), { target: { value: "0" } });
    fireEvent.submit(screen.getByRole("form", { name: "Medication entry" }));

    expect(await screen.findByRole("alert"))
      .toHaveTextContent("Dose must be greater than zero");
    expect(health.createMedication).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Dose")).toHaveValue(0);
  });

  it("rejects partial daily groups without losing valid or invalid inputs", async () => {
    const health = controller();
    render(<HealthMetricsPanel controller={health} />);

    fireEvent.change(screen.getByLabelText("Weight"), { target: { value: "72.5" } });
    fireEvent.change(screen.getByLabelText("Condition note"), {
      target: { value: "Tired" },
    });
    fireEvent.change(screen.getByLabelText("Lab metric key"), {
      target: { value: "fasting_glucose" },
    });
    fireEvent.submit(screen.getByRole("form", { name: "Daily metrics" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Overall condition requires a score",
    );
    expect(health.upsertMetrics).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Weight")).toHaveValue(72.5);
    expect(screen.getByLabelText("Condition note")).toHaveValue("Tired");
    expect(screen.getByLabelText("Lab metric key")).toHaveValue("fasting_glucose");
  });

  it.each([
    ["Weight", "Weight must be greater than zero"],
    ["Sleep hours", "Sleep hours must be greater than zero"],
  ])("rejects a zero %s before daily upsert", async (label, message) => {
    const health = controller();
    render(<HealthMetricsPanel controller={health} />);

    fireEvent.change(screen.getByLabelText(label), { target: { value: "0" } });
    fireEvent.submit(screen.getByRole("form", { name: "Daily metrics" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(health.upsertMetrics).not.toHaveBeenCalled();
    expect(screen.getByLabelText(label)).toHaveValue(0);
  });

  it("rejects a partial lab group before daily upsert", async () => {
    const health = controller();
    render(<HealthMetricsPanel controller={health} />);

    fireEvent.change(screen.getByLabelText("Lab metric key"), {
      target: { value: "fasting_glucose" },
    });
    fireEvent.submit(screen.getByRole("form", { name: "Daily metrics" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Lab requires metric key, name, and value",
    );
    expect(health.upsertMetrics).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Lab metric key")).toHaveValue("fasting_glucose");
  });

  it("converts browser-local health times to RFC3339 without changing the instant", async () => {
    const previousTimezone = process.env.TZ;
    process.env.TZ = "Asia/Seoul";
    try {
      const user = userEvent.setup();
      const health = controller();
      render(<DietPanel controller={health} />);
      await user.click(screen.getByRole("button", { name: "Add diet entry" }));

      fireEvent.change(screen.getByLabelText("Time"), {
        target: { value: "2026-07-30T09:00" },
      });
      await user.type(screen.getByLabelText("Food"), "Breakfast");
      await user.click(screen.getByRole("button", { name: "Save diet entry" }));

      expect(health.createDiet).toHaveBeenCalledWith(
        expect.objectContaining({ occurredAt: "2026-07-30T00:00:00.000Z" }),
        undefined,
      );
    } finally {
      if (previousTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = previousTimezone;
    }
  });

  it("rejects a nonexistent Diet creation wall time without losing the draft", async () => {
    const previousTimezone = process.env.TZ;
    process.env.TZ = "America/New_York";
    try {
      const health = controller();
      render(<DietPanel controller={health} />);
      await userEvent.click(screen.getByRole("button", { name: "Add diet entry" }));
      fireEvent.change(screen.getByLabelText("Time"), {
        target: { value: "2026-03-08T02:30" },
      });
      await userEvent.type(screen.getByLabelText("Food"), "Early breakfast");
      fireEvent.submit(screen.getByRole("form", { name: "Diet entry" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Time must be a valid local date and time",
      );
      expect(health.createDiet).not.toHaveBeenCalled();
      expect(screen.getByLabelText("Time")).toHaveValue("2026-03-08T02:30");
      expect(screen.getByLabelText("Food")).toHaveValue("Early breakfast");
    } finally {
      if (previousTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = previousTimezone;
    }
  });
});
