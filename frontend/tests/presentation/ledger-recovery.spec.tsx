import "@testing-library/jest-dom/vitest";
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { ledgerApi } from "@/features/ledger/api/ledger-api";
import type { LedgerController } from "@/features/ledger/hooks/useLedgerController";
import { LedgerRecovery } from "@/features/ledger/ui/LedgerRecovery";
import { LedgerHistory } from "@/features/ledger/ui/LedgerHistory";

afterEach(() => vi.restoreAllMocks());

it("browses inactive currencies and reactivates through the controller", async () => {
  const user = userEvent.setup();
  const list = vi.spyOn(ledgerApi, "listCurrencies").mockResolvedValue({ items: [
    { id: "old", name: "Old currency", code: "OLD", symbol: "O", decimalPlaces: 2, active: false },
    { id: "live", name: "Live currency", code: "USD", symbol: "$", decimalPlaces: 2, active: true },
  ], nextOffset: null });
  const updateCurrency = vi.fn().mockResolvedValue(undefined);
  const controller = { updateCurrency } as unknown as LedgerController;
  render(<LedgerRecovery kind="currencies" controller={controller} />);
  await user.click(screen.getByText("Inactive currencies"));
  await screen.findByText(/Old currency/);
  expect(screen.queryByText(/Live currency/)).toBeNull();
  expect(list).toHaveBeenCalledWith({ offset: 0, limit: 100, includeInactive: true });
  await user.click(screen.getByRole("button", { name: "Restore" }));
  expect(updateCurrency).toHaveBeenCalledWith("old", { active: true });
  await waitFor(() => expect(screen.queryByText(/Old currency/)).toBeNull());
});

it("shows paged audit before and after snapshots", async () => {
  const user = userEvent.setup();
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ items: [
    { id: "event", occurred_at: "2026-09-30T00:00:00Z", actor: "raven-api", action: "currency.update", before: { active: false }, after: { active: true } },
  ], next_offset: null }), { status: 200, headers: { "Content-Type": "application/json" } }));
  render(<LedgerHistory recordType="currency" recordId="old" />);
  await user.click(screen.getByText("History"));
  await screen.findByText(/currency.update/);
  expect(screen.getByText(/"before"/)).toHaveTextContent('"active": false');
  expect(screen.getByText(/"before"/)).toHaveTextContent('"active": true');
  expect(String(fetch.mock.calls[0][0])).toContain("/audit/currency/old?offset=0&limit=50");
});

it.each(["accounts", "categories", "account-types"] as const)("recovers inactive %s through its lifecycle operation", async (kind) => {
  const user = userEvent.setup();
  if (kind === "accounts") vi.spyOn(ledgerApi, "listAccounts").mockResolvedValue({ items: [
    { id: "old", name: "Inactive record", categoryId: "type", currencyId: "currency", openingBalanceMinor: 0, active: false },
  ], nextOffset: null });
  else if (kind === "categories") vi.spyOn(ledgerApi, "listTransactionCategories").mockResolvedValue({ items: [
    { id: "old", name: "Inactive record", parentId: null, kind: "expense", active: false },
  ], nextOffset: null });
  else vi.spyOn(ledgerApi, "listAccountCategories").mockResolvedValue({ items: [
    { id: "old", name: "Inactive record", parentId: null, liability: false, active: false },
  ], nextOffset: null });
  const restoreAccount = vi.fn().mockResolvedValue(undefined);
  const restoreCategory = vi.fn().mockResolvedValue(undefined);
  const updateAccountCategory = vi.fn().mockResolvedValue(undefined);
  const controller = { restoreAccount, restoreCategory, updateAccountCategory } as unknown as LedgerController;
  render(<LedgerRecovery kind={kind} controller={controller} />);
  await user.click(screen.getByText(`Inactive ${kind}`));
  await screen.findByText(/Inactive record/);
  await user.click(screen.getByRole("button", { name: "Restore" }));
  if (kind === "accounts") expect(restoreAccount).toHaveBeenCalledWith("old");
  else if (kind === "categories") expect(restoreCategory).toHaveBeenCalledWith("old");
  else expect(updateAccountCategory).toHaveBeenCalledWith("old", { active: true });
});
