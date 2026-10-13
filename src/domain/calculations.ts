import type {
  Account,
  AccountAccess,
  AccountCategory,
  CashDenomination,
  Paycheck,
  PaycheckType,
  WealthSnapshot,
} from "./types";

export type CategoryTotals = Record<AccountCategory, number>;
export type AccessBucket = AccountAccess | "unclassified";
export type AccessAggregation = Record<AccessBucket, { amount: number; percentage: number }>;
export type SnapshotDelta = { amount: number; percentage: number | null };
export type AccountBalanceMovement = { accountId: string; amount: number };
export type Period = "mtd" | "ytd";
export const MAX_CURRENCY_AMOUNT = Number.MAX_SAFE_INTEGER / 100;

const emptyCategoryTotals = (): CategoryTotals => ({
  liquidity: 0,
  investments: 0,
  trading: 0,
});

const emptyAccessAmounts = (): Record<AccessBucket, number> => ({
  immediate: 0,
  days: 0,
  locked: 0,
  unclassified: 0,
});

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

export const roundCurrency = (amount: number): number => {
  const rounded = Math.round((amount + Number.EPSILON) * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
};

export const isSafeCurrencyAmount = (value: unknown): value is number =>
  isFiniteNumber(value) && value >= 0 && value <= MAX_CURRENCY_AMOUNT;

type AccountInput = Pick<Account, "balance" | "category" | "includedInWealth">;

function includedAccounts(accounts: ReadonlyArray<AccountInput | null | undefined>): AccountInput[] {
  return accounts.filter(
    (account): account is AccountInput =>
      account !== null &&
      account !== undefined &&
      account.includedInWealth &&
      isFiniteNumber(account.balance),
  );
}

export function calculateTotalWealth(accounts: ReadonlyArray<AccountInput | null | undefined>): number {
  return roundCurrency(
    includedAccounts(accounts).reduce((total, account) => total + account.balance, 0),
  );
}

export function calculateAccountBalanceTotal(
  accounts: ReadonlyArray<Pick<Account, "balance"> | null | undefined>,
): number {
  return roundCurrency(accounts.reduce((total, account) => (
    account && isFiniteNumber(account.balance) ? total + account.balance : total
  ), 0));
}

export function calculateCategoryTotals(
  accounts: ReadonlyArray<AccountInput | null | undefined>,
): CategoryTotals {
  const totals = emptyCategoryTotals();

  for (const account of includedAccounts(accounts)) {
    totals[account.category] += account.balance;
  }

  return {
    liquidity: roundCurrency(totals.liquidity),
    investments: roundCurrency(totals.investments),
    trading: roundCurrency(totals.trading),
  };
}

export function calculateCategoryPercentages(
  totals: CategoryTotals,
  totalWealth: number,
): CategoryTotals {
  if (!isFiniteNumber(totalWealth) || totalWealth <= 0) {
    return emptyCategoryTotals();
  }

  return {
    liquidity: (totals.liquidity / totalWealth) * 100,
    investments: (totals.investments / totalWealth) * 100,
    trading: (totals.trading / totalWealth) * 100,
  };
}

export function calculateAccessAggregation(
  accounts: ReadonlyArray<Account>,
): AccessAggregation {
  const amounts = emptyAccessAmounts();
  const eligibleAccounts = accounts.filter((account) =>
    !account.archivedAt && account.includedInWealth && isFiniteNumber(account.balance));

  for (const account of eligibleAccounts) {
    amounts[account.access ?? "unclassified"] += account.balance;
  }

  const totalWealth = roundCurrency(eligibleAccounts.reduce((total, account) => total + account.balance, 0));
  return Object.fromEntries(
    Object.entries(amounts).map(([bucket, amount]) => {
      const roundedAmount = roundCurrency(amount);
      return [bucket, {
        amount: roundedAmount,
        percentage: totalWealth > 0 ? (roundedAmount / totalWealth) * 100 : 0,
      }];
    }),
  ) as AccessAggregation;
}

export function calculateAccountShare(
  account: Pick<Account, "balance" | "includedInWealth"> | null | undefined,
  totalWealth: number,
): number {
  if (
    !account?.includedInWealth ||
    !isFiniteNumber(account.balance) ||
    !isFiniteNumber(totalWealth) ||
    totalWealth <= 0
  ) {
    return 0;
  }

  return (account.balance / totalWealth) * 100;
}

export function calculateGoalProgress(currentWealth: number, targetAmount: number): number {
  if (!isFiniteNumber(currentWealth) || !isFiniteNumber(targetAmount) || targetAmount <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(100, (currentWealth / targetAmount) * 100));
}

export function calculateGoalRemaining(currentWealth: number, targetAmount: number): number {
  if (!isFiniteNumber(currentWealth) || !isFiniteNumber(targetAmount) || targetAmount <= 0) {
    return 0;
  }

  return roundCurrency(Math.max(0, targetAmount - currentWealth));
}

export function calculateSnapshotDelta(
  current: Pick<WealthSnapshot, "totalWealth"> | null | undefined,
  previous?: Pick<WealthSnapshot, "totalWealth"> | null,
): SnapshotDelta | null {
  if (!current || !previous || !isFiniteNumber(current.totalWealth) || !isFiniteNumber(previous.totalWealth)) {
    return null;
  }

  const amount = roundCurrency(current.totalWealth - previous.totalWealth);
  return {
    amount,
    percentage: previous.totalWealth === 0 ? null : (amount / previous.totalWealth) * 100,
  };
}

export function calculateAccountBalanceMovements(
  current: Pick<WealthSnapshot, "accountBalances"> | null | undefined,
  previous?: Pick<WealthSnapshot, "accountBalances"> | null,
): AccountBalanceMovement[] {
  if (!current || !previous) {
    return [];
  }

  const previousBalances = new Map(previous.accountBalances.map((item) => [item.accountId, item.balance]));
  return current.accountBalances
    .flatMap((item) => {
      const previousBalance = previousBalances.get(item.accountId);
      if (!isFiniteNumber(item.balance) || !isFiniteNumber(previousBalance)) {
        return [];
      }
      const amount = roundCurrency(item.balance - previousBalance);
      return amount === 0 ? [] : [{ accountId: item.accountId, amount }];
    })
    .sort((first, second) => Math.abs(second.amount) - Math.abs(first.amount));
}

function toValidDate(value: Date | string): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function sortedSnapshots(
  snapshots: ReadonlyArray<WealthSnapshot | null | undefined>,
): WealthSnapshot[] {
  return snapshots
    .filter(
      (snapshot): snapshot is WealthSnapshot =>
        snapshot !== null &&
        snapshot !== undefined &&
        isFiniteNumber(snapshot.totalWealth) &&
        toValidDate(snapshot.createdAt) !== null,
    )
    .sort((first, second) =>
      new Date(first.createdAt).getTime() - new Date(second.createdAt).getTime(),
    );
}

function latestSnapshotAtOrBefore(
  snapshots: ReadonlyArray<WealthSnapshot>,
  cutoff: Date,
): WealthSnapshot | undefined {
  const cutoffTime = cutoff.getTime();
  for (let index = snapshots.length - 1; index >= 0; index -= 1) {
    const snapshot = snapshots[index];
    if (new Date(snapshot.createdAt).getTime() <= cutoffTime) {
      return snapshot;
    }
  }

  return undefined;
}

export function calculatePeriodChange(
  snapshots: ReadonlyArray<WealthSnapshot | null | undefined>,
  period: Period,
  referenceDate: Date | string = new Date(),
): SnapshotDelta | null {
  const reference = toValidDate(referenceDate);
  if (!reference) {
    return null;
  }

  const history = sortedSnapshots(snapshots);
  const periodStart =
    period === "mtd"
      ? new Date(reference.getFullYear(), reference.getMonth(), 1)
      : new Date(reference.getFullYear(), 0, 1);
  const baseline = latestSnapshotAtOrBefore(history, periodStart);
  const current = latestSnapshotAtOrBefore(history, reference);

  if (!baseline || !current || baseline.id === current.id) {
    return null;
  }

  return calculateSnapshotDelta(current, baseline);
}

export function calculateAllTimeHigh(
  snapshots: ReadonlyArray<Pick<WealthSnapshot, "totalWealth"> | null | undefined>,
): number | null {
  const totals = snapshots
    .map((snapshot) => snapshot?.totalWealth)
    .filter(isFiniteNumber);

  return totals.length === 0 ? null : Math.max(...totals);
}

export function calculateCashTotal(
  denominations: ReadonlyArray<CashDenomination | null | undefined>,
): number {
  return roundCurrency(
    denominations.reduce((total, denomination) => {
      if (
        !denomination ||
        !isFiniteNumber(denomination.denomination) ||
        !isFiniteNumber(denomination.quantity)
      ) {
        return total;
      }

      return total + denomination.denomination * denomination.quantity;
    }, 0),
  );
}

function validPaychecks(paychecks: ReadonlyArray<Paycheck | null | undefined>): Paycheck[] {
  return paychecks.filter(
    (paycheck): paycheck is Paycheck =>
      paycheck !== null && paycheck !== undefined && isFiniteNumber(paycheck.amount),
  );
}

export function calculateIncomeTotal(
  paychecks: ReadonlyArray<Paycheck | null | undefined>,
): number {
  return roundCurrency(
    validPaychecks(paychecks).reduce((total, paycheck) => total + paycheck.amount, 0),
  );
}

export function calculateIncomeAverage(
  paychecks: ReadonlyArray<Paycheck | null | undefined>,
): number {
  const payments = validPaychecks(paychecks);
  return payments.length === 0 ? 0 : calculateIncomeTotal(payments) / payments.length;
}

export function calculateHighestPayment(
  paychecks: ReadonlyArray<Paycheck | null | undefined>,
): number {
  const amounts = validPaychecks(paychecks).map((paycheck) => paycheck.amount);
  return amounts.length === 0 ? 0 : Math.max(...amounts);
}

/** A record saved before income types existed has none: it was a salary. */
export function paycheckTypeOf(paycheck: Pick<Paycheck, "type">): PaycheckType {
  return paycheck.type ?? "salary";
}

function median(values: number[]): number {
  const sorted = [...values].sort((first, second) => first - second);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/*
 * The typical salary: the median of the salary payments only. An average of
 * every payment mixes in the 13th and 14th months, bonuses and invoices and
 * says nothing about a normal month; the median also shrugs off one odd one.
 * Null when there is no salary to read.
 */
export function calculateTypicalSalary(
  paychecks: ReadonlyArray<Paycheck | null | undefined>,
): number | null {
  const salaries = validPaychecks(paychecks).filter((paycheck) => paycheckTypeOf(paycheck) === "salary");
  return salaries.length === 0 ? null : roundCurrency(median(salaries.map((paycheck) => paycheck.amount)));
}

/*
 * Calendar months, as "YYYY-MM", in which no salary was recorded although the
 * salary is a regular series: from the first salary month to the last month
 * whose usual pay day is past (median day of month, plus three days' grace).
 * Fewer than three salaries are not a series yet, so nothing is missing.
 * It reads recorded payments only: a missing month may be a salary not yet
 * entered, or one that did not arrive — the page says which it cannot know.
 */
export function findMissingSalaryMonths(
  paychecks: ReadonlyArray<Paycheck | null | undefined>,
  today: Date = new Date(),
): string[] {
  const salaries = validPaychecks(paychecks).filter((paycheck) => paycheckTypeOf(paycheck) === "salary");
  if (salaries.length < 3) return [];

  const paid = new Set(salaries.map((paycheck) => paycheck.paymentDate.slice(0, 7)));
  const payDay = median(salaries.map((paycheck) => Number(paycheck.paymentDate.slice(8, 10))));
  const first = [...paid].sort()[0];
  let year = Number(first.slice(0, 4));
  let month = Number(first.slice(5, 7));

  // The last month that should already hold a salary.
  let lastYear = today.getFullYear();
  let lastMonth = today.getMonth() + 1;
  const daysInMonth = new Date(lastYear, lastMonth, 0).getDate();
  if (today.getDate() <= Math.min(payDay + 3, daysInMonth)) {
    lastMonth -= 1;
    if (lastMonth === 0) {
      lastMonth = 12;
      lastYear -= 1;
    }
  }

  const missing: string[] = [];
  while (year < lastYear || (year === lastYear && month <= lastMonth)) {
    const key = `${year}-${String(month).padStart(2, "0")}`;
    if (!paid.has(key)) missing.push(key);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return missing;
}
