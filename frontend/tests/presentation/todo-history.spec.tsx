import "@testing-library/jest-dom/vitest";
import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TodoItemHistory } from "@/features/workbench/ui/TodoItemHistory";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("reads every persisted history page and displays reasons and snapshots", async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(historyResponse({ items: [{ id: "second", at: "2026-09-30T01:00:00Z", action: "update_item", actor: "user", reason: "second reason", before: { note: "before" }, after: { note: "after" } }], next: 1 })).mockResolvedValueOnce(historyResponse({ items: [{ id: "first", at: "2026-09-29T01:00:00Z", action: "create", actor: "user", reason: "first reason", before: null, after: {} }], next: null }));
  vi.stubGlobal("fetch", fetchMock);
  render(<TodoItemHistory itemId="task-one" version="one" />);
  expect(fetchMock).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "History" }));
  expect(await screen.findByText("second reason")).toBeInTheDocument();
  expect(screen.getByRole("cell", { name: "before" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Load more history" }));
  expect(await screen.findByText("first reason")).toBeInTheDocument();
  expect(fetchMock).toHaveBeenLastCalledWith("/api/v1/todo/items/task-one/history?offset=1&limit=50", expect.objectContaining({ credentials: "same-origin" }));
  expect(screen.queryByRole("button", { name: "Load more history" })).toBeNull();
});

function historyResponse(body: unknown): Response { return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } }); }
