import { calculateCashTotal, calculateTotalWealth, isSafeCurrencyAmount } from "@/domain/calculations";
import { isoDateTimeSchema } from "@/domain/schemas";
import {
  accountAccessValues,
  accountCategories,
  accountVolatilityValues,
  goalTypes,
  paycheckTypes,
  type Account,
  type AccountAccess,
  type AccountVolatility,
  type CashDenomination,
  type Paycheck,
  type WealthGoal,
  type WealthSnapshot,
} from "@/domain/types";

import { wealthDb } from "./db";
import { demoAccounts, demoCashDenominations, demoGoals, demoPaychecks, demoSnapshot } from "./demo";
import { firstRunCashAccount, firstRunCashDenominations } from "./seed";

export { wealthDb } from "./db";

const initializedMetadataKey = "initialized";
/** Set while the archive holds the fictional example archive (demo.ts). */
export const demoDataMetadataKey = "demo-data";

export type BalanceUpdate = {
  accountId: string;
  balance: number;
};

export type AccountDraft = Omit<Account, "createdAt" | "lastUpdated" | "archivedAt">;
export type AccountChanges = Partial<Pick<Account, "name" | "category" | "balance" | "includedInWealth" | "icon">> & {
  access?: AccountAccess | null;
  volatility?: AccountVolatility | null;
};
export type PaycheckChanges = Partial<Omit<Paycheck, "id">>;
export type GoalChanges = Partial<Omit<WealthGoal, "id">>;

const supportedCashDenominations = [5, 10, 20, 50, 100, 200, 500] as const;

const isFiniteNonNegative = isSafeCurrencyAmount;

function assertFiniteNonNegativeBalance(balance: unknown): asserts balance is number {
  if (!isFiniteNonNegative(balance)) {
    throw new Error("Balance must be a finite non-negative number");
  }
}

function assertTimestamp(timestamp: string): void {
  if (!isoDateTimeSchema.safeParse(timestamp).success) {
    throw new Error("Timestamp must be a valid ISO date-time with offset");
  }
}

function assertTemporalIntegrity(
  timestamp: string,
  accounts: ReadonlyArray<Account>,
  snapshots: ReadonlyArray<WealthSnapshot>,
  options: { strictlyAfterLatestSnapshot?: boolean } = {},
): void {
  const operationTime = new Date(timestamp).getTime();
  const precedesAccountHistory = accounts.some((account) => operationTime < Math.max(
    new Date(account.createdAt).getTime(),
    new Date(account.lastUpdated).getTime(),
    account.archivedAt ? new Date(account.archivedAt).getTime() : Number.NEGATIVE_INFINITY,
  ));
  if (precedesAccountHistory) {
    throw new Error("Operation timestamp cannot precede account history");
  }

  const latestSnapshotTime = snapshots.reduce(
    (latest, snapshot) => Math.max(latest, new Date(snapshot.createdAt).getTime()),
    Number.NEGATIVE_INFINITY,
  );
  if (options.strictlyAfterLatestSnapshot) {
    if (operationTime <= latestSnapshotTime) {
      throw new Error("Operation timestamp must be strictly after the latest stored snapshot");
    }
  } else if (operationTime < latestSnapshotTime) {
    throw new Error("Operation timestamp cannot precede the latest stored snapshot");
  }
}

function assertAccountDraft(account: AccountDraft): void {
  if (!account.id.trim() || !account.name.trim() || !accountCategories.includes(account.category)) {
    throw new Error("Account requires a non-empty id, name, and valid category");
  }
  if (account.currency !== "EUR" || typeof account.includedInWealth !== "boolean") {
    throw new Error("Account currency must be EUR and inclusion must be boolean");
  }
  if (account.access !== undefined && !accountAccessValues.includes(account.access)) {
    throw new Error("Account access is invalid");
  }
  if (account.volatility !== undefined && !accountVolatilityValues.includes(account.volatility)) {
    throw new Error("Account volatility is invalid");
  }
  assertFiniteNonNegativeBalance(account.balance);
}

function assertCashDenominations(denominations: ReadonlyArray<CashDenomination>): void {
  const seen = new Set<number>();
  for (const denomination of denominations) {
    if (
      !Number.isFinite(denomination.denomination) ||
      denomination.denomination <= 0 ||
      !Number.isInteger(denomination.quantity) ||
      denomination.quantity < 0 ||
      seen.has(denomination.denomination)
    ) {
      throw new Error("Cash denominations must have unique positive values and non-negative integer quantities");
    }
    seen.add(denomination.denomination);
  }
  if (
    denominations.length !== supportedCashDenominations.length ||
    supportedCashDenominations.some((denomination) => !seen.has(denomination))
  ) {
    throw new Error("Cash Counter must contain exactly the supported EUR denominations");
  }
  if (!isSafeCurrencyAmount(calculateCashTotal(denominations))) {
    throw new Error("Cash Counter total must be a safe finite currency amount");
  }
}

function assertDerivedTotal(accounts: ReadonlyArray<Account>): number {
  const total = calculateTotalWealth(accounts);
  if (!isSafeCurrencyAmount(total)) {
    throw new Error("Total Wealth must remain a safe finite currency amount");
  }
  return total;
}

function requireActiveCash(accounts: ReadonlyArray<Account>): Account {
  const cash = accounts.find((account) => account.id === "cash");
  if (
    !cash || cash.archivedAt || cash.name !== "Cash" ||
    cash.category !== "liquidity" || cash.currency !== "EUR"
  ) {
    throw new Error("Active reserved Cash account not found");
  }
  return cash;
}

function createIdentifier(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function assertPaycheck(paycheck: Paycheck): void {
  if (!paycheck.id.trim() || !isCalendarDate(paycheck.paymentDate) || !isFiniteNonNegative(paycheck.amount)) {
    throw new Error("Paycheck requires an id, calendar date, and finite non-negative amount");
  }
  if (paycheck.type !== undefined && !(paycheckTypes as readonly string[]).includes(paycheck.type)) {
    throw new Error("Paycheck type is not a known income type");
  }
}

function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return false;
  }
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  return month >= 1 && month <= 12 && day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function assertGoal(goal: WealthGoal): void {
  if (
    !goal.id.trim() ||
    !goal.name.trim() ||
    !isSafeCurrencyAmount(goal.targetAmount) ||
    goal.targetAmount <= 0 ||
    (goal.type !== undefined && !goalTypes.includes(goal.type)) ||
    (goal.targetDate !== undefined && !isCalendarDate(goal.targetDate))
  ) {
    throw new Error("Goal requires a valid type, name, positive target amount, and optional calendar target date");
  }
}

export async function initializeDatabase(): Promise<void> {
  await wealthDb.transaction(
    "rw",
    [
      wealthDb.accounts,
      wealthDb.cashDenominations,
      wealthDb.snapshots,
      wealthDb.paychecks,
      wealthDb.goals,
      wealthDb.metadata,
    ],
    async () => {
      // A device never initialised starts empty but for the reserved Cash
      // account (seed.ts). An initialised one is never touched here.
      if (!(await wealthDb.metadata.get(initializedMetadataKey))) {
        await wealthDb.accounts.add(firstRunCashAccount(new Date().toISOString()));
        await wealthDb.cashDenominations.bulkAdd(firstRunCashDenominations);
        await wealthDb.metadata.put({ key: initializedMetadataKey, value: true });
      }
    },
  );
}

/*
 * THE EXAMPLE ARCHIVE (demo.ts), on the owner's explicit request only.
 *
 * It is loaded only into an archive that holds nothing of the owner's — the
 * state a new device starts in: the reserved Cash account at zero, no other
 * account, no snapshot, paycheck or goal — so it can never mix with or
 * overwrite real records. While it is there a metadata flag says so, and
 * only then can it be removed, which empties the archive back to that first
 * state, whatever was added on top of it meanwhile. An import replaces the
 * archive and drops the flag (backup.ts). The PIN, the security policy and
 * every preference are never touched.
 */
async function archiveIsEmpty(): Promise<boolean> {
  const [accounts, snapshots, paychecks, goals] = await Promise.all([
    wealthDb.accounts.toArray(),
    wealthDb.snapshots.count(),
    wealthDb.paychecks.count(),
    wealthDb.goals.count(),
  ]);
  const onlyCashAtZero = accounts.length === 0
    || (accounts.length === 1 && accounts[0].id === "cash" && accounts[0].balance === 0 && !accounts[0].archivedAt);
  return onlyCashAtZero && snapshots === 0 && paychecks === 0 && goals === 0;
}

const archiveTables = () => [
  wealthDb.accounts,
  wealthDb.cashDenominations,
  wealthDb.snapshots,
  wealthDb.paychecks,
  wealthDb.goals,
  wealthDb.metadata,
];

/** Whether the example archive may be loaded now: the archive holds nothing of the owner's. */
export async function canLoadDemoData(): Promise<boolean> {
  return (await wealthDb.metadata.get(demoDataMetadataKey)) ? false : archiveIsEmpty();
}

/** Whether the archive holds the example archive (and so may be emptied from Settings). */
export async function hasDemoData(): Promise<boolean> {
  return (await wealthDb.metadata.get(demoDataMetadataKey))?.value === true;
}

export async function loadDemoData(createdAt: string = new Date().toISOString()): Promise<void> {
  assertTimestamp(createdAt);
  await wealthDb.transaction("rw", archiveTables(), async () => {
    if (!(await archiveIsEmpty())) {
      throw new Error("The example archive loads only into an empty archive");
    }
    await Promise.all([wealthDb.accounts.clear(), wealthDb.cashDenominations.clear()]);
    await wealthDb.accounts.bulkAdd(demoAccounts(createdAt));
    await wealthDb.cashDenominations.bulkAdd(demoCashDenominations);
    await wealthDb.snapshots.add(demoSnapshot(createdAt));
    await wealthDb.paychecks.bulkAdd(demoPaychecks);
    await wealthDb.goals.bulkAdd(demoGoals);
    await wealthDb.metadata.put({ key: initializedMetadataKey, value: true });
    await wealthDb.metadata.put({ key: demoDataMetadataKey, value: true });
  });
}

export async function clearDemoData(clearedAt: string = new Date().toISOString()): Promise<void> {
  assertTimestamp(clearedAt);
  await wealthDb.transaction("rw", archiveTables(), async () => {
    if ((await wealthDb.metadata.get(demoDataMetadataKey))?.value !== true) {
      throw new Error("The archive does not hold the example archive");
    }
    await Promise.all([
      wealthDb.accounts.clear(),
      wealthDb.cashDenominations.clear(),
      wealthDb.snapshots.clear(),
      wealthDb.paychecks.clear(),
      wealthDb.goals.clear(),
    ]);
    await wealthDb.accounts.add(firstRunCashAccount(clearedAt));
    await wealthDb.cashDenominations.bulkAdd(firstRunCashDenominations);
    await wealthDb.metadata.delete(demoDataMetadataKey);
  });
}

export async function resetDatabaseForTests(): Promise<void> {
  await wealthDb.transaction(
    "rw",
    [
      wealthDb.accounts,
      wealthDb.cashDenominations,
      wealthDb.snapshots,
      wealthDb.paychecks,
      wealthDb.goals,
      wealthDb.metadata,
    ],
    async () => {
      await Promise.all([
        wealthDb.accounts.clear(),
        wealthDb.cashDenominations.clear(),
        wealthDb.snapshots.clear(),
        wealthDb.paychecks.clear(),
        wealthDb.goals.clear(),
        wealthDb.metadata.clear(),
      ]);
    },
  );
}

export async function getAccounts(options: { includeArchived?: boolean } = {}): Promise<Account[]> {
  const accounts = await wealthDb.accounts.toArray();
  return options.includeArchived ? accounts : accounts.filter((account) => !account.archivedAt);
}

export async function getCashDenominations(): Promise<CashDenomination[]> {
  return wealthDb.cashDenominations.orderBy("denomination").toArray();
}

export async function getSnapshots(): Promise<WealthSnapshot[]> {
  const snapshots = await wealthDb.snapshots.toArray();
  return snapshots.sort(
    (first, second) => new Date(first.createdAt).getTime() - new Date(second.createdAt).getTime(),
  );
}

export async function saveBalanceSnapshot(
  updates: ReadonlyArray<BalanceUpdate>,
  createdAt: string = new Date().toISOString(),
): Promise<WealthSnapshot> {
  assertTimestamp(createdAt);

  return wealthDb.transaction("rw", wealthDb.accounts, wealthDb.cashDenominations, wealthDb.snapshots, async () => {
    const accounts = await wealthDb.accounts.toArray();
    const activeAccounts = accounts.filter((account) => !account.archivedAt);
    requireActiveCash(activeAccounts);
    assertTemporalIntegrity(
      createdAt,
      accounts,
      await wealthDb.snapshots.toArray(),
      { strictlyAfterLatestSnapshot: true },
    );
    const accountsById = new Map(activeAccounts.map((account) => [account.id, account]));
    const updatedAccountIds = new Set<string>();

    for (const update of updates) {
      assertFiniteNonNegativeBalance(update.balance);
      if (!accountsById.has(update.accountId) || updatedAccountIds.has(update.accountId)) {
        throw new Error("Each balance update must target one active account exactly once");
      }
      updatedAccountIds.add(update.accountId);
    }

    const cashDenominations = await wealthDb.cashDenominations.toArray();
    assertCashDenominations(cashDenominations);
    const cashTotal = cashDenominations.length > 0 ? calculateCashTotal(cashDenominations) : undefined;
    const currentAccounts = activeAccounts.map((account) => {
      const submittedBalance = updates.find((update) => update.accountId === account.id)?.balance;
      const balance = account.id === "cash" && cashTotal !== undefined ? cashTotal : submittedBalance ?? account.balance;
      return { ...account, balance, lastUpdated: createdAt };
    });

    const snapshot: WealthSnapshot = {
      id: createIdentifier(),
      createdAt,
      totalWealth: assertDerivedTotal(currentAccounts),
      accountBalances: currentAccounts.map(({ id: accountId, balance, includedInWealth }) => ({ accountId, balance, includedInWealth })),
    };

    await wealthDb.accounts.bulkPut(currentAccounts);
    await wealthDb.snapshots.add(snapshot);
    return snapshot;
  });
}

export async function deleteSnapshot(snapshotId: string): Promise<WealthSnapshot> {
  if (!snapshotId.trim()) {
    throw new Error("Snapshot id is required");
  }

  return wealthDb.transaction("rw", wealthDb.snapshots, async () => {
    const snapshot = await wealthDb.snapshots.get(snapshotId);
    if (!snapshot) {
      throw new Error("Snapshot not found");
    }

    await wealthDb.snapshots.delete(snapshotId);
    return snapshot;
  });
}

export async function setCashDenominations(
  denominations: ReadonlyArray<CashDenomination>,
  updatedAt: string = new Date().toISOString(),
): Promise<void> {
  assertCashDenominations(denominations);
  assertTimestamp(updatedAt);

  await wealthDb.transaction("rw", wealthDb.cashDenominations, wealthDb.accounts, wealthDb.snapshots, async () => {
    const accounts = await wealthDb.accounts.toArray();
    const cashAccount = requireActiveCash(accounts);
    assertTemporalIntegrity(updatedAt, [cashAccount], await wealthDb.snapshots.toArray());
    const cashTotal = calculateCashTotal(denominations);
    assertDerivedTotal(accounts.map((account) => account.id === "cash"
      ? { ...account, balance: cashTotal }
      : account));
    await wealthDb.cashDenominations.clear();
    await wealthDb.cashDenominations.bulkAdd([...denominations]);
    await wealthDb.accounts.put({
      ...cashAccount,
      balance: cashTotal,
      lastUpdated: updatedAt,
    });
  });
}

export async function createAccount(account: AccountDraft, createdAt: string = new Date().toISOString()): Promise<Account> {
  assertAccountDraft(account);
  assertTimestamp(createdAt);
  if (account.id === "cash" || account.name.trim().toLowerCase() === "cash") {
    throw new Error("Cash is a reserved account identity");
  }
  return wealthDb.transaction("rw", wealthDb.accounts, wealthDb.snapshots, async () => {
    const created: Account = { ...account, createdAt, lastUpdated: createdAt };
    const accounts = await wealthDb.accounts.toArray();
    assertTemporalIntegrity(
      createdAt,
      [],
      await wealthDb.snapshots.toArray(),
      { strictlyAfterLatestSnapshot: true },
    );
    assertDerivedTotal([...accounts.filter((item) => !item.archivedAt), created]);
    await wealthDb.accounts.add(created);
    return created;
  });
}

export async function updateAccount(id: string, changes: AccountChanges, updatedAt: string = new Date().toISOString()): Promise<Account> {
  assertTimestamp(updatedAt);
  return wealthDb.transaction("rw", wealthDb.accounts, wealthDb.cashDenominations, wealthDb.snapshots, async () => {
    const account = await wealthDb.accounts.get(id);
    if (!account || account.archivedAt) {
      throw new Error("Active account not found");
    }
    assertTemporalIntegrity(updatedAt, [account], await wealthDb.snapshots.toArray());
    const definedChanges = Object.fromEntries(
      Object.entries(changes).filter(([, value]) => value !== undefined),
    ) as AccountChanges;
    if (definedChanges.balance !== undefined) assertFiniteNonNegativeBalance(definedChanges.balance);
    if (definedChanges.name !== undefined && !definedChanges.name.trim()) {
      throw new Error("Account name cannot be empty");
    }
    if (definedChanges.category !== undefined && !accountCategories.includes(definedChanges.category)) {
      throw new Error("Account category is invalid");
    }
    if (
      definedChanges.access !== undefined &&
      definedChanges.access !== null &&
      !accountAccessValues.includes(definedChanges.access)
    ) {
      throw new Error("Account access is invalid");
    }
    if (
      definedChanges.volatility !== undefined &&
      definedChanges.volatility !== null &&
      !accountVolatilityValues.includes(definedChanges.volatility)
    ) {
      throw new Error("Account volatility is invalid");
    }
    if (
      id === "cash" &&
      ((definedChanges.name !== undefined && definedChanges.name !== "Cash") ||
        (definedChanges.category !== undefined && definedChanges.category !== "liquidity"))
    ) {
      throw new Error("Reserved Cash account identity cannot be changed");
    }

    const cashTotal = id === "cash" && (await wealthDb.cashDenominations.count()) > 0
      ? calculateCashTotal(await wealthDb.cashDenominations.toArray())
      : undefined;
    const {
      access: requestedAccess,
      volatility: requestedVolatility,
      ...ordinaryChanges
    } = definedChanges;
    const {
      access: currentAccess,
      volatility: currentVolatility,
      ...accountWithoutProfile
    } = account;
    const nextAccess = requestedAccess === null ? undefined : requestedAccess ?? currentAccess;
    const nextVolatility = requestedVolatility === null
      ? undefined
      : requestedVolatility ?? currentVolatility;
    const updated: Account = {
      ...accountWithoutProfile,
      ...ordinaryChanges,
      ...(nextAccess === undefined ? {} : { access: nextAccess }),
      ...(nextVolatility === undefined ? {} : { volatility: nextVolatility }),
      balance: cashTotal ?? definedChanges.balance ?? account.balance,
      lastUpdated: updatedAt,
    };
    const accounts = await wealthDb.accounts.toArray();
    assertDerivedTotal(accounts.filter((item) => !item.archivedAt).map((item) => item.id === id ? updated : item));
    await wealthDb.accounts.put(updated);
    return updated;
  });
}

export async function archiveAccount(id: string, archivedAt: string = new Date().toISOString()): Promise<Account> {
  assertTimestamp(archivedAt);
  if (id === "cash") {
    throw new Error("Reserved Cash account cannot be archived");
  }
  return wealthDb.transaction("rw", wealthDb.accounts, wealthDb.snapshots, async () => {
    const account = await wealthDb.accounts.get(id);
    if (!account) {
      throw new Error("Account not found");
    }
    if (account.archivedAt) {
      throw new Error("Account is already archived");
    }
    assertTemporalIntegrity(
      archivedAt,
      [account],
      await wealthDb.snapshots.toArray(),
      { strictlyAfterLatestSnapshot: true },
    );
    const archived: Account = { ...account, includedInWealth: false, archivedAt, lastUpdated: archivedAt };
    await wealthDb.accounts.put(archived);
    return archived;
  });
}

export async function deleteAccount(id: string, archivedAt: string = new Date().toISOString()): Promise<Account> {
  return archiveAccount(id, archivedAt);
}

export async function getPaychecks(): Promise<Paycheck[]> {
  return wealthDb.paychecks.orderBy("paymentDate").toArray();
}

export async function createPaycheck(paycheck: Paycheck): Promise<Paycheck> {
  assertPaycheck(paycheck);
  await wealthDb.paychecks.add(paycheck);
  return paycheck;
}

export async function updatePaycheck(id: string, changes: PaycheckChanges): Promise<Paycheck> {
  return wealthDb.transaction("rw", wealthDb.paychecks, async () => {
    const paycheck = await wealthDb.paychecks.get(id);
    if (!paycheck) {
      throw new Error("Paycheck not found");
    }
    const updated = { ...paycheck, ...changes };
    assertPaycheck(updated);
    await wealthDb.paychecks.put(updated);
    return updated;
  });
}

export async function deletePaycheck(id: string): Promise<void> {
  await wealthDb.paychecks.delete(id);
}

export async function getGoals(): Promise<WealthGoal[]> {
  return wealthDb.goals.toArray();
}

export async function createGoal(goal: WealthGoal): Promise<WealthGoal> {
  assertGoal(goal);
  await wealthDb.goals.add(goal);
  return goal;
}

export async function updateGoal(id: string, changes: GoalChanges): Promise<WealthGoal> {
  return wealthDb.transaction("rw", wealthDb.goals, async () => {
    const goal = await wealthDb.goals.get(id);
    if (!goal) {
      throw new Error("Goal not found");
    }
    const updated = { ...goal, ...changes };
    assertGoal(updated);
    await wealthDb.goals.put(updated);
    return updated;
  });
}

export async function deleteGoal(id: string): Promise<void> {
  await wealthDb.goals.delete(id);
}
