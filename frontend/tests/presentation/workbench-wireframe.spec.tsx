import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import React from "react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { WorkbenchPageClient } from "@/features/workbench/ui/WorkbenchPageClient";

describe("WorkbenchPageClient", () => {
  it("renders the main and sub sidebar navigation", () => {
    render(<WorkbenchPageClient />);

    expect(
      screen.getByRole("button", { name: "Dashboard" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ToDo" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Workspace" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Areas" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Planner" }),
    ).toBeInTheDocument();
  });

  it("changes the main panel when a tab is clicked", async () => {
    const user = userEvent.setup();
    render(<WorkbenchPageClient />);

    await user.click(screen.getByRole("button", { name: "Projects" }));

    expect(
      screen.getByRole("heading", { name: "Projects" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Outcome pipeline")).toBeInTheDocument();
  });

  it("selects yearly when planner is clicked and daily when daily is clicked", async () => {
    const user = userEvent.setup();
    render(<WorkbenchPageClient />);

    await user.click(screen.getByRole("button", { name: "Planner" }));
    expect(
      screen.getByRole("heading", { name: "Yearly" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Daily" }));
    expect(screen.getByRole("heading", { name: "Daily" })).toBeInTheDocument();
  });
});
