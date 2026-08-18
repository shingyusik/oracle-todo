import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type {
  HealthController,
  HealthState,
} from "@/features/health/hooks/useHealthController";
import { defaultHealthTableSettings } from "@/features/health/model/health-table-views";
import { BowelPanel } from "@/features/health/ui/BowelPanel";
import { DietPanel } from "@/features/health/ui/DietPanel";
import { DietCreateDialog } from "@/features/health/ui/DietCreateDialog";
import { HealthMetricsPanel } from "@/features/health/ui/HealthMetricsPanel";
import { MedicationPanel } from "@/features/health/ui/MedicationPanel";

const loadedState: HealthState = {
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
    refreshDiet: vi.fn(),
    refreshTimeline: vi.fn(),
    loadMoreTimeline: vi.fn(),
    refreshTrends: vi.fn(),
    createDiet: vi.fn(),
    updateDiet: vi.fn(),
    archiveDiet: vi.fn(),
    createBowel: vi.fn(),
    createMedication: vi.fn(),
    upsertMetrics: vi.fn(),
    archive: vi.fn(),
    restore: vi.fn(),
    purge: vi.fn(),
    ...overrides,
  };
}

describe("Health Journal forms", () => {
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

    await user.selectOptions(screen.getByLabelText("Meal"), "lunch");
    await user.type(screen.getByLabelText("Food"), "Bibimbap");
    await user.click(screen.getByRole("button", { name: "Tags" }));
    await user.type(screen.getByRole("textbox", { name: "Tags" }), "rice, spicy, rice{Enter}");
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

    await user.click(screen.getByRole("button", { name: "Tags" }));
    expect(screen.getByRole("option", { name: "rice" })).toBeVisible();
    expect(screen.getByRole("option", { name: "spicy" })).toBeVisible();
    expect(screen.queryByRole("option", { name: "todo-only" })).toBeNull();
    await user.click(screen.getByRole("option", { name: "rice" }));
    await user.type(screen.getByRole("textbox", { name: "Tags" }), " fresh, rice, vegan {Enter}");
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
    expect(screen.getByRole("button", { name: "Remove rice tag" })).toBeVisible();
    expect(screen.getByLabelText("Photo")).toHaveProperty("files.length", 1);
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
    await user.click(screen.getByRole("button", { name: "Save diet entry" }));
    expect(onClose).not.toHaveBeenCalled();
    expect(health.createDiet).toHaveBeenCalledOnce();

    save.resolve();
    expect(await screen.findByRole("button", { name: "Open diet" })).toHaveFocus();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("keeps diet inputs and exposes an accessible error after submission fails", async () => {
    const user = userEvent.setup();
    const health = controller({
      createDiet: vi.fn().mockRejectedValue(new Error("Image is too large")),
    });
    const image = new File(["photo"], "meal.png", { type: "image/png" });
    render(<DietPanel controller={health} />);

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
});
