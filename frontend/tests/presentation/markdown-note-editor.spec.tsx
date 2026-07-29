import "@testing-library/jest-dom/vitest";

import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { MarkdownNoteEditor } from "@/features/workbench/ui/MarkdownNoteEditor";

describe("MarkdownNoteEditor", () => {
  it("renders GFM and safe external links without raw HTML", () => {
    render(
      <MarkdownNoteEditor
        value={"# Plan\n\n- [x] Ship\n\n~~old~~ [docs](https://example.com)\n\n<script>alert(1)</script>"}
        onChange={vi.fn()}
      />,
    );

    const heading = screen.getByRole("heading", { name: "Plan" });
    const link = screen.getByRole("link", { name: "docs" });

    expect(heading).toBeInTheDocument();
    expect(screen.getByRole("checkbox")).toBeChecked();
    expect(screen.getByText("old").tagName).toBe("DEL");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer noopener");
    expect(heading.closest("button, [role='button']")).toBeNull();
    expect(link.closest("button, [role='button']")).toBeNull();
    expect(document.querySelector("script")).toBeNull();
  });

  it("shows a clickable Markdown instruction when empty", () => {
    render(<MarkdownNoteEditor value="" onChange={vi.fn()} />);

    expect(screen.getByText("Write a note with Markdown…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit Markdown note" })).toBeInTheDocument();
  });

  it("enters edit mode by clicking the rendered surface, updates the draft, and renders again on blur", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { container } = render(
      <MarkdownNoteEditor value="**Draft**" onChange={onChange} />,
    );

    const surface = container.querySelector(".markdown-note-surface");
    expect(surface).not.toBeNull();
    if (!surface) {
      throw new Error("Missing rendered Markdown note surface");
    }
    expect(surface).not.toHaveAttribute("role");
    expect(surface).not.toHaveAttribute("tabindex");
    await user.click(surface);
    const input = screen.getByRole("textbox", { name: "Markdown note" });
    expect(input).toHaveFocus();

    fireEvent.change(input, { target: { value: "# Updated" } });
    expect(onChange).toHaveBeenCalledWith("# Updated");

    fireEvent.blur(input);
    expect(screen.getByRole("button", { name: "Edit Markdown note" })).toBeInTheDocument();
  });

  it("enters edit mode through the dedicated edit control by pointer", async () => {
    const user = userEvent.setup();
    render(<MarkdownNoteEditor value="Draft" onChange={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Edit Markdown note" }));

    expect(screen.getByRole("textbox", { name: "Markdown note" })).toHaveFocus();
  });

  it.each([
    ["Enter", "{Enter}"],
    ["Space", " "],
  ])(
    "enters edit mode through the dedicated edit control with %s",
    async (_keyName, key) => {
      const user = userEvent.setup();
      render(<MarkdownNoteEditor value="Draft" onChange={vi.fn()} />);

      screen.getByRole("button", { name: "Edit Markdown note" }).focus();
      await user.keyboard(key);

      expect(screen.getByRole("textbox", { name: "Markdown note" })).toHaveFocus();
    },
  );

  it("keeps a keyboard-activated link in rendered mode", async () => {
    const user = userEvent.setup();
    render(<MarkdownNoteEditor value="[docs](https://example.com)" onChange={vi.fn()} />);

    screen.getByRole("link", { name: "docs" }).focus();
    await user.keyboard("{Enter}");

    expect(screen.getByRole("link", { name: "docs" })).toHaveFocus();
    expect(screen.queryByRole("textbox", { name: "Markdown note" })).not.toBeInTheDocument();
  });
});
