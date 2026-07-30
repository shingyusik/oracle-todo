import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { QuickAddDialog } from "@/features/workbench/ui/QuickAddDialog";
import type { WorkbenchController } from "@/features/workbench/model/workbench-model";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("QuickAddDialog", () => {
  it("routes Ledger Quick Add to the existing structured transaction form", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    const user = userEvent.setup();
    const controller = {
      selectTab: vi.fn(),
      openCreationDialog: vi.fn(),
    } as unknown as WorkbenchController;

    render(<QuickAddDialog controller={controller} onClose={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Ledger transaction" }));

    expect(screen.getByRole("dialog", { name: "Add transaction" })).toBeVisible();
    expect(screen.getByRole("form", { name: "New transaction" })).toBeVisible();
    expect(screen.getByLabelText("Amount")).toHaveAttribute("inputmode", "decimal");
  });

  it("routes ToDo Quick Add through the existing creation flow", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    const user = userEvent.setup();
    const controller = {
      selectTab: vi.fn(),
      openCreationDialog: vi.fn(),
    } as unknown as WorkbenchController;
    const onClose = vi.fn();

    render(<QuickAddDialog controller={controller} onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "ToDo item" }));

    expect(controller.selectTab).toHaveBeenCalledWith("tasks");
    expect(controller.openCreationDialog).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes on Escape and restores focus to the invoking control", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    const user = userEvent.setup();
    const onClose = vi.fn();
    const controller = {
      selectTab: vi.fn(),
      openCreationDialog: vi.fn(),
    } as unknown as WorkbenchController;
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();

    const { unmount } = render(
      <QuickAddDialog controller={controller} onClose={onClose} />,
    );
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();

    unmount();
    expect(trigger).toHaveFocus();
    trigger.remove();
  });
});
