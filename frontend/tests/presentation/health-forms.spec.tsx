import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type {
  HealthController,
  HealthState,
} from "@/features/health/hooks/useHealthController";
import { HealthMutationRefreshError } from "@/features/health/hooks/useHealthController";
import { defaultHealthTableSettings } from "@/features/health/model/health-table-views";
import { BowelPanel } from "@/features/health/ui/BowelPanel";
import { DietPanel } from "@/features/health/ui/DietPanel";
import { DietCreateDialog } from "@/features/health/ui/DietCreateDialog";
import { HealthMetricsPanel } from "@/features/health/ui/HealthMetricsPanel";
import { MedicationPanel } from "@/features/health/ui/MedicationPanel";
import { TagsInput } from "@/features/workbench/ui/TagsInput";

const loadedState: HealthState = {
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

  it("submits structured bowel fields with a Bristol value from 1 to 7", async () => {
    const user = userEvent.setup();
    const health = controller();
    render(<BowelPanel controller={health} />);

    await user.selectOptions(screen.getByLabelText("Bristol scale"), "4");
    await user.click(screen.getByLabelText("Blood visible"));
    await user.type(screen.getByLabelText("Bowel note"), "After breakfast");
    await user.click(screen.getByRole("button", { name: "Save bowel entry" }));

    expect(health.createBowel).toHaveBeenCalledWith(expect.objectContaining({
      details: { kind: "bowel", bristolScale: 4, bloodVisible: true },
      note: "After breakfast",
    }));
    expect(screen.getByRole("option", { name: "Type 1" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Type 7" })).toBeInTheDocument();
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

  it("submits a medication dose using the selected medication unit", async () => {
    const user = userEvent.setup();
    const health = controller();
    render(<MedicationPanel controller={health} />);

    await user.type(screen.getByLabelText("Medication name"), "Vitamin D");
    await user.type(screen.getByLabelText("Dose"), "1000");
    await user.selectOptions(screen.getByLabelText("Medication unit"), "mg");
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
    render(<MedicationPanel controller={health} />);

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
