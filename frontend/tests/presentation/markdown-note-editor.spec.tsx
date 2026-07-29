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

    expect(screen.getByRole("heading", { name: "Plan" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox")).toBeChecked();
    expect(screen.getByText("old").tagName).toBe("DEL");
    expect(screen.getByRole("link", { name: "docs" })).toHaveAttribute("target", "_blank");
    expect(screen.getByRole("link", { name: "docs" })).toHaveAttribute(
      "rel",
      "noreferrer noopener",
    );
    expect(document.querySelector("script")).toBeNull();
  });

  it("shows a clickable Markdown instruction when empty", () => {
    render(<MarkdownNoteEditor value="" onChange={vi.fn()} />);

    expect(screen.getByText("Write a note with Markdown…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit Markdown note" })).toBeInTheDocument();
  });

  it("enters edit mode by click, updates the draft, and renders again on blur", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<MarkdownNoteEditor value="**Draft**" onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "Edit Markdown note" }));
    const input = screen.getByRole("textbox", { name: "Markdown note" });
    expect(input).toHaveFocus();

    fireEvent.change(input, { target: { value: "# Updated" } });
    expect(onChange).toHaveBeenCalledWith("# Updated");

    fireEvent.blur(input);
    expect(screen.getByRole("button", { name: "Edit Markdown note" })).toBeInTheDocument();
  });

  it.each(["{Enter}", "{Space}"])("enters edit mode with %s", async (key) => {
    const user = userEvent.setup();
    render(<MarkdownNoteEditor value="Draft" onChange={vi.fn()} />);

    screen.getByRole("button", { name: "Edit Markdown note" }).focus();
    await user.keyboard(key);

    expect(screen.getByRole("textbox", { name: "Markdown note" })).toHaveFocus();
  });
});
