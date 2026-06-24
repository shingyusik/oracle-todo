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

  it("does not render static overview cards", () => {
    render(<WorkbenchPageClient />);

    expect(screen.queryByLabelText("Dashboard overview")).toBeNull();
    expect(screen.queryByText("Focus")).toBeNull();
    expect(screen.queryByText("Ready")).toBeNull();
  });

  it("does not render static panel intro copy", () => {
    render(<WorkbenchPageClient />);

    expect(screen.queryByText("Local command center")).toBeNull();
    expect(
      screen.queryByText("Review proposed, approved, and active work from one place."),
    ).toBeNull();
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

    expect(screen.getByRole("button", { name: "ToDo" })).toHaveAttribute(
      "data-active",
      "true",
    );
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
    expect(screen.getByRole("button", { name: "ToDo" })).toHaveAttribute(
      "data-active",
      "true",
    );
  });

  it("changes the main panel when a tab is clicked", async () => {
    const user = userEvent.setup();
    render(<WorkbenchPageClient />);

    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Projects" }));

    expect(screen.getByRole("button", { name: "Projects" })).toHaveAttribute(
      "data-active",
      "true",
    );
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
    expect(screen.queryByRole("cell", { name: "Morning review" })).toBeNull();
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
      "/todo-engine/items?type=event": [
        {
          id: "event-1",
          type: "event",
          title: "Planning review",
          status: "approved",
          area_id: "area-1",
          scheduled: "2026-06-24T10:00:00Z",
          metadata_: { location: "Desk", participants: ["Me"] },
          updated_at: "2026-06-21T00:00:00Z",
        },
      ],
      "/todo-engine/items?type=goal": [
        {
          id: "goal-1",
          type: "goal",
          title: "June outcome",
          status: "approved",
          area_id: "area-1",
          horizon: "month",
          scheduled: "2026-06-01",
          due: "2026-06-30",
          parent_id: "goal-root",
          updated_at: "2026-06-21T00:00:00Z",
        },
        {
          id: "goal-root",
          type: "goal",
          title: "Root objective",
          status: "approved",
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
    expect(screen.queryByRole("cell", { name: "Check weekly" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Tasks" }));

    await waitFor(() =>
      expect(
        screen.getByRole("cell", { name: "Recovery Plan" }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByRole("cell", { name: "Health" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Stretch" })).toBeInTheDocument();
    expect(screen.queryByRole("cell", { name: "Call before noon" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Routines" }));

    await waitFor(() =>
      expect(screen.getByRole("cell", { name: "daily" })).toBeInTheDocument(),
    );
    expect(screen.getByRole("cell", { name: "Health" })).toBeInTheDocument();
    expect(
      screen.getByRole("cell", { name: "single_open" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("cell", { name: "After coffee" })).toBeNull();
    expect(screen.getByRole("cell", { name: "2026-06-21" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Events" }));

    await waitFor(() =>
      expect(
        screen.getByRole("cell", { name: "Planning review" }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByRole("cell", { name: "Desk" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Me" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Goals" }));

    await waitFor(() =>
      expect(
        screen.getByRole("cell", { name: "June outcome" }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByRole("cell", { name: "Health" })).toBeInTheDocument();
    expect(screen.getAllByRole("cell", { name: "Root objective" })).toHaveLength(
      2,
    );
    expect(screen.getByRole("cell", { name: "month" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "2026-06-30" })).toBeInTheDocument();
  });

  it("selects yearly when planner is clicked and daily when daily is clicked", async () => {
    const user = userEvent.setup();
    render(<WorkbenchPageClient />);

    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    expect(screen.getByRole("button", { name: "Yearly" })).toHaveAttribute(
      "data-active",
      "true",
    );

    await user.click(screen.getByRole("button", { name: "Daily" }));
    expect(screen.getByRole("button", { name: "Daily" })).toHaveAttribute(
      "data-active",
      "true",
    );
  });

  it("enables trash only for selected rows and confirms archive", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((url: string) => {
      if (String(url).endsWith("/archive")) {
        return Promise.resolve({ ok: true, json: async () => ({}) });
      }

      return Promise.resolve({
        ok: true,
        json: async () => [
          { id: "task-1", type: "task", title: "One", status: "approved" },
          { id: "task-2", type: "task", title: "Two", status: "approved" },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Tasks" }));

    const trash = await screen.findByRole("button", {
      name: "Archive selected items",
    });
    expect(trash).toBeDisabled();

    await user.click(screen.getByRole("checkbox", { name: "Select One" }));
    expect(trash).toBeEnabled();

    await user.click(trash);
    expect(
      screen.getByRole("dialog", { name: "Archive selected items?" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Archive" }));
    expect(fetchMock).toHaveBeenCalledWith(
      "/todo-engine/items/task-1/archive",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("focuses and traps the archive dialog, and closes it on escape", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (String(url).endsWith("/archive")) {
          return Promise.resolve({ ok: true, json: async () => ({}) });
        }

        return Promise.resolve({
          ok: true,
          json: async () => [
            { id: "task-1", type: "task", title: "One", status: "approved" },
          ],
        });
      }),
    );

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Tasks" }));
    await user.click(screen.getByRole("checkbox", { name: "Select One" }));
    await user.click(screen.getByRole("button", { name: "Archive selected items" }));

    const dialog = screen.getByRole("dialog", { name: "Archive selected items?" });
    expect(dialog).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus(),
    );

    await user.tab();
    expect(screen.getByRole("button", { name: "Archive" })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Archive selected items?" })).toBeNull();
  });

  it("marks the select-all checkbox indeterminate for partial selection", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (String(url).endsWith("/archive")) {
          return Promise.resolve({ ok: true, json: async () => ({}) });
        }

        return Promise.resolve({
          ok: true,
          json: async () => [
            { id: "task-1", type: "task", title: "One", status: "approved" },
            { id: "task-2", type: "task", title: "Two", status: "approved" },
          ],
        });
      }),
    );

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Tasks" }));

    const selectAll = screen.getByRole("checkbox", { name: "Select all visible items" }) as HTMLInputElement;
    expect(selectAll.checked).toBe(false);
    expect(selectAll.indeterminate).toBe(false);

    await user.click(screen.getByRole("checkbox", { name: "Select One" }));
    await waitFor(() => {
      expect(selectAll.checked).toBe(false);
      expect(selectAll.indeterminate).toBe(true);
    });
  });

  it("opens a creation dialog and creates a row", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((url: string) => {
      if (url === "/todo-engine/tasks/propose") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "task-new",
            type: "task",
            title: "New task",
            status: "approved",
          }),
        });
      }

      return Promise.resolve({ ok: true, json: async () => [] });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Tasks" }));
    await user.click(screen.getByRole("button", { name: "Add item" }));

    expect(
      screen.getByRole("dialog", { name: "Create Tasks item" }),
    ).toBeInTheDocument();

    await user.type(screen.getByLabelText("Title"), "New task");
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(
      await screen.findByRole("heading", { name: "New task" }),
    ).toBeInTheDocument();
  });

  it("focuses and traps the creation dialog through every control, and closes it on escape", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (String(url).endsWith("/propose")) {
          return Promise.resolve({ ok: true, json: async () => ({}) });
        }

        return Promise.resolve({ ok: true, json: async () => [] });
      }),
    );

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Goals" }));
    await user.click(screen.getByRole("button", { name: "Add item" }));

    const dialog = screen.getByRole("dialog", { name: "Create Goals item" });
    expect(dialog).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Title")).toHaveFocus());

    await user.tab();
    expect(screen.getByLabelText("Scheduled")).toHaveFocus();

    await user.tab();
    expect(screen.getByLabelText("Horizon")).toHaveFocus();

    await user.tab();
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole("button", { name: "Create" })).toHaveFocus();

    await user.tab();
    expect(screen.getByLabelText("Title")).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Create Goals item" })).toBeNull();
  });

  it("shows only supported goal horizons and requires a scheduled date", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (String(url).endsWith("/propose")) {
          return Promise.resolve({ ok: true, json: async () => ({}) });
        }

        return Promise.resolve({ ok: true, json: async () => [] });
      }),
    );

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Goals" }));
    await user.click(screen.getByRole("button", { name: "Add item" }));

    const horizon = screen.getByLabelText("Horizon");
    expect(horizon).toBeInTheDocument();
    expect(horizon).toHaveTextContent("week");
    expect(horizon).toHaveTextContent("month");
    expect(horizon).toHaveTextContent("year");
    expect(horizon).not.toHaveTextContent("quarter");
    expect(screen.getByLabelText("Scheduled")).toBeRequired();
  });

});
