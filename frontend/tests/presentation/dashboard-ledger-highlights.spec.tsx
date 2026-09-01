import "@testing-library/jest-dom/vitest";

import { act, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { loadLedgerReport } from "@/features/ledger/api/ledger-report-loader";
import type { LedgerReportData } from "@/features/ledger/api/ledger-report-loader";
import { DashboardLedgerHighlights } from "@/features/dashboard/ui/DashboardLedgerHighlights";

vi.mock("@/features/ledger/api/ledger-report-loader", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/features/ledger/api/ledger-report-loader")>(),
  loadLedgerReport: vi.fn(),
}));

describe("Dashboard Ledger highlights", () => {
  beforeEach(() => {
    vi.mocked(loadLedgerReport).mockReset();
  });

  it("keeps shared controls visible above three ordered loading skeletons", () => {
    vi.mocked(loadLedgerReport).mockReturnValue(new Promise(() => undefined));

    render(<DashboardLedgerHighlights mutationEpoch={0} onNavigate={vi.fn()} />);

    const surface = screen.getByRole("region", { name: "Ledger highlights" });
    expect(within(surface).getByRole("button", { name: "Ledger highlights" }))
      .toBeDisabled();
    expect(within(surface).getByRole("button", { name: "Current month" }))
      .toBeDisabled();
    expect(within(surface).getByRole("button", { name: "Previous month" }))
      .toBeDisabled();
    const body = surface.querySelector(".dashboard-ledger-grid");
    expect(body).toHaveAttribute("aria-busy", "true");
    expect(within(body as HTMLElement).getAllByTestId("dashboard-ledger-skeleton")
      .map((panel) => panel.className)).toEqual([
      "dashboard-ledger-skeleton dashboard-ledger-skeleton-cash-flow",
      "dashboard-ledger-skeleton dashboard-ledger-skeleton-category",
      "dashboard-ledger-skeleton dashboard-ledger-skeleton-trend",
    ]);
    expect(within(body as HTMLElement).queryByRole("button")).not.toBeInTheDocument();
  });

  it("reuses the initial request across StrictMode effect replay", async () => {
    const pending = deferred<LedgerReportData>();
    vi.mocked(loadLedgerReport).mockReturnValue(pending.promise);

    render(
      <React.StrictMode>
        <DashboardLedgerHighlights mutationEpoch={0} onNavigate={vi.fn()} />
      </React.StrictMode>,
    );

    expect(loadLedgerReport).toHaveBeenCalledOnce();
    await act(async () => pending.resolve(reportData({
      incomeMinor: 100,
      expenseMinor: 25,
    })));
    expect(await screen.findByRole("region", { name: "Cash Flow" }))
      .toBeVisible();
  });

  it("shares month and currency across Cash Flow and the real report charts", async () => {
    vi.mocked(loadLedgerReport).mockResolvedValue(reportData({
      incomeMinor: 3_650_000,
      expenseMinor: 1_384_000,
    }));
    const onNavigate = vi.fn();
    render(<DashboardLedgerHighlights mutationEpoch={0} onNavigate={onNavigate} />);

    const cashFlow = await screen.findByRole("region", { name: "Cash Flow" });
    const surface = screen.getByRole("region", { name: "Ledger highlights" });
    expect(cashFlow).toHaveTextContent("3,650,000 KRW");
    expect(cashFlow).toHaveTextContent("1,384,000 KRW");
    expect(cashFlow).toHaveTextContent("2,266,000 KRW");
    expect(cashFlow).toHaveTextContent("44,645 KRW");
    expect(within(cashFlow).getByRole("img", { name: /Spending is 38% of income/ }))
      .toHaveStyle({ "--dashboard-ledger-ring-stop": "38%" });
    expect(within(surface).getByRole("region", { name: "Spending by category" }))
      .toBeInTheDocument();
    expect(within(surface).getByRole("region", { name: "Income and spending pattern" }))
      .toBeInTheDocument();

    const heading = within(surface).getByRole("button", { name: "Ledger highlights" });
    expect(heading).toBeEnabled();
    await userEvent.click(heading);
    expect(onNavigate).toHaveBeenLastCalledWith({
      kind: "report",
      selection: { period: "current_month" },
      currencyId: "currency-krw",
    });

    await userEvent.click(within(surface).getByRole("button", {
      name: "Food, 100%, 1,384,000 KRW, expense category composition",
    }));
    expect(onNavigate).toHaveBeenLastCalledWith({
      kind: "drilldown",
      target: {
        kind: "category",
        range: { start: "2026-08-01", end: "2026-08-31" },
        currencyId: "currency-krw",
        referenceId: "category-food",
      },
    });

    await userEvent.click(within(surface).getByRole("button", {
      name: "2026-08-01 Expense 1,384,000 KRW",
    }));
    expect(onNavigate).toHaveBeenLastCalledWith({
      kind: "drilldown",
      target: {
        kind: "trend",
        range: { start: "2026-08-01", end: "2026-08-01" },
        currencyId: "currency-krw",
        entryType: "expense",
      },
    });

    await userEvent.click(within(surface).getByRole("button", { name: "Previous month" }));
    await waitFor(() => expect(loadLedgerReport)
      .toHaveBeenLastCalledWith({ period: "previous_month" }));
  });

  it("shows a full overage ring and negative remaining amount", async () => {
    vi.mocked(loadLedgerReport).mockResolvedValue(reportData({
      incomeMinor: 1_000_000,
      expenseMinor: 1_200_000,
    }));
    render(<DashboardLedgerHighlights mutationEpoch={0} onNavigate={vi.fn()} />);

    const cashFlow = await screen.findByRole("region", { name: "Cash Flow" });
    expect(within(cashFlow).getByText("Over 20%")).toBeVisible();
    expect(within(cashFlow).getByText("Remaining").parentElement)
      .toHaveTextContent("-200,000 KRW");
    expect(within(cashFlow).getByRole("img", { name: /Spending is 120% of income/ }))
      .toHaveClass("is-over");
    expect(within(cashFlow).getByRole("img", { name: /Spending is 120% of income/ }))
      .toHaveStyle({ "--dashboard-ledger-ring-stop": "100%" });
  });

  it("shows a full no-income ring without an undefined percentage", async () => {
    vi.mocked(loadLedgerReport).mockResolvedValue(reportData({
      incomeMinor: 0,
      expenseMinor: 200_000,
    }));
    render(<DashboardLedgerHighlights mutationEpoch={0} onNavigate={vi.fn()} />);

    const cashFlow = await screen.findByRole("region", { name: "Cash Flow" });
    const donut = within(cashFlow).getByRole("img", { name: /Spending 200,000 KRW with no income/ });
    expect(within(donut).getByText("No income")).toBeVisible();
    expect(donut).toHaveClass("is-over");
    expect(donut).toHaveStyle({ "--dashboard-ledger-ring-stop": "100%" });
    expect(within(cashFlow).getByText("Remaining").parentElement)
      .toHaveTextContent("-200,000 KRW");
    expect(cashFlow).not.toHaveTextContent("undefined");
  });

  it("omits the Cash Flow donut when income and spending are both zero", async () => {
    vi.mocked(loadLedgerReport).mockResolvedValue(reportData({
      incomeMinor: 0,
      expenseMinor: 0,
    }));
    render(<DashboardLedgerHighlights mutationEpoch={0} onNavigate={vi.fn()} />);

    const cashFlow = await screen.findByRole("region", { name: "Cash Flow" });
    expect(cashFlow).toHaveTextContent("No income or spending for this period.");
    expect(within(cashFlow).queryByRole("img")).not.toBeInTheDocument();
  });

  it("keeps a balance-only currency selectable with three proper empty states", async () => {
    vi.mocked(loadLedgerReport).mockResolvedValue(reportData({
      incomeMinor: 3_650_000,
      expenseMinor: 1_384_000,
      balanceOnlyUsd: true,
    }));
    render(<DashboardLedgerHighlights mutationEpoch={0} onNavigate={vi.fn()} />);

    const usd = await screen.findByRole("button", { name: "USD" });
    const surface = screen.getByRole("region", { name: "Ledger highlights" });
    await userEvent.click(usd);

    expect(usd).toHaveAttribute("aria-pressed", "true");
    expect(within(surface).getByRole("region", { name: "Cash Flow" }))
      .toHaveTextContent("No income or spending for this period.");
    expect(within(surface).getByRole("region", { name: "Spending by category" }))
      .toHaveTextContent("No spending categories for this period.");
    expect(within(surface).getByRole("region", { name: "Income and spending pattern" }))
      .toHaveTextContent("No income or spending for this period.");
  });

  it("shows only a safe error and retries the same selection", async () => {
    vi.mocked(loadLedgerReport)
      .mockRejectedValueOnce(new Error("C:\\private\\ledger.sqlite failed"))
      .mockResolvedValueOnce(reportData({ incomeMinor: 100, expenseMinor: 25 }));
    render(<DashboardLedgerHighlights mutationEpoch={0} onNavigate={vi.fn()} />);

    expect(await screen.findByRole("alert"))
      .toHaveTextContent("Could not load Ledger highlights.");
    expect(screen.queryByText(/private|sqlite failed/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry Ledger highlights" }));

    await screen.findByRole("region", { name: "Cash Flow" });
    expect(loadLedgerReport).toHaveBeenCalledTimes(2);
    expect(loadLedgerReport).toHaveBeenLastCalledWith({ period: "current_month" });
  });

  it("shows an explicit empty state when no Ledger currencies are available", async () => {
    vi.mocked(loadLedgerReport).mockResolvedValue(emptyReportData());
    render(<DashboardLedgerHighlights mutationEpoch={0} onNavigate={vi.fn()} />);

    expect(await screen.findByText("No Ledger currencies available.")).toBeVisible();
    const surface = screen.getByRole("region", { name: "Ledger highlights" });
    expect(within(surface).getByRole("button", { name: "Ledger highlights" }))
      .toBeDisabled();
    expect(within(surface).getByRole("button", { name: "Current month" }))
      .toBeEnabled();
    expect(within(surface).queryByRole("region", { name: "Cash Flow" }))
      .not.toBeInTheDocument();
    expect(within(surface).queryByRole("region", { name: "Spending by category" }))
      .not.toBeInTheDocument();
    expect(within(surface).queryByRole("region", { name: "Income and spending pattern" }))
      .not.toBeInTheDocument();
  });

  it("reloads the current selection when the mutation epoch changes", async () => {
    vi.mocked(loadLedgerReport).mockResolvedValue(
      reportData({ incomeMinor: 100, expenseMinor: 25 }),
    );
    const { rerender } = render(
      <DashboardLedgerHighlights mutationEpoch={0} onNavigate={vi.fn()} />,
    );
    await waitFor(() => expect(loadLedgerReport).toHaveBeenCalledTimes(1));

    rerender(<DashboardLedgerHighlights mutationEpoch={1} onNavigate={vi.fn()} />);

    await waitFor(() => expect(loadLedgerReport).toHaveBeenCalledTimes(2));
    expect(loadLedgerReport).toHaveBeenLastCalledWith({ period: "current_month" });
  });

  it("ignores an older request that settles after the latest mutation reload", async () => {
    const older = deferred<LedgerReportData>();
    const latest = deferred<LedgerReportData>();
    vi.mocked(loadLedgerReport)
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(latest.promise);
    const { rerender } = render(
      <DashboardLedgerHighlights mutationEpoch={0} onNavigate={vi.fn()} />,
    );
    await waitFor(() => expect(loadLedgerReport).toHaveBeenCalledTimes(1));

    rerender(<DashboardLedgerHighlights mutationEpoch={1} onNavigate={vi.fn()} />);
    await waitFor(() => expect(loadLedgerReport).toHaveBeenCalledTimes(2));
    await act(async () => latest.resolve(reportData({
      incomeMinor: 222,
      expenseMinor: 0,
      currency: { id: "currency-usd", code: "USD", decimalPlaces: 2 },
    })));

    const surface = screen.getByRole("region", { name: "Ledger highlights" });
    const cashFlow = within(surface).getByRole("region", { name: "Cash Flow" });
    expect(within(surface).getByRole("button", { name: "USD" }))
      .toHaveAttribute("aria-pressed", "true");
    expect(within(cashFlow).getByText("Income").parentElement).toHaveTextContent("2.22 USD");

    await act(async () => older.resolve(reportData({
      incomeMinor: 1_000_000,
      expenseMinor: 0,
    })));

    expect(within(surface).getByRole("button", { name: "USD" }))
      .toHaveAttribute("aria-pressed", "true");
    expect(within(surface).queryByRole("button", { name: "KRW" })).not.toBeInTheDocument();
    expect(within(cashFlow).getByText("Income").parentElement).toHaveTextContent("2.22 USD");
  });

  it.each(["resolve", "reject"] as const)(
    "does no post-unmount work when a pending request %ss",
    async (outcome) => {
      const pending = deferred<LedgerReportData>();
      const data = reportData({ incomeMinor: 100, expenseMinor: 25 });
      let comparisonReads = 0;
      Object.defineProperty(data, "comparison", {
        configurable: true,
        get: () => {
          comparisonReads += 1;
          return reportData({ incomeMinor: 100, expenseMinor: 25 }).comparison;
        },
      });
      vi.mocked(loadLedgerReport).mockReturnValue(pending.promise);
      const onNavigate = vi.fn();
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const { unmount } = render(
        <DashboardLedgerHighlights mutationEpoch={0} onNavigate={onNavigate} />,
      );
      expect(loadLedgerReport).toHaveBeenCalledOnce();

      unmount();
      await act(async () => {
        if (outcome === "resolve") pending.resolve(data);
        else pending.reject(new Error("request settled after unmount"));
        await pending.promise.catch(() => undefined);
      });

      expect(comparisonReads).toBe(0);
      expect(consoleError).not.toHaveBeenCalled();
      expect(loadLedgerReport).toHaveBeenCalledOnce();
      expect(onNavigate).not.toHaveBeenCalled();
      consoleError.mockRestore();
    },
  );
});

function reportData({
  incomeMinor,
  expenseMinor,
  balanceOnlyUsd = false,
  currency = { id: "currency-krw", code: "KRW", decimalPlaces: 0 },
}: {
  incomeMinor: number;
  expenseMinor: number;
  balanceOnlyUsd?: boolean;
  currency?: { id: string; code: string; decimalPlaces: number };
}): LedgerReportData {
  const current = {
    currencyId: currency.id,
    currencyCode: currency.code,
    decimalPlaces: currency.decimalPlaces,
    incomeMinor,
    expenseMinor,
    netChangeMinor: incomeMinor - expenseMinor,
    entryCount: incomeMinor === 0 && expenseMinor === 0 ? 0 : 2,
  };
  const previous = { ...current, incomeMinor: 0, expenseMinor: 0, netChangeMinor: 0 };
  const range = { start: "2026-08-01", end: "2026-08-31" };
  const balances: LedgerReportData["balances"] = [{
    account: {
      id: `account-${currency.code.toLowerCase()}`,
      name: "Cash",
      categoryId: "account-category-cash",
      currencyId: currency.id,
      openingBalanceMinor: 0,
      active: true,
    },
    currencyCode: currency.code,
    decimalPlaces: currency.decimalPlaces,
    currentBalanceMinor: incomeMinor - expenseMinor,
  }];
  if (balanceOnlyUsd) balances.push({
    account: {
      id: "account-usd",
      name: "USD cash",
      categoryId: "account-category-cash",
      currencyId: "currency-usd",
      openingBalanceMinor: 0,
      active: true,
    },
    currencyCode: "USD",
    decimalPlaces: 2,
    currentBalanceMinor: 12_345,
  });
  return {
    comparison: {
      current: { range, currencies: [current] },
      previous: {
        range: { start: "2026-07-01", end: "2026-07-31" },
        currencies: [previous],
      },
      currencies: [{
        currencyId: currency.id,
        currencyCode: currency.code,
        current,
        previous,
      }],
    },
    categoryBreakdown: expenseMinor > 0 ? [{
      ...current,
      referenceId: "category-food",
      name: "Food",
      incomeMinor: 0,
      netChangeMinor: -expenseMinor,
    }] : [],
    trend: {
      range,
      granularity: "daily",
      currencies: [{
        currencyId: currency.id,
        currencyCode: currency.code,
        points: [{ start: range.start, end: range.start, incomeMinor, expenseMinor }],
      }],
    },
    balances,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function emptyReportData(): LedgerReportData {
  const data = reportData({ incomeMinor: 0, expenseMinor: 0 });
  return {
    ...data,
    comparison: {
      ...data.comparison,
      current: { ...data.comparison.current, currencies: [] },
      previous: { ...data.comparison.previous, currencies: [] },
      currencies: [],
    },
    categoryBreakdown: [],
    trend: { ...data.trend, currencies: [] },
    balances: [],
  };
}
