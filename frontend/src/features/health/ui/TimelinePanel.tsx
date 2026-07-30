"use client";

import React, { useRef, useState } from "react";

import type {
  HealthController,
  HealthRecordKind,
} from "@/features/health/hooks/useHealthController";
import type {
  HealthEvent,
  TimelineItem,
} from "@/features/health/model/health-model";
import { DestructiveConfirmationDialog } from "@/features/workbench/ui/DestructiveConfirmationDialog";

export function TimelinePanel({ controller }: { controller: HealthController }) {
  const { state } = controller;

  return (
    <section aria-labelledby="health-timeline-heading">
      <header className="workspace-table-header">
        <h1 id="health-timeline-heading">Timeline</h1>
      </header>
      {state.timelineStatus === "loading" && state.timeline.length === 0 ? (
        <p role="status" className="items-message">Loading Health Journal…</p>
      ) : state.timelineStatus === "error" && state.timeline.length === 0 ? (
        <>
          <p role="alert" className="items-message">
            {state.timelineError ?? "Health timeline is unavailable"}
          </p>
          <button type="button" onClick={() => void controller.refreshTimeline()}>
            Retry timeline
          </button>
        </>
      ) : (
        <>
          <HealthRecordTable
            controller={controller}
            items={state.timeline}
            emptyMessage="No health records yet."
          />
          {state.timelineError && (
            <p role="alert" className="items-message">{state.timelineError}</p>
          )}
          {state.timelineHasMore && (
            <button type="button" onClick={() => void controller.loadMoreTimeline()}>
              Load more health records
            </button>
          )}
        </>
      )}
    </section>
  );
}

export function HealthRecordTable({
  controller,
  items,
  emptyMessage,
}: {
  controller: HealthController;
  items: TimelineItem[];
  emptyMessage: string;
}) {
  const action = useRecordAction();
  const [purgeTarget, setPurgeTarget] = useState<TimelineItem | null>(null);

  if (items.length === 0) return <p className="items-message">{emptyMessage}</p>;

  return (
    <section className="items-section" aria-label="Health records">
      {action.error && <p role="alert" className="items-message">{action.error}</p>}
      <table className="items-table">
        <thead>
          <tr>
            <th>Occurred</th>
            <th>Category</th>
            <th>Name</th>
            <th>Value</th>
            <th>Note</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const record = item.record;
            const kind: HealthRecordKind =
              item.kind === "diet" ? "diet" : "event";
            const label = recordLabel(item);
            const archived = record.deletedAt !== null;
            const recordKey = `${kind}:${record.id}`;
            const actionContext = `${label}, ${formatDateTime(record.occurredAt)} (${record.id})`;
            return (
              <tr key={`${item.kind}:${record.id}`}>
                <td>{formatDateTime(record.occurredAt)}</td>
                <td>{item.kind === "diet" ? "diet" : item.record.category}</td>
                <td>{label}</td>
                <td>{recordValue(item)}</td>
                <td>{record.note ?? "—"}</td>
                <td>{archived ? "Archived" : "Active"}</td>
                <td>
                  {archived ? (
                    <>
                      <button
                        type="button"
                        aria-label={`Restore ${actionContext}`}
                        disabled={action.isPending(recordKey)}
                        onClick={() => {
                          if (window.confirm(`Restore ${label}?`)) {
                            void action.run(
                              recordKey,
                              () => controller.restore(kind, record.id),
                            );
                          }
                        }}
                      >
                        Restore {label}
                      </button>
                      <button
                        type="button"
                        aria-label={`Purge ${actionContext}`}
                        disabled={action.isPending(recordKey)}
                        onClick={() => setPurgeTarget(item)}
                      >
                        Purge {label}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      aria-label={`Archive ${actionContext}`}
                      disabled={action.isPending(recordKey)}
                      onClick={() => {
                        if (window.confirm(`Archive ${label}?`)) {
                          void action.run(
                            recordKey,
                            () => controller.archive(kind, record.id),
                          );
                        }
                      }}
                    >
                      Archive {label}
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {purgeTarget ? (
        <DestructiveConfirmationDialog
          title={`Permanently purge ${recordLabel(purgeTarget)}?`}
          description="This health record will be permanently removed. This cannot be undone."
          onCancel={() => setPurgeTarget(null)}
          onConfirm={() => {
            const target = purgeTarget;
            const kind: HealthRecordKind =
              target.kind === "diet" ? "diet" : "event";
            setPurgeTarget(null);
            void action.run(
              `${kind}:${target.record.id}`,
              () => controller.purge(kind, target.record.id, target.record.id),
            );
          }}
        />
      ) : null}
    </section>
  );
}

export function HealthCollectionStatus({
  controller,
  label,
}: {
  controller: HealthController;
  label: string;
}) {
  const { state } = controller;
  if (state.timelineStatus === "loading" && state.timeline.length === 0) {
    return <p role="status" className="items-message">Loading {label}…</p>;
  }
  if (state.timelineStatus === "error") {
    return (
      <>
        <p role="alert" className="items-message">{state.timelineError}</p>
        <button type="button" onClick={() => void controller.refreshTimeline()}>
          Retry {label}
        </button>
      </>
    );
  }
  return (
    <>
      {state.timelineError && (
        <p role="alert" className="items-message">{state.timelineError}</p>
      )}
      {state.timelineHasMore && (
        <button type="button" onClick={() => void controller.loadMoreTimeline()}>
          Load more {label}
        </button>
      )}
    </>
  );
}

function useRecordAction() {
  const active = useRef(new Set<string>());
  const [pending, setPending] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);

  async function run(key: string, operation: () => Promise<void>) {
    if (active.current.has(key)) return;
    active.current.add(key);
    setPending(new Set(active.current));
    setError(null);
    try {
      await operation();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Health action failed");
    } finally {
      active.current.delete(key);
      setPending(new Set(active.current));
    }
  }

  return { error, isPending: (key: string) => pending.has(key), run };
}

function recordLabel(item: TimelineItem): string {
  return item.kind === "diet" ? item.record.foodName : item.record.name;
}

function recordValue(item: TimelineItem): string {
  if (item.kind === "diet") {
    const tags = item.record.tags.length ? ` · ${item.record.tags.join(", ")}` : "";
    return `${item.record.mealType.replaceAll("_", " ")}${tags}`;
  }
  return eventValue(item.record);
}

function eventValue(event: HealthEvent): string {
  if (event.attributes.kind === "bowel") {
    return `Bristol ${event.attributes.bristolScale}${
      event.attributes.bloodVisible ? " · blood visible" : ""
    }`;
  }
  if (event.value === null) return "—";
  return `${event.value}${event.unit ? ` ${event.unit}` : ""}`;
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
