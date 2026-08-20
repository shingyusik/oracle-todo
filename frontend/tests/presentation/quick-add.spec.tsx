import "@testing-library/jest-dom/vitest";

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { healthApi } from "@/features/health/api/health-api";
import type { HealthEvent } from "@/features/health/model/health-model";
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
  ] as const;
}

function stubHealthLoaded(
  dietEntries: Awaited<ReturnType<typeof healthApi.listDiet>> = [],
  metricsEntries: HealthEvent[] = [],
) {
  return {
    diet: vi.spyOn(healthApi, "listDiet").mockResolvedValue(dietEntries),
    events: vi.spyOn(healthApi, "listEvents").mockImplementation(async (query) =>
      query?.dailyOnly ? metricsEntries : []),
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

  it("preloads existing Metrics and preserves its snapshot through mutation refresh", async () => {
    const user = userEvent.setup();
    const weight: HealthEvent = {
      id: "weight-1",
      occurredAt: "2026-08-19T03:00:00Z",
      category: "weight",
      metricKey: "body_weight",
      name: "Body weight",
      value: 72.5,
      unit: "kg",
      note: null,
      attributes: {
        kind: "weight", metricKey: "body_weight", name: "Body weight", value: 72.5, unit: "kg",
      },
      createdAt: "2026-08-19T03:00:00Z",
      updatedAt: "2026-08-19T03:00:00Z",
      deletedAt: null,
    };
    const refreshedWeight = {
      ...weight,
      value: 80,
      attributes: {
        kind: "weight", metricKey: "body_weight", name: "Body weight", value: 80, unit: "kg",
      },
      updatedAt: "2026-08-20T03:00:00Z",
    } as HealthEvent;
    const health = stubHealthLoaded([], [weight]);
    let metricReads = 0;
    health.events.mockImplementation(async (query) => {
      if (!query?.dailyOnly) return [];
      metricReads += 1;
      return metricReads === 1 ? [weight] : [refreshedWeight];
    });
    const timelineRefresh = deferred<Awaited<ReturnType<typeof healthApi.timeline>>>();
    const trendsRefresh = deferred<Awaited<ReturnType<typeof healthApi.trends>>>();
    health.timeline.mockResolvedValueOnce([]).mockReturnValueOnce(timelineRefresh.promise);
    health.trends.mockResolvedValueOnce(
      {} as Awaited<ReturnType<typeof healthApi.trends>>,
    ).mockReturnValueOnce(trendsRefresh.promise);
    const save = vi.spyOn(healthApi, "saveDailyMetrics").mockResolvedValue([refreshedWeight]);
    const onClose = vi.fn();
    render(<QuickAddDialog controller={workbenchController()} onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: "Health metrics" }));
    await screen.findByRole("form", { name: "Daily metrics" });
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-08-19" } });
    await waitFor(() => expect(screen.getByLabelText("Weight")).toHaveValue(72.5));
    fireEvent.change(screen.getByLabelText("Weight"), { target: { value: "70" } });
    fireEvent.submit(screen.getByRole("form", { name: "Daily metrics" }));

    await waitFor(() => expect(save).toHaveBeenCalledWith({ metrics: [{
      occurredAt: expect.any(String),
      details: { kind: "weight", value: 70, unit: "kg" },
      expectedUpdatedAt: weight.updatedAt,
    }], archives: [] }));
    await waitFor(() => expect(metricReads).toBe(2));
    expect(screen.getByLabelText("Weight")).toHaveValue(70);
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      timelineRefresh.resolve([]);
      trendsRefresh.resolve({} as Awaited<ReturnType<typeof healthApi.trends>>);
    });
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
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
    const refreshedDiet =
      deferred<Awaited<ReturnType<typeof healthApi.listDiet>>>();
    vi.spyOn(healthApi, "createDiet").mockReturnValue(create.promise);
    initial.timeline.mockImplementationOnce(() => Promise.resolve([]))
      .mockImplementationOnce(() => refreshedTimeline.promise);
    initial.trends.mockImplementationOnce(() => Promise.resolve(
      {} as Awaited<ReturnType<typeof healthApi.trends>>,
    )).mockImplementationOnce(() => refreshedTrends.promise);
    initial.diet.mockImplementationOnce(() => Promise.resolve([]))
      .mockImplementationOnce(() => refreshedDiet.promise);
    const onClose = vi.fn();
    render(
      <QuickAddDialog controller={workbenchController()} onClose={onClose} />,
    );

    await user.click(screen.getByRole("button", { name: "Diet entry" }));
    await user.type(screen.getByLabelText("Food"), "Lunch");
    await user.click(screen.getByRole("button", { name: "Save diet entry" }));

    expect(screen.getByRole("button", { name: "Close Quick Add" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Back to Quick Add" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Operation in progress. Close is disabled until it finishes.",
    );
    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => create.resolve(
      {} as Awaited<ReturnType<typeof healthApi.createDiet>>,
    ));
    await waitFor(() => {
      expect(initial.timeline).toHaveBeenCalledTimes(2);
      expect(initial.trends).toHaveBeenCalledTimes(2);
      expect(initial.diet).toHaveBeenCalledTimes(2);
    });
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      refreshedTimeline.resolve([]);
      refreshedDiet.resolve([]);
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
    await user.type(screen.getByLabelText("Food"), "Lunch");
    await user.click(screen.getByRole("button", { name: "Save diet entry" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Diet save failed");
    expect(screen.getByLabelText("Food")).toHaveValue("Lunch");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("uses loaded Diet tags without leaking ToDo tag options", async () => {
    const user = userEvent.setup();
    stubHealthLoaded([{
      id: "diet-1",
      occurredAt: "2026-08-18T03:00:00Z",
      mealType: "lunch",
      foodName: "Bibimbap",
      note: null,
      tags: ["rice"],
      mediaId: null,
      createdAt: "2026-08-18T03:00:00Z",
      updatedAt: "2026-08-18T03:00:00Z",
      deletedAt: null,
    }]);
    render(<QuickAddDialog controller={workbenchController()} onClose={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Diet entry" }));
    await user.click(await screen.findByRole("button", { name: "Tags" }));

    expect(screen.getByRole("option", { name: "rice" })).toBeVisible();
    expect(screen.queryByRole("option", { name: "todo-only" })).toBeNull();
  });

  it("retries only Ledger refresh after a transaction was persisted", async () => {
    const user = userEvent.setup();
    const ledgerSpies = stubLedgerLoaded();
    ledgerSpies[0]
      .mockResolvedValueOnce({ items: [], nextOffset: null })
      .mockRejectedValueOnce(new Error("Ledger refresh failed"))
      .mockResolvedValue({ items: [], nextOffset: null });
    ledgerSpies[3].mockResolvedValue({
      items: [{
        id: "account-cash",
        name: "Cash",
        categoryId: "account-category-cash",
        currencyId: "currency-krw",
        openingBalanceMinor: 0,
        active: true,
      }],
      nextOffset: null,
    });
    const create = vi.spyOn(ledgerApi, "createEntry").mockResolvedValue(
      {} as Awaited<ReturnType<typeof ledgerApi.createEntry>>,
    );
    const onClose = vi.fn();
    render(
      <QuickAddDialog controller={workbenchController()} onClose={onClose} />,
    );

    await user.click(screen.getByRole("button", { name: "Ledger transaction" }));
    await user.type(await screen.findByLabelText("Content"), "Lunch");
    await user.selectOptions(screen.getByLabelText("Account"), "account-cash");
    await user.type(screen.getByLabelText("Amount"), "12000");
    await user.click(screen.getByRole("button", { name: "Save transaction" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Transaction saved, but the list could not refresh.",
    );
    expect(screen.getByRole("button", { name: "Close Quick Add" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Back to Quick Add" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Saved" })).toBeDisabled();
    expect(create).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: "Retry refresh" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(create).toHaveBeenCalledOnce();
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
