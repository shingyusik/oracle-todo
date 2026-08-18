import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen } from "@testing-library/react";
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

    await user.selectOptions(screen.getByLabelText("Meal type"), "lunch");
    await user.type(screen.getByLabelText("Food name"), "Bibimbap");
    await user.type(screen.getByLabelText("Tags"), "rice, spicy, rice");
    await user.upload(screen.getByLabelText("Meal image"), image);
    await user.click(screen.getByRole("button", { name: "Save diet entry" }));

    expect(health.createDiet).toHaveBeenCalledWith(
      expect.objectContaining({
        mealType: "lunch",
        foodName: "Bibimbap",
        tags: ["rice", "spicy"],
      }),
      image,
    );
    expect(screen.getByLabelText("Meal image")).toHaveProperty("files.length", 0);
  });

  it("keeps diet inputs and exposes an accessible error after submission fails", async () => {
    const user = userEvent.setup();
    const health = controller({
      createDiet: vi.fn().mockRejectedValue(new Error("Image is too large")),
    });
    const image = new File(["photo"], "meal.png", { type: "image/png" });
    render(<DietPanel controller={health} />);

    await user.type(screen.getByLabelText("Food name"), "Lunch");
    await user.upload(screen.getByLabelText("Meal image"), image);
    await user.click(screen.getByRole("button", { name: "Save diet entry" }));

    expect(screen.getByLabelText("Food name")).toHaveValue("Lunch");
    expect(screen.getByLabelText("Meal image")).toHaveProperty("files.length", 1);
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

      fireEvent.change(screen.getByLabelText("Occurred at"), {
        target: { value: "2026-07-30T09:00" },
      });
      await user.type(screen.getByLabelText("Food name"), "Breakfast");
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
