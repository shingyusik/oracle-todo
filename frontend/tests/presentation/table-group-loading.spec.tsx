import React from "react";
import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { defaultPlannerGroupSettings, type PlannerGroupCandidate } from "@/features/workbench/model/planner-group-settings";
import type { PlannerTableSettings } from "@/features/workbench/model/planner-model";
import { TableViewControls, type TableViewControlsAdapter } from "@/features/workbench/ui/TableViewControls";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function Harness({ load, context = "workspace", seeds = [], manualOrder = ["hidden", "focus"], generation = 1 }: {
  load: (settings: PlannerTableSettings) => Promise<PlannerGroupCandidate[]>;
  context?: string;
  seeds?: PlannerGroupCandidate[];
  manualOrder?: string[];
  generation?: number;
}) {
  const [settings, update] = React.useState<PlannerTableSettings>({
    filterMode: "and", filterRules: [], sortRules: [],
    groupSettings: { ...defaultPlannerGroupSettings(), groupBy: "tag", hideEmpty: false,
      manualOrder, hiddenGroupKeys: ["hidden"] },
  });
  const adapter: TableViewControlsAdapter = {
    scopeId: "workspace.task", title: "Tasks", settings, filterFields: [], sortFields: [],
    groupOptions: [{ value: "none", label: "None" }, { value: "tag", label: "Tag" }, { value: "status", label: "Status" }],
    candidates: seeds, filterOptions: { tags: [], daily: { tags: [], areas: [], projects: [], currencies: [], routines: [], statuses: [], priorities: [], horizons: [], parents: [], materializationPolicies: [], participants: [] } },
    dropdownIdPrefix: "test", isDefaultSort: () => true, update,
    loadGroupCandidates: () => load(settings), groupCandidatesKey: JSON.stringify({ context, generation }),
  };
  return <TableViewControls adapter={adapter} />;
}

describe("compact group loading", () => {
  it("opens immediately and stays closed when a pending request finishes", async () => {
    const pending = deferred<PlannerGroupCandidate[]>();
    const load = vi.fn(() => pending.promise);
    render(<Harness load={load} />);
    const trigger = screen.getByRole("button", { name: "Group Tasks" });
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "Group Tasks" })).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("Loading groups");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(trigger).not.toHaveAttribute("disabled");
    fireEvent.click(trigger);
    await act(async () => pending.resolve([{ key: "focus", label: "Focus", count: 250 }]));
    expect(screen.queryByRole("dialog", { name: "Group Tasks" })).toBeNull();
    expect(load).toHaveBeenCalledOnce();
  });

  it("keeps group controls usable, ignores stale results, and reloads changed context", async () => {
    const first = deferred<PlannerGroupCandidate[]>();
    const second = deferred<PlannerGroupCandidate[]>();
    const load = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
      .mockResolvedValue([{ key: "completed", label: "Completed", count: 300 }]);
    const { rerender } = render(<Harness load={load} />);
    fireEvent.click(screen.getByRole("button", { name: "Group Tasks" }));
    await waitFor(() => expect(load).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: "Choose group property" }));
    fireEvent.click(screen.getByRole("option", { name: "Status" }));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    await act(async () => first.resolve([{ key: "old", label: "Old tag", count: 1000 }]));
    expect(screen.queryByText("Old tag")).toBeNull();
    await act(async () => second.resolve([{ key: "active", label: "Active", count: 200 }]));
    expect(screen.getByText("Active")).toBeVisible();
    rerender(<Harness load={load} context="linked.parent-2" />);
    await waitFor(() => expect(screen.getByText("Completed")).toBeVisible());
    expect(screen.queryByText("Active")).toBeNull();
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("refreshes counts for a new table generation and ignores the prior generation response", async () => {
    const first = deferred<PlannerGroupCandidate[]>();
    const second = deferred<PlannerGroupCandidate[]>();
    const load = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { rerender } = render(<Harness load={load} generation={1} />);
    fireEvent.click(screen.getByRole("button", { name: "Group Tasks" }));
    await waitFor(() => expect(load).toHaveBeenCalledOnce());
    rerender(<Harness load={load} generation={2} />);
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    await act(async () => second.resolve([{ key: "focus", label: "Focus", count: 250 }]));
    expect(screen.getByText("250")).toBeVisible();
    await act(async () => first.resolve([{ key: "focus", label: "Focus", count: 100 }]));
    expect(screen.queryByText("100")).toBeNull();
    expect(screen.getByText("250")).toBeVisible();
  });

  it("orders literal reserved tags by label and leaves the synthetic Untagged group last", async () => {
    const load = vi.fn().mockResolvedValue([
      { key: "\\756e746167676564", label: "untagged", count: 2 },
      { key: "focus", label: "focus", count: 100 },
      { key: "untagged", label: "Untagged", count: 4 },
    ]);
    render(<Harness load={load} manualOrder={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Group Tasks" }));
    await screen.findByText("focus");
    const rows = within(screen.getByRole("list", { name: "Groups" })).getAllByRole("listitem");
    expect(rows.map((row) => row.querySelector(".planner-group-name")?.textContent)).toEqual(["focus", "untagged", "Untagged"]);
  });

  it("keeps fixed empty group order and server counts with hidden candidates", async () => {
    const load = vi.fn().mockResolvedValue([{ key: "completed", label: "Completed", count: 250 },
      { key: "active", label: "Active", count: 100 }]);
    render(<Harness load={load} seeds={[{ key: "active", label: "Active", count: 0 },
      { key: "paused", label: "Paused", count: 0 }, { key: "completed", label: "Completed", count: 0 }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Group Tasks" }));
    fireEvent.click(screen.getByRole("button", { name: "Choose group property" }));
    fireEvent.click(screen.getByRole("option", { name: "Status" }));
    await screen.findByText("Completed");
    const rows = within(screen.getByRole("list", { name: "Groups" })).getAllByRole("listitem");
    expect(rows.map((row) => row.querySelector(".planner-group-name")?.textContent)).toEqual(["Active", "Paused", "Completed"]);
    expect(rows.map((row) => row.querySelector(".planner-group-count")?.textContent)).toEqual(["100", "0", "250"]);
  });

  it("shows safe failure with retry and preserves full counts, empty and hidden groups, manual order", async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error("raw database secret path"))
      .mockResolvedValue([{ key: "focus", label: "Focus", count: 250 }, { key: "hidden", label: "Hidden", count: 70 }]);
    render(<Harness load={load} seeds={[{ key: "empty", label: "Empty relation", count: 0 }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Group Tasks" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load groups.");
    expect(screen.queryByText(/raw database secret path/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry groups" }));
    await screen.findByText("Focus");
    const rows = within(screen.getByRole("list", { name: "Groups" })).getAllByRole("listitem");
    expect(rows.map((row) => row.querySelector(".planner-group-name")?.textContent))
      .toEqual(["Hidden", "Focus", "Empty relation"]);
    expect(rows.map((row) => row.querySelector(".planner-group-count")?.textContent)).toEqual(["70", "250", "0"]);
    expect(screen.getByRole("button", { name: "Show Hidden" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Hide all" }));
    expect(load).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "Show all" })).toBeVisible();
  });
});
