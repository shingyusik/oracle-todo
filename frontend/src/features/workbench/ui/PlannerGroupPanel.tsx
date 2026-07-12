"use client";

import React from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  ChevronRight,
  Eye,
  EyeOff,
  GripVertical,
  Trash2,
  X,
} from "lucide-react";

import {
  plannerGroupManagementCandidates,
  type PlannerGroupCandidate,
  type PlannerGroupSettings,
  type PlannerGroupSort,
} from "@/features/workbench/model/planner-group-settings";
import type { PlannerGroupBy } from "@/features/workbench/model/planner-model";

type Option<T extends string> = { value: T; label: string };

export function PlannerGroupPanel({
  settings,
  candidates,
  groupOptions,
  onGroupByChange,
  onSortChange,
  onHideEmptyChange,
  onVisibilityToggle,
  onAllVisibilityChange,
  onManualOrderChange,
  onRemove,
  onClose,
}: {
  settings: PlannerGroupSettings;
  candidates: PlannerGroupCandidate[];
  groupOptions: Option<PlannerGroupBy>[];
  onGroupByChange: (value: PlannerGroupBy) => void;
  onSortChange: (value: PlannerGroupSort) => void;
  onHideEmptyChange: (value: boolean) => void;
  onVisibilityToggle: (key: string) => void;
  onAllVisibilityChange: (keys: string[], visible: boolean) => void;
  onManualOrderChange: (keys: string[]) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const [page, setPage] = React.useState<"root" | "property" | "sort">("root");
  const [draggedKey, setDraggedKey] = React.useState<string | null>(null);
  const groups = plannerGroupManagementCandidates(candidates, settings);
  const keys = groups.map(({ key }) => key);
  const allHidden = keys.length > 0 && keys.every((key) => settings.hiddenGroupKeys.includes(key));
  const propertyLabel = groupOptions.find(({ value }) => value === settings.groupBy)?.label ?? "None";
  const sortOptions: Option<PlannerGroupSort>[] = [
    { value: "manual", label: "Manual" },
    { value: "alphabetical", label: "Alphabetical" },
    { value: "reverse_alphabetical", label: "Reverse alphabetical" },
  ];

  function move(key: string, direction: -1 | 1) {
    const current = keys;
    const index = current.indexOf(key);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= current.length) return;
    const next = [...current];
    [next[index], next[target]] = [next[target]!, next[index]!];
    onManualOrderChange(next);
  }

  function dropBefore(targetKey: string) {
    if (!draggedKey || draggedKey === targetKey) return;
    const next = keys.filter((key) => key !== draggedKey);
    next.splice(next.indexOf(targetKey), 0, draggedKey);
    onManualOrderChange(next);
    setDraggedKey(null);
  }

  const title = page === "property" ? "Group by" : page === "sort" ? "Sort" : "Group";
  return (
    <div className="planner-group-settings-panel" role="dialog" aria-label="Group settings">
      <header className="planner-group-header">
        <button type="button" aria-label="Back" onClick={() => page === "root" ? onClose() : setPage("root")}>
          <ArrowLeft size={19} aria-hidden="true" />
        </button>
        <h2>{title}</h2>
        <button type="button" aria-label="Close group settings" onClick={onClose}>
          <X size={19} aria-hidden="true" />
        </button>
      </header>

      {page === "property" ? (
        <div className="planner-group-choice-list" role="listbox" aria-label="Choose group property">
          {groupOptions.map((option) => (
            <button key={option.value} type="button" role="option" aria-selected={option.value === settings.groupBy} onClick={() => { onGroupByChange(option.value); setPage("root"); }}>
              <span>{option.label}</span>{option.value === settings.groupBy ? <Check size={18} aria-hidden="true" /> : null}
            </button>
          ))}
        </div>
      ) : page === "sort" ? (
        <div className="planner-group-choice-list" role="listbox" aria-label="Choose group sort">
          {sortOptions.map((option) => (
            <button key={option.value} type="button" role="option" aria-selected={option.value === settings.sort} onClick={() => { onSortChange(option.value); setPage("root"); }}>
              <span>{option.label}</span>{option.value === settings.sort ? <Check size={18} aria-hidden="true" /> : null}
            </button>
          ))}
        </div>
      ) : (
        <>
          <div className="planner-group-setting-rows">
            <button type="button" onClick={() => setPage("property")}><span>Group by</span><span>{propertyLabel}<ChevronRight size={18} aria-hidden="true" /></span></button>
            <button type="button" onClick={() => setPage("sort")}><span>Sort</span><span>{sortOptions.find(({ value }) => value === settings.sort)?.label}<ChevronRight size={18} aria-hidden="true" /></span></button>
            <label><span>Hide empty groups</span><input type="checkbox" role="switch" checked={settings.hideEmpty} onChange={(event) => onHideEmptyChange(event.target.checked)} /></label>
          </div>
          {settings.groupBy !== "none" ? (
            <section className="planner-group-list-section" aria-labelledby="planner-groups-heading">
              <div className="planner-group-list-heading"><h3 id="planner-groups-heading">Groups</h3>{keys.length > 0 ? <button type="button" onClick={() => onAllVisibilityChange(keys, allHidden)}>{allHidden ? "Show all" : "Hide all"}</button> : null}</div>
              <div className="planner-group-row-list" role="list" aria-label="Groups">
                {groups.map((candidate, index) => {
                  const hidden = settings.hiddenGroupKeys.includes(candidate.key);
                  return (
                    <div key={candidate.key} className="planner-group-row" role="listitem" draggable={settings.sort === "manual"} onDragStart={() => setDraggedKey(candidate.key)} onDragOver={(event) => event.preventDefault()} onDrop={() => dropBefore(candidate.key)}>
                      <GripVertical className="planner-group-drag-handle" size={18} aria-hidden="true" />
                      <span className="planner-group-name">{candidate.label}</span>
                      <span className="planner-group-count">{candidate.count}</span>
                      {settings.sort === "manual" ? <span className="planner-group-keyboard-moves"><button type="button" aria-label={`Move ${candidate.label} up`} disabled={index === 0} onClick={() => move(candidate.key, -1)}><ArrowUp size={15} aria-hidden="true" /></button><button type="button" aria-label={`Move ${candidate.label} down`} disabled={index === groups.length - 1} onClick={() => move(candidate.key, 1)}><ArrowDown size={15} aria-hidden="true" /></button></span> : null}
                      <button type="button" className="planner-group-eye" aria-label={`${hidden ? "Show" : "Hide"} ${candidate.label}`} onClick={() => onVisibilityToggle(candidate.key)}>{hidden ? <EyeOff size={19} aria-hidden="true" /> : <Eye size={19} aria-hidden="true" />}</button>
                    </div>
                  );
                })}
              </div>
            </section>
          ) : null}
          <button type="button" className="planner-group-remove" disabled={settings.groupBy === "none"} onClick={onRemove}><Trash2 size={18} aria-hidden="true" />Remove grouping</button>
        </>
      )}
    </div>
  );
}
