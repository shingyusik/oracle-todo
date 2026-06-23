import "@testing-library/jest-dom/vitest";

import { render, screen, waitFor } from "@testing-library/react";
import React from "react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WorkbenchPageClient } from "@/features/workbench/ui/WorkbenchPageClient";

describe("WorkbenchPageClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the Merovingian logo image", () => {
    render(<WorkbenchPageClient />);

    expect(
      screen.getByRole("img", { name: "Merovingian" }),
    ).toHaveAttribute("src", "/merovingian-mark.png");
    expect(screen.getByText("MEROVINGIAN")).toBeInTheDocument();
    expect(
      screen.getByText("CONTROL. ANALYZE. OPTIMIZE."),
    ).toBeInTheDocument();
  });

  it("renders workspace and planner as todo sub navigation items", async () => {
    const user = userEvent.setup();
    render(<WorkbenchPageClient />);

    expect(
      screen.getByRole("button", { name: "Dashboard" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ToDo" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Workspace" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Areas" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "ToDo" }));

    expect(screen.getByRole("button", { name: "Workspace" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.getByRole("button", { name: "Planner" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.queryByRole("button", { name: "Areas" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Yearly" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Workspace" }));

    expect(screen.getByRole("heading", { name: "Areas" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Workspace" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByRole("button", { name: "Areas" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Planner" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Yearly" })).toBeNull();
  });

  it("shows only workspace and planner children when todo is selected", async () => {
    const user = userEvent.setup();
    render(<WorkbenchPageClient />);

    expect(screen.queryByRole("button", { name: "Areas" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "ToDo" }));

    expect(screen.getByRole("heading", { name: "ToDo" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Workspace" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Planner" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Areas" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Yearly" })).toBeNull();
  });

  it("marks todo group tabs as parent navigation", async () => {
    const user = userEvent.setup();
    render(<WorkbenchPageClient />);

    await user.click(screen.getByRole("button", { name: "ToDo" }));

    const workspaceTab = screen.getByRole("button", { name: "Workspace" });
    expect(workspaceTab).toContainElement(
      workspaceTab.querySelector(".sub-sidebar-parent-icon"),
    );
    expect(workspaceTab).toHaveClass("sub-sidebar-tab-parent");
  });

  it("opens planner children from the planner sibling tab", async () => {
    const user = userEvent.setup();
    render(<WorkbenchPageClient />);

    await user.click(screen.getByRole("button", { name: "ToDo" }));

    expect(screen.getByRole("button", { name: "Planner" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Areas" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Yearly" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Planner" }));

    expect(
      screen.getByRole("heading", { name: "Yearly" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Yearly" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Areas" })).toBeNull();
  });

  it("keeps workspace and planner sibling branches open together", async () => {
    const user = userEvent.setup();
    render(<WorkbenchPageClient />);

    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    expect(screen.getByRole("button", { name: "Areas" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Planner" }));
    expect(screen.getByRole("button", { name: "Yearly" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Areas" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Workspace" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByRole("button", { name: "Planner" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("collapses workspace and planner when their expanded buttons are clicked again", async () => {
    const user = userEvent.setup();
    render(<WorkbenchPageClient />);

    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));

    expect(screen.getByRole("button", { name: "Areas" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Yearly" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Workspace" }));
    expect(screen.queryByRole("button", { name: "Areas" })).toBeNull();
    expect(screen.getByRole("button", { name: "Yearly" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Planner" }));
    expect(screen.queryByRole("button", { name: "Yearly" })).toBeNull();
    expect(screen.getByRole("heading", { name: "ToDo" })).toBeInTheDocument();
  });

  it("changes the main panel when a tab is clicked", async () => {
    const user = userEvent.setup();
    render(<WorkbenchPageClient />);

    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Projects" }));

    expect(
      screen.getByRole("heading", { name: "Projects" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Outcome pipeline")).toBeInTheDocument();
  });

  it("loads selected workspace items from todo-engine into a table", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          id: "area-1",
          type: "area",
          title: "Health",
          status: "active",
          review_cycle: "weekly",
          standard: "Move daily",
          note: "Morning review",
          created_at: "2026-06-21T00:00:00Z",
          updated_at: "2026-06-21T00:00:00Z",
        },
      ],
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/todo-engine/items?type=area"),
    );
    expect(screen.getByRole("table", { name: "Areas items" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Health" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "active" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "weekly" })).toBeInTheDocument();
    expect(
      screen.getByRole("cell", { name: "Morning review" }),
    ).toBeInTheDocument();
  });

  it("shows linked workspace item titles in item-specific columns", async () => {
    const user = userEvent.setup();
    const responses: Record<string, unknown[]> = {
      "/todo-engine/items?type=area": [
        {
          id: "area-1",
          type: "area",
          title: "Health",
          status: "active",
          updated_at: "2026-06-21T00:00:00Z",
        },
      ],
      "/todo-engine/items?type=project": [
        {
          id: "project-1",
          type: "project",
          title: "Recovery Plan",
          status: "active",
          area_id: "area-1",
          definition_of_done: "Walk without pain",
          note: "Check weekly",
          updated_at: "2026-06-21T00:00:00Z",
        },
      ],
      "/todo-engine/items?type=routine": [
        {
          id: "routine-1",
          type: "routine",
          title: "Stretch",
          status: "active",
          area_id: "area-1",
          recurrence_rule: "daily",
          materialization_policy: "single_open",
          note: "After coffee",
          last_materialized_at: "2026-06-21T07:00:00Z",
          updated_at: "2026-06-21T00:00:00Z",
        },
      ],
      "/todo-engine/items?type=task": [
        {
          id: "task-1",
          type: "task",
          title: "Book physio",
          status: "approved",
          area_id: "area-1",
          project_id: "project-1",
          routine_id: "routine-1",
          note: "Call before noon",
          updated_at: "2026-06-21T00:00:00Z",
        },
      ],
    };
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve({
        ok: true,
        json: async () => responses[url] ?? [],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Projects" }));

    await waitFor(() =>
      expect(screen.getByRole("cell", { name: "Health" })).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("cell", { name: "Walk without pain" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Check weekly" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Tasks" }));

    await waitFor(() =>
      expect(
        screen.getByRole("cell", { name: "Recovery Plan" }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByRole("cell", { name: "Health" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Stretch" })).toBeInTheDocument();
    expect(
      screen.getByRole("cell", { name: "Call before noon" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Routines" }));

    await waitFor(() =>
      expect(screen.getByRole("cell", { name: "daily" })).toBeInTheDocument(),
    );
    expect(screen.getByRole("cell", { name: "Health" })).toBeInTheDocument();
    expect(
      screen.getByRole("cell", { name: "single_open" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "After coffee" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "2026-06-21" })).toBeInTheDocument();
  });

  it("selects yearly when planner is clicked and daily when daily is clicked", async () => {
    const user = userEvent.setup();
    render(<WorkbenchPageClient />);

    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    expect(
      screen.getByRole("heading", { name: "Yearly" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Daily" }));
    expect(screen.getByRole("heading", { name: "Daily" })).toBeInTheDocument();
  });

});
