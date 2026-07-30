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
    expect(document.querySelector("script")).toBeNull();
  });

  it("shows a clickable Markdown instruction when empty", () => {
    render(<MarkdownNoteEditor value="" onChange={vi.fn()} />);

    expect(screen.getByText("Write a note with Markdown…")).toBeInTheDocument();
    expect(screen.getByRole("button")).toBeInTheDocument();
  });

  it("edits a rendered line by pointer and renders it again on blur", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <MarkdownNoteEditor value="**Draft**" onChange={onChange} />,
    );

    await user.click(screen.getByText("Draft"));
    const input = screen.getByRole("textbox", { name: "Markdown note line 1" });
    expect(input).toHaveFocus();

    fireEvent.change(input, { target: { value: "# Updated" } });
    expect(onChange).toHaveBeenCalledWith("# Updated");
    rerender(<MarkdownNoteEditor value="# Updated" onChange={onChange} />);

    fireEvent.blur(input);
    expect(screen.getByText("Updated")).toBeInTheDocument();
  });

  it("renders the completed line and edits a new line on Enter", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <MarkdownNoteEditor value="First" onChange={onChange} />,
    );

    await user.click(screen.getByText("First"));
    const input = screen.getByRole("textbox", { name: "Markdown note line 1" });
    await user.type(input, "{Enter}");

    expect(onChange).toHaveBeenLastCalledWith("First\n");
    rerender(<MarkdownNoteEditor value={"First\n"} onChange={onChange} />);
    expect(screen.getByText("First")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Markdown note line 2" })).toHaveFocus();
  });

  it.each([
    ["Enter", "{Enter}"],
    ["Space", " "],
  ])(
    "edits a rendered line with %s",
    async (_keyName, key) => {
      const user = userEvent.setup();
      render(<MarkdownNoteEditor value="Draft" onChange={vi.fn()} />);

      screen.getByRole("button", { name: "Draft" }).focus();
      await user.keyboard(key);

      expect(screen.getByRole("textbox", { name: "Markdown note line 1" })).toHaveFocus();
    },
  );

  it("renders marker-only tasks and strikes the checked line", () => {
    const { container } = render(
      <MarkdownNoteEditor value={"- [ ]\n- [x]\n- [X] Done"} onChange={vi.fn()} />,
    );

    const boxes = screen.getAllByRole("checkbox");
    expect(boxes[0]).not.toBeChecked();
    expect(boxes[1]).toBeChecked();
    expect(boxes[2]).toBeChecked();
    expect(container.querySelectorAll(".markdown-note-line--checked")).toHaveLength(2);
    expect(screen.getByText("Done").closest(".markdown-note-line--checked")).not.toBeNull();
  });

  it("keeps a keyboard-activated link in rendered mode", async () => {
    const user = userEvent.setup();
    render(<MarkdownNoteEditor value="[docs](https://example.com)" onChange={vi.fn()} />);

    screen.getByRole("link", { name: "docs" }).focus();
    await user.keyboard("{Enter}");

    expect(screen.getByRole("link", { name: "docs" })).toHaveFocus();
    expect(
      screen.queryByRole("textbox", { name: "Markdown note line 1" }),
    ).not.toBeInTheDocument();
  });
});
