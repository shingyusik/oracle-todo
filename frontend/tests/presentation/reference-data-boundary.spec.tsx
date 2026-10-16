import "@testing-library/jest-dom/vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { expect, it, vi } from "vitest";
import { ReferenceDataBoundary } from "@/features/workbench/ui/ReferenceDataBoundary";

it("keeps cancellation available, retries failure, then moves focus into the loaded form", async () => {
  const user = userEvent.setup();
  let resolve!: (ok: boolean) => void;
  const load = vi.fn().mockResolvedValueOnce(false).mockImplementationOnce(
    () => new Promise<boolean>((done) => { resolve = done; }),
  );
  const onCancel = vi.fn();
  render(<ReferenceDataBoundary load={load} onCancel={onCancel} cancelLabel="Close">
    <label>Name<input /></label>
  </ReferenceDataBoundary>);
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not load references.");
  await user.click(screen.getByRole("button", { name: "Retry" }));
  expect(screen.getByRole("status")).toHaveTextContent("Loading");
  const close = screen.getByRole("button", { name: "Close" });
  close.focus();
  expect(close).not.toBeDisabled();
  await act(async () => resolve(true));
  expect(screen.getByLabelText("Name")).toHaveFocus();
});

it("ignores an obsolete load after its scope changes", async () => {
  let finishOld!: (ok: boolean) => void;
  const load = vi.fn().mockImplementationOnce(() => new Promise<boolean>((resolve) => {
    finishOld = resolve;
  })).mockResolvedValueOnce(false);
  const view = render(<ReferenceDataBoundary load={load} scope="old" onCancel={vi.fn()}>
    <input aria-label="Loaded" />
  </ReferenceDataBoundary>);
  view.rerender(<ReferenceDataBoundary load={load} scope="new" onCancel={vi.fn()}>
    <input aria-label="Loaded" />
  </ReferenceDataBoundary>);
  await screen.findByRole("alert");
  await act(async () => finishOld(true));
  expect(screen.queryByLabelText("Loaded")).toBeNull();
});
