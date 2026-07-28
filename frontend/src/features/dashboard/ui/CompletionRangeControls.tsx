import React from "react";

import type { DashboardDateRange } from "@/features/dashboard/model/dashboard-model";

type CompletionRangeControlsProps = {
  today: string;
  appliedRange: DashboardDateRange;
  draftRange: DashboardDateRange;
  selectedPreset: 7 | 14 | 30 | "custom";
  error: string | null;
  onPresetSelect: (preset: 7 | 14 | 30) => void;
  onDraftChange: (field: "start" | "end", value: string) => void;
  onCustomApply: () => void;
};

const completionPresets = [7, 14, 30] as const;

export function CompletionRangeControls({
  today,
  appliedRange,
  draftRange,
  selectedPreset,
  error,
  onPresetSelect,
  onDraftChange,
  onCustomApply,
}: CompletionRangeControlsProps) {
  const [customOpen, setCustomOpen] = React.useState(
    selectedPreset === "custom",
  );

  return (
    <form
      className="dashboard-range-controls"
      aria-label={
        `Completion range ${appliedRange.start} to ${appliedRange.end}`
      }
      onSubmit={(event) => {
        event.preventDefault();
        onCustomApply();
      }}
    >
      <div className="dashboard-range-presets">
        {completionPresets.map((preset) => (
          <button
            type="button"
            aria-pressed={selectedPreset === preset}
            onClick={() => {
              setCustomOpen(false);
              onPresetSelect(preset);
            }}
            key={preset}
          >
            {preset} days
          </button>
        ))}
        <button
          type="button"
          aria-expanded={customOpen}
          aria-pressed={selectedPreset === "custom"}
          onClick={() => setCustomOpen((current) => !current)}
        >
          Custom range
        </button>
      </div>
      {customOpen ? (
        <div className="dashboard-range-custom">
          <label>
            <span>Start</span>
            <input
              type="date"
              max={today}
              aria-label="Completion start date"
              value={draftRange.start}
              onChange={(event) =>
                onDraftChange("start", event.currentTarget.value)}
            />
          </label>
          <label>
            <span>End</span>
            <input
              type="date"
              max={today}
              aria-label="Completion end date"
              value={draftRange.end}
              onChange={(event) =>
                onDraftChange("end", event.currentTarget.value)}
            />
          </label>
          <button
            type="submit"
            aria-label="Apply completion range"
          >
            Apply
          </button>
        </div>
      ) : null}
      {error ? (
        <p className="dashboard-range-error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
