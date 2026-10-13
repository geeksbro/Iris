import { describe, expect, it } from "vitest";

import { upgradeLegacyRecords } from "./legacy";

type UpgradeWithOptions = (
  accounts: Parameters<typeof upgradeLegacyRecords>[0],
  snapshots: Parameters<typeof upgradeLegacyRecords>[1],
  options?: { searchBudget?: number },
) => ReturnType<typeof upgradeLegacyRecords>;

const runUpgrade = upgradeLegacyRecords as unknown as UpgradeWithOptions;

function makeAccounts(balances: number[]) {
  return balances.map((balance, index) => ({
    id: `account-${index}`,
    name: `Account ${index}`,
    category: "liquidity" as const,
    currency: "EUR" as const,
    balance,
    includedInWealth: false,
    lastUpdated: "2026-08-25T00:00:00.000Z",
  }));
}

function makeSnapshot(balances: number[], totalWealth: number) {
  return [{
    id: "legacy-snapshot",
    createdAt: "2026-08-25T00:00:00.000Z",
    totalWealth,
    accountBalances: balances.map((balance, index) => ({
      accountId: `account-${index}`,
      balance,
    })),
  }];
}

describe("legacy snapshot reconciliation", () => {
  it("fails clearly when the deterministic search budget is exhausted", () => {
    const balances = Array.from({ length: 16 }, (_, index) => (2 ** index) * 0.02);

    expect(() => runUpgrade(
      makeAccounts(balances),
      makeSnapshot(balances, 655.35),
      { searchBudget: 25 },
    )).toThrow("Legacy snapshot reconciliation exceeded the safe search budget");
  });

  it("rejects a powers-of-two target above the suffix sum without consuming the search budget", () => {
    const balances = Array.from({ length: 40 }, (_, index) => (2 ** index) / 100);
    const total = balances.reduce((sum, balance) => sum + balance, 0);

    expect(() => runUpgrade(
      makeAccounts(balances),
      makeSnapshot(balances, total + 0.01),
      { searchBudget: 1 },
    )).toThrow("Legacy snapshot total cannot be reconciled with its captured balances");
  });
});
