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
import type { HealthEvent } from "@/features/health/model/health-model";
import { defaultHealthTableSettings } from "@/features/health/model/health-table-views";
import { BowelCreateDialog } from "@/features/health/ui/BowelCreateDialog";
import { BowelPanel } from "@/features/health/ui/BowelPanel";
import { DietPanel } from "@/features/health/ui/DietPanel";
import { DietCreateDialog } from "@/features/health/ui/DietCreateDialog";
import { HealthMetricsCreateDialog } from "@/features/health/ui/HealthMetricsCreateDialog";
import { BowelForm, DietForm, MedicationForm, MetricsForm } from "@/features/health/ui/HealthForms";
import { MedicationPanel } from "@/features/health/ui/MedicationPanel";
import { MedicationCreateDialog } from "@/features/health/ui/MedicationCreateDialog";
import { TagsInput } from "@/features/workbench/ui/TagsInput";

const loadedState: HealthState = {
  metricsStatus: "loaded",
  metricsError: null,
  metricsEntries: [],
  medicationStatus: "loaded",
  medicationError: null,
  medicationEntries: [],
  bowelStatus: "loaded",
  bowelError: null,
  bowelEntries: [],
  dietStatus: "loaded",
  dietError: null,
  dietEntries: [],
  reportStatus: "idle",
  reportError: null,
  report: null,
  reportSelection: { preset: 30 },
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
    tablePage: vi.fn(() => ({ items: [], nextOffset: null, moreStatus: "idle" as const, moreError: null, generation: 0 })),
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
    refreshMetrics: vi.fn(),
    refreshMedication: vi.fn(),
    refreshBowel: vi.fn(),
    refreshDiet: vi.fn(),
    runReports: vi.fn(),
    retryReports: vi.fn(),
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

function metricEvent(
  id: string,
  occurredAt: string,
  field: "weight" | "sleep" | "crp" | "calprotectin" | "condition",
  value: number,
  updatedAt = occurredAt,
): HealthEvent {
  const fixed = {
    weight: ["weight", "body_weight", "Body weight", "kg"],
    sleep: ["sleep", "sleep_duration", "Sleep", "hours"],
    crp: ["lab", "crp", "CRP", "mg/L"],
    calprotectin: ["lab", "fecal_calprotectin", "Fecal calprotectin", "µg/g"],
    condition: ["symptom", "overall_condition", "Overall condition", null],
  } as const;
  const [category, metricKey, name, unit] = fixed[field];
  let attributes: HealthEvent["attributes"];
  if (field === "weight") {
    attributes = { kind: "weight", metricKey, name, value, unit: unit! };
  } else if (field === "sleep") {
    attributes = { kind: "sleep", metricKey, name, hours: value };
  } else if (field === "condition") {
    attributes = { kind: "symptom", metricKey, name, score: value, conditionNote: "Stable" };
  } else {
    attributes = { kind: "lab", metricKey, name, value, unit: unit! };
  }
  return {
    id, occurredAt, category, metricKey, name, value, unit,
    note: null, attributes, createdAt: occurredAt, updatedAt, deletedAt: null,
  };
}

function MetricsDialogHarness({
  health,
  onClose = vi.fn(),
}: {
  health: HealthController;
  onClose?: () => void;
}) {
  const [open, setOpen] = React.useState(true);
  const returnFocusRef = React.useRef<HTMLButtonElement>(null);
  return <>
    <main data-testid="metrics-dialog-background">
      <button ref={returnFocusRef}>Add health metrics</button>
    </main>
    {open ? <HealthMetricsCreateDialog
      controller={health}
      metricsEntries={health.state.metricsEntries}
      onClose={() => {
        onClose();
        setOpen(false);
      }}
      returnFocusRef={returnFocusRef}
    /> : null}
  </>;
}

function MetricsDialogLifecycleHarness({
  health,
  open,
}: {
  health: HealthController;
  open: boolean;
}) {
  const returnFocusRef = React.useRef<HTMLButtonElement>(null);
  return <main>
    <button ref={returnFocusRef}>Add metrics lifecycle</button>
    {open ? <HealthMetricsCreateDialog
      controller={health}
      metricsEntries={health.state.metricsEntries}
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
  it.each([
    ["Diet", "Add diet entry", "Close Add diet entry", () => <DietDialogHarness health={controller()} />,
      [["Time", "INPUT"], ["Meal", "SELECT"], ["Note", "TEXTAREA"]]],
    ["Bowel", "Add bowel entry", "Close Add bowel entry", () => <BowelDialogHarness health={controller()} />,
      [["Time", "INPUT"], ["Bristol Scale", "SELECT"], ["Note", "TEXTAREA"]]],
    ["Medication", "Add medication entry", "Close Add medication entry",
      () => <MedicationDialogHarness health={controller()} />,
      [["Medication name", "INPUT"], ["Unit", "SELECT"], ["Note", "TEXTAREA"]]],
    ["Health Metrics", "Add health metrics", "Close Add health metrics",
      () => <MetricsDialogHarness health={controller()} />,
      [["Date", "INPUT"], ["Condition", "SELECT"], ["Note", "TEXTAREA"]]],
  ])("aligns the %s creation dialog actions and field wrappers with Ledger", (
    _name,
    dialogName,
    closeLabel,
    renderDialog,
    controls,
  ) => {
    render(renderDialog());
    const dialog = screen.getByRole("dialog", { name: dialogName });
    const header = within(dialog).getByRole("heading", { name: dialogName }).parentElement!;
    const close = within(dialog).getByRole("button", { name: closeLabel });
    const save = within(dialog).getByRole("button", { name: "Save" });
    const actions = close.parentElement!;

    expect(within(header).queryByRole("button")).toBeNull();
    expect(actions.tagName).toBe("FOOTER");
    expect(actions).toHaveClass("ledger-create-dialog-actions");
    expect(save.parentElement).toBe(actions);
    expect(close).toHaveClass("items-toolbar-button");
    expect(save).toHaveClass("items-toolbar-button", "ledger-create-dialog-save");
    expect(close).toHaveTextContent(/^Close$/);
    expect(save).toHaveTextContent(/^Save$/);
    for (const [label, tagName] of controls) {
      const control = within(dialog).getByLabelText(label);
      expect(control.tagName).toBe(tagName);
      expect(control.closest(".field-label")).not.toBeNull();
    }
  });

  it("aligns the Bowel blood checkbox with the compact form pattern", () => {
    render(<BowelDialogHarness health={controller()} />);
    const bloodVisible = screen.getByLabelText("Blood Visible");

    expect(bloodVisible).toHaveAttribute("type", "checkbox");
    expect(bloodVisible.closest("label")).toHaveClass("field-checkbox");
  });

  it.each([
    ["Diet", "Save diet entry", () => <DietForm controller={controller()} />],
    ["Bowel", "Save bowel entry", () => <BowelForm controller={controller()} />],
    ["Medication", "Save medication", () => <MedicationForm controller={controller()} />],
    ["Health Metrics", "Save daily metrics", () => <MetricsForm controller={controller()} />],
  ])("preserves the standalone %s submit label", (_name, saveLabel, renderForm) => {
    render(renderForm());
    expect(screen.getByRole("button", { name: saveLabel })).toBeVisible();
    expect(screen.queryByRole("button", { name: /^Close Add / })).toBeNull();
  });

  it("opens the shared tag dropdown from the field without a visible Add button", async () => {
    const user = userEvent.setup();
    render(<TagsInput label="Tags" value={[]} tagOptions={["rice"]} onCommit={vi.fn()} />);

    const trigger = screen.getByRole("button", { name: "Tags" });
    const inputLayout = trigger.closest(".tag-input");
    expect(inputLayout).not.toBeNull();
    expect(inputLayout).toHaveTextContent(/^Select or enter tags\.\.\.$/);
    expect(screen.queryByText(/^Add$/)).toBeNull();

    await user.click(inputLayout!);

    expect(screen.getByRole("combobox", { name: "Tags" })).toBeVisible();
  });

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
    await user.click(screen.getByRole("button", { name: "Save" }));

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
    const firstField = screen.getByLabelText("Time");
    const retrylessSave = screen.getByRole("button", { name: "Save" });
    expect(firstField).toHaveFocus();
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(retrylessSave).toHaveFocus();
    await user.tab();
    expect(firstField).toHaveFocus();
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
    const saveButton = screen.getByRole("button", { name: "Saving…" });
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
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
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
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    const dialog = screen.getByRole("dialog", { name: "Add bowel entry" });
    const close = screen.getByRole("button", { name: "Close Add bowel entry" });
    expect(close).toBeDisabled();
    fireEvent.keyDown(dialog, { key: "Escape" });
    fireEvent.mouseDown(dialog.parentElement!);
    fireEvent.click(close);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Retry refresh" })).toBeVisible();
    expect(health.createBowel).toHaveBeenCalledOnce();
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
    await user.click(screen.getByRole("button", { name: "Save" }));

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
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(health.createDiet).toHaveBeenCalledWith(
      expect.objectContaining({ tags: ["fresh", "vegan"] }),
      undefined,
    );
  });

  it("renders Diet controls in the requested order", async () => {
    render(<DietPanel controller={controller()} />);
    fireEvent.click(screen.getByRole("button", { name: "Add diet entry" }));
    const form = await screen.findByRole("form", { name: "Diet entry" });
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
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByRole("dialog", { name: "Add diet entry" })).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("Meal image must be an image file");
    expect(health.createDiet).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Food")).toHaveValue("Bibimbap");
    expect(screen.getByLabelText("Note")).toHaveValue("Keep this");
    expect(screen.getByLabelText("Photo")).toHaveProperty("files.length", 1);

    const image = new File(["photo"], "meal.png", { type: "image/png" });
    await user.upload(screen.getByLabelText("Photo"), image);
    await user.click(screen.getByRole("button", { name: "Save" }));
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
    const firstField = screen.getByLabelText("Time");
    const save = screen.getByRole("button", { name: "Save" });

    expect(firstField).toHaveFocus();
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(save).toHaveFocus();
    await user.tab();
    expect(firstField).toHaveFocus();
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
    await user.click(screen.getByRole("button", { name: "Save" }));
    await user.keyboard("{Escape}");
    fireEvent.mouseDown(screen.getByRole("dialog", { name: "Add diet entry" }).parentElement!);
    await user.click(screen.getByRole("button", { name: "Saving…" }));
    expect(onClose).not.toHaveBeenCalled();
    expect(health.createDiet).toHaveBeenCalledOnce();

    save.resolve();
    expect(await screen.findByRole("button", { name: "Open diet" })).toHaveFocus();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("keeps Diet focus inside the dialog when pending leaves no enabled controls", async () => {
    const save = deferred<void>();
    const health = controller({ createDiet: vi.fn(() => save.promise) });
    render(<DietDialogHarness health={health} />);
    fireEvent.change(screen.getByLabelText("Food"), { target: { value: "Lunch" } });
    fireEvent.submit(screen.getByRole("form", { name: "Diet entry" }));

    const dialog = screen.getByRole("dialog", { name: "Add diet entry" });
    await waitFor(() => expect(dialog).toHaveFocus());
    expect(dialog).toHaveAttribute("tabindex", "-1");

    const background = screen.getByRole("button", { name: "Open diet", hidden: true });
    for (const shiftKey of [false, true]) {
      background.focus();
      const tab = new KeyboardEvent("keydown", {
        key: "Tab", shiftKey, bubbles: true, cancelable: true,
      });
      dialog.dispatchEvent(tab);
      expect(tab.defaultPrevented).toBe(true);
      expect(dialog).toHaveFocus();
    }

    save.resolve();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Add diet entry" })).toBeNull());
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
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Changes were saved, but Health could not refresh.",
    );
    expect(screen.getByLabelText("Food")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Tags" })).toBeDisabled();
    const dialog = screen.getByRole("dialog", { name: "Add diet entry" });
    const close = screen.getByRole("button", { name: "Close Add diet entry" });
    expect(close).toBeDisabled();
    fireEvent.keyDown(dialog, { key: "Escape" });
    fireEvent.mouseDown(dialog.parentElement!);
    fireEvent.click(close);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Retry refresh" })).toBeVisible();
    expect(health.createDiet).toHaveBeenCalledOnce();
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
    await user.click(screen.getByRole("button", { name: "Save" }));

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
    await user.click(screen.getByRole("button", { name: "Save" }));

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
    const firstField = screen.getByLabelText("Taken at");
    const close = screen.getByRole("button", { name: "Close Add medication entry" });
    const save = screen.getByRole("button", { name: "Save" });
    expect(firstField).toHaveFocus();
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(save).toHaveFocus();
    await user.tab();
    expect(firstField).toHaveFocus();
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
    await user.click(screen.getByRole("button", { name: "Save" }));

    const dialog = screen.getByRole("dialog", { name: "Add medication entry" });
    expect(dialog).toHaveAttribute("aria-busy", "true");
    expect(dialog).toHaveFocus();
    await user.keyboard("{Tab}{Escape}");
    fireEvent.mouseDown(dialog.parentElement!);
    fireEvent.click(screen.getByRole("button", { name: "Close Add medication entry" }));
    fireEvent.click(screen.getByRole("button", { name: "Saving…" }));
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
    await user.click(screen.getByRole("button", { name: "Save" }));

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
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Changes were saved, but Health could not refresh.");
    expect(screen.getByLabelText("Medication name")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    const dialog = screen.getByRole("dialog", { name: "Add medication entry" });
    const close = screen.getByRole("button", { name: "Close Add medication entry" });
    expect(close).toBeDisabled();
    fireEvent.keyDown(dialog, { key: "Escape" });
    fireEvent.mouseDown(dialog.parentElement!);
    fireEvent.click(close);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Retry refresh" })).toBeVisible();
    expect(health.createMedication).toHaveBeenCalledOnce();
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
    await user.click(screen.getByRole("button", { name: "Save" }));
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
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(health.createMedication).toHaveBeenCalledWith(expect.objectContaining({
      details: {
        kind: "medication",
        medicationName: "Vitamin D",
        dose: 1000,
        unit: "mg",
      },
    }));
  });

  it("renders fixed Health Metrics fields in order and submits the exact daily payload", async () => {
    const health = controller();
    render(<MetricsDialogHarness health={health} />);
    const form = screen.getByRole("form", { name: "Daily metrics" });
    const controls = ["Date", "Weight", "Sleep", "CRP", "Calprotectin", "Condition", "Note"]
      .map((label) => within(form).getByLabelText(label));
    for (let index = 1; index < controls.length; index += 1) {
      expect(controls[index - 1].compareDocumentPosition(controls[index]) & Node.DOCUMENT_POSITION_FOLLOWING)
        .toBeTruthy();
    }
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-08-19" } });
    fireEvent.change(screen.getByLabelText("Weight"), { target: { value: "68.2" } });
    fireEvent.change(screen.getByLabelText("Sleep"), { target: { value: "7.5" } });
    fireEvent.change(screen.getByLabelText("CRP"), { target: { value: "0.4" } });
    fireEvent.change(screen.getByLabelText("Calprotectin"), { target: { value: "80" } });
    fireEvent.change(screen.getByLabelText("Condition"), { target: { value: "8" } });
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "  Good  " } });
    fireEvent.submit(form);
    const occurredAt = new Date(2026, 7, 19, 12).toISOString();
    await waitFor(() => expect(health.saveMetrics).toHaveBeenCalledWith({
      metrics: [
        { occurredAt, details: { kind: "weight", value: 68.2, unit: "kg" } },
        { occurredAt, details: { kind: "sleep", value: 7.5 } },
        { occurredAt, details: { kind: "lab", key: "crp", name: "CRP", value: 0.4, unit: "mg/L" } },
        { occurredAt, details: { kind: "lab", key: "fecal_calprotectin", name: "Fecal calprotectin", value: 80, unit: "µg/g" } },
        { occurredAt, details: { kind: "overall_condition", score: 8, conditionNote: "Good" } },
      ],
      archives: [],
    }));
  });

  it("defaults Health Metrics to the local date and preloads another date with optimistic timestamps", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 20, 23, 30));
    const first = metricEvent("weight-1", new Date(2026, 7, 18, 12).toISOString(), "weight", 67.1, "2026-08-18T04:00:00.000Z");
    const second = metricEvent("weight-2", new Date(2026, 7, 19, 12).toISOString(), "weight", 68.2, "2026-08-19T04:00:00.000Z");
    const health = controller({ state: { ...loadedState, metricsEntries: [first, second] } });
    try {
      render(<MetricsDialogHarness health={health} />);
      expect(screen.getByLabelText("Date")).toHaveValue("2026-08-20");
      fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-08-18" } });
      await act(async () => Promise.resolve());
      expect(screen.getByLabelText("Weight")).toHaveValue(67.1);
      fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-08-19" } });
      await act(async () => Promise.resolve());
      expect(screen.getByLabelText("Weight")).toHaveValue(68.2);
      fireEvent.submit(screen.getByRole("form", { name: "Daily metrics" }));
      await act(async () => Promise.resolve());
      expect(health.saveMetrics).toHaveBeenCalledWith({
        metrics: [{
          occurredAt: new Date(2026, 7, 19, 12).toISOString(),
          details: { kind: "weight", value: 68.2, unit: "kg" },
          expectedUpdatedAt: "2026-08-19T04:00:00.000Z",
        }],
        archives: [],
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the selected-date draft and original optimistic token across background refresh", async () => {
    const date = "2026-08-18";
    const occurredAt = new Date(2026, 7, 18, 12).toISOString();
    const original = metricEvent("weight-1", occurredAt, "weight", 67.1, "2026-08-18T04:00:00.000Z");
    const refreshed = metricEvent("weight-1", occurredAt, "weight", 72.4, "2026-08-18T05:00:00.000Z");
    const initial = controller({ state: { ...loadedState, metricsEntries: [original] } });
    const latest = controller({ state: { ...loadedState, metricsEntries: [refreshed] } });
    const view = render(<MetricsDialogHarness health={initial} />);

    fireEvent.change(screen.getByLabelText("Date"), { target: { value: date } });
    await act(async () => Promise.resolve());
    expect(screen.getByLabelText("Weight")).toHaveValue(67.1);
    fireEvent.change(screen.getByLabelText("Weight"), { target: { value: "68.2" } });

    view.rerender(<MetricsDialogHarness health={latest} />);
    expect(screen.getByLabelText("Weight")).toHaveValue(68.2);
    fireEvent.submit(screen.getByRole("form", { name: "Daily metrics" }));
    await waitFor(() => expect(latest.saveMetrics).toHaveBeenCalledWith({
      metrics: [{
        occurredAt,
        details: { kind: "weight", value: 68.2, unit: "kg" },
        expectedUpdatedAt: "2026-08-18T04:00:00.000Z",
      }],
      archives: [],
    }));
  });

  it("hydrates a late selected-date row once while pristine, then preserves edits", async () => {
    const date = "2026-08-18";
    const occurredAt = new Date(2026, 7, 18, 12).toISOString();
    const loaded = metricEvent("weight-1", occurredAt, "weight", 67.1, "2026-08-18T04:00:00.000Z");
    const refreshed = metricEvent("weight-1", occurredAt, "weight", 72.4, "2026-08-18T05:00:00.000Z");
    const empty = controller();
    const firstLoad = controller({ state: { ...loadedState, metricsEntries: [loaded] } });
    const latest = controller({ state: { ...loadedState, metricsEntries: [refreshed] } });
    const view = render(<MetricsDialogHarness health={empty} />);

    fireEvent.change(screen.getByLabelText("Date"), { target: { value: date } });
    await act(async () => Promise.resolve());
    expect(screen.getByLabelText("Weight")).toHaveValue(null);
    view.rerender(<MetricsDialogHarness health={firstLoad} />);
    await waitFor(() => expect(screen.getByLabelText("Weight")).toHaveValue(67.1));

    fireEvent.change(screen.getByLabelText("Weight"), { target: { value: "68.2" } });
    view.rerender(<MetricsDialogHarness health={latest} />);
    expect(screen.getByLabelText("Weight")).toHaveValue(68.2);
    fireEvent.submit(screen.getByRole("form", { name: "Daily metrics" }));
    await waitFor(() => expect(latest.saveMetrics).toHaveBeenCalledWith({
      metrics: [{
        occurredAt,
        details: { kind: "weight", value: 68.2, unit: "kg" },
        expectedUpdatedAt: "2026-08-18T04:00:00.000Z",
      }],
      archives: [],
    }));
  });

  it("uses the browser-local date on both sides of local midnight", () => {
    const previousTimezone = process.env.TZ;
    process.env.TZ = "America/Los_Angeles";
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-08-20T06:59:59.000Z"));
      const beforeMidnight = render(<MetricsDialogHarness health={controller()} />);
      expect(screen.getByLabelText("Date")).toHaveValue("2026-08-19");
      beforeMidnight.unmount();

      vi.setSystemTime(new Date("2026-08-20T07:00:00.000Z"));
      render(<MetricsDialogHarness health={controller()} />);
      expect(screen.getByLabelText("Date")).toHaveValue("2026-08-20");
    } finally {
      vi.useRealTimers();
      if (previousTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = previousTimezone;
    }
  });

  it("portals and isolates Health Metrics, wraps focus, closes only while idle, and restores focus", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const view = render(<MetricsDialogHarness health={controller()} onClose={onClose} />);
    const dialog = screen.getByRole("dialog", { name: "Add health metrics" });
    const host = dialog.closest<HTMLElement>("[data-raven-modal-host]");
    expect(host?.parentElement).toBe(document.body);
    expect(view.container).toHaveAttribute("inert");
    expect(document.body.style.overflow).toBe("hidden");
    const firstField = screen.getByLabelText("Date");
    expect(firstField).toHaveFocus();
    const save = screen.getByRole("button", { name: "Save" });
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(save).toHaveFocus();
    await user.tab();
    expect(firstField).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Add health metrics" })).toHaveFocus();
    expect(document.body.style.overflow).toBe("");
  });

  it("closes Health Metrics from an idle backdrop click", () => {
    const onClose = vi.fn();
    render(<MetricsDialogHarness health={controller()} onClose={onClose} />);
    const backdrop = screen.getByRole("dialog", { name: "Add health metrics" }).parentElement!;
    fireEvent.mouseDown(backdrop);
    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog", { name: "Add health metrics" })).not.toBeInTheDocument();
  });

  it("restores preexisting isolation state across Health Metrics StrictMode mounts", () => {
    const previousOverflow = document.body.style.overflow;
    const external = document.createElement("aside");
    document.body.append(external);
    document.body.style.overflow = "scroll";
    const health = controller();
    const view = render(
      <React.StrictMode>
        <MetricsDialogLifecycleHarness health={health} open={false} />
      </React.StrictMode>,
    );
    view.container.setAttribute("aria-hidden", "false");
    view.container.setAttribute("inert", "existing");

    try {
      view.rerender(
        <React.StrictMode>
          <MetricsDialogLifecycleHarness health={health} open />
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
          <MetricsDialogLifecycleHarness health={health} open={false} />
        </React.StrictMode>,
      );
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

  it("blocks Health Metrics duplicate submission and dismissal synchronously while pending", async () => {
    const save = deferred<void>();
    const onClose = vi.fn();
    const health = controller({ saveMetrics: vi.fn(() => save.promise) });
    render(<MetricsDialogHarness health={health} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText("Weight"), { target: { value: "68" } });
    const form = screen.getByRole("form", { name: "Daily metrics" });
    fireEvent.submit(form);
    fireEvent.submit(form);
    const dialog = screen.getByRole("dialog", { name: "Add health metrics" });
    fireEvent.keyDown(dialog, { key: "Escape" });
    fireEvent.mouseDown(dialog.parentElement!);
    fireEvent.click(screen.getByRole("button", { name: "Close Add health metrics" }));
    expect(health.saveMetrics).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
    expect(dialog).toHaveAttribute("aria-busy", "true");
    expect(dialog).toHaveFocus();
    save.resolve();
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it("retains Health Metrics fields after an ordinary failure", async () => {
    const health = controller({ saveMetrics: vi.fn().mockRejectedValue(new Error("Metrics save failed")) });
    render(<MetricsDialogHarness health={health} />);
    fireEvent.change(screen.getByLabelText("Weight"), { target: { value: "68.2" } });
    fireEvent.change(screen.getByLabelText("Condition"), { target: { value: "8" } });
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "Keep this" } });
    fireEvent.submit(screen.getByRole("form", { name: "Daily metrics" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Metrics save failed");
    expect(screen.getByLabelText("Weight")).toHaveValue(68.2);
    expect(screen.getByLabelText("Condition")).toHaveValue("8");
    expect(screen.getByLabelText("Note")).toHaveValue("Keep this");
    expect(screen.getByLabelText("Weight")).toBeEnabled();
  });

  it("freezes committed Health Metrics and retries reads without saving again", async () => {
    const retry = deferred<boolean>();
    const onClose = vi.fn();
    const health = controller({
      saveMetrics: vi.fn().mockRejectedValue(new HealthMutationRefreshError()),
      refreshMetrics: vi.fn().mockResolvedValueOnce(false).mockImplementationOnce(() => retry.promise),
    });
    render(<MetricsDialogHarness health={health} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText("Weight"), { target: { value: "68" } });
    fireEvent.submit(screen.getByRole("form", { name: "Daily metrics" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Changes were saved, but Health could not refresh.");
    expect(screen.getByLabelText("Weight")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Close Add health metrics" })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Add health metrics" }), { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Retry refresh" }));
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Retry refresh" }));
    fireEvent.click(screen.getByRole("button", { name: "Retry refresh" }));
    expect(health.refreshMetrics).toHaveBeenCalledTimes(2);
    retry.resolve(true);
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(health.saveMetrics).toHaveBeenCalledOnce();
  });

  it("settles a Health Metrics refresh retry safely after unmount", async () => {
    const retry = deferred<boolean>();
    const onClose = vi.fn();
    const health = controller({
      saveMetrics: vi.fn().mockRejectedValue(new HealthMutationRefreshError()),
      refreshMetrics: vi.fn(() => retry.promise),
    });
    const view = render(<MetricsDialogHarness health={health} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText("Weight"), { target: { value: "68" } });
    fireEvent.submit(screen.getByRole("form", { name: "Daily metrics" }));
    await userEvent.click(await screen.findByRole("button", { name: "Retry refresh" }));
    view.unmount();
    await act(async () => { retry.resolve(true); await retry.promise; });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("renders the Health Metrics dialog without browser globals on the server", () => {
    const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
    const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
    const consoleError = vi.spyOn(console, "error");
    Object.defineProperty(globalThis, "document", { configurable: true, value: undefined });
    Object.defineProperty(globalThis, "window", { configurable: true, value: undefined });
    try {
      expect(renderToString(<HealthMetricsCreateDialog
        controller={controller()}
        metricsEntries={[]}
        onClose={vi.fn()}
        returnFocusRef={React.createRef<HTMLButtonElement>()}
      />)).toBe("");
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      if (documentDescriptor) Object.defineProperty(globalThis, "document", documentDescriptor);
      if (windowDescriptor) Object.defineProperty(globalThis, "window", windowDescriptor);
      consoleError.mockRestore();
    }
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

  it("validates fixed Health Metrics values and keeps the draft", async () => {
    const health = controller();
    render(<MetricsDialogHarness health={health} />);
    fireEvent.change(screen.getByLabelText("Sleep"), { target: { value: "25" } });
    fireEvent.submit(screen.getByRole("form", { name: "Daily metrics" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Sleep must not exceed 24");
    expect(health.saveMetrics).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Sleep")).toHaveValue(25);
  });

  it.each([
    ["Weight", "Weight must be greater than zero"],
    ["Sleep", "Sleep must be greater than zero"],
  ])("rejects a zero %s before daily save", async (label, message) => {
    const health = controller();
    render(<MetricsDialogHarness health={health} />);

    fireEvent.change(screen.getByLabelText(label), { target: { value: "0" } });
    fireEvent.submit(screen.getByRole("form", { name: "Daily metrics" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(health.saveMetrics).not.toHaveBeenCalled();
    expect(screen.getByLabelText(label)).toHaveValue(0);
  });

  it("allows a Health Metrics note draft but requires Condition before saving it", async () => {
    const health = controller();
    render(<MetricsDialogHarness health={health} />);
    const note = screen.getByLabelText("Note");
    expect(note).toBeEnabled();
    fireEvent.change(note, { target: { value: "Keep this" } });
    fireEvent.submit(screen.getByRole("form", { name: "Daily metrics" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Select Condition to save Note");
    expect(health.saveMetrics).not.toHaveBeenCalled();
    expect(note).toHaveValue("Keep this");
  });

  it.each([
    ["CRP", "-0.1", "CRP must not be negative"],
    ["Calprotectin", "-1", "Calprotectin must not be negative"],
  ])("rejects invalid %s values without saving", async (label, value, message) => {
    const health = controller();
    render(<MetricsDialogHarness health={health} />);
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
    fireEvent.submit(screen.getByRole("form", { name: "Daily metrics" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(health.saveMetrics).not.toHaveBeenCalled();
  });

  it.each(["CRP", "Calprotectin"])("rejects a non-finite %s value at the native number boundary", async (label) => {
    const health = controller();
    render(<MetricsDialogHarness health={health} />);
    const input = screen.getByLabelText(label);
    fireEvent.change(input, { target: { value: "1e309" } });
    expect(input).toHaveValue(null);
    fireEvent.submit(screen.getByRole("form", { name: "Daily metrics" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter at least one daily metric");
    expect(health.saveMetrics).not.toHaveBeenCalled();
  });

  it("offers exactly the optional Condition values 1 through 10", () => {
    render(<MetricsDialogHarness health={controller()} />);
    const condition = screen.getByLabelText("Condition");
    expect(within(condition).getAllByRole("option").map((option) => [
      option.getAttribute("value"), option.textContent,
    ])).toEqual([
      ["", "None"],
      ...Array.from({ length: 10 }, (_, index) => String(index + 1)).map((value) => [value, value]),
    ]);
  });

  it("rejects a skipped local Health Metrics date instead of shifting it", async () => {
    const previousTimezone = process.env.TZ;
    process.env.TZ = "Pacific/Apia";
    try {
      const health = controller();
      render(<MetricsDialogHarness health={health} />);
      fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2011-12-30" } });
      fireEvent.change(screen.getByLabelText("Weight"), { target: { value: "68" } });
      fireEvent.submit(screen.getByRole("form", { name: "Daily metrics" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("Time must be a valid local date and time");
      expect(health.saveMetrics).not.toHaveBeenCalled();
      expect(screen.getByLabelText("Date")).toHaveValue("2011-12-30");
    } finally {
      if (previousTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = previousTimezone;
    }
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
      await user.click(screen.getByRole("button", { name: "Save" }));

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
