import React from "react";
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { defaultPlannerGroupSettings } from "@/features/workbench/model/planner-group-settings";
import { PlannerGroupPanel } from "@/features/workbench/ui/PlannerGroupPanel";

function renderPanel(overrides = {}) {
  const onManualOrderChange = vi.fn();
  render(<PlannerGroupPanel
    settings={{ ...defaultPlannerGroupSettings(), groupBy: "tag", manualOrder: ["focus", "ops"], ...overrides }}
    candidates={[{ key: "focus", label: "Focus", count: 2 }, { key: "ops", label: "Ops", count: 1 }, { key: "empty", label: "Empty", count: 0 }]}
    groupOptions={[{ value: "none", label: "None" }, { value: "tag", label: "Tag" }]}
    onGroupByChange={vi.fn()} onSortChange={vi.fn()} onHideEmptyChange={vi.fn()}
    onVisibilityToggle={vi.fn()} onAllVisibilityChange={vi.fn()}
    onManualOrderChange={onManualOrderChange} onRemove={vi.fn()} onClose={vi.fn()}
  />);
  return { onManualOrderChange };
}

describe("PlannerGroupPanel", () => {
  it("uses compact root rows and dedicated property and sort pages", async () => {
    const user = userEvent.setup();
    renderPanel();
    expect(screen.getByRole("heading", { name: "Group" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Tag" })).toBeNull();
    await user.click(screen.getByRole("button", { name: /Group by/ }));
    expect(screen.getByRole("heading", { name: "Group by" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Tag" })).toBeInTheDocument();
  });

  it("reorders manual groups with keyboard buttons and native drag and drop", async () => {
    const user = userEvent.setup();
    const { onManualOrderChange } = renderPanel();
    await user.click(screen.getByRole("button", { name: "Move Ops up" }));
    expect(onManualOrderChange).toHaveBeenLastCalledWith(["ops", "focus"]);

    const rows = screen.getAllByRole("listitem");
    const handles = screen.getAllByRole("button", { name: /Drag .* group/ });
    const dataTransfer = {
      effectAllowed: "none",
      dropEffect: "none",
      setData: vi.fn(),
    };
    expect(rows[1]).not.toHaveAttribute("draggable", "true");
    expect(handles[1]).toHaveAttribute("draggable", "true");
    fireEvent.dragStart(handles[1]!, { dataTransfer });
    expect(dataTransfer.setData).toHaveBeenCalledWith("text/plain", "ops");
    expect(dataTransfer.effectAllowed).toBe("move");
    fireEvent.dragOver(rows[0]!, { dataTransfer });
    fireEvent.drop(rows[0]!, { dataTransfer });
    expect(dataTransfer.dropEffect).toBe("move");
    expect(onManualOrderChange).toHaveBeenLastCalledWith(["ops", "focus"]);
  });

  it("shows only the relevant bulk action and excludes empty management rows", () => {
    renderPanel();
    expect(screen.getByRole("button", { name: "Hide all" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show all" })).toBeNull();
    expect(screen.queryByText("Empty")).toBeNull();
  });
});
