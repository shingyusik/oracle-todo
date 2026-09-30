import "@testing-library/jest-dom/vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { TodoArchive } from "@/features/workbench/ui/TodoArchive";
import { requestJson } from "@/lib/raven-api";

vi.mock("@/lib/raven-api", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/raven-api")>(), requestJson: vi.fn() }));
vi.mock("@/features/workbench/api/table-api", () => ({ mapWorkspaceItem: (value: unknown) => value }));

it("loads archived items and opens their read-only detail", async () => {
  const item = { id: "archived", title: "Old task", type: "task", status: "archived" };
  vi.mocked(requestJson).mockResolvedValue({ items: [item], next: null });
  const onOpen = vi.fn();
  render(<TodoArchive onOpen={onOpen} />);
  await userEvent.click(screen.getByRole("button", { name: "Browse archive" }));
  await userEvent.click(await screen.findByRole("button", { name: "Old task" }));
  expect(requestJson).toHaveBeenCalledWith("/api/v1/todo/items/archive?offset=0&limit=50");
  expect(onOpen).toHaveBeenCalledWith(item);
  expect(screen.getByText("Archived items are read-only.")).toBeVisible();
});

it("keeps earlier archive records while loading the next bounded page", async () => {
  vi.mocked(requestJson).mockReset()
    .mockResolvedValueOnce({ items: [{ id: "one", title: "First", type: "task", status: "archived" }], next: 50 })
    .mockResolvedValueOnce({ items: [{ id: "two", title: "Next", type: "task", status: "archived" }], next: null });
  render(<TodoArchive onOpen={vi.fn()} />);
  await userEvent.click(screen.getByRole("button", { name: "Browse archive" }));
  await screen.findByRole("button", { name: "First" });
  await userEvent.click(screen.getByRole("button", { name: "Load more archive" }));
  expect(await screen.findByRole("button", { name: "Next" })).toBeVisible();
  expect(screen.getByRole("button", { name: "First" })).toBeVisible();
  expect(requestJson).toHaveBeenLastCalledWith("/api/v1/todo/items/archive?offset=50&limit=50");
});
