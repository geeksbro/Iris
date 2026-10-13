import { isSafeCurrencyAmount } from "./calculations";
import type { Account, SnapshotAccountBalance, WealthSnapshot } from "./types";

export type LegacyAccount = Omit<Account, "createdAt"> & { createdAt?: string };
export type LegacySnapshotAccountBalance = Omit<SnapshotAccountBalance, "includedInWealth"> & {
  includedInWealth?: boolean;
};
export type LegacyWealthSnapshot = Omit<WealthSnapshot, "accountBalances"> & {
  accountBalances: LegacySnapshotAccountBalance[];
};

const DEFAULT_RECONCILIATION_SEARCH_BUDGET = 10_000;

export interface LegacyUpgradeOptions {
  searchBudget?: number;
}

const toCents = (value: number): bigint => BigInt(Math.round(value * 100));

function deriveInclusionState(
  balances: LegacySnapshotAccountBalance[],
  totalWealth: number,
  accountsById: ReadonlyMap<string, LegacyAccount>,
  searchBudget: number,
): boolean[] {
  if (!isSafeCurrencyAmount(totalWealth) || balances.some((balance) => !isSafeCurrencyAmount(balance.balance))) {
    throw new Error("Legacy snapshot contains an unsafe monetary amount");
  }

  const target = toCents(totalWealth);
  const hinted = balances.map((balance) => accountsById.get(balance.accountId)?.includedInWealth ?? false);
  const hintedTotal = balances.reduce(
    (sum, balance, index) => sum + (hinted[index] ? toCents(balance.balance) : BigInt(0)),
    BigInt(0),
  );
  if (hintedTotal === target) {
    return hinted;
  }

  const allTotal = balances.reduce((sum, balance) => sum + toCents(balance.balance), BigInt(0));
  if (allTotal === target) {
    return balances.map(() => true);
  }

  if (balances.length > 40) {
    throw new Error("Legacy snapshot inclusion state is too ambiguous to migrate safely");
  }

  const cents = balances.map((balance) => toCents(balance.balance));
  const suffixSums = Array<bigint>(cents.length + 1).fill(BigInt(0));
  for (let index = cents.length - 1; index >= 0; index -= 1) {
    suffixSums[index] = suffixSums[index + 1] + cents[index];
  }
  if (target > suffixSums[0]) {
    throw new Error("Legacy snapshot total cannot be reconciled with its captured balances");
  }

  const chosen = balances.map(() => false);
  const misses = new Set<string>();
  let searchedStates = 0;
  const search = (index: number, remaining: bigint): boolean => {
    if (remaining === BigInt(0)) {
      return true;
    }
    if (index >= cents.length || remaining < BigInt(0) || remaining > suffixSums[index]) {
      return false;
    }
    searchedStates += 1;
    if (searchedStates > searchBudget) {
      throw new Error("Legacy snapshot reconciliation exceeded the safe search budget");
    }
    const key = `${index}:${remaining}`;
    if (misses.has(key)) {
      return false;
    }

    const preferIncluded = hinted[index];
    const choices = preferIncluded ? [true, false] : [false, true];
    for (const include of choices) {
      chosen[index] = include;
      if (search(index + 1, remaining - (include ? cents[index] : BigInt(0)))) {
        return true;
      }
    }
    chosen[index] = false;
    misses.add(key);
    return false;
  };

  if (!search(0, target)) {
    throw new Error("Legacy snapshot total cannot be reconciled with its captured balances");
  }
  return chosen;
}

export function upgradeLegacyRecords(
  legacyAccounts: readonly LegacyAccount[],
  legacySnapshots: readonly LegacyWealthSnapshot[],
  options: LegacyUpgradeOptions = {},
): { accounts: Account[]; snapshots: WealthSnapshot[] } {
  const searchBudget = options.searchBudget ?? DEFAULT_RECONCILIATION_SEARCH_BUDGET;
  if (!Number.isInteger(searchBudget) || searchBudget <= 0) {
    throw new Error("Legacy snapshot reconciliation search budget must be a positive integer");
  }
  const earliestCapture = new Map<string, string>();
  for (const snapshot of legacySnapshots) {
    for (const balance of snapshot.accountBalances) {
      const known = earliestCapture.get(balance.accountId);
      if (!known || new Date(snapshot.createdAt).getTime() < new Date(known).getTime()) {
        earliestCapture.set(balance.accountId, snapshot.createdAt);
      }
    }
  }

  const accounts = legacyAccounts.map((account): Account => ({
    ...account,
    createdAt: account.createdAt ?? earliestCapture.get(account.id) ?? account.lastUpdated,
  }));
  const accountsById = new Map(accounts.map((account) => [account.id, account]));
  const snapshots = legacySnapshots.map((snapshot): WealthSnapshot => {
    const existingStates = snapshot.accountBalances.map((balance) => balance.includedInWealth);
    const inclusionState = existingStates.every((value) => typeof value === "boolean")
      ? existingStates as boolean[]
      : deriveInclusionState(snapshot.accountBalances, snapshot.totalWealth, accountsById, searchBudget);

    return {
      ...snapshot,
      accountBalances: snapshot.accountBalances.map((balance, index) => ({
        accountId: balance.accountId,
        balance: balance.balance,
        includedInWealth: inclusionState[index],
      })),
    };
  });

  return { accounts, snapshots };
}
