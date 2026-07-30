import "@testing-library/jest-dom/vitest";

import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import React from "react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { healthApi } from "@/features/health/api/health-api";
import type {
  HealthController,
  HealthState,
} from "@/features/health/hooks/useHealthController";
import { useHealthController } from "@/features/health/hooks/useHealthController";
import type {
  DietEntry,
  HealthEvent,
  HealthTrends,
  TimelineItem,
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

const trends: HealthTrends = {
  days: 30,
  topDietTags: [{ name: "rice", count: 2 }],
  bowelAverageByDay: [{ localDate: "2026-07-30", average: 4, count: 1 }],
  symptomFrequencies: [{ name: "Headache", count: 2 }],
  medicationFrequencies: [{ name: "Vitamin D", count: 1 }],
  numericSeries: [
    {
      category: "weight",
      metricKey: "weight",
      name: "Weight",
      unit: "kg",
      points: [{ occurredAt: "2026-07-30T00:00:00Z", value: 72.5 }],
    },
    {
      category: "sleep",
      metricKey: "sleep",
      name: "Sleep",
      unit: "hours",
      points: [{ occurredAt: "2026-07-30T00:00:00Z", value: 7.25 }],
    },
    {
      category: "lab",
      metricKey: "fasting_glucose",
      name: "Fasting glucose",
      unit: "mg/dL",
      points: [{ occurredAt: "2026-07-30T00:00:00Z", value: 92.4 }],
    },
  ],
  possibleTagReactions: [{ tag: "rice", dietEntries: 2, eventsWithin24h: 1 }],
  reactionDisclaimer: "Server-provided note.",
};

const loadedState: HealthState = {
  timelineStatus: "loaded",
  timelineError: null,
  timeline: [
    { kind: "diet", record: diet },
    { kind: "health_event", record: bowel },
  ],
  timelineHasMore: false,
  trendsStatus: "loaded",
  trendsError: null,
  trends,
};

function controller(state: HealthState = loadedState): HealthController {
  return {
    state,
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
  };
}

describe("HealthPanel", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses Timeline as the default leaf and has no Overview", () => {
    render(<HealthPanel controller={controller()} />);

    expect(screen.getByRole("heading", { name: "Timeline" })).toBeInTheDocument();
    expect(screen.getByText("Bibimbap")).toBeInTheDocument();
    expect(screen.queryByText("Overview")).not.toBeInTheDocument();
  });

  it("keeps timeline and trends loading or error states independent", () => {
    const health = controller({
      ...loadedState,
      timelineStatus: "error",
      timelineError: "Timeline unavailable",
      trendsStatus: "loaded",
    });
    const { rerender } = render(<HealthPanel controller={health} />);

    expect(screen.getByRole("alert")).toHaveTextContent("Timeline unavailable");

    rerender(<HealthPanel controller={health} leafTabId="trends" />);
    expect(screen.getByRole("heading", { name: "Trends" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Bowel Bristol average" }))
      .toBeInTheDocument();
  });

  it("renders every required trend series and a fixed non-causal label", () => {
    render(<HealthPanel controller={controller()} leafTabId="trends" />);

    expect(screen.getByRole("group", { name: "Bowel Bristol average" }))
      .toBeInTheDocument();
    expect(screen.getByText("Headache")).toBeInTheDocument();
    expect(screen.getByText("Vitamin D")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Weight (kg)" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Sleep (hours)" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Fasting glucose (mg/dL)" }))
      .toBeInTheDocument();
    expect(screen.getByText(/descriptive associations, not causal conclusions/i))
      .toBeInTheDocument();
  });

  it("offers explicit pagination and prevents concurrent duplicate page loads", async () => {
    const firstPage: TimelineItem[] = Array.from({ length: 100 }, (_, index) => ({
      kind: "diet",
      record: { ...diet, id: `diet-${index}`, foodName: `Meal ${index}` },
    }));
    let releaseNextPage: ((items: TimelineItem[]) => void) | undefined;
    vi.spyOn(healthApi, "timeline")
      .mockResolvedValueOnce(firstPage)
      .mockImplementationOnce(() => new Promise((resolve) => {
        releaseNextPage = resolve;
      }));
    vi.spyOn(healthApi, "trends").mockResolvedValue(trends);

    const { result } = renderHook(() => useHealthController());
    await waitFor(() => expect(result.current.state.timelineStatus).toBe("loaded"));
    expect(result.current.state.timelineHasMore).toBe(true);

    let firstLoad!: Promise<void>;
    await act(async () => {
      firstLoad = result.current.loadMoreTimeline();
      void result.current.loadMoreTimeline();
      await Promise.resolve();
    });
    expect(healthApi.timeline).toHaveBeenCalledTimes(2);
    await act(async () => {
      releaseNextPage?.([]);
      await firstLoad;
    });
    expect(result.current.state.timelineHasMore).toBe(false);
  });

  it("confirms lifecycle actions and ignores a duplicate click while pending", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    let releaseArchive: (() => void) | undefined;
    const health = controller();
    health.archive = vi.fn(() => new Promise<void>((resolve) => {
      releaseArchive = resolve;
    }));
    render(<HealthPanel controller={health} />);

    const archive = screen.getByRole("button", { name: "Archive Bibimbap" });
    await user.click(archive);
    await user.click(archive);
    expect(health.archive).toHaveBeenCalledTimes(1);
    expect(health.archive).toHaveBeenCalledWith("diet", "diet-1");

    await act(async () => releaseArchive?.());
  });

  it("restores and purges archived records with the exact record confirmation", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const health = controller({
      ...loadedState,
      timeline: [{
        kind: "diet",
        record: { ...diet, deletedAt: "2026-07-30T05:00:00Z" },
      }],
    });
    render(<HealthPanel controller={health} />);

    await user.click(screen.getByRole("button", { name: "Restore Bibimbap" }));
    expect(health.restore).toHaveBeenCalledWith("diet", "diet-1");
    await user.click(screen.getByRole("button", { name: "Purge Bibimbap" }));
    expect(health.purge).toHaveBeenCalledWith("diet", "diet-1", "diet-1");
  });
});
