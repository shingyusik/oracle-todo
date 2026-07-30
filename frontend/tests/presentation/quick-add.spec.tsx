import "@testing-library/jest-dom/vitest";

import {
  act,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { healthApi } from "@/features/health/api/health-api";
import { ledgerApi } from "@/features/ledger/api/ledger-api";
import type { WorkbenchController } from "@/features/workbench/model/workbench-model";
import { QuickAddDialog } from "@/features/workbench/ui/QuickAddDialog";

function workbenchController(): WorkbenchController {
  return {
    openTaskCreation: vi.fn(),
  } as unknown as WorkbenchController;
}

function stubLedgerLoaded() {
  const page = { items: [], nextOffset: null };
  return [
    vi.spyOn(ledgerApi, "listEntries").mockResolvedValue(page),
    vi.spyOn(ledgerApi, "listCurrencies").mockResolvedValue(page),
    vi.spyOn(ledgerApi, "listAccountCategories").mockResolvedValue(page),
    vi.spyOn(ledgerApi, "listAccounts").mockResolvedValue(page),
    vi.spyOn(ledgerApi, "listTransactionCategories").mockResolvedValue(page),
    vi.spyOn(ledgerApi, "listAccountBalances").mockResolvedValue(page),
  ];
}

function stubHealthLoaded() {
  return {
    timeline: vi.spyOn(healthApi, "timeline").mockResolvedValue([]),
    trends: vi.spyOn(healthApi, "trends").mockResolvedValue(
      {} as Awaited<ReturnType<typeof healthApi.trends>>,
    ),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("QuickAddDialog", () => {
  it("mounts no domain controller until a structured type is selected", async () => {
    const ledgerSpies = stubLedgerLoaded();
    const healthSpies = stubHealthLoaded();

    render(
      <QuickAddDialog controller={workbenchController()} onClose={vi.fn()} />,
    );

    expect(ledgerSpies.every((spy) => spy.mock.calls.length === 0)).toBe(true);
    expect(healthSpies.timeline).not.toHaveBeenCalled();
    expect(healthSpies.trends).not.toHaveBeenCalled();
  });

  it("loads only Ledger references before showing the transaction form", async () => {
    const user = userEvent.setup();
    const ledgerSpies = stubLedgerLoaded();
    const healthSpies = stubHealthLoaded();
    render(
      <QuickAddDialog controller={workbenchController()} onClose={vi.fn()} />,
    );

    await user.click(screen.getByRole("button", { name: "Ledger transaction" }));

    expect(await screen.findByRole("form", { name: "New transaction" }))
      .toBeVisible();
    expect(ledgerSpies.every((spy) => spy.mock.calls.length === 1)).toBe(true);
    expect(healthSpies.timeline).not.toHaveBeenCalled();
    expect(healthSpies.trends).not.toHaveBeenCalled();
  });

  it("shows Ledger reference failure and retries before rendering the form", async () => {
    const user = userEvent.setup();
    const ledgerSpies = stubLedgerLoaded();
    ledgerSpies[0].mockRejectedValueOnce(new Error("Ledger references unavailable"));
    render(
      <QuickAddDialog controller={workbenchController()} onClose={vi.fn()} />,
    );

    await user.click(screen.getByRole("button", { name: "Ledger transaction" }));
    expect(await screen.findByRole("alert"))
      .toHaveTextContent("Ledger references unavailable");
    expect(screen.queryByRole("form", { name: "New transaction" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Retry Ledger" }));
    expect(await screen.findByRole("form", { name: "New transaction" }))
      .toBeVisible();
  });

  it("routes ToDo Quick Add through the navigation-safe controller command", async () => {
    const user = userEvent.setup();
    const controller = workbenchController();
    const onClose = vi.fn();

    render(<QuickAddDialog controller={controller} onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "ToDo item" }));

    expect(controller.openTaskCreation).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes a Health form only after mutation and refresh fully succeed", async () => {
    const user = userEvent.setup();
    const initial = stubHealthLoaded();
    const create = deferred<Awaited<ReturnType<typeof healthApi.createDiet>>>();
    const refreshedTimeline =
      deferred<Awaited<ReturnType<typeof healthApi.timeline>>>();
    const refreshedTrends =
      deferred<Awaited<ReturnType<typeof healthApi.trends>>>();
    vi.spyOn(healthApi, "createDiet").mockReturnValue(create.promise);
    initial.timeline.mockImplementationOnce(() => Promise.resolve([]))
      .mockImplementationOnce(() => refreshedTimeline.promise);
    initial.trends.mockImplementationOnce(() => Promise.resolve(
      {} as Awaited<ReturnType<typeof healthApi.trends>>,
    )).mockImplementationOnce(() => refreshedTrends.promise);
    const onClose = vi.fn();
    render(
      <QuickAddDialog controller={workbenchController()} onClose={onClose} />,
    );

    await user.click(screen.getByRole("button", { name: "Diet entry" }));
    await user.type(screen.getByLabelText("Food name"), "Lunch");
    await user.click(screen.getByRole("button", { name: "Save diet entry" }));

    expect(screen.getByRole("button", { name: "Close Quick Add" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Back to Quick Add" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Saving in progress");
    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => create.resolve(
      {} as Awaited<ReturnType<typeof healthApi.createDiet>>,
    ));
    await waitFor(() => {
      expect(initial.timeline).toHaveBeenCalledTimes(2);
      expect(initial.trends).toHaveBeenCalledTimes(2);
    });
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      refreshedTimeline.resolve([]);
      refreshedTrends.resolve(
        {} as Awaited<ReturnType<typeof healthApi.trends>>,
      );
    });
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it("keeps Health input and dialog open after a failed save", async () => {
    const user = userEvent.setup();
    stubHealthLoaded();
    vi.spyOn(healthApi, "createDiet")
      .mockRejectedValue(new Error("Diet save failed"));
    const onClose = vi.fn();
    render(
      <QuickAddDialog controller={workbenchController()} onClose={onClose} />,
    );

    await user.click(screen.getByRole("button", { name: "Diet entry" }));
    await user.type(screen.getByLabelText("Food name"), "Lunch");
    await user.click(screen.getByRole("button", { name: "Save diet entry" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Diet save failed");
    expect(screen.getByLabelText("Food name")).toHaveValue("Lunch");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes on Escape and restores focus to the invoking control", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();

    const { unmount } = render(
      <QuickAddDialog controller={workbenchController()} onClose={onClose} />,
    );
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();

    unmount();
    expect(trigger).toHaveFocus();
    trigger.remove();
  });
});
