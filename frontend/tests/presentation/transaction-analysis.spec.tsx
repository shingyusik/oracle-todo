import "@testing-library/jest-dom/vitest";
import React from "react";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ledgerApi } from "@/features/ledger/api/ledger-api";
import { defaultLedgerTableSettings } from "@/features/ledger/model/ledger-table-views";
import { TransactionAnalysis } from "@/features/ledger/ui/TransactionAnalysis";
import type { TransactionAnalysisBucket } from "@/features/ledger/model/ledger-analysis";

const bucket: TransactionAnalysisBucket = { currencyId: "krw", currencyCode: "KRW", decimalPlaces: 0,
  month: "2026-09", kind: "expense", categoryId: "food", categoryLabel: "Food", count: 60, totalMinor: 6000 };
afterEach(() => vi.restoreAllMocks());

describe("TransactionAnalysis", () => {
  it("uses the complete filtered aggregate and keeps currency totals separate", async () => {
    const analyze = vi.spyOn(ledgerApi, "analyzeTable").mockResolvedValue([bucket,
      { ...bucket, currencyId: "usd", currencyCode: "USD", decimalPlaces: 2, totalMinor: 1500, count: 1 }]);
    const user = userEvent.setup();
    const onClose = vi.fn();
    const settings = defaultLedgerTableSettings("ledger.transactions");
    render(<TransactionAnalysis settings={settings} generation={1} onClose={onClose} />);
    expect(await screen.findByRole("group", { name: "Transactions" })).toHaveTextContent("60");
    expect(screen.getByRole("group", { name: "Spending" })).toHaveTextContent("6000 KRW");
    expect(analyze).toHaveBeenCalledWith(settings);
    await user.click(within(screen.getByRole("group", { name: "Analysis currency" })).getByRole("button", { name: "USD" }));
    expect(screen.getByRole("group", { name: "Spending" })).toHaveTextContent("15.00 USD");
    await user.click(screen.getByRole("button", { name: "Close transaction analysis" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("hides old results after filters change and ignores late responses, with safe retry", async () => {
    const pending: Array<(value: TransactionAnalysisBucket[]) => void> = [];
    const analyze = vi.spyOn(ledgerApi, "analyzeTable").mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
    const settings = defaultLedgerTableSettings("ledger.transactions");
    const view = render(<TransactionAnalysis settings={settings} generation={1} onClose={() => {}} />);
    const filtered = { ...settings, filterRules: [{ id: "content", field: "content" as const, operator: "contains" as const, value: "subscription" }] };
    view.rerender(<TransactionAnalysis settings={filtered} generation={1} onClose={() => {}} />);
    await act(async () => pending[1]([{ ...bucket, totalMinor: 200 }]));
    await act(async () => pending[0]([bucket]));
    expect(screen.getByRole("group", { name: "Spending" })).toHaveTextContent("200 KRW");
    analyze.mockRejectedValueOnce(new Error("private database path"));
    view.rerender(<TransactionAnalysis settings={filtered} generation={2} onClose={() => {}} />);
    expect(screen.queryByRole("group", { name: "Spending" })).toBeNull();
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load transaction analysis.");
    expect(screen.queryByText("private database path")).toBeNull();
    analyze.mockResolvedValueOnce([]);
    await userEvent.setup().click(screen.getByRole("button", { name: "Retry analysis" }));
    expect(await screen.findByText("No transactions match this view.")).toBeVisible();
  });
});
