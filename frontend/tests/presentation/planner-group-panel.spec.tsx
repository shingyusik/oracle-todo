import React from "react";
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  defaultPlannerGroupSettings,
  type PlannerGroupSettings,
} from "@/features/workbench/model/planner-group-settings";
import { PlannerGroupPanel } from "@/features/workbench/ui/PlannerGroupPanel";

type PanelProps = React.ComponentProps<typeof PlannerGroupPanel>;

function renderPanel(overrides: Partial<PanelProps> = {}) {
  const onManualOrderChange = vi.fn();
  const props: PanelProps = {
    settings: {
      ...defaultPlannerGroupSettings(),
      groupBy: "tag",
      manualOrder: ["focus", "ops"],
    } as PlannerGroupSettings,
    candidates: [{ key: "focus", label: "Focus", count: 2 }, { key: "ops", label: "Ops", count: 1 }, { key: "empty", label: "Empty", count: 0 }],
    groupOptions: [{ value: "none", label: "None" }, { value: "tag", label: "Tag" }],
    onGroupByChange: vi.fn(),
    onSortChange: vi.fn(),
    onHideEmptyChange: vi.fn(),
    onVisibilityToggle: vi.fn(),
    onAllVisibilityChange: vi.fn(),
    onManualOrderChange,
    onRemove: vi.fn(),
    onRequestOuterClose: vi.fn(),
    ...overrides,
  };
  render(<PlannerGroupPanel
    {...props}
  />);
  return { onManualOrderChange };
}

describe("PlannerGroupPanel", () => {
  it("opens property and sort choices inline one at a time", async () => {
    const user = userEvent.setup();
    renderPanel();

    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Close group settings" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Choose group property" }));
    expect(screen.getByRole("listbox", { name: "Choose group property" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Choose group sort" }));
    expect(screen.queryByRole("listbox", { name: "Choose group property" })).not.toBeInTheDocument();
    expect(screen.getByRole("listbox", { name: "Choose group sort" })).toBeVisible();
  });

  it("selects an inline option without closing the group content", async () => {
    const user = userEvent.setup();
    const onGroupByChange = vi.fn();
    renderPanel({ onGroupByChange });

    await user.click(screen.getByRole("button", { name: "Choose group property" }));
    await user.click(screen.getByRole("option", { name: "Tag" }));

    expect(onGroupByChange).toHaveBeenCalledWith("tag");
    expect(screen.queryByRole("listbox", { name: "Choose group property" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose group sort" })).toBeVisible();
  });

  it("closes an inline selector before requesting outer dismissal", async () => {
    const user = userEvent.setup();
    const onRequestOuterClose = vi.fn();
    renderPanel({ onRequestOuterClose });

    await user.click(screen.getByRole("button", { name: "Choose group sort" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox", { name: "Choose group sort" })).not.toBeInTheDocument();
    expect(onRequestOuterClose).not.toHaveBeenCalled();

    await user.keyboard("{Escape}");
    expect(onRequestOuterClose).toHaveBeenCalledTimes(1);
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
