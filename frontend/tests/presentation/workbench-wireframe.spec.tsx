import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkbenchPageClient } from "@/features/workbench/ui/WorkbenchPageClient";

beforeEach(() => {
  window.localStorage.clear();
});

async function statusOptions(title: string): Promise<string[]> {
  const select = await screen.findByLabelText(`Status for ${title}`);

  return within(select)
    .getAllByRole("option")
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

function propertyRow(label: string): HTMLElement {
  const row = screen.getByText(label).closest(".property-row");
  expect(row).not.toBeNull();
  if (!row) {
    throw new Error(`Missing property row: ${label}`);
  }
  return row as HTMLElement;
}

function fieldRow(label: string): HTMLElement {
  const row = screen.getByLabelText(label).closest(".field-label");
  expect(row).not.toBeNull();
  if (!row) {
    throw new Error(`Missing field row: ${label}`);
  }
  return row as HTMLElement;
}

function expectFieldBeforeProperty(fieldLabel: string, propertyLabel: string) {
  expect(
    fieldRow(fieldLabel).compareDocumentPosition(propertyRow(propertyLabel)) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
}

function expectPropertyImmediatelyBeforeProperty(firstLabel: string, secondLabel: string) {
  expect(propertyRow(firstLabel).nextElementSibling).toBe(propertyRow(secondLabel));
}

function expectPropertyImmediatelyBeforeField(propertyLabel: string, fieldLabel: string) {
  expect(propertyRow(propertyLabel).nextElementSibling).toBe(fieldRow(fieldLabel));
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

function monthLabelForDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

function testMonthLabel(date: string): string {
  return ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][
    Number(date.slice(5, 7)) - 1
  ] ?? date.slice(5, 7);
}

function testLongDateLabel(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function calendarSelectionRange(button: HTMLElement): { start: string; end: string } {
  const label = button.getAttribute("aria-label") ?? "";
  const match = label.match(/(\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})/);
  expect(match).not.toBeNull();
  if (!match) {
    throw new Error(`Calendar button is missing a selectable range: ${label}`);
  }

  return { start: match[1] ?? "", end: match[2] ?? "" };
}

function calendarSelectionDayLabel(button: HTMLElement): string {
  const label = button.getAttribute("aria-label") ?? "";
  const [dayLabel = ""] = label.split(".");
  expect(dayLabel).not.toBe("");
  return dayLabel;
}

function calendarPreviewButtons(picker: HTMLElement): HTMLElement[] {
  return within(picker)
    .getAllByRole("button")
    .filter((button) => button.classList.contains("goal-period-calendar-day-preview"));
}

function testMonthEnd(date: string): string {
  const value = new Date(`${date.slice(0, 7)}-01T00:00:00`);
  value.setMonth(value.getMonth() + 1);
  value.setDate(0);
  return formatDate(value);
}

function testNextMonthStart(date: string): string {
  const value = new Date(`${date.slice(0, 7)}-01T00:00:00`);
  value.setMonth(value.getMonth() + 1);
  return formatDate(value);
}

function testPreviousMonthStart(date: string): string {
  const value = new Date(`${date.slice(0, 7)}-01T00:00:00`);
  value.setMonth(value.getMonth() - 1);
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
    vi.restoreAllMocks();
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

  it("renders icon-only primary tabs with accessible tooltip labels", () => {
    render(<WorkbenchPageClient />);

    for (const label of ["Dashboard", "ToDo"]) {
      const tab = screen.getByRole("button", { name: label });

      expect(tab).toHaveAttribute("data-tooltip", label);
      expect(tab).not.toHaveTextContent(label);

      const icon = tab.querySelector(".main-sidebar-tab-icon");
      expect(icon).not.toBeNull();
      if (!icon) {
        throw new Error(`Missing icon for ${label} primary tab`);
      }
      expect(icon).toHaveAttribute("aria-hidden", "true");
    }
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
    const monthStart = testMonthStart(testToday());
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
              horizon: "month",
              scheduled: monthStart,
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
            horizon: "month",
            scheduled: monthStart,
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

    const trigger = screen.getByRole("button", { name: "Period" });
    expect(trigger).toHaveTextContent("Week");

    await user.click(trigger);
    const picker = screen.getByRole("dialog", { name: "Period" });
    expect(
      within(picker).getByText(`${weekStart} to ${testAddDays(weekStart, 6)}`),
    ).toBeInTheDocument();
    await user.click(within(picker).getByRole("button", { name: "Month" }));
    expect(
      within(picker).getByText(`${monthStart} to ${testMonthEnd(testToday())}`),
    ).toBeInTheDocument();
    await user.click(within(picker).getByRole("button", { name: "July 2026" }));

    await user.type(screen.getByLabelText("Title"), "Anchored weekly goal");
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(
      await screen.findByRole("heading", { name: "Anchored weekly goal" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "< Back" }));

    expect(screen.getByText("Anchored weekly goal")).toBeInTheDocument();
  });

  it("submits canonical yearly and monthly planner goal anchors from the creation dialog", async () => {
    const user = userEvent.setup();
    const today = testToday();
    const yearStart = testYearStart(today);
    const monthStart = testMonthStart(today);
    const responses: Record<string, unknown[]> = {
      "/todo-engine/items?type=goal": [],
      "/todo-engine/items?type=task": [],
      "/todo-engine/items?type=event": [],
      "/todo-engine/items?type=routine": [],
      "/todo-engine/items?type=area": [],
      "/todo-engine/items?type=project": [],
    };
    const goalBodies: Array<{ title: string; horizon: string; scheduled: string; actor: string }> =
      [];
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/todo-engine/goals/propose") {
        const body = JSON.parse(String(init?.body)) as {
          title: string;
          horizon: string;
          scheduled: string;
          actor: string;
        };
        goalBodies.push(body);

        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: `goal-${goalBodies.length}`,
            type: "goal",
            title: body.title,
            status: "approved",
            horizon: body.horizon,
            scheduled: body.scheduled,
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
    await user.click(screen.getByRole("button", { name: "Add planner item" }));

    const yearlyTrigger = screen.getByRole("button", { name: "Period" });
    expect(yearlyTrigger).toHaveTextContent("Year");
    await user.click(yearlyTrigger);
    expect(
      within(screen.getByRole("dialog", { name: "Period" })).getByLabelText("Goal year"),
    ).toHaveValue(yearStart.slice(0, 4));
    await user.keyboard("{Escape}");

    await user.type(screen.getByLabelText("Title"), "Year anchor goal");
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(goalBodies[0]).toEqual({
      title: "Year anchor goal",
      horizon: "year",
      scheduled: yearStart,
      actor: "user",
    });

    await user.click(screen.getByRole("button", { name: "< Back" }));
    await user.click(screen.getByRole("button", { name: "Monthly" }));
    await user.click(screen.getByRole("button", { name: "Add planner item" }));

    expect(screen.getByRole("button", { name: "Period" })).toHaveTextContent("Month");

    await user.type(screen.getByLabelText("Title"), "Month anchor goal");
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(goalBodies[1]).toEqual({
      title: "Month anchor goal",
      horizon: "month",
      scheduled: monthStart,
      actor: "user",
    });
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

    expect(
      await screen.findByRole("heading", { name: testLongDateLabel(today) }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filter planner view" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Group planner view" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sort planner view" })).toBeInTheDocument();
    expect(screen.getByText("Today Task")).toBeInTheDocument();
    expect(screen.getByText("Overdue Task")).toBeInTheDocument();
    expect(screen.queryByText("Upcoming Task")).toBeNull();
    expect(screen.getByText("Inbox Task")).toBeInTheDocument();
    expect(screen.getByLabelText("Scheduled daily work")).toContainElement(
      screen.getByLabelText(testLongDateLabel(today)),
    );
    expect(screen.getByLabelText("Scheduled daily work")).toContainElement(
      screen.getByLabelText(`Before ${testLongDateLabel(today)}`),
    );
    expect(screen.getByLabelText("Daily planner")).toContainElement(
      screen.getByLabelText("Unscheduled"),
    );
    expect(screen.queryByText("Done Task")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Area Should Not Render" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Project Should Not Render" }),
    ).toBeNull();

    await user.click(screen.getByRole("button", { name: "Filter planner view" }));
    const filterDialog = screen.getByRole("dialog", { name: "Filter" });
    expect(filterDialog).not.toHaveClass("planner-control-dropdown-compact");
    await user.click(screen.getByRole("button", { name: "Add filter rule" }));
    await user.click(screen.getByRole("option", { name: "Area" }));
    await user.click(screen.getByRole("button", { name: "Select Area filter values" }));
    await user.click(screen.getByRole("checkbox", { name: "Focus" }));

    expect(screen.getByText("Today Task")).toBeInTheDocument();
    expect(screen.queryByText("Overdue Task")).toBeNull();
    expect(screen.queryByText("Upcoming Task")).toBeNull();
    expect(screen.queryByText("Inbox Task")).toBeNull();
    expect(screen.getByText("1 rules")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add filter rule" }));

    expect(screen.getByText("And")).toBeInTheDocument();
    expect(screen.queryByText("2 rules")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Filter mode" }));
    await user.click(screen.getByRole("option", { name: "Or" }));

    expect(screen.getByText("Or")).toBeInTheDocument();
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
    await user.click(screen.getByRole("button", { name: "Add filter rule" }));
    expect(screen.getByRole("option", { name: "Title" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Item type" })).toBeNull();
    expect(screen.queryByRole("option", { name: "Horizon" })).toBeNull();
    await user.click(screen.getByRole("option", { name: "Tags" }));
    await user.click(screen.getByRole("button", { name: "Select Tags filter values" }));
    await user.click(screen.getByRole("checkbox", { name: "focus" }));

    expect(screen.getByText("Focus Task")).toBeInTheDocument();
    expect(screen.queryByText("Ops Task")).toBeNull();
    expect(screen.getByText("1 rules")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete filter" }));

    expect(screen.getByText("Focus Task")).toBeInTheDocument();
    expect(screen.getByText("Ops Task")).toBeInTheDocument();
  });

  it("hides unsupported filter rules after switching planner views", async () => {
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
                    area_id: "area-1",
                    scheduled: testToday(),
                  },
                  {
                    id: "task-2",
                    type: "task",
                    title: "Ops Task",
                    status: "active",
                    area_id: "area-2",
                    scheduled: testToday(),
                  },
                ]
              : url === "/todo-engine/items?type=area"
                ? [
                    { id: "area-1", type: "area", title: "Focus", status: "active" },
                    { id: "area-2", type: "area", title: "Ops", status: "active" },
                  ]
                : url === "/todo-engine/items?type=goal"
                  ? [
                      {
                        id: "goal-1",
                        type: "goal",
                        title: "Monthly Goal",
                        status: "active",
                        horizon: "month",
                        scheduled: testMonthStart(testToday()),
                        tags: ["month-current"],
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

    await screen.findByText("Focus Task");
    await user.click(screen.getByRole("button", { name: "Filter planner view" }));
    await user.click(screen.getByRole("button", { name: "Add filter rule" }));
    await user.click(screen.getByRole("option", { name: "Area" }));
    await user.click(screen.getByRole("button", { name: "Select Area filter values" }));
    await user.click(screen.getByRole("checkbox", { name: "Focus" }));

    expect(screen.getByText("1 rules")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Monthly" }));
    expect(await screen.findByText("Monthly Goal")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Filter planner view" }));

    expect(screen.queryByText("1 rules")).toBeNull();
    expect(screen.queryByDisplayValue("Title")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Add filter rule" }));
    await user.click(screen.getByRole("option", { name: "Tags" }));
    await user.click(screen.getByRole("button", { name: "Select Tags filter values" }));
    await user.click(screen.getByRole("checkbox", { name: "month-current" }));

    expect(screen.getByText("Monthly Goal")).toBeInTheDocument();
    expect(screen.getByText("1 rules")).toBeInTheDocument();
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
    await user.selectOptions(screen.getByLabelText("Sort field"), "title");

    const selectedDaySection = screen.getByLabelText(testLongDateLabel(testToday()));
    expect(
      within(selectedDaySection).getAllByRole("button").map((button) => button.textContent),
    ).toEqual(["A Task", "B Task"]);

    await user.click(screen.getByRole("button", { name: "Group planner view" }));
    expect(screen.getByRole("dialog", { name: "Group" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Group settings" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Close group settings" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Choose group property" }));
    await user.click(screen.getByRole("option", { name: "Tag" }));

    expect(within(selectedDaySection).getByRole("heading", { name: "focus" })).toBeInTheDocument();
    expect(within(selectedDaySection).getByRole("heading", { name: "ops" })).toBeInTheDocument();
  });

  it("links and dismisses the Group dropdown through its real toolbar events", async () => {
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
    await user.click(screen.getByRole("button", { name: "Daily" }));

    const groupTrigger = screen.getByRole("button", { name: "Group planner view" });
    await user.click(groupTrigger);
    const groupDialog = screen.getByRole("dialog", { name: "Group" });
    expect(groupTrigger).toHaveAttribute("aria-controls", "planner-group-dropdown");
    expect(groupDialog).toHaveAttribute("id", "planner-group-dropdown");
    expect(groupDialog).toHaveClass("planner-control-dropdown-compact");

    await user.click(screen.getByRole("button", { name: "Choose group sort" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox", { name: "Choose group sort" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Group" })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Group" })).not.toBeInTheDocument();
    expect(groupTrigger).toHaveFocus();

    await user.click(groupTrigger);
    fireEvent.mouseDown(document.body);
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Group" })).not.toBeInTheDocument();
    });
    expect(groupTrigger).toHaveFocus();
  });

  it("shows planner date triggers only for weekly and daily views", async () => {
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
    await user.click(screen.getByRole("button", { name: "Yearly" }));

    expect(screen.queryByRole("button", { name: "Choose Weekly date" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Choose Daily date" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Previous week" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Previous day" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Monthly" }));

    expect(screen.queryByRole("button", { name: "Choose Weekly date" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Choose Daily date" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Previous week" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Previous day" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Weekly" }));

    expect(screen.getByRole("button", { name: "Choose Weekly date" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous week" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next week" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Choose Daily date" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Daily" }));

    expect(screen.getByRole("button", { name: "Choose Daily date" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous day" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next day" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Choose Weekly date" })).toBeNull();
  });

  it("keeps the weekly title pill and date navigator in the same leading toolbar group", async () => {
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
    await user.click(screen.getByRole("button", { name: "Weekly" }));

    const titlePill = document.querySelector(".planner-view-pill");
    const trigger = screen.getByRole("button", { name: "Choose Weekly date" });
    const addButton = screen.getByRole("button", { name: "Add planner item" });
    const leadingGroup = trigger.closest(".planner-view-leading");

    expect(titlePill).not.toBeNull();
    expect(leadingGroup).not.toBeNull();
    expect(titlePill?.closest(".planner-view-leading")).toBe(leadingGroup);
    expect(addButton.closest(".planner-view-actions")).not.toBeNull();
    expect(leadingGroup).not.toBe(addButton.closest(".planner-view-actions"));
  });

  it("matches weekly and daily keyboard focus previews to their committed ranges", async () => {
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
    await user.click(screen.getByRole("button", { name: "Weekly" }));

    await user.click(screen.getByRole("button", { name: "Choose Weekly date" }));
    const weeklyPicker = screen.getByRole("dialog", { name: "Choose Weekly date" });
    const weeklyCandidate = within(weeklyPicker)
      .getAllByRole("button")
      .find(
        (button) =>
          button.classList.contains("goal-period-calendar-day") &&
          !button.classList.contains("goal-period-calendar-day-selected"),
      );
    expect(weeklyCandidate).toBeDefined();
    if (!weeklyCandidate) {
      throw new Error("Missing unselected weekly calendar candidate.");
    }

    fireEvent.focus(weeklyCandidate);
    expect(calendarPreviewButtons(weeklyPicker)).toHaveLength(7);

    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Choose Weekly date" })).toBeNull(),
    );

    await user.click(screen.getByRole("button", { name: "Daily" }));
    await user.click(screen.getByRole("button", { name: "Choose Daily date" }));
    const dailyPicker = screen.getByRole("dialog", { name: "Choose Daily date" });
    const dailyCandidate = within(dailyPicker)
      .getAllByRole("button")
      .find(
        (button) =>
          button.classList.contains("goal-period-calendar-day") &&
          !button.classList.contains("goal-period-calendar-day-selected"),
      );
    expect(dailyCandidate).toBeDefined();
    if (!dailyCandidate) {
      throw new Error("Missing unselected daily calendar candidate.");
    }

    fireEvent.focus(dailyCandidate);
    expect(calendarPreviewButtons(dailyPicker)).toHaveLength(1);
  });

  it("dismisses the weekly planner date portal on outside pointer without committing a new period", async () => {
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
    await user.click(screen.getByRole("button", { name: "Weekly" }));

    const weeklyTrigger = screen.getByRole("button", { name: "Choose Weekly date" });
    const triggerTextBefore = weeklyTrigger.textContent;

    await user.click(weeklyTrigger);
    expect(screen.getByRole("dialog", { name: "Choose Weekly date" })).toBeInTheDocument();

    fireEvent.mouseDown(document.body);

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Choose Weekly date" })).toBeNull(),
    );
    expect(screen.getByRole("button", { name: "Choose Weekly date" })).toHaveTextContent(
      triggerTextBefore ?? "",
    );
    expect(screen.getByRole("button", { name: "Choose Weekly date" })).toHaveFocus();
  });

  it("previews and selects planner weeks from the shared calendar popover", async () => {
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
    await user.click(screen.getByRole("button", { name: "Weekly" }));

    const weeklyTrigger = screen.getByRole("button", { name: "Choose Weekly date" });
    expect(
      weeklyTrigger.compareDocumentPosition(screen.getByRole("button", { name: "Now" })) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    await user.click(weeklyTrigger);
    const picker = screen.getByRole("dialog", { name: "Choose Weekly date" });
    const candidate = within(picker)
      .getAllByRole("button")
      .find(
        (button) =>
          button.classList.contains("goal-period-calendar-day") &&
          !button.classList.contains("goal-period-calendar-day-selected"),
      );
    expect(candidate).toBeDefined();
    if (!candidate) {
      throw new Error("Missing unselected weekly calendar candidate.");
    }

    fireEvent.mouseEnter(candidate);
    const { start, end } = calendarSelectionRange(candidate);
    expect(calendarPreviewButtons(picker)).toHaveLength(7);

    await user.click(candidate);

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Choose Weekly date" })).toBeNull(),
    );
    expect(screen.getByRole("heading", { name: start })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: end })).toBeInTheDocument();

    const updatedWeeklyTrigger = screen.getByRole("button", { name: "Choose Weekly date" });
    await user.click(updatedWeeklyTrigger);
    const reopenedPicker = screen.getByRole("dialog", { name: "Choose Weekly date" });
    fireEvent.keyDown(reopenedPicker, { key: "Escape" });

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Choose Weekly date" })).toBeNull(),
    );
    expect(updatedWeeklyTrigger).toHaveFocus();
  });

  it("previews and selects planner days from the shared calendar popover", async () => {
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
    await user.click(screen.getByRole("button", { name: "Daily" }));

    const dailyTrigger = screen.getByRole("button", { name: "Choose Daily date" });
    expect(
      dailyTrigger.compareDocumentPosition(screen.getByRole("button", { name: "Now" })) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    await user.click(dailyTrigger);
    const picker = screen.getByRole("dialog", { name: "Choose Daily date" });
    const candidate = within(picker)
      .getAllByRole("button")
      .find(
        (button) =>
          button.classList.contains("goal-period-calendar-day") &&
          !button.classList.contains("goal-period-calendar-day-selected"),
      );
    expect(candidate).toBeDefined();
    if (!candidate) {
      throw new Error("Missing unselected daily calendar candidate.");
    }

    fireEvent.mouseEnter(candidate);
    expect(calendarPreviewButtons(picker)).toHaveLength(1);

    const selectedDayLabel = calendarSelectionDayLabel(candidate);
    await user.click(candidate);

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Choose Daily date" })).toBeNull(),
    );
    expect(screen.getByRole("heading", { name: selectedDayLabel })).toBeInTheDocument();

    const updatedDailyTrigger = screen.getByRole("button", { name: "Choose Daily date" });
    await user.click(updatedDailyTrigger);
    const reopenedPicker = screen.getByRole("dialog", { name: "Choose Daily date" });
    fireEvent.keyDown(reopenedPicker, { key: "Escape" });

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Choose Daily date" })).toBeNull(),
    );
    expect(updatedDailyTrigger).toHaveFocus();
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
    await user.selectOptions(screen.getByLabelText("Sort field"), "title");
    await user.click(screen.getByRole("button", { name: "Group planner view" }));
    await user.click(screen.getByRole("button", { name: "Choose group property" }));
    await user.click(screen.getByRole("option", { name: "Tag" }));

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
    await user.click(screen.getByRole("button", { name: "Choose group property" }));
    await user.click(screen.getByRole("option", { name: "Area" }));

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
    await user.click(screen.getByRole("button", { name: "Choose group property" }));

    expect(screen.getByRole("option", { name: "None" })).toHaveAttribute("aria-selected", "true");
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
    await user.selectOptions(screen.getByLabelText("Sort field"), "title");
    await user.click(screen.getByRole("button", { name: "Group planner view" }));
    await user.click(screen.getByRole("button", { name: "Choose group property" }));
    await user.click(screen.getByRole("option", { name: "Area" }));

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
    await user.selectOptions(screen.getByLabelText("Sort field"), "title");
    await user.click(screen.getByRole("button", { name: "Group planner view" }));
    await user.click(screen.getByRole("button", { name: "Choose group property" }));
    await user.click(screen.getByRole("option", { name: "Tag" }));

    await user.click(screen.getByRole("button", { name: "Monthly" }));
    await screen.findByText("Alpha Month Goal");
    await user.click(screen.getByRole("button", { name: "Sort planner view" }));
    await user.selectOptions(screen.getByLabelText("Sort field"), "updated");
    await user.click(screen.getByRole("button", { name: "Group planner view" }));
    await user.click(screen.getByRole("button", { name: "Choose group property" }));
    await user.click(screen.getByRole("option", { name: "Status" }));

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
    await user.selectOptions(screen.getByLabelText("Sort field"), "title");

    expect(screen.getByLabelText("Active planner controls")).toBeInTheDocument();
    expect(screen.getByText("Sorted by title")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add sort" }));
    await user.click(
      within(screen.getByRole("listbox", { name: "Sort fields" })).getByRole("option", {
        name: "Updated",
      }),
    );
    const sortRows = screen
      .getAllByLabelText("Drag sort rule")
      .map((handle) => handle.closest(".planner-sort-row") as HTMLElement);
    const dataTransfer = {
      data: new Map<string, string>(),
      setData(type: string, value: string) {
        this.data.set(type, value);
      },
      getData(type: string) {
        return this.data.get(type) ?? "";
      },
    };
    fireEvent.dragStart(sortRows[1], { dataTransfer });
    fireEvent.dragOver(sortRows[0], { dataTransfer });
    fireEvent.drop(sortRows[0], { dataTransfer });

    expect(screen.getByText("Sorted by updated +1")).toBeInTheDocument();
  });

  it("renders yearly period carousel and twelve month goal cards", async () => {
    const user = userEvent.setup();
    const today = testToday();
    const yearStart = testYearStart(today);
    const nextYearStart = testNextYearStart(today);
    const monthStart = testMonthStart(today);
    const responses: Record<string, unknown[]> = {
      "/todo-engine/items?type=goal": [
        { id: "goal-year", type: "goal", title: "Annual Goal", status: "active", horizon: "year", scheduled: yearStart, tags: ["annual-current"] },
        { id: "goal-other-year", type: "goal", title: "Other Year Goal", status: "active", horizon: "year", scheduled: nextYearStart, tags: ["annual-future"] },
        { id: "goal-month", type: "goal", title: "Monthly Goal", status: "active", horizon: "month", scheduled: monthStart, tags: ["month-current"] },
        { id: "goal-year-done", type: "goal", title: "Completed Annual Goal", status: "completed", horizon: "year", scheduled: yearStart, tags: ["annual-done"] },
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

    expect(await screen.findByRole("region", { name: "Year goal carousel" })).toBeInTheDocument();
    expect(screen.getByText("Annual Goal")).toBeInTheDocument();
    expect(screen.getByText("Other Year Goal")).toBeInTheDocument();
    expect(screen.queryByText("Completed Annual Goal")).toBeNull();
    expect(screen.getAllByTestId("yearly-month-card")).toHaveLength(12);
    expect(
      screen.getByRole("region", { name: `${testMonthLabel(monthStart)} goals` }),
    ).toHaveTextContent("Monthly Goal");
    expect(screen.getByRole("button", { name: "Previous year" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next year" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Now" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Filter planner view" }));
    await user.click(screen.getByRole("button", { name: "Add filter rule" }));
    expect(screen.getByRole("option", { name: "Horizon" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Parent" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Priority" })).toBeNull();
    await user.click(screen.getByRole("option", { name: "Tags" }));
    await user.click(screen.getByRole("button", { name: "Select Tags filter values" }));
    expect(screen.getByRole("checkbox", { name: "annual-current" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "annual-future" })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: "annual-done" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Group planner view" }));
    await user.click(screen.getByRole("button", { name: "Choose group property" }));
    await user.click(screen.getByRole("option", { name: "Tag" }));
    const yearlyGroupPanel = screen.getByRole("dialog", { name: "Group" });
    expect(within(yearlyGroupPanel).getByText("annual-current")).toBeInTheDocument();
    expect(within(yearlyGroupPanel).getByText("month-current")).toBeInTheDocument();
    expect(within(yearlyGroupPanel).queryByText("annual-future")).toBeNull();
  });

  it("renders monthly period carousel and ISO Monday week goal cards", async () => {
    const user = userEvent.setup();
    const today = testToday();
    const monthStart = testMonthStart(today);
    const nextMonthStart = testNextMonthStart(today);
    const firstWeekStart = testWeekStart(monthStart);
    const secondWeekStart = testAddDays(firstWeekStart, 7);
    const firstWeekEventDate = testAddDays(firstWeekStart, 2);
    const responses: Record<string, unknown[]> = {
      "/todo-engine/items?type=goal": [
        { id: "goal-month", type: "goal", title: "Monthly Goal", status: "active", horizon: "month", scheduled: monthStart, tags: ["month-current"] },
        { id: "goal-other-month", type: "goal", title: "Other Month Goal", status: "active", horizon: "month", scheduled: nextMonthStart, tags: ["month-future"] },
        { id: "goal-week-1", type: "goal", title: "First Week Goal", status: "active", horizon: "week", scheduled: firstWeekStart, tags: ["week-current"] },
        { id: "goal-week-2", type: "goal", title: "Second Week Goal", status: "active", horizon: "week", scheduled: secondWeekStart, tags: ["week-current"] },
        { id: "goal-week-done", type: "goal", title: "Done Week Goal", status: "completed", horizon: "week", scheduled: firstWeekStart, tags: ["week-done"] },
      ],
      "/todo-engine/items?type=task": [
        { id: "task-month", type: "task", title: "Month Task", status: "active", scheduled: firstWeekStart, tags: ["month-todo"], updated_at: "2026-07-01T09:00:00Z" },
        { id: "task-month-2", type: "task", title: "Second Month Task", status: "active", scheduled: firstWeekStart, tags: ["month-todo"], updated_at: "2026-07-01T08:00:00Z" },
        { id: "task-month-3", type: "task", title: "Hidden Month Task", status: "active", scheduled: firstWeekStart, tags: ["month-todo"], updated_at: "2026-07-01T07:00:00Z" },
      ],
      "/todo-engine/items?type=event": [
        { id: "event-month", type: "event", title: "Month Event", status: "active", scheduled: firstWeekEventDate, tags: ["month-todo"] },
      ],
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
    await user.click(screen.getByRole("button", { name: "Monthly" }));

    expect(await screen.findByRole("region", { name: "Month goal carousel" })).toBeInTheDocument();
    expect(screen.getByText("Monthly Goal")).toBeInTheDocument();
    expect(screen.getByText("Other Month Goal")).toBeInTheDocument();
    expect(screen.getByRole("grid", { name: "Monthly todo calendar" })).toBeInTheDocument();
    expect(screen.getAllByTestId("monthly-week-row").length).toBeGreaterThanOrEqual(4);
    expect(screen.getAllByTestId("monthly-day-card").length).toBeGreaterThanOrEqual(28);
    expect(screen.getByRole("gridcell", { name: `${firstWeekStart} todo` })).toHaveTextContent("Month Task");
    expect(screen.getByRole("gridcell", { name: `${firstWeekStart} todo` })).toHaveTextContent("Second Month Task");
    expect(screen.getByRole("gridcell", { name: `${firstWeekStart} todo` })).toHaveTextContent("+1 more");
    expect(screen.queryByText("Hidden Month Task")).toBeNull();
    expect(screen.getByRole("gridcell", { name: `${firstWeekEventDate} todo` })).toHaveTextContent("Month Event");
    expect(screen.getAllByTestId("monthly-week-goal-rail").length).toBeGreaterThanOrEqual(4);
    expect(screen.getByRole("region", { name: "W1 goals" })).toHaveTextContent("First Week Goal");
    expect(screen.getByRole("region", { name: "W2 goals" })).toHaveTextContent("Second Week Goal");
    expect(screen.queryByText("Done Week Goal")).toBeNull();
    expect(screen.getByRole("button", { name: "Previous month" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next month" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Now" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Group planner view" }));
    await user.click(screen.getByRole("button", { name: "Choose group property" }));
    await user.click(screen.getByRole("option", { name: "Tag" }));
    const monthlyGroupPanel = screen.getByRole("dialog", { name: "Group" });
    expect(within(monthlyGroupPanel).getByText("month-current")).toBeInTheDocument();
    expect(within(monthlyGroupPanel).getByText("week-current")).toBeInTheDocument();
    expect(within(monthlyGroupPanel).queryByText("month-future")).toBeNull();
  });

  it("moves monthly periods with arrows and returns with Now", async () => {
    const user = userEvent.setup();
    const today = testToday();
    const monthStart = testMonthStart(today);
    const nextMonthStart = testNextMonthStart(today);
    const responses: Record<string, unknown[]> = {
      "/todo-engine/items?type=goal": [
        { id: "current", type: "goal", title: "Current Month", status: "active", horizon: "month", scheduled: monthStart },
        { id: "next", type: "goal", title: "Next Month", status: "active", horizon: "month", scheduled: nextMonthStart },
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
    await user.click(screen.getByRole("button", { name: "Monthly" }));

    expect(await screen.findByText("Current Month")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next month" }));
    expect(await screen.findByText("Next Month")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Now" }));
    expect(await screen.findByText("Current Month")).toBeInTheDocument();
  });

  it("disables Now when yearly or monthly planner already matches the current period", async () => {
    const user = userEvent.setup();
    const today = testToday();
    const yearStart = testYearStart(today);
    const monthStart = testMonthStart(today);
    const responses: Record<string, unknown[]> = {
      "/todo-engine/items?type=goal": [
        { id: "current-year", type: "goal", title: "Current Year", status: "active", horizon: "year", scheduled: yearStart },
        { id: "current-month", type: "goal", title: "Current Month", status: "active", horizon: "month", scheduled: monthStart },
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

    expect(await screen.findByText("Current Year")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Now" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Monthly" }));

    expect(await screen.findByText("Current Month")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Now" })).toBeDisabled();
  });

  it("includes same-year month goal tags in yearly planner filters", async () => {
    const user = userEvent.setup();
    const today = testToday();
    const yearStart = testYearStart(today);
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
                    id: "goal-year",
                    type: "goal",
                    title: "Annual Goal",
                    status: "active",
                    horizon: "year",
                    scheduled: yearStart,
                    tags: ["annual-current"],
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
                ]
              : [],
        }),
      ),
    );

    render(<WorkbenchPageClient />);

    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    await screen.findByText("Annual Goal");

    await user.click(screen.getByRole("button", { name: "Filter planner view" }));
    await user.click(screen.getByRole("button", { name: "Add filter rule" }));
    await user.click(screen.getByRole("option", { name: "Tags" }));
    await user.click(screen.getByRole("button", { name: "Select Tags filter values" }));
    expect(screen.getByRole("checkbox", { name: "annual-current" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "month-current" })).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "month-current" }));

    expect(screen.getByText("Monthly Goal")).toBeInTheDocument();
    expect(screen.queryByText("Annual Goal")).toBeNull();
  });

  it("includes intersecting week goal tags in monthly planner filters", async () => {
    const user = userEvent.setup();
    const today = testToday();
    const monthStart = testMonthStart(today);
    const firstWeekStart = testWeekStart(monthStart);
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          json: async () =>
            url === "/todo-engine/items?type=goal"
              ? [
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
                    id: "goal-week-1",
                    type: "goal",
                    title: "First Week Goal",
                    status: "active",
                    horizon: "week",
                    scheduled: firstWeekStart,
                    tags: ["week-current"],
                  },
                ]
              : [],
        }),
      ),
    );

    render(<WorkbenchPageClient />);

    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    await user.click(screen.getByRole("button", { name: "Monthly" }));
    await screen.findByText("Monthly Goal");

    await user.click(screen.getByRole("button", { name: "Filter planner view" }));
    await user.click(screen.getByRole("button", { name: "Add filter rule" }));
    await user.click(screen.getByRole("option", { name: "Tags" }));
    await user.click(screen.getByRole("button", { name: "Select Tags filter values" }));
    expect(screen.getByRole("checkbox", { name: "month-current" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "week-current" })).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "week-current" }));

    expect(screen.getByText("First Week Goal")).toBeInTheDocument();
    expect(screen.queryByText("Monthly Goal")).toBeNull();
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

    const tagField = await screen.findByRole("button", { name: "Tags for Plan" });
    expect(within(tagField).queryByRole("textbox")).toBeNull();
    await user.click(tagField);
    const tags = screen.getByPlaceholderText("Search for an option...");
    await user.type(tags, " deep-work, deep-work, planning ");
    fireEvent.blur(tags);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Remove planning tag" })).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Remove deep-work tag" })).toBeInTheDocument();
  });

  it("turns entered workspace tags into removable chips", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/todo-engine/items/task-1" && init?.method === "PATCH") {
        const body = JSON.parse(String(init.body)) as { tags: string[] };

        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "task-1",
            type: "task",
            title: "Plan",
            status: "active",
            tags: body.tags,
          }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () =>
          url === "/todo-engine/items?type=task"
            ? [
                {
                  id: "task-1",
                  type: "task",
                  title: "Plan",
                  status: "active",
                  tags: ["deep-work"],
                },
              ]
            : [],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Tasks" }));

    await user.click(await screen.findByRole("button", { name: "Tags for Plan" }));
    const tags = screen.getByPlaceholderText("Search for an option...");
    await user.type(tags, "planning{Enter}");

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/todo-engine/items/task-1",
        expect.objectContaining({
          body: JSON.stringify({ tags: ["deep-work", "planning"] }),
          method: "PATCH",
        }),
      ),
    );
    await user.click(screen.getByRole("button", { name: "Remove planning tag" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/todo-engine/items/task-1",
        expect.objectContaining({
          body: JSON.stringify({ tags: ["deep-work"] }),
          method: "PATCH",
        }),
      ),
    );
  });

  it("selects stored tags from the workspace tag dropdown", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/todo-engine/items/task-1" && init?.method === "PATCH") {
        const body = JSON.parse(String(init.body)) as { tags: string[] };

        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "task-1",
            type: "task",
            title: "Plan",
            status: "active",
            tags: body.tags,
          }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => {
          if (url === "/todo-engine/items") {
            return [
              { id: "task-1", type: "task", title: "Plan", status: "active", tags: ["deep-work"] },
              { id: "project-1", type: "project", title: "Roadmap", status: "active", tags: ["planning"] },
              { id: "area-1", type: "area", title: "Ops", status: "active", tags: ["ops"] },
            ];
          }

          return url === "/todo-engine/items?type=task"
            ? [
                {
                  id: "task-1",
                  type: "task",
                  title: "Plan",
                  status: "active",
                  tags: ["deep-work"],
                },
              ]
            : [];
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Tasks" }));

    const tagField = await screen.findByRole("button", { name: "Tags for Plan" });
    expect(within(tagField).queryByRole("textbox")).toBeNull();
    await user.click(tagField);

    expect(screen.getByPlaceholderText("Search for an option...")).toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: "planning" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/todo-engine/items/task-1",
        expect.objectContaining({
          body: JSON.stringify({ tags: ["deep-work", "planning"] }),
          method: "PATCH",
        }),
      ),
    );
  });

  it("waits for IME composition to finish before committing a tag", async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/todo-engine/items/task-1" && init?.method === "PATCH") {
        const body = JSON.parse(String(init.body)) as { tags: string[] };

        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "task-1",
            type: "task",
            title: "Plan",
            status: "active",
            tags: body.tags,
          }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () =>
          url === "/todo-engine/items?type=task"
            ? [
                {
                  id: "task-1",
                  type: "task",
                  title: "Plan",
                  status: "active",
                  tags: ["deep-work"],
                },
              ]
            : [],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Tasks" }));

    await user.click(await screen.findByRole("button", { name: "Tags for Plan" }));
    const tags = screen.getByPlaceholderText("Search for an option...");
    fireEvent.change(tags, { target: { value: "새 태그" } });
    fireEvent.keyDown(tags, { key: "Enter", isComposing: true });

    expect(fetchMock.mock.calls.filter(([url]) => url === "/todo-engine/items/task-1")).toEqual([]);

    fireEvent.keyDown(tags, { key: "Enter", isComposing: false });

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/todo-engine/items/task-1",
        expect.objectContaining({
          body: JSON.stringify({ tags: ["deep-work", "새 태그"] }),
          method: "PATCH",
        }),
      ),
    );
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

    await user.click(await screen.findByRole("button", { name: "Tags for Plan" }));
    const tags = screen.getByPlaceholderText("Search for an option...");
    await user.type(tags, " deep-work, planning ");
    fireEvent.blur(tags);

    expect(screen.getByRole("button", { name: "Remove deep-work tag" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove planning tag" })).toBeInTheDocument();
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
    expect(screen.getByRole("button", { name: "Period for June outcome" })).toHaveTextContent(
      "Month",
    );
    expect(screen.queryByLabelText("Due for June outcome")).toBeNull();
    expect(screen.queryByLabelText("Horizon for June outcome")).toBeNull();
    expect(screen.queryByLabelText("Scheduled for June outcome")).toBeNull();
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
    expect(screen.getByRole("button", { name: "Period" })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole("button", { name: "Create" })).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Create Goals item" })).toBeNull();
  });

  it("creates workspace goals through one period control", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/todo-engine/goals/propose" && init?.method === "POST") {
        expect(init.body).toBe(
          JSON.stringify({
            title: "July goal",
            horizon: "month",
            scheduled: "2026-07-01",
            actor: "user",
          }),
        );
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "goal-new",
            type: "goal",
            title: "July goal",
            status: "approved",
            horizon: "month",
            scheduled: "2026-07-01",
          }),
        });
      }

      return Promise.resolve({ ok: true, json: async () => [] });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Goals" }));
    await user.click(screen.getByRole("button", { name: "Add item" }));

    const trigger = screen.getByRole("button", { name: "Period" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("dialog", { name: "Period" })).toBeNull();
    expect(screen.queryByLabelText("Scheduled")).toBeNull();
    expect(screen.queryByLabelText("Horizon")).toBeNull();
    expect(screen.queryByLabelText("Due")).toBeNull();

    await user.type(screen.getByLabelText("Title"), "July goal");
    await user.click(trigger);
    const picker = screen.getByRole("dialog", { name: "Period" });
    expect(within(picker).getByRole("button", { name: "Year" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(picker).getByRole("button", { name: "Month" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    await user.click(within(picker).getByRole("button", { name: "Month" }));
    expect(screen.getByRole("dialog", { name: "Period" })).toBeInTheDocument();
    expect(trigger).toHaveTextContent("Year");

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Period" })).toBeNull();
    expect(trigger).toHaveTextContent("Year");

    await user.click(trigger);
    const committedPicker = screen.getByRole("dialog", { name: "Period" });
    await user.click(within(committedPicker).getByRole("button", { name: "Month" }));
    await user.click(within(committedPicker).getByRole("button", { name: "July 2026" }));
    expect(screen.queryByRole("dialog", { name: "Period" })).toBeNull();
    expect(trigger).toHaveTextContent("Month");

    await user.click(trigger);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("dialog", { name: "Period" })).toBeNull();
    expect(trigger).toHaveTextContent("Month");

    await user.click(screen.getByRole("button", { name: "Create" }));
    expect(fetchMock).toHaveBeenCalledWith(
      "/todo-engine/goals/propose",
      expect.objectContaining({ method: "POST" }),
    );
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
    const detailView = screen.getByLabelText("One details");
    expect(detailView.querySelector(".detail-header")).not.toBeNull();
    expect(detailView.querySelector(".detail-properties-list")).not.toBeNull();
    expect(detailView.querySelector(".detail-properties-grid")).toBeNull();
    expect(screen.getByRole("button", { name: "< Back" }).textContent).toBe("");
    const saveButton = screen.getByRole("button", { name: "Save" });
    expect(saveButton.textContent).toBe("");
    expect(saveButton).toBeDisabled();
    expect(detailView.querySelector(".detail-header")?.contains(saveButton)).toBe(true);
    expect(
      screen
        .getByText("Created")
        .compareDocumentPosition(screen.getByText("Description")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    await user.clear(screen.getByLabelText("Note"));
    await user.type(screen.getByLabelText("Note"), "Saved note");
    expect(saveButton).toBeEnabled();
    await user.click(saveButton);

    expect(fetchMock).toHaveBeenCalledWith(
      "/todo-engine/items/task-1",
      expect.objectContaining({ method: "PATCH" }),
    );

    await user.click(screen.getByRole("button", { name: "< Back" }));
    expect(screen.getByRole("table", { name: "Tasks items" })).toBeInTheDocument();
  });

  it("does not activate an approved goal when saving an unrelated detail field", async () => {
    const user = userEvent.setup();
    let apiStatus = "approved";
    let apiNote = "Old note";
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/todo-engine/items/goal-1" && init?.method === "PATCH") {
        apiNote = "Saved note";
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "goal-1",
            type: "goal",
            title: "Approved goal",
            status: apiStatus,
            note: apiNote,
            horizon: "month",
          }),
        });
      }

      if (url === "/todo-engine/items/goal-1/activate") {
        apiStatus = "active";
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "goal-1",
            type: "goal",
            title: "Approved goal",
            status: apiStatus,
            note: apiNote,
            horizon: "month",
          }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => [
          {
            id: "goal-1",
            type: "goal",
            title: "Approved goal",
            status: apiStatus,
            note: apiNote,
            horizon: "month",
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Goals" }));
    await user.click(await screen.findByRole("cell", { name: "Approved goal" }));

    expect(screen.getByLabelText("Status for Approved goal")).toHaveValue("active");
    await user.clear(screen.getByLabelText("Note"));
    await user.type(screen.getByLabelText("Note"), "Saved note");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/todo-engine/items/goal-1",
        expect.objectContaining({ method: "PATCH" }),
      );
    });
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/todo-engine/items/goal-1/activate",
      expect.objectContaining({ method: "POST" }),
    );
    expect(apiStatus).toBe("approved");
    expect(screen.getByLabelText("Status for Approved goal")).toHaveValue("active");
  });

  it("keeps detail tag clicks from triggering chip removal", async () => {
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
                    title: "One",
                    status: "active",
                    tags: ["deep-work", "planning"],
                  },
                ]
              : [],
        }),
      ),
    );

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Tasks" }));
    await user.click(await screen.findByRole("cell", { name: "One" }));

    const tagField = screen.getByRole("button", { name: "Tags" });
    expect(tagField.closest("label")).toBeNull();
    await user.click(tagField);

    expect(screen.getByRole("button", { name: "Remove deep-work tag" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove planning tag" })).toBeInTheDocument();
  });

  it("keeps detail long-text drafts while relation edits wait for Save", async () => {
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
    });
    expect(fetchMock.mock.calls.find(([url]) => url === "/todo-engine/items/task-1")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/todo-engine/items/task-1/activate",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("skips detail patch requests when save only changes status", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/todo-engine/items/task-1/complete") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "task-1",
            type: "task",
            title: "One",
            status: "completed",
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
            status: "active",
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

    await user.selectOptions(screen.getByLabelText("Status for One"), "completed");
    await user.click(screen.getByRole("button", { name: "Save" }));

    const patchCalls = fetchMock.mock.calls.filter(
      ([url, init]) =>
        url === "/todo-engine/items/task-1" &&
        (init as RequestInit | undefined)?.method === "PATCH",
    );

    expect(patchCalls).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledWith(
      "/todo-engine/items/task-1/complete",
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
    expectFieldBeforeProperty("Priority", "Created");
    expectPropertyImmediatelyBeforeProperty("Created", "Updated");
    expectPropertyImmediatelyBeforeField("Updated", "Description");

    await user.clear(screen.getByLabelText("Description"));
    await user.type(screen.getByLabelText("Description"), "Updated description");
    await user.clear(screen.getByLabelText("Note"));
    await user.type(screen.getByLabelText("Note"), "Updated note");
    await user.selectOptions(screen.getByLabelText("Priority"), "2");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByDisplayValue("Updated description")).toBeInTheDocument();
  });

  it("places timestamps directly above note when detail has no description", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: async () => [
            {
              id: "area-1",
              type: "area",
              title: "Finance",
              status: "active",
              review_cycle: "weekly",
              standard: "Keep accounts clean",
              note: "Monthly close",
              created_at: "2026-07-01T00:00:00Z",
              updated_at: "2026-07-02T00:00:00Z",
            },
          ],
        }),
      ),
    );

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Areas" }));
    await user.click(await screen.findByRole("cell", { name: "Finance" }));

    expectFieldBeforeProperty("Standard", "Created");
    expectPropertyImmediatelyBeforeProperty("Created", "Updated");
    expectPropertyImmediatelyBeforeField("Updated", "Note");
  });

  it("selects task priority from a detail dropdown", async () => {
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
    expect(priority.tagName).toBe("SELECT");
    expect(within(priority).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "-",
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "10",
    ]);
    await user.selectOptions(priority, "10");
    expect(priority).toHaveValue("10");

    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(fetchMock).toHaveBeenCalledWith(
      "/todo-engine/items/task-1",
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  it("shows the same goal fields in the table and detail", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          {
            id: "goal-1",
            type: "goal",
            title: "June outcome",
            status: "approved",
            horizon: "month",
            scheduled: "2026-06-01",
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
            note: "",
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-02T00:00:00Z",
          },
        ],
      });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Goals" }));

    expect(screen.getByRole("button", { name: "Period for June outcome" })).toHaveTextContent(
      "Month",
    );
    expect(screen.queryByRole("dialog", { name: "Period for June outcome" })).toBeNull();
    expect(screen.queryByLabelText("Due for June outcome")).toBeNull();
    expect(screen.queryByLabelText("Horizon for June outcome")).toBeNull();
    expect(screen.queryByLabelText("Scheduled for June outcome")).toBeNull();
    expect(screen.getAllByRole("cell", { name: "Root objective" })).toHaveLength(2);
    expect(screen.getByRole("cell", { name: "Ship the monthly target" })).toBeInTheDocument();

    await user.click(screen.getByRole("cell", { name: "June outcome" }));

    expect(screen.getByRole("button", { name: "Period" })).toHaveTextContent("Month");
    const periodRow = screen.getByRole("button", { name: "Period" }).closest(".field-label");
    expect(periodRow).not.toBeNull();
    if (!periodRow) {
      throw new Error("Missing Period field row");
    }
    expect(periodRow.querySelector(".goal-period-control")).not.toBeNull();
    expect(periodRow.nextElementSibling).toBe(fieldRow("Parent"));
    expect(screen.queryByRole("dialog", { name: "Period" })).toBeNull();
    expect(screen.queryByLabelText("Due")).toBeNull();
    expect(screen.queryByLabelText("Horizon")).toBeNull();
    expect(screen.queryByLabelText("Scheduled")).toBeNull();
    expect(screen.getByLabelText("Parent")).toHaveValue("goal-root");
    expect(screen.getByLabelText("Note")).toHaveValue("Ship the monthly target");
    expect(screen.getByText("2026-06-01")).toBeInTheDocument();
    expect(screen.getByText("2026-06-02")).toBeInTheDocument();

    const detailTrigger = screen.getByRole("button", { name: "Period" });
    await user.click(detailTrigger);
    const detailPicker = screen.getByRole("dialog", { name: "Period" });
    await user.click(within(detailPicker).getByRole("button", { name: "Week" }));
    await user.click(within(detailPicker).getByRole("button", { name: /June 10, 2026/ }));

    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    expect(
      fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH"),
    ).toHaveLength(0);
  });

  it("patches a goal period through the inline calendar with an ISO week anchor", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (String(url).includes("/items/goal-1") && init?.method === "PATCH") {
        expect(init.body).toBe(
          JSON.stringify({ horizon: "week", scheduled: "2026-07-06" }),
        );
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "goal-1",
            type: "goal",
            title: "Goal",
            status: "approved",
            horizon: "week",
            scheduled: "2026-07-06",
          }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => [
          {
            id: "goal-1",
            type: "goal",
            title: "Goal",
            status: "approved",
            horizon: "month",
            scheduled: "2026-06-01",
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Goals" }));

    const trigger = await screen.findByRole("button", { name: "Period for Goal" });
    await user.click(trigger);
    const picker = screen.getByRole("dialog", { name: "Period for Goal" });
    await user.click(within(picker).getByRole("button", { name: "Week" }));

    expect(
      fetchMock.mock.calls.filter(
        ([url, init]) => String(url).includes("/items/goal-1") && init?.method === "PATCH",
      ),
    ).toHaveLength(0);

    await user.click(within(picker).getByRole("button", { name: /July 10, 2026/ }));
    expect(screen.queryByRole("dialog", { name: "Period for Goal" })).toBeNull();

    expect(fetchMock).toHaveBeenCalledWith(
      "/todo-engine/items/goal-1",
      expect.objectContaining({ method: "PATCH" }),
    );
    expect(screen.queryByRole("heading", { name: "Goal" })).not.toBeInTheDocument();
  });

  it("previews and selects goal weeks as a full calendar row", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: async () => [
            {
              id: "goal-1",
              type: "goal",
              title: "Goal",
              status: "approved",
              horizon: "week",
              scheduled: "2026-07-06",
            },
          ],
        }),
      ),
    );

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Goals" }));

    await user.click(await screen.findByRole("button", { name: "Period for Goal" }));
    const picker = screen.getByRole("dialog", { name: "Period for Goal" });
    const july17 = within(picker).getByRole("button", { name: /July 17, 2026/ });

    const selectedDays = within(picker)
      .getAllByRole("button")
      .filter((button) =>
        button.classList.contains("goal-period-calendar-day-selected"),
      );
    expect(selectedDays.map((button) => button.textContent)).toEqual([
      "6",
      "7",
      "8",
      "9",
      "10",
      "11",
      "12",
    ]);

    fireEvent.mouseEnter(july17);

    const stillSelectedDays = within(picker)
      .getAllByRole("button")
      .filter((button) =>
        button.classList.contains("goal-period-calendar-day-selected"),
      );
    expect(stillSelectedDays.map((button) => button.textContent)).toEqual([
      "6",
      "7",
      "8",
      "9",
      "10",
      "11",
      "12",
    ]);

    const previewDays = within(picker)
      .getAllByRole("button")
      .filter((button) =>
        button.classList.contains("goal-period-calendar-day-preview"),
      );
    expect(previewDays.map((button) => button.textContent)).toEqual([
      "13",
      "14",
      "15",
      "16",
      "17",
      "18",
      "19",
    ]);
    expect(previewDays[0]).toHaveClass("goal-period-calendar-day-range-start");
    expect(previewDays[6]).toHaveClass("goal-period-calendar-day-range-end");

    fireEvent.mouseLeave(july17);
    expect(
      within(picker)
        .getAllByRole("button")
        .filter((button) =>
          button.classList.contains("goal-period-calendar-day-preview"),
        ),
    ).toHaveLength(0);
  });

  it("selects a goal month from a year-scoped month grid", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/todo-engine/items/goal-1" && init?.method === "PATCH") {
        expect(init.body).toBe(
          JSON.stringify({ horizon: "month", scheduled: "2027-03-01" }),
        );

        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "goal-1",
            type: "goal",
            title: "Goal",
            status: "approved",
            horizon: "month",
            scheduled: "2027-03-01",
          }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => [
          {
            id: "goal-1",
            type: "goal",
            title: "Goal",
            status: "approved",
            horizon: "month",
            scheduled: "2026-06-01",
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Goals" }));

    await user.click(await screen.findByRole("button", { name: "Period for Goal" }));
    const picker = screen.getByRole("dialog", { name: "Period for Goal" });

    expect(within(picker).getByText("2026")).toBeInTheDocument();
    expect(within(picker).getByRole("button", { name: "June 2026" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(picker).queryByRole("button", { name: /June 10, 2026/ })).toBeNull();

    await user.click(within(picker).getByRole("button", { name: "Next year" }));
    expect(within(picker).getByText("2027")).toBeInTheDocument();
    await user.click(within(picker).getByRole("button", { name: "March 2027" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Period for Goal" })).toBeNull(),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/todo-engine/items/goal-1",
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  it("returns the month picker to this year without committing a period", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-07-15T12:00:00"));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    try {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) =>
      Promise.resolve({
        ok: true,
        json: async () => [
          {
            id: "goal-1",
            type: "goal",
            title: "Goal",
            status: "approved",
            horizon: "month",
            scheduled: "2026-06-01",
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Goals" }));

    await user.click(await screen.findByRole("button", { name: "Period for Goal" }));
    const picker = screen.getByRole("dialog", { name: "Period for Goal" });
    const currentYear = new Date().getFullYear();
    const scheduledYear = 2026;
    const navigatingBack = scheduledYear > currentYear;
    const navigationLabel = navigatingBack ? "Previous year" : "Next year";
    const navigatedYear = navigatingBack ? scheduledYear - 1 : scheduledYear + 1;

    await user.click(within(picker).getByRole("button", { name: navigationLabel }));
    expect(within(picker).getByText(String(navigatedYear))).toBeInTheDocument();
    expect(within(picker).getByRole("button", { name: "This year" })).toBeEnabled();

    await user.click(within(picker).getByRole("button", { name: "This year" }));

    expect(within(picker).getByText(String(currentYear))).toBeInTheDocument();
    expect(within(picker).getByRole("button", { name: "This year" })).toBeDisabled();
    expect(
      fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH"),
    ).toHaveLength(0);
    expect(screen.getByRole("dialog", { name: "Period for Goal" })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns the week calendar to this month without committing a period", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-07-15T12:00:00"));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    try {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) =>
      Promise.resolve({
        ok: true,
        json: async () => [
          {
            id: "goal-1",
            type: "goal",
            title: "Goal",
            status: "approved",
            horizon: "week",
            scheduled: "2026-07-06",
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Goals" }));

    await user.click(await screen.findByRole("button", { name: "Period for Goal" }));
    const picker = screen.getByRole("dialog", { name: "Period for Goal" });
    const currentMonthStart = testMonthStart(testToday());
    const scheduledMonthStart = "2026-07-01";
    const navigatingBack = scheduledMonthStart > currentMonthStart;
    const navigationLabel = navigatingBack ? "Previous month" : "Next month";
    const navigatedMonthStart = navigatingBack
      ? testPreviousMonthStart(scheduledMonthStart)
      : testNextMonthStart(scheduledMonthStart);

    await user.click(within(picker).getByRole("button", { name: navigationLabel }));
    expect(
      within(picker).getByText(monthLabelForDate(new Date(`${navigatedMonthStart}T00:00:00`))),
    ).toBeInTheDocument();
    expect(within(picker).getByRole("button", { name: "This month" })).toBeEnabled();

    await user.click(within(picker).getByRole("button", { name: "This month" }));

    expect(within(picker).getByText(monthLabelForDate(new Date()))).toBeInTheDocument();
    expect(within(picker).getByRole("button", { name: "This month" })).toBeDisabled();
    expect(
      fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH"),
    ).toHaveLength(0);
    expect(screen.getByRole("dialog", { name: "Period for Goal" })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses a fixed viewport popover, repositions on scroll, and restores focus on escape", async () => {
    const user = userEvent.setup();
    const addEventListenerSpy = vi.spyOn(window, "addEventListener");
    const removeEventListenerSpy = vi.spyOn(window, "removeEventListener");

    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: async () => [
            {
              id: "goal-1",
              type: "goal",
              title: "Goal",
              status: "approved",
              horizon: "month",
              scheduled: "2026-06-01",
            },
          ],
        }),
      ),
    );

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Goals" }));

    const trigger = await screen.findByRole("button", { name: "Period for Goal" });
    await user.click(trigger);

    const picker = screen.getByRole("dialog", { name: "Period for Goal" });
    await waitFor(() =>
      expect(within(picker).getByRole("button", { name: "Month" })).toHaveFocus(),
    );
    expect(picker).toHaveStyle({
      position: "fixed",
      overflowY: "auto",
    });
    expect(picker.style.maxHeight).not.toBe("");
    expect(document.body).toContainElement(picker);
    expect(screen.getByLabelText("Goals items")).not.toContainElement(picker);
    expect(
      addEventListenerSpy.mock.calls.some(([type]) => type === "resize"),
    ).toBe(true);
    expect(
      addEventListenerSpy.mock.calls.some(
        ([type, _listener, options]) => type === "scroll" && options === true,
      ),
    ).toBe(true);

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Period for Goal" })).toBeNull();
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(
      removeEventListenerSpy.mock.calls.some(([type]) => type === "resize"),
    ).toBe(true);
    expect(
      removeEventListenerSpy.mock.calls.some(
        ([type, _listener, options]) => type === "scroll" && options === true,
      ),
    ).toBe(true);
  });

  it("commits a same-year month goal to year exactly once and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/todo-engine/items/goal-1" && init?.method === "PATCH") {
        expect(init.body).toBe(
          JSON.stringify({ horizon: "year", scheduled: "2026-01-01" }),
        );

        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "goal-1",
            type: "goal",
            title: "Goal",
            status: "approved",
            horizon: "year",
            scheduled: "2026-01-01",
          }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => [
          {
            id: "goal-1",
            type: "goal",
            title: "Goal",
            status: "approved",
            horizon: "month",
            scheduled: "2026-06-01",
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Goals" }));

    const trigger = await screen.findByRole("button", { name: "Period for Goal" });
    await user.click(trigger);
    const picker = screen.getByRole("dialog", { name: "Period for Goal" });

    await user.click(within(picker).getByRole("button", { name: "Year" }));
    await user.selectOptions(within(picker).getByLabelText("Goal year"), "2026");

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Period for Goal" })).toBeNull());
    expect(
      fetchMock.mock.calls.filter(
        ([url, init]) => url === "/todo-engine/items/goal-1" && init?.method === "PATCH",
      ),
    ).toHaveLength(1);
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(trigger).toHaveTextContent("Year");
  });

  it("commits a goal year through a scrollable year dropdown", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/todo-engine/items/goal-1" && init?.method === "PATCH") {
        expect(init.body).toBe(
          JSON.stringify({ horizon: "year", scheduled: "2040-01-01" }),
        );

        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "goal-1",
            type: "goal",
            title: "Goal",
            status: "approved",
            horizon: "year",
            scheduled: "2040-01-01",
          }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => [
          {
            id: "goal-1",
            type: "goal",
            title: "Goal",
            status: "approved",
            horizon: "month",
            scheduled: "2026-06-01",
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Goals" }));

    await user.click(await screen.findByRole("button", { name: "Period for Goal" }));
    const picker = screen.getByRole("dialog", { name: "Period for Goal" });
    await user.click(within(picker).getByRole("button", { name: "Year" }));

    const yearSelect = within(picker).getByLabelText("Goal year");
    expect(yearSelect.tagName).toBe("SELECT");
    const currentYear = new Date().getFullYear();
    expect(
      within(yearSelect).getByRole("option", { name: String(currentYear - 50) }),
    ).toBeInTheDocument();
    expect(
      within(yearSelect).getByRole("option", { name: String(currentYear + 50) }),
    ).toBeInTheDocument();

    await user.selectOptions(yearSelect, "2040");

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Period for Goal" })).toBeNull(),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/todo-engine/items/goal-1",
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  it("includes an out-of-range stored goal year in the dropdown", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: async () => [
            {
              id: "goal-1",
              type: "goal",
              title: "Long Goal",
              status: "approved",
              horizon: "year",
              scheduled: "2120-01-01",
            },
          ],
        }),
      ),
    );

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Goals" }));

    await user.click(await screen.findByRole("button", { name: "Period for Long Goal" }));
    const picker = screen.getByRole("dialog", { name: "Period for Long Goal" });
    const yearSelect = within(picker).getByLabelText("Goal year");

    expect(within(yearSelect).getByRole("option", { name: "2120" })).toBeInTheDocument();
    expect(yearSelect).toHaveValue("2120");
  });

  it("shows a parent horizon error when an inline goal period change is rejected", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/todo-engine/items/goal-1" && init?.method === "PATCH") {
        expect(init.body).toBe(
          JSON.stringify({ horizon: "year", scheduled: "2026-01-01" }),
        );

        return Promise.resolve({
          ok: false,
          status: 400,
          json: async () => ({
            code: "goal_parent_horizon_not_coarser",
            detail: "opaque server detail",
            parent_horizon: "month",
            child_horizon: "year",
          }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => [
          {
            id: "goal-1",
            type: "goal",
            title: "Goal",
            status: "approved",
            horizon: "week",
            scheduled: "2026-07-06",
            parent_id: "goal-parent",
          },
          {
            id: "goal-parent",
            type: "goal",
            title: "Parent Goal",
            status: "approved",
            horizon: "month",
            scheduled: "2026-07-01",
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Goals" }));

    const trigger = await screen.findByRole("button", { name: "Period for Goal" });
    expect(trigger).toHaveTextContent("Week");

    await user.click(trigger);
    const picker = screen.getByRole("dialog", { name: "Period for Goal" });
    await user.click(within(picker).getByRole("button", { name: "Year" }));
    await user.selectOptions(within(picker).getByLabelText("Goal year"), "2026");

    expect(
      await screen.findByRole("dialog", { name: "Year로 변경할 수 없음" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "현재 Parent 기간은 Month이고, 요청한 Goal 기간은 Year입니다. Goal은 Parent보다 더 작은 기간만 사용할 수 있습니다.",
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "확인" }));

    expect(trigger).toHaveTextContent("Week");
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("shows equal parent and requested horizon labels from structured error metadata", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/todo-engine/items/goal-1" && init?.method === "PATCH") {
        expect(init.body).toBe(
          JSON.stringify({ horizon: "month", scheduled: "2026-07-01" }),
        );

        return Promise.resolve({
          ok: false,
          status: 400,
          json: async () => ({
            code: "goal_parent_horizon_not_coarser",
            detail: "opaque server detail",
            parent_horizon: "month",
            child_horizon: "month",
          }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => [
          {
            id: "goal-1",
            type: "goal",
            title: "Goal",
            status: "approved",
            horizon: "week",
            scheduled: "2026-07-06",
            parent_id: "goal-parent",
          },
          {
            id: "goal-parent",
            type: "goal",
            title: "Parent Goal",
            status: "approved",
            horizon: "month",
            scheduled: "2026-07-01",
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Goals" }));

    const trigger = await screen.findByRole("button", { name: "Period for Goal" });
    expect(trigger).toHaveTextContent("Week");

    await user.click(trigger);
    const picker = screen.getByRole("dialog", { name: "Period for Goal" });
    await user.click(within(picker).getByRole("button", { name: "Month" }));
    await user.click(within(picker).getByRole("button", { name: "July 2026" }));

    expect(
      await screen.findByRole("dialog", { name: "Month로 변경할 수 없음" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "현재 Parent 기간은 Month이고, 요청한 Goal 기간은 Month입니다. Goal은 Parent보다 더 작은 기간만 사용할 수 있습니다.",
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "확인" }));

    expect(trigger).toHaveTextContent("Week");
    await waitFor(() => expect(trigger).toHaveFocus());
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
    expectPropertyImmediatelyBeforeProperty("Updated", "Last Materialized");
    expectPropertyImmediatelyBeforeField("Last Materialized", "Note");
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
    await user.selectOptions(screen.getByLabelText("Priority"), "2");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/todo-engine/items/event-1",
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  it("shows only active status choices and priority controls", async () => {
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
    const inlinePriority = screen.getByLabelText("Priority for One");
    expect(inlinePriority.tagName).toBe("SELECT");
    expect(within(inlinePriority).getByRole("option", { name: "10" })).toBeInTheDocument();

    await user.click(screen.getByRole("cell", { name: "One" }));
    const detailPriority = screen.getByLabelText("Priority");
    expect(detailPriority.tagName).toBe("SELECT");
    expect(within(detailPriority).getByRole("option", { name: "10" })).toBeInTheDocument();
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

  it("patches inline event priority from a dropdown", async () => {
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
    expect(priority.tagName).toBe("SELECT");
    await user.selectOptions(priority, "10");

    expect(priority).toHaveValue("10");
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

  it("shows stable status options for every item type", async () => {
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
        { id: "goal-5", type: "goal", title: "Waiting goal", status: "waiting" },
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
    expect(await statusOptions("Project without DoD")).toEqual(["active", "paused", "completed"]);
    expect(screen.getByLabelText("Status for Project without DoD")).toHaveValue("active");
    expect(await statusOptions("Project with DoD")).toEqual(["active", "paused", "completed"]);

    await user.click(screen.getByRole("button", { name: "Routines" }));
    expect(await statusOptions("Routine without rule")).toEqual(["active", "paused", "completed"]);
    expect(screen.getByLabelText("Status for Routine without rule")).toHaveValue("active");
    expect(await statusOptions("Paused routine")).toEqual(["active", "paused", "completed"]);
    expect(screen.getByLabelText("Status for Paused routine")).toHaveValue("paused");

    await user.click(screen.getByRole("button", { name: "Events" }));
    expect(await statusOptions("Event without scheduled")).toEqual(["active", "paused", "completed"]);
    expect(await statusOptions("Scheduled event")).toEqual(["active", "paused", "completed"]);

    await user.click(screen.getByRole("button", { name: "Areas" }));
    expect(await statusOptions("Area")).toEqual(["active", "archived"]);

    await user.click(screen.getByRole("button", { name: "Goals" }));
    for (const title of [
      "Proposed goal",
      "Approved goal",
      "Active goal",
      "Paused goal",
      "Waiting goal",
    ]) {
      expect(await statusOptions(title)).toEqual(["active", "paused", "completed"]);
    }
    expect(screen.getByLabelText("Status for Proposed goal")).toHaveValue("active");
    expect(screen.getByLabelText("Status for Approved goal")).toHaveValue("active");
    expect(screen.getByLabelText("Status for Paused goal")).toHaveValue("paused");
    expect(screen.getByLabelText("Status for Waiting goal")).toHaveValue("active");
    await user.click(screen.getByRole("cell", { name: "Proposed goal" }));
    expect(await statusOptions("Proposed goal")).toEqual(["active", "paused", "completed"]);
    expect(screen.getByLabelText("Status for Proposed goal")).toHaveValue("active");
    await user.click(screen.getByRole("button", { name: "< Back" }));

    await user.click(screen.getByRole("button", { name: "Tasks" }));
    expect(await statusOptions("Proposed task")).toEqual(["active", "completed"]);
    expect(screen.getByLabelText("Status for Proposed task")).toHaveValue("active");
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
