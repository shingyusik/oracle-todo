import "@testing-library/jest-dom/vitest";

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { describe, expect, it, vi } from "vitest";

import {
  DestructiveConfirmationDialog,
} from "@/features/workbench/ui/DestructiveConfirmationDialog";

describe("DestructiveConfirmationDialog", () => {
  it("supports custom confirmation copy and safe error feedback", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn().mockResolvedValue(undefined);

    render(
      <DestructiveConfirmationDialog
        title="Archive One?"
        description="Archive this item from active views."
        confirmLabel="Archive"
        error="Could not archive item."
        fallbackFocusRef={React.createRef<HTMLElement>()}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "Archive One?" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(
      within(dialog).getByText("Archive this item from active views.", {
        exact: true,
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not archive item.",
    );

    const cancelButton = screen.getByRole("button", { name: "Cancel" });
    const archiveButton = screen.getByRole("button", { name: "Archive" });
    expect(cancelButton).toHaveFocus();

    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(archiveButton).toHaveFocus();

    await user.keyboard("{Tab}");
    expect(cancelButton).toHaveFocus();

    await user.click(archiveButton);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("uses permanent purge copy by default", () => {
    render(
      <DestructiveConfirmationDialog
        title="Purge One?"
        description="Permanently remove this record."
        fallbackFocusRef={React.createRef<HTMLElement>()}
        onCancel={vi.fn()}
        onConfirm={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Purge permanently" }),
    ).toBeInTheDocument();
  });

  it("renders an alert for an empty error string", () => {
    render(
      <DestructiveConfirmationDialog
        title="Archive One?"
        description="Archive this item from active views."
        error=""
        fallbackFocusRef={React.createRef<HTMLElement>()}
        onCancel={vi.fn()}
        onConfirm={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(screen.getByRole("alert")).toBeEmptyDOMElement();
  });
});
