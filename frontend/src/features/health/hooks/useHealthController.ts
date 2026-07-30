"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  healthApi,
  type DailyMetricInput,
} from "@/features/health/api/health-api";
import type {
  DietInput,
  EventInput,
  HealthTrends,
  TimelineItem,
} from "@/features/health/model/health-model";

type LoadStatus = "idle" | "loading" | "loaded" | "error";
export type HealthRecordKind = "diet" | "event";

export type HealthState = {
  timelineStatus: LoadStatus;
  timelineError: string | null;
  timeline: TimelineItem[];
  timelineHasMore: boolean;
  trendsStatus: LoadStatus;
  trendsError: string | null;
  trends: HealthTrends | null;
};

export type HealthController = {
  state: HealthState;
  refreshTimeline(): Promise<void>;
  loadMoreTimeline(): Promise<void>;
  refreshTrends(days?: number): Promise<void>;
  createDiet(input: DietInput, image?: Blob): Promise<void>;
  createBowel(input: EventInput): Promise<void>;
  createMedication(input: EventInput): Promise<void>;
  upsertMetrics(input: DailyMetricInput[]): Promise<void>;
  archive(kind: HealthRecordKind, id: string): Promise<void>;
  restore(kind: HealthRecordKind, id: string): Promise<void>;
  purge(kind: HealthRecordKind, id: string, confirmation: string): Promise<void>;
};

const PAGE_SIZE = 100;
const initialState: HealthState = {
  timelineStatus: "idle",
  timelineError: null,
  timeline: [],
  timelineHasMore: false,
  trendsStatus: "idle",
  trendsError: null,
  trends: null,
};

export function useHealthController(): HealthController {
  const [state, setState] = useState(initialState);
  const loadingPage = useRef(false);
  const timelineGeneration = useRef(0);
  const trendsGeneration = useRef(0);
  const timelineOffset = state.timeline.length;

  const refreshTimeline = useCallback(async () => {
    const generation = ++timelineGeneration.current;
    setState((current) => ({
      ...current,
      timelineStatus: "loading",
      timelineError: null,
    }));
    try {
      const timeline = await healthApi.timeline({
        includeArchived: true,
        limit: PAGE_SIZE,
        offset: 0,
      });
      if (generation !== timelineGeneration.current) return;
      setState((current) => ({
        ...current,
        timelineStatus: "loaded",
        timelineError: null,
        timeline,
        timelineHasMore: timeline.length === PAGE_SIZE,
      }));
    } catch (error) {
      if (generation !== timelineGeneration.current) return;
      setState((current) => ({
        ...current,
        timelineStatus: current.timeline.length === 0 ? "error" : "loaded",
        timelineError: errorMessage(error, "Health timeline request failed"),
      }));
    }
  }, []);

  const refreshTrends = useCallback(async (days = 30) => {
    const generation = ++trendsGeneration.current;
    setState((current) => ({
      ...current,
      trendsStatus: "loading",
      trendsError: null,
    }));
    try {
      const trends = await healthApi.trends(days);
      if (generation !== trendsGeneration.current) return;
      setState((current) => ({
        ...current,
        trendsStatus: "loaded",
        trendsError: null,
        trends,
      }));
    } catch (error) {
      if (generation !== trendsGeneration.current) return;
      setState((current) => ({
        ...current,
        trendsStatus: "error",
        trendsError: errorMessage(error, "Health trends request failed"),
      }));
    }
  }, []);

  useEffect(() => {
    void refreshTimeline();
    void refreshTrends();
  }, [refreshTimeline, refreshTrends]);

  const loadMoreTimeline = useCallback(async () => {
    if (loadingPage.current) return;
    loadingPage.current = true;
    const generation = timelineGeneration.current;
    setState((current) => ({ ...current, timelineError: null }));
    try {
      const page = await healthApi.timeline({
        includeArchived: true,
        limit: PAGE_SIZE,
        offset: timelineOffset,
      });
      if (generation !== timelineGeneration.current) return;
      setState((current) => ({
        ...current,
        timeline: appendUnique(current.timeline, page),
        timelineHasMore: page.length === PAGE_SIZE,
      }));
    } catch (error) {
      if (generation !== timelineGeneration.current) return;
      setState((current) => ({
        ...current,
        timelineError: errorMessage(error, "More health records could not be loaded"),
      }));
    } finally {
      loadingPage.current = false;
    }
  }, [timelineOffset]);

  const refreshAfterMutation = useCallback(async () => {
    await Promise.all([refreshTimeline(), refreshTrends()]);
  }, [refreshTimeline, refreshTrends]);

  async function mutate(operation: () => Promise<unknown>) {
    await operation();
    await refreshAfterMutation();
  }

  return {
    state,
    refreshTimeline,
    loadMoreTimeline,
    refreshTrends,
    createDiet: (input, image) =>
      mutate(() => image
        ? healthApi.createDietWithImage({ image, metadata: input })
        : healthApi.createDiet(input)),
    createBowel: (input) => mutate(() => healthApi.createEvent(input)),
    createMedication: (input) => mutate(() => healthApi.createEvent(input)),
    upsertMetrics: (input) => mutate(() => healthApi.upsertDailyMetrics(input)),
    archive: (kind, id) => mutate(() =>
      kind === "diet" ? healthApi.archiveDiet(id) : healthApi.archiveEvent(id)),
    restore: (kind, id) => mutate(() =>
      kind === "diet" ? healthApi.restoreDiet(id) : healthApi.restoreEvent(id)),
    purge: (kind, id, confirmation) => mutate(() =>
      kind === "diet"
        ? healthApi.purgeDiet(id, confirmation)
        : healthApi.purgeEvent(id, confirmation)),
  };
}

function appendUnique(
  current: TimelineItem[],
  page: TimelineItem[],
): TimelineItem[] {
  const ids = new Set(current.map(timelineKey));
  return current.concat(page.filter((item) => !ids.has(timelineKey(item))));
}

function timelineKey(item: TimelineItem): string {
  return `${item.kind}:${item.record.id}`;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
