import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WorkbenchPageClient } from "@/features/workbench/ui/WorkbenchPageClient";

async function statusOptions(title: string): Promise<string[]> {
  const select = await screen.findByLabelText(`Status for ${title}`);

  return within(select)
    .getAllByRole("option")
    .map((option) => option.textContent ?? "");
}

async function enabledStatusOptions(title: string): Promise<string[]> {
  const select = await screen.findByLabelText(`Status for ${title}`);

  return within(select)
    .getAllByRole("option")
    .filter((option) => !(option as HTMLOptionElement).disabled)
    .map((option) => option.textContent ?? "");
}

function expectFieldBefore(firstLabel: string, secondLabel: string) {
  const first = screen.getByLabelText(firstLabel).closest(".field-label");
  const second = screen.getByLabelText(secondLabel).closest(".field-label");

  expect(first).not.toBeNull();
  expect(second).not.toBeNull();
  if (!first || !second) {
    throw new Error(`Missing fields for order assertion: ${firstLabel}, ${secondLabel}`);
  }
  expect(
    first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function testToday(): string {
  return formatDate(new Date());
}

function testWeekStart(date: string): string {
  const value = new Date(`${date}T00:00:00`);
  const day = value.getDay();
  value.setDate(value.getDate() + (day === 0 ? -6 : 1 - day));
  return formatDate(value);
}

function testAddDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00`);
  value.setDate(value.getDate() + days);
  return formatDate(value);
}

function testMonthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

function testNextMonthStart(date: string): string {
  const value = new Date(`${date.slice(0, 7)}-01T00:00:00`);
  value.setMonth(value.getMonth() + 1);
  return formatDate(value);
}

function testYearStart(date: string): string {
  return `${date.slice(0, 4)}-01-01`;
}

function testNextYearStart(date: string): string {
  const value = new Date(`${date.slice(0, 4)}-01-01T00:00:00`);
  value.setFullYear(value.getFullYear() + 1);
  return formatDate(value);
}

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

  it("renders shared planner view controls on every planner tab", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: async () => [],
        }),
      ),
    );

    render(<WorkbenchPageClient />);

    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));

    for (const tab of ["Yearly", "Monthly", "Weekly", "Daily"]) {
      if (tab !== "Yearly") {
        await user.click(screen.getByRole("button", { name: tab }));
      }

      expect(screen.getByRole("button", { name: "Filter planner view" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Sort planner view" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Group planner view" })).toBeInTheDocument();
    }
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
    expect(screen.getByLabelText("Select all visible items").closest("th")).toHaveClass(
      "selection-column",
    );
    expect(screen.getByRole("cell", { name: "Health" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "active" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "weekly" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Morning review" })).toBeInTheDocument();
  });

  it("renders weekly planner goals and seven day cards", async () => {
    const user = userEvent.setup();
    const today = testToday();
    const weekStart = testWeekStart(today);
    const monthStart = testMonthStart(today);
    const responses: Record<string, unknown[]> = {
      "/todo-engine/items?type=goal": [
        {
          id: "goal-1",
          type: "goal",
          title: "July Goal",
          status: "active",
          horizon: "month",
          scheduled: monthStart,
        },
        {
          id: "goal-2",
          type: "goal",
          title: "Week Goal",
          status: "active",
          horizon: "week",
          scheduled: weekStart,
        },
      ],
      "/todo-engine/items?type=task": [
        {
          id: "task-1",
          type: "task",
          title: "Monday Task",
          status: "active",
          scheduled: weekStart,
        },
      ],
      "/todo-engine/items?type=event": [],
      "/todo-engine/items?type=routine": [],
      "/todo-engine/items?type=area": [],
      "/todo-engine/items?type=project": [],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          json: async () => responses[url] ?? [],
        }),
      ),
    );

    render(<WorkbenchPageClient />);

    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    await user.click(screen.getByRole("button", { name: "Weekly" }));

    expect(
      await screen.findByRole("heading", { name: "Goals for this month" }),
    ).toBeInTheDocument();
    expect(screen.getByText("July Goal")).toBeInTheDocument();
    expect(screen.getByText("Week Goal")).toBeInTheDocument();
    expect(screen.getByText("Monday Task")).toBeInTheDocument();
    expect(screen.getAllByTestId("weekly-day-card")).toHaveLength(7);
  });

  it("defaults weekly planner goal creation to the active week anchor and shows it", async () => {
    const user = userEvent.setup();
    const weekStart = testWeekStart(testToday());
    const responses: Record<string, unknown[]> = {
      "/todo-engine/items?type=goal": [],
      "/todo-engine/items?type=task": [],
      "/todo-engine/items?type=event": [],
      "/todo-engine/items?type=routine": [],
      "/todo-engine/items?type=area": [],
      "/todo-engine/items?type=project": [],
    };
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/todo-engine/goals/propose") {
        expect(init).toEqual(
          expect.objectContaining({
            method: "POST",
            body: JSON.stringify({
              title: "Anchored weekly goal",
              horizon: "week",
              scheduled: weekStart,
              actor: "user",
            }),
          }),
        );

        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "goal-new",
            type: "goal",
            title: "Anchored weekly goal",
            status: "approved",
            horizon: "week",
            scheduled: weekStart,
          }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => responses[url] ?? [],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);

    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    await user.click(screen.getByRole("button", { name: "Weekly" }));
    await user.click(screen.getByRole("button", { name: "Add planner item" }));

    expect(screen.getByLabelText("Scheduled")).toHaveValue(weekStart);

    await user.type(screen.getByLabelText("Title"), "Anchored weekly goal");
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(
      await screen.findByRole("heading", { name: "Anchored weekly goal" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "< Back" }));

    expect(screen.getByText("Anchored weekly goal")).toBeInTheDocument();
  });

  it("creates weekly planner tasks and daily planner events or routines from the type selector", async () => {
    const user = userEvent.setup();
    const today = testToday();
    const weekStart = testWeekStart(today);
    const responses: Record<string, unknown[]> = {
      "/todo-engine/items?type=goal": [],
      "/todo-engine/items?type=task": [],
      "/todo-engine/items?type=event": [],
      "/todo-engine/items?type=routine": [],
      "/todo-engine/items?type=area": [],
      "/todo-engine/items?type=project": [],
    };
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/todo-engine/tasks/propose") {
        expect(init).toEqual(
          expect.objectContaining({
            method: "POST",
            body: JSON.stringify({
              title: "Weekly task",
              scheduled: weekStart,
              actor: "user",
            }),
          }),
        );

        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "task-new",
            type: "task",
            title: "Weekly task",
            status: "active",
            scheduled: weekStart,
          }),
        });
      }
      if (url === "/todo-engine/events/propose") {
        expect(init).toEqual(
          expect.objectContaining({
            method: "POST",
            body: JSON.stringify({
              title: "Daily event",
              scheduled: today,
              actor: "user",
            }),
          }),
        );

        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "event-new",
            type: "event",
            title: "Daily event",
            status: "active",
            scheduled: today,
          }),
        });
      }
      if (url === "/todo-engine/routines/propose") {
        expect(init).toEqual(
          expect.objectContaining({
            method: "POST",
            body: JSON.stringify({
              title: "Daily routine",
              actor: "user",
              materialization_policy: "single_open",
            }),
          }),
        );

        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "routine-new",
            type: "routine",
            title: "Daily routine",
            status: "approved",
          }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => responses[url] ?? [],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);

    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    await user.click(screen.getByRole("button", { name: "Weekly" }));
    await user.click(screen.getByRole("button", { name: "Add planner item" }));
    await user.selectOptions(screen.getByLabelText("Type"), "task");
    expect(screen.getByLabelText("Scheduled")).toHaveValue(weekStart);
    await user.type(screen.getByLabelText("Title"), "Weekly task");
    await user.click(screen.getByRole("button", { name: "Create" }));
    expect(await screen.findByText("Weekly task")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Daily" }));
    await user.click(screen.getByRole("button", { name: "Add planner item" }));
    await user.selectOptions(screen.getByLabelText("Type"), "event");
    expect(screen.getByLabelText("Scheduled")).toHaveValue(today);
    await user.type(screen.getByLabelText("Title"), "Daily event");
    await user.click(screen.getByRole("button", { name: "Create" }));
    expect(await screen.findByText("Daily event")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "< Back" }));
    await user.click(screen.getByRole("button", { name: "Add planner item" }));
    await user.selectOptions(screen.getByLabelText("Type"), "routine");
    expect(screen.queryByLabelText("Scheduled")).toBeNull();
    await user.type(screen.getByLabelText("Title"), "Daily routine");
    await user.click(screen.getByRole("button", { name: "Create" }));
    expect(await screen.findByRole("heading", { name: "Daily routine" })).toBeInTheDocument();
  });

  it("renders daily planner sections with filter, group, and sort controls", async () => {
    const user = userEvent.setup();
    const today = testToday();
    const overdue = testAddDays(today, -1);
    const upcoming = testAddDays(today, 1);
    const responses: Record<string, unknown[]> = {
      "/todo-engine/items?type=task": [
        {
          id: "task-1",
          type: "task",
          title: "Today Task",
          status: "active",
          scheduled: today,
          tags: ["deep-work"],
          area_id: "area-1",
        },
        {
          id: "task-2",
          type: "task",
          title: "Done Task",
          status: "completed",
          scheduled: today,
          tags: ["deep-work"],
          area_id: "area-1",
        },
        {
          id: "task-3",
          type: "task",
          title: "Overdue Task",
          status: "active",
          scheduled: overdue,
          area_id: "area-2",
        },
        {
          id: "task-4",
          type: "task",
          title: "Upcoming Task",
          status: "active",
          scheduled: upcoming,
          area_id: "area-2",
        },
        {
          id: "task-5",
          type: "task",
          title: "Inbox Task",
          status: "active",
          area_id: "area-2",
        },
      ],
      "/todo-engine/items?type=event": [],
      "/todo-engine/items?type=routine": [],
      "/todo-engine/items?type=area": [
        { id: "area-1", type: "area", title: "Focus", status: "active" },
        { id: "area-2", type: "area", title: "Admin", status: "active" },
        {
          id: "area-3",
          type: "area",
          title: "Area Should Not Render",
          status: "active",
          scheduled: today,
        },
      ],
      "/todo-engine/items?type=project": [
        {
          id: "project-1",
          type: "project",
          title: "Project Should Not Render",
          status: "active",
          scheduled: today,
        },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          json: async () => responses[url] ?? [],
        }),
      ),
    );

    render(<WorkbenchPageClient />);

    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    await user.click(screen.getByRole("button", { name: "Daily" }));

    expect(await screen.findByRole("heading", { name: "Today" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filter planner view" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Group planner view" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sort planner view" })).toBeInTheDocument();
    expect(screen.getByText("Today Task")).toBeInTheDocument();
    expect(screen.getByText("Overdue Task")).toBeInTheDocument();
    expect(screen.getByText("Upcoming Task")).toBeInTheDocument();
    expect(screen.getByText("Inbox Task")).toBeInTheDocument();
    expect(screen.queryByText("Done Task")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Area Should Not Render" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Project Should Not Render" }),
    ).toBeNull();

    await user.click(screen.getByRole("button", { name: "Filter planner view" }));
    await user.selectOptions(screen.getByLabelText("Filter by Area"), "area-1");

    expect(screen.getByText("Today Task")).toBeInTheDocument();
    expect(screen.queryByText("Overdue Task")).toBeNull();
    expect(screen.queryByText("Upcoming Task")).toBeNull();
    expect(screen.queryByText("Inbox Task")).toBeNull();
    expect(screen.getByText("1 rules")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Filter by Tags"), "deep-work");

    expect(screen.getByText("Today Task")).toBeInTheDocument();
    expect(screen.queryByText("Done Task")).toBeNull();
    expect(screen.getByText("2 rules")).toBeInTheDocument();

    expect(
      within(screen.getByLabelText("Filter by Status")).queryByRole(
        "option",
        { name: "completed" },
      ),
    ).toBeNull();
  });

  it("filters daily planner items through the rule builder dropdown", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          json: async () =>
            url === "/todo-engine/items?type=task"
              ? [
                  {
                    id: "task-1",
                    type: "task",
                    title: "Focus Task",
                    status: "active",
                    tags: ["focus"],
                    area_id: "area-1",
                    scheduled: testToday(),
                  },
                  {
                    id: "task-2",
                    type: "task",
                    title: "Ops Task",
                    status: "active",
                    tags: ["ops"],
                    area_id: "area-2",
                    scheduled: testToday(),
                  },
                ]
              : url === "/todo-engine/items?type=area"
                ? [
                    { id: "area-1", type: "area", title: "Work", status: "active" },
                    { id: "area-2", type: "area", title: "Ops", status: "active" },
                  ]
                : [],
        }),
      ),
    );

    render(<WorkbenchPageClient />);

    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    await user.click(screen.getByRole("button", { name: "Daily" }));

    await screen.findByText("Focus Task");
    await user.click(screen.getByRole("button", { name: "Filter planner view" }));
    await user.selectOptions(screen.getByLabelText("Filter by Tags"), "focus");

    expect(screen.getByText("Focus Task")).toBeInTheDocument();
    expect(screen.queryByText("Ops Task")).toBeNull();
    expect(screen.getByText("1 rules")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Remove Tags filter" }));

    expect(screen.getByText("Focus Task")).toBeInTheDocument();
    expect(screen.getByText("Ops Task")).toBeInTheDocument();
  });

  it("sorts and groups daily planner items from dropdown controls", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          json: async () =>
            url === "/todo-engine/items?type=task"
              ? [
                  {
                    id: "task-b",
                    type: "task",
                    title: "B Task",
                    status: "active",
                    tags: ["ops"],
                    priority: 2,
                    scheduled: testToday(),
                  },
                  {
                    id: "task-a",
                    type: "task",
                    title: "A Task",
                    status: "active",
                    tags: ["focus"],
                    priority: 1,
                    scheduled: testToday(),
                  },
                ]
              : [],
        }),
      ),
    );

    render(<WorkbenchPageClient />);

    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    await user.click(screen.getByRole("button", { name: "Daily" }));
    await screen.findByText("A Task");

    await user.click(screen.getByRole("button", { name: "Sort planner view" }));
    await user.click(screen.getByRole("button", { name: "Title" }));

    const today = screen.getByLabelText("Today");
    expect(within(today).getAllByRole("button").map((button) => button.textContent)).toEqual([
      "A Task",
      "B Task",
    ]);

    await user.click(screen.getByRole("button", { name: "Group planner view" }));
    await user.click(screen.getByRole("button", { name: "Tag" }));

    expect(within(today).getByRole("heading", { name: "focus" })).toBeInTheDocument();
    expect(within(today).getByRole("heading", { name: "ops" })).toBeInTheDocument();
  });

  it("groups weekly goal strips with planner controls while keeping day cards visible", async () => {
    const user = userEvent.setup();
    const today = testToday();
    const weekStart = testWeekStart(today);
    const monthStart = testMonthStart(today);
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          json: async () =>
            url === "/todo-engine/items?type=goal"
              ? [
                  {
                    id: "month-goal-b",
                    type: "goal",
                    title: "Beta Month Goal",
                    status: "active",
                    horizon: "month",
                    scheduled: monthStart,
                    tags: ["focus"],
                  },
                  {
                    id: "month-goal-a",
                    type: "goal",
                    title: "Alpha Month Goal",
                    status: "active",
                    horizon: "month",
                    scheduled: monthStart,
                    tags: ["focus"],
                  },
                  {
                    id: "week-goal-b",
                    type: "goal",
                    title: "Beta Week Goal",
                    status: "active",
                    horizon: "week",
                    scheduled: weekStart,
                    tags: ["focus"],
                  },
                  {
                    id: "week-goal-a",
                    type: "goal",
                    title: "Alpha Week Goal",
                    status: "active",
                    horizon: "week",
                    scheduled: weekStart,
                    tags: ["focus"],
                  },
                  {
                    id: "week-goal-ops",
                    type: "goal",
                    title: "Ops Week Goal",
                    status: "active",
                    horizon: "week",
                    scheduled: weekStart,
                    tags: ["ops"],
                  },
                ]
              : url === "/todo-engine/items?type=task"
                ? [
                    {
                      id: "task-1",
                      type: "task",
                      title: "Monday Task",
                      status: "active",
                      scheduled: weekStart,
                      tags: ["focus"],
                    },
                  ]
                : [],
        }),
      ),
    );

    render(<WorkbenchPageClient />);

    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    await user.click(screen.getByRole("button", { name: "Weekly" }));
    await screen.findByText("Alpha Month Goal");

    await user.click(screen.getByRole("button", { name: "Sort planner view" }));
    await user.click(screen.getByRole("button", { name: "Title" }));
    await user.click(screen.getByRole("button", { name: "Group planner view" }));
    await user.click(screen.getByRole("button", { name: "Tag" }));

    const monthGoals = screen.getByLabelText("Weekly month goals");
    expect(within(monthGoals).getByRole("heading", { name: "focus" })).toBeInTheDocument();
    expect(
      within(monthGoals).getAllByRole("button").map((button) => button.textContent),
    ).toEqual(["Alpha Month Goal", "Beta Month Goal"]);

    const weekGoals = screen.getByLabelText("Weekly goals");
    expect(within(weekGoals).getByRole("heading", { name: "focus" })).toBeInTheDocument();
    expect(within(weekGoals).getByRole("heading", { name: "ops" })).toBeInTheDocument();
    expect(
      within(weekGoals).getAllByRole("button").map((button) => button.textContent),
    ).toEqual(["Alpha Week Goal", "Beta Week Goal", "Ops Week Goal"]);

    expect(screen.getByText("Monday Task")).toBeInTheDocument();
    expect(screen.getAllByTestId("weekly-day-card")).toHaveLength(7);
  });

  it("ignores unsupported weekly group values when switching to monthly planner", async () => {
    const user = userEvent.setup();
    const today = testToday();
    const monthStart = testMonthStart(today);
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          json: async () =>
            url === "/todo-engine/items?type=goal"
              ? [
                  {
                    id: "goal-1",
                    type: "goal",
                    title: "Work Goal",
                    status: "active",
                    horizon: "month",
                    scheduled: monthStart,
                    area_id: "area-1",
                  },
                ]
              : url === "/todo-engine/items?type=area"
                ? [{ id: "area-1", type: "area", title: "Work", status: "active" }]
                : [],
        }),
      ),
    );

    render(<WorkbenchPageClient />);

    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    await user.click(screen.getByRole("button", { name: "Weekly" }));

    await user.click(screen.getByRole("button", { name: "Group planner view" }));
    await user.click(screen.getByRole("button", { name: "Area" }));

    expect(screen.getByText("Grouped by area")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Monthly" }));
    await screen.findByText("Work Goal");

    expect(screen.queryByText("Grouped by area")).toBeNull();
    expect(screen.getByRole("button", { name: "Group planner view" })).toHaveAttribute(
      "data-active",
      "false",
    );
    expect(screen.queryByRole("heading", { name: "Work" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Group planner view" }));

    expect(screen.getByRole("button", { name: "None" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("button", { name: "Area" })).toBeNull();
  });

  it("keeps weekly sort and group choices isolated from monthly and yearly tabs", async () => {
    const user = userEvent.setup();
    const today = testToday();
    const weekStart = testWeekStart(today);
    const monthStart = testMonthStart(today);
    const yearStart = testYearStart(today);
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          json: async () =>
            url === "/todo-engine/items?type=goal"
              ? [
                  {
                    id: "year-goal",
                    type: "goal",
                    title: "Year Goal",
                    status: "active",
                    horizon: "year",
                    scheduled: yearStart,
                    area_id: "area-1",
                  },
                  {
                    id: "month-goal",
                    type: "goal",
                    title: "Month Goal",
                    status: "active",
                    horizon: "month",
                    scheduled: monthStart,
                    area_id: "area-1",
                  },
                  {
                    id: "week-goal",
                    type: "goal",
                    title: "Week Goal",
                    status: "active",
                    horizon: "week",
                    scheduled: weekStart,
                    area_id: "area-1",
                  },
                ]
              : url === "/todo-engine/items?type=task"
                ? [
                    {
                      id: "task-1",
                      type: "task",
                      title: "Weekly Task",
                      status: "active",
                      scheduled: weekStart,
                      area_id: "area-1",
                    },
                  ]
                : url === "/todo-engine/items?type=area"
                  ? [{ id: "area-1", type: "area", title: "Work", status: "active" }]
                  : [],
        }),
      ),
    );

    render(<WorkbenchPageClient />);

    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    await user.click(screen.getByRole("button", { name: "Weekly" }));
    await screen.findByText("Week Goal");

    await user.click(screen.getByRole("button", { name: "Sort planner view" }));
    await user.click(screen.getByRole("button", { name: "Title" }));
    await user.click(screen.getByRole("button", { name: "Group planner view" }));
    await user.click(screen.getByRole("button", { name: "Area" }));

    expect(screen.getByText("Sorted by title")).toBeInTheDocument();
    expect(screen.getByText("Grouped by area")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Monthly" }));
    await screen.findByText("Month Goal");
    expect(screen.queryByText("Sorted by title")).toBeNull();
    expect(screen.queryByText("Grouped by area")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Yearly" }));
    await screen.findByText("Year Goal");
    expect(screen.queryByText("Sorted by title")).toBeNull();
    expect(screen.queryByText("Grouped by area")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Weekly" }));
    await screen.findByText("Week Goal");
    expect(screen.getByText("Sorted by title")).toBeInTheDocument();
    expect(screen.getByText("Grouped by area")).toBeInTheDocument();
  });

  it("does not let monthly sort and group choices mutate weekly planner state", async () => {
    const user = userEvent.setup();
    const today = testToday();
    const weekStart = testWeekStart(today);
    const monthStart = testMonthStart(today);
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          json: async () =>
            url === "/todo-engine/items?type=goal"
              ? [
                  {
                    id: "month-goal-b",
                    type: "goal",
                    title: "Beta Month Goal",
                    status: "active",
                    horizon: "month",
                    scheduled: monthStart,
                    tags: ["focus"],
                  },
                  {
                    id: "month-goal-a",
                    type: "goal",
                    title: "Alpha Month Goal",
                    status: "active",
                    horizon: "month",
                    scheduled: monthStart,
                    tags: ["focus"],
                  },
                  {
                    id: "week-goal",
                    type: "goal",
                    title: "Week Goal",
                    status: "active",
                    horizon: "week",
                    scheduled: weekStart,
                    tags: ["focus"],
                  },
                ]
              : url === "/todo-engine/items?type=task"
                ? [
                    {
                      id: "task-1",
                      type: "task",
                      title: "Weekly Task",
                      status: "active",
                      scheduled: weekStart,
                      tags: ["focus"],
                    },
                  ]
                : [],
        }),
      ),
    );

    render(<WorkbenchPageClient />);

    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    await user.click(screen.getByRole("button", { name: "Weekly" }));
    await screen.findByText("Week Goal");

    await user.click(screen.getByRole("button", { name: "Sort planner view" }));
    await user.click(screen.getByRole("button", { name: "Title" }));
    await user.click(screen.getByRole("button", { name: "Group planner view" }));
    await user.click(screen.getByRole("button", { name: "Tag" }));

    await user.click(screen.getByRole("button", { name: "Monthly" }));
    await screen.findByText("Alpha Month Goal");
    await user.click(screen.getByRole("button", { name: "Sort planner view" }));
    await user.click(screen.getByRole("button", { name: "Updated" }));
    await user.click(screen.getByRole("button", { name: "Group planner view" }));
    await user.click(screen.getByRole("button", { name: "Status" }));

    expect(screen.getByText("Sorted by updated")).toBeInTheDocument();
    expect(screen.getByText("Grouped by status")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Weekly" }));
    await screen.findByText("Week Goal");
    expect(screen.getByText("Sorted by title")).toBeInTheDocument();
    expect(screen.getByText("Grouped by tag")).toBeInTheDocument();
    expect(screen.queryByText("Sorted by updated")).toBeNull();
    expect(screen.queryByText("Grouped by status")).toBeNull();
  });

  it("shows an active sort pill when planner sort differs from the tab default", async () => {
    const user = userEvent.setup();
    const today = testToday();
    const weekStart = testWeekStart(today);
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          json: async () =>
            url === "/todo-engine/items?type=task"
              ? [
                  {
                    id: "task-b",
                    type: "task",
                    title: "B Task",
                    status: "active",
                    scheduled: weekStart,
                  },
                  {
                    id: "task-a",
                    type: "task",
                    title: "A Task",
                    status: "active",
                    scheduled: weekStart,
                  },
                ]
              : [],
        }),
      ),
    );

    render(<WorkbenchPageClient />);

    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    await user.click(screen.getByRole("button", { name: "Weekly" }));
    await screen.findByText("A Task");

    expect(screen.queryByLabelText("Active planner controls")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Sort planner view" }));
    await user.click(screen.getByRole("button", { name: "Title" }));

    expect(screen.getByLabelText("Active planner controls")).toBeInTheDocument();
    expect(screen.getByText("Sorted by title")).toBeInTheDocument();
  });

  it("renders yearly and monthly goal lists from loaded planner goals", async () => {
    const user = userEvent.setup();
    const today = testToday();
    const yearStart = testYearStart(today);
    const nextYearStart = testNextYearStart(today);
    const monthStart = testMonthStart(today);
    const nextMonthStart = testNextMonthStart(today);
    const responses: Record<string, unknown[]> = {
      "/todo-engine/items?type=goal": [
        {
          id: "goal-year",
          type: "goal",
          title: "Annual Goal",
          status: "active",
          horizon: "year",
          scheduled: yearStart,
          tags: ["annual-current"],
        },
        {
          id: "goal-other-year",
          type: "goal",
          title: "Other Year Goal",
          status: "active",
          horizon: "year",
          scheduled: nextYearStart,
          tags: ["annual-future"],
        },
        {
          id: "goal-year-done",
          type: "goal",
          title: "Completed Annual Goal",
          status: "completed",
          horizon: "year",
          scheduled: yearStart,
          tags: ["annual-done"],
        },
        {
          id: "goal-month",
          type: "goal",
          title: "Monthly Goal",
          status: "active",
          horizon: "month",
          scheduled: monthStart,
          tags: ["month-current"],
        },
        {
          id: "goal-other-month",
          type: "goal",
          title: "Other Month Goal",
          status: "active",
          horizon: "month",
          scheduled: nextMonthStart,
          tags: ["month-future"],
        },
        {
          id: "goal-month-archived",
          type: "goal",
          title: "Archived Monthly Goal",
          status: "archived",
          horizon: "month",
          scheduled: monthStart,
          tags: ["month-archived"],
        },
      ],
      "/todo-engine/items?type=area": [],
      "/todo-engine/items?type=project": [],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          json: async () => responses[url] ?? [],
        }),
      ),
    );

    render(<WorkbenchPageClient />);

    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    expect(await screen.findByText("Annual Goal")).toBeInTheDocument();
    expect(screen.queryByText("Other Year Goal")).toBeNull();
    expect(screen.queryByText("Completed Annual Goal")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Filter planner view" }));
    const yearlyTagFilter = screen.getByLabelText("Filter by Tags");
    expect(
      within(yearlyTagFilter).getByRole(
        "option",
        { name: "annual-current" },
      ),
    ).toBeInTheDocument();
    expect(
      within(yearlyTagFilter).queryByRole(
        "option",
        { name: "annual-future" },
      ),
    ).toBeNull();
    expect(
      within(yearlyTagFilter).queryByRole(
        "option",
        { name: "annual-done" },
      ),
    ).toBeNull();
    await user.selectOptions(yearlyTagFilter, "annual-current");
    expect(screen.getByText("Annual Goal")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Monthly" }));
    expect(await screen.findByText("Monthly Goal")).toBeInTheDocument();
    expect(screen.queryByText("Other Month Goal")).toBeNull();
    expect(screen.queryByText("Archived Monthly Goal")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Filter planner view" }));
    const monthlyTagFilter = screen.getByLabelText("Filter by Tags");
    expect(
      within(monthlyTagFilter).queryByRole(
        "option",
        { name: "annual-current" },
      ),
    ).toBeNull();
    expect(
      within(monthlyTagFilter).getByRole(
        "option",
        { name: "month-current" },
      ),
    ).toBeInTheDocument();
    expect(
      within(monthlyTagFilter).queryByRole(
        "option",
        { name: "month-future" },
      ),
    ).toBeNull();
    expect(
      within(monthlyTagFilter).queryByRole(
        "option",
        { name: "month-archived" },
      ),
    ).toBeNull();
  });

  it("normalizes visible workspace tags after save", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/todo-engine/items/task-1") {
        expect(init).toEqual(
          expect.objectContaining({
            method: "PATCH",
            body: JSON.stringify({ tags: ["deep-work", "planning"] }),
          }),
        );
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "task-1",
            type: "task",
            title: "Plan",
            status: "active",
            tags: ["deep-work", "planning"],
          }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => [
          { id: "task-1", type: "task", title: "Plan", status: "active", tags: ["deep-work"] },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Tasks" }));

    const tags = await screen.findByLabelText("Tags for Plan");
    await user.clear(tags);
    await user.type(tags, " deep-work, deep-work, planning ");
    fireEvent.blur(tags);

    await waitFor(() => expect(tags).toHaveValue("deep-work, planning"));
  });

  it("does not patch tags when only spacing changes", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve({
        ok: true,
        json: async () =>
          url === "/todo-engine/items?type=task"
            ? [
                {
                  id: "task-1",
                  type: "task",
                  title: "Plan",
                  status: "active",
                  tags: ["deep-work", "planning"],
                },
              ]
            : [],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Tasks" }));

    const tags = await screen.findByLabelText("Tags for Plan");
    await user.clear(tags);
    await user.type(tags, " deep-work, planning ");
    fireEvent.blur(tags);

    await waitFor(() => expect(tags).toHaveValue("deep-work, planning"));
    expect(
      fetchMock.mock.calls.filter(([url]) => url === "/todo-engine/items/task-1"),
    ).toHaveLength(0);
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
          due: "2026-06-30",
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
          description: "Call clinic and confirm insurance",
          note: "Call before noon",
          created_at: "2026-06-20T00:00:00Z",
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
    expect(screen.getByLabelText("Due for Recovery Plan")).toHaveValue("2026-06-30");
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
      screen.getByRole("cell", { name: "Call clinic and confirm insurance" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Call before noon" })).toBeInTheDocument();
    expect(screen.getAllByRole("cell", { name: "2026-06-20" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("cell", { name: "2026-06-21" }).length).toBeGreaterThan(0);
    expect(screen.queryByLabelText("Description for Book physio")).toBeNull();
    expect(screen.queryByLabelText("Note for Book physio")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Routines" }));

    await waitFor(() =>
      expect(screen.getByRole("cell", { name: "daily" })).toBeInTheDocument(),
    );
    expect(screen.getByRole("cell", { name: "Health" })).toBeInTheDocument();
    expect(
      screen.getByRole("cell", { name: "Single open" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "After coffee" })).toBeInTheDocument();
    expect(screen.getAllByRole("cell", { name: "2026-06-21" }).length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Events" }));

    await waitFor(() =>
      expect(
        screen.getByRole("cell", { name: "Planning review" }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByLabelText("Starts At for Planning review")).toHaveValue(
      "2026-06-24T10:00",
    );
    expect(screen.getByRole("cell", { name: "Desk" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Me" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Goals" }));

    await waitFor(() =>
      expect(
        screen.getByRole("cell", { name: "June outcome" }),
      ).toBeInTheDocument(),
    );
    expect(screen.getAllByRole("cell", { name: "Root objective" })).toHaveLength(
      2,
    );
    expect(screen.getByLabelText("Scheduled for June outcome")).toHaveValue("2026-06-01");
    expect(screen.getByLabelText("Horizon for June outcome")).toHaveValue("month");
    expect(screen.getByLabelText("Due for June outcome")).toHaveValue("2026-06-30");
  }, 10000);

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
      if (url === "/todo-engine/items/task-new/activate") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "task-new",
            type: "task",
            title: "New task",
            status: "active",
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

  it("requires scheduled for event creation", async () => {
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
    await user.click(screen.getByRole("button", { name: "Events" }));
    await user.click(screen.getByRole("button", { name: "Add item" }));

    expect(screen.getByLabelText("Scheduled")).toBeRequired();
  });

  it("opens a detail view and saves note edits", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (String(url).includes("/items/task-1") && init?.method === "PATCH") {
        expect(init.body).toBe(JSON.stringify({ note: "Saved note" }));
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "task-1",
            type: "task",
            title: "One",
            status: "approved",
            note: "Saved note",
          }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => [
          { id: "task-1", type: "task", title: "One", status: "approved", note: "Old note" },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Tasks" }));

    await user.click(await screen.findByRole("cell", { name: "One" }));
    expect(screen.getByRole("heading", { name: "One" })).toBeInTheDocument();
    expect(screen.getByText("Properties")).toBeInTheDocument();

    await user.clear(screen.getByLabelText("Note"));
    await user.type(screen.getByLabelText("Note"), "Saved note");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/todo-engine/items/task-1",
      expect.objectContaining({ method: "PATCH" }),
    );

    await user.click(screen.getByRole("button", { name: "< Back" }));
    expect(screen.getByRole("table", { name: "Tasks items" })).toBeInTheDocument();
  });

  it("keeps detail long-text drafts while status and relation edits wait for Save", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/todo-engine/items/task-1" && init?.method === "PATCH") {
        expect(init.body).toBe(
          JSON.stringify({
            description: "Draft detail text",
            area: "area-2",
          }),
        );
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "task-1",
            type: "task",
            title: "One",
            status: "approved",
            description: "Draft detail text",
            area_id: "area-2",
            project_id: "project-1",
            routine_id: "routine-1",
          }),
        });
      }

      if (url === "/todo-engine/items/task-1/activate") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "task-1",
            type: "task",
            title: "One",
            status: "active",
            area_id: "area-2",
            description: "Draft detail text",
            project_id: "project-1",
            routine_id: "routine-1",
          }),
        });
      }

      if (url === "/todo-engine/items?type=area") {
        return Promise.resolve({
          ok: true,
          json: async () => [
            { id: "area-1", type: "area", title: "Health", status: "active" },
            { id: "area-2", type: "area", title: "Career", status: "active" },
          ],
        });
      }

      if (url === "/todo-engine/items?type=project") {
        return Promise.resolve({
          ok: true,
          json: async () => [
            { id: "project-1", type: "project", title: "Plan", status: "active" },
          ],
        });
      }

      if (url === "/todo-engine/items?type=routine") {
        return Promise.resolve({
          ok: true,
          json: async () => [
            { id: "routine-1", type: "routine", title: "Stretch", status: "active" },
          ],
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => [
          {
            id: "task-1",
            type: "task",
            title: "One",
            status: "approved",
            area_id: "area-1",
            project_id: "project-1",
            routine_id: "routine-1",
            description: "Original description",
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Tasks" }));
    await user.click(await screen.findByRole("cell", { name: "One" }));

    expect(screen.getByLabelText("Status for One")).toBeInTheDocument();
    expect(screen.getByLabelText("Area for One")).toBeInTheDocument();
    expect(screen.queryByText("Type")).toBeNull();
    expectFieldBefore("Status for One", "Area for One");

    await user.clear(screen.getByLabelText("Description"));
    await user.type(screen.getByLabelText("Description"), "Draft detail text");
    await user.selectOptions(screen.getByLabelText("Status for One"), "active");
    await user.selectOptions(screen.getByLabelText("Area for One"), "area-2");

    expect(screen.getByLabelText("Description")).toHaveValue("Draft detail text");
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/todo-engine/items/task-1",
      expect.objectContaining({ method: "PATCH" }),
    );
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/todo-engine/items/task-1/activate",
      expect.objectContaining({ method: "POST" }),
    );

    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/todo-engine/items/task-1",
        expect.objectContaining({ method: "PATCH" }),
      );
      expect(fetchMock).toHaveBeenCalledWith(
        "/todo-engine/items/task-1/activate",
        expect.objectContaining({ method: "POST" }),
      );
    });
    expect(fetchMock.mock.calls.find(([url]) => url === "/todo-engine/items/task-1")).toBeTruthy();
    expect(fetchMock.mock.calls.find(([url]) => url === "/todo-engine/items/task-1/activate")).toBeTruthy();
    expect(
      fetchMock.mock.calls.findIndex(([url]) => url === "/todo-engine/items/task-1"),
    ).toBeLessThan(
      fetchMock.mock.calls.findIndex(([url]) => url === "/todo-engine/items/task-1/activate"),
    );
  });

  it("skips detail patch requests when save only changes status", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/todo-engine/items/task-1/activate") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "task-1",
            type: "task",
            title: "One",
            status: "active",
            note: "Old note",
          }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => [
          {
            id: "task-1",
            type: "task",
            title: "One",
            status: "approved",
            note: "Old note",
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Tasks" }));
    await user.click(await screen.findByRole("cell", { name: "One" }));

    await user.selectOptions(screen.getByLabelText("Status for One"), "active");
    await user.click(screen.getByRole("button", { name: "Save" }));

    const patchCalls = fetchMock.mock.calls.filter(
      ([url, init]) =>
        url === "/todo-engine/items/task-1" &&
        (init as RequestInit | undefined)?.method === "PATCH",
    );

    expect(patchCalls).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledWith(
      "/todo-engine/items/task-1/activate",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("shows the same task fields in the table and detail while editing long fields only in detail", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/todo-engine/items/task-1") {
        expect(init).toEqual(expect.objectContaining({ method: "PATCH" }));
        expect(JSON.parse(String(init?.body))).toEqual({
          description: "Updated description",
          note: "Updated note",
          priority: 2,
        });

        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "task-1",
            type: "task",
            title: "Book physio",
            status: "approved",
            scheduled: "2026-07-03",
            due: "2026-07-04",
            priority: 2,
            description: "Updated description",
            note: "Updated note",
            created_at: "2026-07-01T00:00:00Z",
            updated_at: "2026-07-02T00:00:00Z",
          }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => [
          {
            id: "task-1",
            type: "task",
            title: "Book physio",
            status: "approved",
            scheduled: "2026-07-03",
            due: "2026-07-04",
            priority: 1,
            description: "Original description",
            note: "Original note",
            created_at: "2026-07-01T00:00:00Z",
            updated_at: "2026-07-02T00:00:00Z",
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Tasks" }));

    expect(
      await screen.findByRole("cell", { name: "Original description" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Original note" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Description for Book physio")).toBeNull();

    await user.click(screen.getByRole("cell", { name: "Book physio" }));

    expect(screen.getByLabelText("Title")).toHaveValue("Book physio");
    expect(screen.getByLabelText("Scheduled")).toHaveValue("2026-07-03");
    expect(screen.getByLabelText("Due")).toHaveValue("2026-07-04");
    expect(screen.getByLabelText("Priority")).toHaveValue("1");
    expect(screen.getByLabelText("Description")).toHaveValue("Original description");
    expect(screen.getByLabelText("Note")).toHaveValue("Original note");
    expect(screen.getByText("2026-07-01")).toBeInTheDocument();
    expect(screen.getByText("2026-07-02")).toBeInTheDocument();
    expectFieldBefore("Scheduled", "Due");
    expectFieldBefore("Due", "Priority");
    expectFieldBefore("Priority", "Description");

    await user.clear(screen.getByLabelText("Description"));
    await user.type(screen.getByLabelText("Description"), "Updated description");
    await user.clear(screen.getByLabelText("Note"));
    await user.type(screen.getByLabelText("Note"), "Updated note");
    await user.clear(screen.getByLabelText("Priority"));
    await user.type(screen.getByLabelText("Priority"), "2");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByDisplayValue("Updated description")).toBeInTheDocument();
  });

  it("blocks non-digit task priority characters in detail edits", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/todo-engine/items/task-1" && init?.method === "PATCH") {
        expect(JSON.parse(String(init.body))).toEqual({ priority: 10 });
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "task-1",
            type: "task",
            title: "One",
            status: "active",
            priority: 10,
          }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => [
          { id: "task-1", type: "task", title: "One", status: "active", priority: 1 },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Tasks" }));
    await user.click(await screen.findByRole("cell", { name: "One" }));

    const priority = screen.getByLabelText("Priority");
    await user.clear(priority);
    await user.type(priority, "2.7a-");
    expect(priority).toHaveDisplayValue("27");
    await user.tab();
    expect(priority).toHaveDisplayValue("10");

    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(fetchMock).toHaveBeenCalledWith(
      "/todo-engine/items/task-1",
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  it("shows the same goal fields in the table and detail", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          {
            id: "goal-1",
            type: "goal",
            title: "June outcome",
            status: "approved",
            horizon: "month",
            scheduled: "2026-06-01",
            due: "2026-06-30",
            parent_id: "goal-root",
            note: "Ship the monthly target",
            created_at: "2026-06-01T00:00:00Z",
            updated_at: "2026-06-02T00:00:00Z",
          },
          {
            id: "goal-root",
            type: "goal",
            title: "Root objective",
            status: "active",
            horizon: "year",
            scheduled: "2026-01-01",
            due: "2026-12-31",
            note: "",
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-02T00:00:00Z",
          },
        ],
      }),
    );

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Goals" }));

    expect(await screen.findByRole("cell", { name: "month" })).toBeInTheDocument();
    expect(screen.getByLabelText("Scheduled for June outcome")).toHaveValue("2026-06-01");
    expect(screen.getByLabelText("Due for June outcome")).toHaveValue("2026-06-30");
    expect(screen.getAllByRole("cell", { name: "Root objective" })).toHaveLength(2);
    expect(screen.getByRole("cell", { name: "Ship the monthly target" })).toBeInTheDocument();

    await user.click(screen.getByRole("cell", { name: "June outcome" }));

    expect(screen.getByLabelText("Horizon")).toHaveValue("month");
    expect(screen.getByLabelText("Scheduled")).toHaveValue("2026-06-01");
    expect(screen.getByLabelText("Due")).toHaveValue("2026-06-30");
    expect(screen.getByLabelText("Parent")).toHaveValue("goal-root");
    expect(screen.getByLabelText("Note")).toHaveValue("Ship the monthly target");
    expect(screen.getByText("2026-06-01")).toBeInTheDocument();
    expect(screen.getByText("2026-06-02")).toBeInTheDocument();
  });

  it("saves project detail definition of done through the item PATCH endpoint", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/todo-engine/items/project-1" && init?.method === "PATCH") {
        expect(init.body).toBe(JSON.stringify({ definition_of_done: "Ship review fixes" }));

        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "project-1",
            type: "project",
            title: "Plan",
            status: "approved",
            definition_of_done: "Ship review fixes",
            due: "2026-06-30",
          }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () =>
          url === "/todo-engine/items?type=project"
            ? [
                {
                  id: "project-1",
                  type: "project",
                  title: "Plan",
                  status: "approved",
                  definition_of_done: "Old DoD",
                  due: "2026-06-30",
                },
              ]
            : [],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Projects" }));

    await user.click(await screen.findByRole("cell", { name: "Plan" }));
    await user.clear(screen.getByLabelText("Definition of Done"));
    await user.type(screen.getByLabelText("Definition of Done"), "Ship review fixes");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/todo-engine/items/project-1",
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  it("saves routine detail recurrence rule through the item PATCH endpoint", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/todo-engine/items/routine-1" && init?.method === "PATCH") {
        expect(init.body).toBe(
          JSON.stringify({
            recurrence_rule: "RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR",
          }),
        );

        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "routine-1",
            type: "routine",
            title: "Stretch",
            status: "approved",
            recurrence_rule: "weekly",
            materialization_policy: "single_open",
          }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () =>
          url === "/todo-engine/items?type=routine"
            ? [
                {
                  id: "routine-1",
                  type: "routine",
                  title: "Stretch",
                  status: "approved",
                  recurrence_rule: "daily",
                  materialization_policy: "single_open",
                },
              ]
            : [],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Routines" }));

    await user.click(await screen.findByRole("cell", { name: "Stretch" }));
    expect(screen.queryByLabelText("Recurrence Rule")).toBeNull();
    expect(screen.getByText("Recurrence Rule").closest(".recurrence-row")).not.toBeNull();
    expect(screen.getByLabelText("Every").closest(".recurrence-field")).not.toBeNull();
    expect(screen.getByLabelText("Recurrence Rule Preview").closest(".recurrence-preview")).not.toBeNull();
    await user.clear(screen.getByLabelText("Every"));
    await user.type(screen.getByLabelText("Every"), "2");
    await user.selectOptions(screen.getByLabelText("Frequency"), "weekly");
    await user.click(screen.getByLabelText("Monday"));
    await user.click(screen.getByLabelText("Wednesday"));
    await user.click(screen.getByLabelText("Friday"));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/todo-engine/items/routine-1",
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  it("opens legacy weekly recurrence without sending an unchanged recurrence rule patch", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/todo-engine/items/routine-1" && init?.method === "PATCH") {
        expect(init.body).toBe(JSON.stringify({ note: "Keep this stretch" }));

        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "routine-1",
            type: "routine",
            title: "Stretch",
            status: "approved",
            recurrence_rule: "every 2 weeks on monday",
            materialization_policy: "single_open",
            note: "Keep this stretch",
          }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () =>
          url === "/todo-engine/items?type=routine"
            ? [
                {
                  id: "routine-1",
                  type: "routine",
                  title: "Stretch",
                  status: "approved",
                  recurrence_rule: "every 2 weeks on monday",
                  materialization_policy: "single_open",
                  note: "",
                },
              ]
            : [],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Routines" }));

    await user.click(await screen.findByRole("cell", { name: "Stretch" }));

    expect(screen.getByLabelText("Every")).toHaveValue(2);
    expect(screen.getByLabelText("Frequency")).toHaveValue("weekly");
    expect(screen.getByLabelText("Monday")).toBeChecked();

    await user.type(screen.getByLabelText("Note"), "Keep this stretch");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/todo-engine/items/routine-1",
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  it.each([
    ["월-금", ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]],
    ["평일", ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]],
    ["월수금", ["Monday", "Wednesday", "Friday"]],
  ])("opens Korean legacy recurrence %s as weekly weekdays", async (rule, checkedDays) => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          id: "routine-1",
          type: "routine",
          title: "Stretch",
          status: "approved",
          recurrence_rule: rule,
          materialization_policy: "single_open",
        },
      ],
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Routines" }));

    await user.click(await screen.findByRole("cell", { name: "Stretch" }));

    expect(screen.getByLabelText("Frequency")).toHaveValue("weekly");
    for (const day of checkedDays) {
      expect(screen.getByLabelText(day)).toBeChecked();
    }
  });

  it("shows routine last materialized in detail as readonly", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          {
            id: "routine-1",
            type: "routine",
            title: "Stretch",
            status: "approved",
            recurrence_rule: "daily",
            materialization_policy: "single_open",
            note: "After coffee",
            last_materialized_at: "2026-06-21T07:00:00Z",
            created_at: "2026-06-20T00:00:00Z",
            updated_at: "2026-06-22T00:00:00Z",
          },
        ],
      }),
    );

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Routines" }));
    await user.click(await screen.findByRole("cell", { name: "Stretch" }));

    const properties = screen.getByText("Properties").closest(".detail-properties");
    expect(within(properties as HTMLElement).getByText("Last Materialized")).toBeInTheDocument();
    expect(within(properties as HTMLElement).getByText("2026-06-21")).toBeInTheDocument();
    expect(screen.queryByLabelText("Last Materialized")).toBeNull();
  });

  it("omits unchanged event participants from the detail PATCH body", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/todo-engine/items/event-1" && init?.method === "PATCH") {
        expect(init.body).toBe(JSON.stringify({ priority: 2, location: "Office" }));

        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "event-1",
            type: "event",
            title: "Review",
            status: "approved",
            scheduled: "2026-06-24T10:00:00Z",
            due: "2026-06-24",
            priority: 2,
            metadata_: {
              location: "Office",
              participants: ["Me", "Team"],
              commitment_type: "busy",
            },
          }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () =>
          url === "/todo-engine/items?type=event"
            ? [
                {
                  id: "event-1",
                  type: "event",
                  title: "Review",
                  status: "approved",
                  scheduled: "2026-06-24T10:00:00Z",
                  due: "2026-06-24",
                  priority: 1,
                  metadata_: {
                    location: "Desk",
                    participants: ["Me", "Team"],
                    commitment_type: "busy",
                  },
                },
              ]
            : [],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Events" }));

    await user.click(await screen.findByRole("cell", { name: "Review" }));
    expectFieldBefore("Description", "Note");
    await user.clear(screen.getByLabelText("Location"));
    await user.type(screen.getByLabelText("Location"), "Office");
    await user.clear(screen.getByLabelText("Priority"));
    await user.type(screen.getByLabelText("Priority"), "2");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/todo-engine/items/event-1",
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  it("shows only active status choices and bounded integer priority controls", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          json: async () =>
            url === "/todo-engine/items?type=event"
              ? [
                  {
                    id: "event-1",
                    type: "event",
                    title: "Review",
                    status: "active",
                    priority: 4,
                  },
                ]
              : [
                  {
                    id: "task-1",
                    type: "task",
                    title: "One",
                    status: "active",
                    priority: 5,
                  },
                ],
        }),
      ),
    );

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Tasks" }));

    expect(await statusOptions("One")).toEqual(["active", "completed"]);
    expect(await enabledStatusOptions("One")).toEqual(["active", "completed"]);
    expect(screen.getByLabelText("Priority for One")).toHaveAttribute("min", "1");
    expect(screen.getByLabelText("Priority for One")).toHaveAttribute("max", "10");
    expect(screen.getByLabelText("Priority for One")).toHaveAttribute("step", "1");

    await user.click(screen.getByRole("cell", { name: "One" }));
    expect(screen.getByLabelText("Priority")).toHaveAttribute("min", "1");
    expect(screen.getByLabelText("Priority")).toHaveAttribute("max", "10");
    expect(screen.getByLabelText("Priority")).toHaveAttribute("step", "1");
    await user.click(screen.getByRole("button", { name: "< Back" }));

    await user.click(screen.getByRole("button", { name: "Events" }));
    expect(await statusOptions("Review")).toEqual(["active", "paused", "completed"]);
  });

  it("hides approved from task and event status even when stored data is approved", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          json: async () =>
            url === "/todo-engine/items?type=event"
              ? [
                  {
                    id: "event-1",
                    type: "event",
                    title: "Review",
                    status: "approved",
                  },
                ]
              : [
                  {
                    id: "task-1",
                    type: "task",
                    title: "One",
                    status: "approved",
                  },
                ],
        }),
      ),
    );

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Tasks" }));

    const status = await screen.findByLabelText("Status for One");
    expect(status).toHaveValue("active");
    expect(await statusOptions("One")).toEqual(["active", "completed"]);

    await user.click(screen.getByRole("button", { name: "Events" }));
    const eventStatus = await screen.findByLabelText("Status for Review");
    expect(eventStatus).toHaveValue("active");
    expect(await statusOptions("Review")).toEqual(["active", "paused", "completed"]);
  });

  it("lets project and parent selects choose none while area remains required", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          json: async () => {
            if (url === "/todo-engine/items?type=area") {
              return [{ id: "area-1", type: "area", title: "Health", status: "active" }];
            }
            if (url === "/todo-engine/items?type=project") {
              return [{ id: "project-1", type: "project", title: "Plan", status: "active" }];
            }
            if (url === "/todo-engine/items?type=goal") {
              return [{ id: "goal-1", type: "goal", title: "Goal", status: "active" }];
            }
            return [{ id: "task-1", type: "task", title: "One", status: "active", area_id: "area-1" }];
          },
        }),
      ),
    );

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Tasks" }));
    await user.click(await screen.findByRole("cell", { name: "One" }));

    expect(within(screen.getByLabelText("Project for One")).getByRole("option", { name: "None" })).toBeEnabled();
    expect(within(screen.getByLabelText("Area for One")).getByRole("option", { name: "-" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "< Back" }));
    await user.click(screen.getByRole("button", { name: "Goals" }));
    await user.click(await screen.findByRole("cell", { name: "Goal" }));
    expect(within(screen.getByLabelText("Parent for Goal")).getByRole("option", { name: "None" })).toBeEnabled();
    expect(within(screen.getByLabelText("Parent for Goal")).getByRole("option", { name: "Goal" })).toHaveValue("goal-1");
  });

  it("opens a detail view from the keyboard", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve({
        ok: true,
        json: async () => [
          { id: "task-1", type: "task", title: "One", status: "approved" },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Tasks" }));

    const row = screen.getByRole("button", { name: "Open details for One" });
    row.focus();
    expect(row).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(screen.getByRole("heading", { name: "One" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "< Back" }));
    const reopenedRow = screen.getByRole("button", { name: "Open details for One" });
    reopenedRow.focus();

    await user.keyboard("{Space}");
    expect(screen.getByRole("heading", { name: "One" })).toBeInTheDocument();
  });

  it("keeps checkbox keyboard selection from opening details", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          json: async () => [
            { id: "task-1", type: "task", title: "One", status: "approved" },
          ],
        }),
      ),
    );

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Tasks" }));

    const checkbox = screen.getByRole("checkbox", { name: "Select One" });
    await user.click(checkbox);
    expect(screen.getByRole("button", { name: "Archive selected items" })).toBeEnabled();

    checkbox.focus();
    expect(checkbox).toHaveFocus();

    await user.keyboard("{Space}");
    expect(screen.queryByRole("heading", { name: "One" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Archive selected items" })).toBeEnabled();

    checkbox.focus();
    await user.keyboard("{Enter}");
    expect(screen.queryByRole("heading", { name: "One" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Archive selected items" })).toBeEnabled();
  });

  it("patches an inline due edit without opening details", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (String(url).includes("/items/task-1") && init?.method === "PATCH") {
        expect(init.body).toBe(JSON.stringify({ due: "2026-06-30" }));
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "task-1",
            type: "task",
            title: "One",
            status: "approved",
            due: "2026-06-30",
          }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => [
          {
            id: "task-1",
            type: "task",
            title: "One",
            status: "approved",
            due: "2026-06-20",
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Tasks" }));

    const due = await screen.findByLabelText("Due for One");
    await user.click(due);
    expect(screen.queryByRole("heading", { name: "One" })).not.toBeInTheDocument();

    await user.clear(due);
    await user.type(due, "2026-06-30");
    await user.tab();

    expect(fetchMock).toHaveBeenCalledWith(
      "/todo-engine/items/task-1",
      expect.objectContaining({ method: "PATCH" }),
    );
    expect(screen.queryByRole("heading", { name: "One" })).not.toBeInTheDocument();
  });

  it("patches an inline project due edit through the item PATCH endpoint", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (String(url).includes("/items/project-1") && init?.method === "PATCH") {
        expect(init.body).toBe(JSON.stringify({ due: "2026-07-01" }));
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "project-1",
            type: "project",
            title: "Plan",
            status: "approved",
            due: "2026-07-01",
          }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => [
          {
            id: "project-1",
            type: "project",
            title: "Plan",
            status: "approved",
            due: "2026-06-30",
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Projects" }));

    const due = await screen.findByLabelText("Due for Plan");
    await user.clear(due);
    await user.type(due, "2026-07-01");
    await user.tab();

    expect(fetchMock).toHaveBeenCalledWith(
      "/todo-engine/items/project-1",
      expect.objectContaining({ method: "PATCH" }),
    );
    expect(screen.queryByRole("heading", { name: "Plan" })).not.toBeInTheDocument();
  });

  it("patches an inline event start edit without dropping the time", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (String(url).includes("/items/event-1") && init?.method === "PATCH") {
        expect(init.body).toBe(
          JSON.stringify({ scheduled: "2026-06-25T11:30:00Z" }),
        );
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "event-1",
            type: "event",
            title: "Review",
            status: "approved",
            scheduled: "2026-06-25T11:30:00Z",
          }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => [
          {
            id: "event-1",
            type: "event",
            title: "Review",
            status: "approved",
            scheduled: "2026-06-24T10:00:00Z",
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Events" }));

    const scheduled = await screen.findByLabelText("Starts At for Review");
    expect(scheduled).toHaveValue("2026-06-24T10:00");

    await user.clear(scheduled);
    await user.type(scheduled, "2026-06-25T11:30");
    await user.tab();

    expect(fetchMock).toHaveBeenCalledWith(
      "/todo-engine/items/event-1",
      expect.objectContaining({ method: "PATCH" }),
    );
    expect(screen.queryByRole("heading", { name: "Review" })).not.toBeInTheDocument();
  });

  it("blocks non-digit event priority characters before inline Enter commit", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/todo-engine/items/event-1" && init?.method === "PATCH") {
        expect(init.body).toBe(JSON.stringify({ priority: 10 }));
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "event-1",
            type: "event",
            title: "Review",
            status: "active",
            priority: 10,
          }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => [
          { id: "event-1", type: "event", title: "Review", status: "active", priority: 1 },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Events" }));

    const priority = await screen.findByLabelText("Priority for Review");
    await user.clear(priority);
    await user.type(priority, "3.9a-{Enter}");

    expect(priority).toHaveDisplayValue("10");
    expect(fetchMock).toHaveBeenCalledWith(
      "/todo-engine/items/event-1",
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  it("transitions inline status without opening details", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/todo-engine/items/task-1/activate") {
        expect(init).toEqual(
          expect.objectContaining({
            method: "POST",
            body: JSON.stringify({}),
          }),
        );
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "task-1",
            type: "task",
            title: "One",
            status: "active",
          }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => [
          {
            id: "task-1",
            type: "task",
            title: "One",
            status: "approved",
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Tasks" }));

    const status = await screen.findByLabelText("Status for One");
    await user.selectOptions(status, "active");

    expect(fetchMock).toHaveBeenCalledWith(
      "/todo-engine/items/task-1/activate",
      expect.objectContaining({ method: "POST" }),
    );
    expect(screen.queryByRole("heading", { name: "One" })).not.toBeInTheDocument();
  });

  it("archives an area from the inline status select", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/todo-engine/items/area-1/archive") {
        expect(init).toEqual(
          expect.objectContaining({
            method: "POST",
            body: JSON.stringify({}),
          }),
        );
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "area-1",
            type: "area",
            title: "Area",
            status: "archived",
          }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => [
          {
            id: "area-1",
            type: "area",
            title: "Area",
            status: "active",
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));

    const status = await screen.findByLabelText("Status for Area");
    await user.selectOptions(status, "archived");

    expect(fetchMock).toHaveBeenCalledWith(
      "/todo-engine/items/area-1/archive",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("shows only service-allowed inline status transitions", async () => {
    const user = userEvent.setup();
    const responses: Record<string, unknown[]> = {
      "/todo-engine/items?type=area": [
        { id: "area-1", type: "area", title: "Area", status: "active" },
      ],
      "/todo-engine/items?type=project": [
        {
          id: "project-1",
          type: "project",
          title: "Project without DoD",
          status: "approved",
        },
        {
          id: "project-2",
          type: "project",
          title: "Project with DoD",
          status: "approved",
          definition_of_done: "Done",
        },
      ],
      "/todo-engine/items?type=routine": [
        {
          id: "routine-1",
          type: "routine",
          title: "Routine without rule",
          status: "approved",
        },
        {
          id: "routine-2",
          type: "routine",
          title: "Paused routine",
          status: "paused",
          recurrence_rule: "daily",
        },
      ],
      "/todo-engine/items?type=event": [
        {
          id: "event-1",
          type: "event",
          title: "Event without scheduled",
          status: "approved",
        },
        {
          id: "event-2",
          type: "event",
          title: "Scheduled event",
          status: "active",
          scheduled: "2026-06-24T10:00:00Z",
        },
      ],
      "/todo-engine/items?type=goal": [
        { id: "goal-1", type: "goal", title: "Proposed goal", status: "proposed" },
        { id: "goal-2", type: "goal", title: "Approved goal", status: "approved" },
        { id: "goal-3", type: "goal", title: "Active goal", status: "active" },
        { id: "goal-4", type: "goal", title: "Paused goal", status: "paused" },
      ],
      "/todo-engine/items?type=task": [
        { id: "task-1", type: "task", title: "Proposed task", status: "proposed" },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve({ ok: true, json: async () => responses[url] ?? [] }),
      ),
    );

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));

    await user.click(screen.getByRole("button", { name: "Projects" }));
    expect(await statusOptions("Project without DoD")).toEqual([
      "approved",
    ]);
    expect(await enabledStatusOptions("Project without DoD")).toEqual(["approved"]);
    expect(await enabledStatusOptions("Project with DoD")).toEqual(["approved", "active"]);

    await user.click(screen.getByRole("button", { name: "Routines" }));
    expect(await enabledStatusOptions("Routine without rule")).toEqual(["approved"]);
    expect(await enabledStatusOptions("Paused routine")).toEqual(["paused", "active"]);

    await user.click(screen.getByRole("button", { name: "Events" }));
    expect(await enabledStatusOptions("Event without scheduled")).toEqual([
      "active",
      "paused",
      "completed",
    ]);
    expect(await enabledStatusOptions("Scheduled event")).toEqual([
      "active",
      "paused",
      "completed",
    ]);

    await user.click(screen.getByRole("button", { name: "Areas" }));
    expect(await statusOptions("Area")).toEqual(["active", "archived"]);
    expect(await enabledStatusOptions("Area")).toEqual(["active", "archived"]);

    await user.click(screen.getByRole("button", { name: "Goals" }));
    expect(await enabledStatusOptions("Proposed goal")).toEqual(["proposed", "approved"]);
    expect(await enabledStatusOptions("Approved goal")).toEqual(["approved", "active"]);
    expect(await enabledStatusOptions("Active goal")).toEqual([
      "active",
      "paused",
      "completed",
    ]);
    expect(await enabledStatusOptions("Paused goal")).toEqual(["paused", "active"]);

    await user.click(screen.getByRole("button", { name: "Tasks" }));
    expect(await enabledStatusOptions("Proposed task")).toEqual(["active", "completed"]);
  });

  it("disables the relation placeholder for an existing relation", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (String(url).includes("/items?type=area")) {
          return Promise.resolve({
            ok: true,
            json: async () => [{ id: "area-1", type: "area", title: "Health", status: "active" }],
          });
        }

        return Promise.resolve({
          ok: true,
          json: async () => [
            {
              id: "task-1",
              type: "task",
              title: "One",
              status: "approved",
              area_id: "area-1",
            },
          ],
        });
      }),
    );

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Tasks" }));

    const areaSelect = await screen.findByLabelText("Area for One");
    expect(within(areaSelect).getByRole("option", { name: "-" })).toBeDisabled();
  });

  it("does not PATCH a relation when the placeholder value is cleared", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (String(url).includes("/items/task-1") && init?.method === "PATCH") {
        expect(init.body).not.toBe(JSON.stringify({ area: "" }));
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "task-1",
            type: "task",
            title: "One",
            status: "approved",
            area_id: "area-1",
          }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => [
          {
            id: "area-1",
            type: "area",
            title: "Health",
            status: "active",
          },
          {
            id: "task-1",
            type: "task",
            title: "One",
            status: "approved",
            area_id: "area-1",
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Tasks" }));

    const areaSelect = await screen.findByLabelText("Area for One");
    fireEvent.change(areaSelect, { target: { value: "" } });

    expect(fetchMock).not.toHaveBeenCalledWith(
      "/todo-engine/items/task-1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ area: "" }),
      }),
    );
  });

});
