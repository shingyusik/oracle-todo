import { describe, expect, it } from "vitest";

import type {
  Account,
  AccountBalance,
  AccountCategory,
} from "@/features/ledger/model/ledger-model";
import { defaultLedgerTableSettings } from "@/features/ledger/model/ledger-table-views";
import { deriveAccountGroups } from "@/features/ledger/model/account-table";
import type { PlannerTableSettings } from "@/features/workbench/model/planner-model";

function account(id: string, overrides: Partial<Account> = {}): Account {
  return {
    id,
    name: id,
    categoryId: "type-asset",
    currencyId: "currency-usd",
    openingBalanceMinor: 0,
    active: true,
    ...overrides,
  };
}

function balance(
  source: Account,
  overrides: Partial<Omit<AccountBalance, "account">> = {},
): AccountBalance {
  return {
    account: source,
    currencyCode: "USD",
    decimalPlaces: 2,
    currentBalanceMinor: 0,
    ...overrides,
  };
}

const accountTypes: AccountCategory[] = [{
  id: "type-asset",
  name: "Asset",
  parentId: null,
  liability: false,
  active: true,
}, {
  id: "type-debt",
  name: "Liability",
  parentId: null,
  liability: true,
  active: true,
}];

function accountSettings(
  patch: Omit<Partial<PlannerTableSettings>, "groupSettings"> & {
    groupSettings?: Partial<PlannerTableSettings["groupSettings"]>;
  } = {},
): PlannerTableSettings {
  const defaults = defaultLedgerTableSettings("ledger.accounts");
  const { groupSettings, ...settings } = patch;
  return {
    ...defaults,
    ...settings,
    groupSettings: {
      ...defaults.groupSettings,
      ...groupSettings,
    },
  };
}

function rowIds(
  accounts: readonly Account[],
  balances: readonly AccountBalance[],
  settings = accountSettings(),
): string[] {
  return deriveAccountGroups(accounts, balances, accountTypes, settings)
    .flatMap((group) => group.rows.map((row) => row.id));
}

describe("deriveAccountGroups", () => {
  it("joins each active account to its own balance despite a reversed balance response", () => {
    const cash = account("cash", { name: "Cash" });
    const bank = account("bank", {
      name: "Bank",
      categoryId: "type-debt",
      currencyId: "currency-jpy",
    });
    const archived = account("archived", { name: "Archived", active: false });
    const withoutBalance = account("without-balance", { name: "No balance" });
    const groups = deriveAccountGroups(
      [cash, bank, archived, withoutBalance],
      [
        balance(bank, { currencyCode: "JPY", decimalPlaces: 0, currentBalanceMinor: 678 }),
        balance(cash, { currencyCode: "USD", decimalPlaces: 2, currentBalanceMinor: 12_345 }),
        balance(archived, { currencyCode: "KRW", decimalPlaces: 0, currentBalanceMinor: 99 }),
      ],
      accountTypes,
      accountSettings(),
    );

    expect(groups).toEqual([{
      key: "all",
      label: null,
      rows: [
        expect.objectContaining({
          id: "bank",
          account: bank,
          name: "Bank",
          accountTypeId: "type-debt",
          accountTypeLabel: "Liability",
          currencyId: "currency-jpy",
          currencyCode: "JPY",
          decimalPlaces: 0,
          currentBalanceMinor: 678,
        }),
        expect.objectContaining({
          id: "cash",
          account: cash,
          name: "Cash",
          accountTypeId: "type-asset",
          accountTypeLabel: "Asset",
          currencyId: "currency-usd",
          currencyCode: "USD",
          decimalPlaces: 2,
          currentBalanceMinor: 12_345,
        }),
      ],
    }]);
  });

  it("keeps balance precision and currency code when the account type label is unavailable", () => {
    const foreign = account("foreign", {
      categoryId: "inactive-type",
      currencyId: "inactive-currency",
    });
    const [group] = deriveAccountGroups(
      [foreign],
      [balance(foreign, {
        currencyCode: "JPY",
        decimalPlaces: 0,
        currentBalanceMinor: 5_000,
      })],
      accountTypes,
      accountSettings(),
    );

    expect(group?.rows).toEqual([expect.objectContaining({
      id: "foreign",
      accountTypeLabel: "Unknown account type",
      currencyCode: "JPY",
      decimalPlaces: 0,
      currentBalanceMinor: 5_000,
    })]);
  });

  it.each([
    [
      "name",
      { id: "name", field: "name", type: "text", operator: "contains", value: "bank" },
      ["bank"],
    ],
    [
      "account type label",
      { id: "type", field: "account_type", type: "relation", operator: "is", value: ["Liability"] },
      ["card"],
    ],
    [
      "account type id",
      { id: "type-id", field: "account_type", type: "relation", operator: "is", value: ["type-asset"] },
      ["bank"],
    ],
    [
      "currency code",
      { id: "currency", field: "currency", type: "relation", operator: "is", value: ["KRW"] },
      ["card"],
    ],
    [
      "currency id",
      { id: "currency-id", field: "currency", type: "relation", operator: "is", value: ["currency-usd"] },
      ["bank"],
    ],
    [
      "displayed current balance",
      { id: "balance", field: "current_balance", type: "number", operator: "is", value: "12.34" },
      ["bank"],
    ],
  ] as const)("filters by %s", (_name, filterRule, expected) => {
    const bank = account("bank", { name: "Bank cash" });
    const card = account("card", {
      name: "Card",
      categoryId: "type-debt",
      currencyId: "currency-krw",
    });

    expect(rowIds(
      [bank, card],
      [
        balance(bank, { currencyCode: "USD", decimalPlaces: 2, currentBalanceMinor: 1_234 }),
        balance(card, { currencyCode: "KRW", decimalPlaces: 0, currentBalanceMinor: 12 }),
      ],
      accountSettings({ filterRules: [filterRule as PlannerTableSettings["filterRules"][number]] }),
    )).toEqual(expected);
  });

  it("unions separate filter matches in OR mode and excludes them in AND mode", () => {
    const bank = account("bank", { name: "Bank cash" });
    const card = account("card", {
      name: "Card",
      categoryId: "type-debt",
      currencyId: "currency-krw",
    });
    const balances = [
      balance(bank, { currencyCode: "USD", decimalPlaces: 2, currentBalanceMinor: 1_234 }),
      balance(card, { currencyCode: "KRW", decimalPlaces: 0, currentBalanceMinor: 12 }),
    ];
    const filterRules: PlannerTableSettings["filterRules"] = [{
      id: "name", field: "name", type: "text", operator: "contains", value: "bank",
    }, {
      id: "currency", field: "currency", type: "relation", operator: "is", value: ["KRW"],
    }];

    expect(rowIds([bank, card], balances, accountSettings({
      filterMode: "or",
      filterRules,
    }))).toEqual(["bank", "card"]);
    expect(rowIds([bank, card], balances, accountSettings({
      filterMode: "and",
      filterRules,
    }))).toEqual([]);
  });

  it("sorts supported fields with deterministic multi-rule and row-id ties", () => {
    const accounts = [
      account("zulu", { name: "Zulu", categoryId: "type-debt", currencyId: "currency-jpy" }),
      account("alpha-b", { name: "Alpha", categoryId: "type-asset", currencyId: "currency-usd" }),
      account("alpha-a", { name: "Alpha", categoryId: "type-asset", currencyId: "currency-usd" }),
      account("cash", { name: "Cash", categoryId: "type-asset", currencyId: "currency-krw" }),
    ];
    const balances = [
      balance(accounts[0]!, { currencyCode: "JPY", decimalPlaces: 0, currentBalanceMinor: 3 }),
      balance(accounts[1]!, { currencyCode: "USD", decimalPlaces: 2, currentBalanceMinor: 500 }),
      balance(accounts[2]!, { currencyCode: "USD", decimalPlaces: 2, currentBalanceMinor: 500 }),
      balance(accounts[3]!, { currencyCode: "KRW", decimalPlaces: 0, currentBalanceMinor: 4 }),
    ];

    const expected: Record<string, string[]> = {
      name: ["alpha-a", "alpha-b", "cash", "zulu"],
      account_type: ["alpha-a", "alpha-b", "cash", "zulu"],
      currency: ["zulu", "cash", "alpha-a", "alpha-b"],
      current_balance: ["zulu", "cash", "alpha-a", "alpha-b"],
    };
    for (const [field, ids] of Object.entries(expected)) {
      expect(rowIds(accounts, balances, accountSettings({
        sortRules: [{ id: field, field: field as "name", direction: "asc" }],
      }))).toEqual(ids);
    }
    expect(rowIds(accounts, balances, accountSettings({
      sortRules: [
        { id: "type", field: "account_type", direction: "asc" },
        { id: "name", field: "name", direction: "desc" },
      ],
    }))).toEqual(["cash", "alpha-a", "alpha-b", "zulu"]);
  });

  it("groups by account type and currency using saved-view ordering and visibility", () => {
    const cash = account("cash", { name: "Cash" });
    const card = account("card", {
      name: "Card",
      categoryId: "type-debt",
      currencyId: "currency-krw",
    });
    const balances = [
      balance(cash, { currencyCode: "USD", decimalPlaces: 2, currentBalanceMinor: 100 }),
      balance(card, { currencyCode: "KRW", decimalPlaces: 0, currentBalanceMinor: 200 }),
    ];

    const byType = deriveAccountGroups([cash, card], balances, accountTypes, accountSettings({
      groupSettings: {
        groupBy: "account_type",
        manualOrder: ["type-debt", "type-asset"],
        hiddenGroupKeys: ["type-asset"],
        hideEmpty: true,
      },
    }));
    const byCurrency = deriveAccountGroups([cash, card], balances, accountTypes, accountSettings({
      groupSettings: {
        groupBy: "currency",
        manualOrder: ["currency-krw", "currency-usd"],
        hideEmpty: false,
      },
    }));

    expect(byType.map(({ key, label, rows }) => ({ key, label, ids: rows.map(({ id }) => id) })))
      .toEqual([{ key: "type-debt", label: "Liability", ids: ["card"] }]);
    expect(byCurrency.map(({ key, label, rows }) => ({ key, label, ids: rows.map(({ id }) => id) })))
      .toEqual([
        { key: "currency-krw", label: "KRW", ids: ["card"] },
        { key: "currency-usd", label: "USD", ids: ["cash"] },
      ]);
  });

  it("filters and sorts zero- and two-decimal current balances in displayed units", () => {
    const yen = account("yen", { currencyId: "currency-jpy" });
    const dollars = account("dollars", { currencyId: "currency-usd" });
    const balances = [
      balance(yen, { currencyCode: "JPY", decimalPlaces: 0, currentBalanceMinor: 12 }),
      balance(dollars, { currencyCode: "USD", decimalPlaces: 2, currentBalanceMinor: 1_234 }),
    ];

    expect(rowIds([yen, dollars], balances, accountSettings({
      filterRules: [{
        id: "displayed", field: "current_balance", type: "number", operator: "is", value: "12",
      }],
    }))).toEqual(["yen"]);
    expect(rowIds([yen, dollars], balances, accountSettings({
      sortRules: [{ id: "balance", field: "current_balance", direction: "asc" }],
    }))).toEqual(["yen", "dollars"]);
  });
});
