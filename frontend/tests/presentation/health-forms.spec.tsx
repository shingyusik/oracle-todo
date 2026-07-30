import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type {
  HealthController,
  HealthState,
} from "@/features/health/hooks/useHealthController";
import { BowelPanel } from "@/features/health/ui/BowelPanel";
import { DietPanel } from "@/features/health/ui/DietPanel";
import { HealthMetricsPanel } from "@/features/health/ui/HealthMetricsPanel";
import { MedicationPanel } from "@/features/health/ui/MedicationPanel";

const loadedState: HealthState = {
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
  return {
    state: loadedState,
    refreshTimeline: vi.fn(),
    loadMoreTimeline: vi.fn(),
    refreshTrends: vi.fn(),
    createDiet: vi.fn(),
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
  });

  it("keeps diet inputs and exposes an accessible error after submission fails", async () => {
    const user = userEvent.setup();
    const health = controller({
      createDiet: vi.fn().mockRejectedValue(new Error("Image is too large")),
    });
    render(<DietPanel controller={health} />);

    await user.type(screen.getByLabelText("Food name"), "Lunch");
    await user.click(screen.getByRole("button", { name: "Save diet entry" }));

    expect(screen.getByLabelText("Food name")).toHaveValue("Lunch");
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

  it("batches populated weight, sleep, symptom, and lab daily metrics", async () => {
    const user = userEvent.setup();
    const health = controller();
    render(<HealthMetricsPanel controller={health} />);

    await user.type(screen.getByLabelText("Weight"), "72.5");
    await user.type(screen.getByLabelText("Sleep hours"), "7.25");
    await user.type(screen.getByLabelText("Symptom name"), "Headache");
    await user.type(screen.getByLabelText("Symptom score"), "3");
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
        details: expect.objectContaining({
          kind: "symptom",
          name: "Headache",
          score: 3,
        }),
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
