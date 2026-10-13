import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { calculateTotalWealth, MAX_CURRENCY_AMOUNT } from "@/domain/calculations";
import { parseWealthBackup } from "@/domain/schemas";
import { createBackup, replaceDatabaseFromBackup } from "./backup";
import { demoCreatedAt } from "./demo";
import {
  archiveAccount,
  createAccount,
  createGoal,
  createPaycheck,
  deleteAccount,
  deleteGoal,
  deletePaycheck,
  deleteSnapshot,
  getAccounts,
  getGoals,
  getPaychecks,
  getSnapshots,
  canLoadDemoData,
  clearDemoData,
  hasDemoData,
  initializeDatabase,
  loadDemoData,
  resetDatabaseForTests,
  saveBalanceSnapshot,
  setCashDenominations,
  updateAccount,
  updateGoal,
  updatePaycheck,
  wealthDb,
} from "./repository";
import { initializeWithDemoArchive } from "@/test/demo-archive";

describe("wealth repository", () => {
  beforeEach(async () => {
    await resetDatabaseForTests();
  });

  afterEach(async () => {
    await resetDatabaseForTests();
  });

  it("starts a new device empty but for the reserved Cash account at zero, and never initialises twice", async () => {
    await initializeDatabase();
    await initializeDatabase();

    expect(await getAccounts()).toEqual([expect.objectContaining({ id: "cash", name: "Cash", category: "liquidity", balance: 0, includedInWealth: true })]);
    expect((await wealthDb.cashDenominations.toArray()).map((row) => row.quantity)).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(await wealthDb.snapshots.count()).toBe(0);
    expect(await wealthDb.paychecks.count()).toBe(0);
    expect(await getGoals()).toEqual([]);
    expect(await canLoadDemoData()).toBe(true);
  });

  it("never touches an archive that was already initialised", async () => {
    await wealthDb.metadata.put({ key: "initialized", value: true });
    await wealthDb.accounts.add({ id: "mine", name: "Mine", category: "liquidity", currency: "EUR", balance: 12, includedInWealth: true, createdAt: demoCreatedAt, lastUpdated: demoCreatedAt });

    await initializeDatabase();

    expect((await getAccounts()).map((account) => account.id)).toEqual(["mine"]);
  });

  it("loads the fictional example archive only into an empty archive, and removes it only while it is there", async () => {
    await initializeDatabase();
    await loadDemoData(demoCreatedAt);

    expect(await wealthDb.accounts.count()).toBe(7);
    expect(await wealthDb.snapshots.count()).toBe(1);
    expect(await wealthDb.paychecks.count()).toBe(8);
    expect(await getGoals()).toEqual([{ id: "wealth-goal", name: "Total Wealth", targetAmount: 20000 }]);
    expect(calculateTotalWealth(await getAccounts())).toBe(9420.4);
    expect(await hasDemoData()).toBe(true);
    expect(await canLoadDemoData()).toBe(false);
    await expect(loadDemoData(demoCreatedAt)).rejects.toThrow("only into an empty archive");

    // Whatever was added on top goes with it; the PIN's metadata stays.
    await wealthDb.metadata.put({ key: "security-policy", value: { idleTimeoutMs: 60_000 } });
    await createPaycheck({ id: "added", paymentDate: "2026-08-27", amount: 10 });
    await clearDemoData("2026-09-01T09:00:00.000Z");
    expect(await getAccounts()).toEqual([expect.objectContaining({ id: "cash", balance: 0, createdAt: "2026-09-01T09:00:00.000Z" })]);
    expect(await wealthDb.paychecks.count()).toBe(0);
    expect(await wealthDb.snapshots.count()).toBe(0);
    expect(await hasDemoData()).toBe(false);
    expect((await wealthDb.metadata.get("security-policy"))?.value).toEqual({ idleTimeoutMs: 60_000 });
    await expect(clearDemoData()).rejects.toThrow("does not hold the example archive");
  });

  it("refuses the example archive over the owner's records, and an import is never the example archive", async () => {
    await initializeDatabase();
    await createGoal({ id: "wealth-goal", name: "Casa", targetAmount: 1000 });
    expect(await canLoadDemoData()).toBe(false);
    await expect(loadDemoData()).rejects.toThrow("only into an empty archive");
    expect(await wealthDb.accounts.count()).toBe(1);

    await resetDatabaseForTests();
    await initializeDatabase();
    await loadDemoData(demoCreatedAt);
    const backup = await createBackup("2026-08-26T10:00:00.000Z");
    await replaceDatabaseFromBackup(backup);
    expect(await hasDemoData()).toBe(false);
    await expect(clearDemoData()).rejects.toThrow("does not hold the example archive");
  });

  it("returns snapshots in chronological epoch order when offsets differ", async () => {
    await wealthDb.snapshots.bulkAdd([
      { id: "later", createdAt: "2026-08-25T09:00:00+00:00", totalWealth: 200, accountBalances: [] },
      { id: "earlier", createdAt: "2026-08-25T10:30:00+02:00", totalWealth: 100, accountBalances: [] },
    ]);

    expect((await getSnapshots()).map((snapshot) => snapshot.id)).toEqual(["earlier", "later"]);
  });

  it("updates current balances while retaining the exact balance state in each snapshot", async () => {
    await initializeWithDemoArchive();
    const original = await wealthDb.snapshots.get("initial-snapshot");

    await saveBalanceSnapshot(
      [{ accountId: "banca-aurora", balance: 6000 }, { accountId: "conto-vela", balance: 500 }],
      "2026-08-26T09:00:00.000Z",
    );

    expect((await wealthDb.accounts.get("banca-aurora"))?.balance).toBe(6000);
    expect((await wealthDb.accounts.get("banca-aurora"))?.lastUpdated).toBe("2026-08-26T09:00:00.000Z");
    expect(await wealthDb.snapshots.count()).toBe(2);
    expect(await wealthDb.snapshots.get("initial-snapshot")).toEqual(original);
    expect((await wealthDb.snapshots.where("createdAt").equals("2026-08-26T09:00:00.000Z").first())?.accountBalances)
      .toContainEqual({ accountId: "banca-aurora", balance: 6000, includedInWealth: true });
  });

  it("deletes only the selected snapshot without changing current account balances", async () => {
    await initializeWithDemoArchive();
    const saved = await saveBalanceSnapshot(
      [{ accountId: "banca-aurora", balance: 6000 }],
      "2026-08-26T09:00:00.000Z",
    );
    const currentAccount = await wealthDb.accounts.get("banca-aurora");

    await deleteSnapshot(saved.id);

    expect(await wealthDb.snapshots.get(saved.id)).toBeUndefined();
    expect(await wealthDb.snapshots.get("initial-snapshot")).toBeDefined();
    expect(await wealthDb.accounts.get("banca-aurora")).toEqual(currentAccount);
  });

  it("rejects deletion of a snapshot that does not exist", async () => {
    await initializeWithDemoArchive();

    await expect(deleteSnapshot("missing-snapshot")).rejects.toThrow("Snapshot not found");
  });

  it("rejects a date-only snapshot timestamp before it can enter an unimportable backup", async () => {
    await initializeWithDemoArchive();

    await expect(saveBalanceSnapshot([{ accountId: "banca-aurora", balance: 6000 }], "2026-08-25"))
      .rejects.toThrow("Timestamp must be a valid ISO date-time with offset");

    await saveBalanceSnapshot([{ accountId: "banca-aurora", balance: 6000 }], "2026-08-26T09:00:00.000Z");
    const backup = await createBackup("2026-08-26T10:00:00.000Z");
    await resetDatabaseForTests();
    await expect(replaceDatabaseFromBackup(backup)).resolves.toBeUndefined();
    expect((await wealthDb.snapshots.where("createdAt").equals("2026-08-26T09:00:00.000Z").first())?.totalWealth)
      .toBe(10600.05);
  });

  it("keeps excluded accounts out of the total and archives deleted accounts as tombstones", async () => {
    await initializeWithDemoArchive();
    await updateAccount("conto-vela", { includedInWealth: false }, "2026-08-26T09:00:00.000Z");
    await archiveAccount("lira-invest", "2026-08-26T10:00:00.000Z");

    expect(calculateTotalWealth(await getAccounts())).toBe(8756.75);
    expect((await getAccounts()).map((account) => account.id)).not.toContain("lira-invest");
    expect(await wealthDb.accounts.get("lira-invest")).toMatchObject({
      id: "lira-invest",
      includedInWealth: false,
      archivedAt: "2026-08-26T10:00:00.000Z",
    });
  });

  it("deletes an account through the tombstone command while retaining it for backup history", async () => {
    await initializeWithDemoArchive();
    await deleteAccount("lira-invest", "2026-08-26T10:00:00.000Z");

    expect(await getAccounts()).not.toContainEqual(expect.objectContaining({ id: "lira-invest" }));
    expect(await getAccounts({ includeArchived: true })).toContainEqual(expect.objectContaining({
      id: "lira-invest",
      includedInWealth: false,
      archivedAt: "2026-08-26T10:00:00.000Z",
    }));
  });

  it("rolls back every change when any submitted balance is invalid", async () => {
    await initializeWithDemoArchive();
    const before = await wealthDb.accounts.get("banca-aurora");
    const snapshotCount = await wealthDb.snapshots.count();

    await expect(saveBalanceSnapshot([
      { accountId: "banca-aurora", balance: 6000 },
      { accountId: "conto-vela", balance: -1 },
    ], "2026-08-26T09:00:00.000Z")).rejects.toThrow("Balance must be a finite non-negative number");

    expect(await wealthDb.accounts.get("banca-aurora")).toEqual(before);
    expect(await wealthDb.snapshots.count()).toBe(snapshotCount);
  });

  it("derives the Cash account and stored snapshot from the cash denominations", async () => {
    await initializeWithDemoArchive();
    await setCashDenominations([
      { denomination: 5, quantity: 0 },
      { denomination: 10, quantity: 0 },
      { denomination: 20, quantity: 0 },
      { denomination: 50, quantity: 3 },
      { denomination: 100, quantity: 0 },
      { denomination: 200, quantity: 0 },
      { denomination: 500, quantity: 0 },
    ], "2026-08-26T09:00:00.000Z");

    await saveBalanceSnapshot([{ accountId: "cash", balance: 999 }], "2026-08-26T10:00:00.000Z");

    expect((await wealthDb.accounts.get("cash"))?.balance).toBe(150);
    expect((await wealthDb.snapshots.where("createdAt").equals("2026-08-26T10:00:00.000Z").first())?.accountBalances)
      .toContainEqual({ accountId: "cash", balance: 150, includedInWealth: true });
  });

  it("rolls back Cash Counter writes when the reserved Cash account is missing", async () => {
    await initializeWithDemoArchive();
    const before = await wealthDb.cashDenominations.toArray();
    await wealthDb.accounts.delete("cash");

    await expect(setCashDenominations(
      before.map((item) => item.denomination === 10 ? { ...item, quantity: 99 } : item),
      "2026-08-26T09:00:00.000Z",
    )).rejects.toThrow("Active reserved Cash account not found");

    expect(await wealthDb.cashDenominations.toArray()).toEqual(before);
  });

  it("rolls back Cash Counter writes when the reserved Cash account is archived", async () => {
    await initializeWithDemoArchive();
    const before = await wealthDb.cashDenominations.toArray();
    await wealthDb.accounts.update("cash", { archivedAt: "2026-08-26T08:00:00.000Z" });

    await expect(setCashDenominations(
      before.map((item) => item.denomination === 10 ? { ...item, quantity: 99 } : item),
      "2026-08-26T09:00:00.000Z",
    )).rejects.toThrow("Active reserved Cash account not found");

    expect(await wealthDb.cashDenominations.toArray()).toEqual(before);
  });

  it("rejects unsafe balances at mutation boundaries before Total Wealth can overflow", async () => {
    await initializeWithDemoArchive();
    const before = await wealthDb.accounts.get("banca-aurora");
    const snapshotCount = await wealthDb.snapshots.count();

    await expect(updateAccount(
      "banca-aurora",
      { balance: Number.MAX_VALUE },
      "2026-08-26T09:00:00.000Z",
    )).rejects.toThrow("finite non-negative");
    await expect(saveBalanceSnapshot(
      [{ accountId: "banca-aurora", balance: Number.MAX_VALUE }],
      "2026-08-26T09:00:00.000Z",
    )).rejects.toThrow("finite non-negative");

    expect(await wealthDb.accounts.get("banca-aurora")).toEqual(before);
    expect(await wealthDb.snapshots.count()).toBe(snapshotCount);
  });

  it("creates, updates, and archives accounts without physically deleting the account", async () => {
    await initializeWithDemoArchive();
    const account = await createAccount({
      id: "savings",
      name: "Savings",
      category: "liquidity",
      currency: "EUR",
      balance: 200,
      includedInWealth: true,
    }, "2026-08-26T09:00:00.000Z");

    await updateAccount(account.id, { balance: 250, name: "Emergency savings" }, "2026-08-26T10:00:00.000Z");
    await archiveAccount(account.id, "2026-08-26T11:00:00.000Z");

    expect(await wealthDb.accounts.get(account.id)).toMatchObject({
      name: "Emergency savings",
      balance: 250,
      createdAt: "2026-08-26T09:00:00.000Z",
      includedInWealth: false,
      archivedAt: "2026-08-26T11:00:00.000Z",
    });
  });

  it("prevents a newly created account from being backdated into an existing snapshot", async () => {
    await initializeWithDemoArchive();

    await expect(createAccount({
      id: "backdated",
      name: "Backdated",
      category: "liquidity",
      currency: "EUR",
      balance: 10,
      includedInWealth: true,
    }, "2026-08-25T00:00:00.000Z")).rejects.toThrow("after the latest stored snapshot");

    expect(await wealthDb.accounts.get("backdated")).toBeUndefined();
  });

  it("rolls back a snapshot timestamped before an account's latest mutation", async () => {
    await initializeWithDemoArchive();
    await updateAccount("banca-aurora", { balance: 6_100 }, "2026-08-26T10:00:00.000Z");
    const before = await wealthDb.accounts.get("banca-aurora");
    const snapshotCount = await wealthDb.snapshots.count();

    await expect(saveBalanceSnapshot(
      [{ accountId: "banca-aurora", balance: 6_200 }],
      "2026-08-26T09:00:00.000Z",
    )).rejects.toThrow("cannot precede account history");

    expect(await wealthDb.accounts.get("banca-aurora")).toEqual(before);
    expect(await wealthDb.snapshots.count()).toBe(snapshotCount);
  });

  it("rolls back backdated account and Cash mutations", async () => {
    await initializeWithDemoArchive();
    const accountBefore = await wealthDb.accounts.get("banca-aurora");
    const cashBefore = await wealthDb.accounts.get("cash");
    const denominationsBefore = await wealthDb.cashDenominations.toArray();

    await expect(updateAccount("banca-aurora", { balance: 1 }, "2026-08-24T00:00:00.000Z"))
      .rejects.toThrow("cannot precede account history");
    await expect(setCashDenominations(denominationsBefore, "2026-08-24T00:00:00.000Z"))
      .rejects.toThrow("cannot precede account history");

    expect(await wealthDb.accounts.get("banca-aurora")).toEqual(accountBefore);
    expect(await wealthDb.accounts.get("cash")).toEqual(cashBefore);
    expect(await wealthDb.cashDenominations.toArray()).toEqual(denominationsBefore);
  });

  it("requires archival to occur strictly after a snapshot captured at the same time", async () => {
    await initializeWithDemoArchive();
    const before = await wealthDb.accounts.get("lira-invest");

    await expect(archiveAccount("lira-invest", "2026-08-25T00:00:00.000Z"))
      .rejects.toThrow("strictly after the latest stored snapshot");

    expect(await wealthDb.accounts.get("lira-invest")).toEqual(before);
  });

  it("rejects re-archiving an account without moving its historical archive boundary", async () => {
    await initializeWithDemoArchive();
    await archiveAccount("lira-invest", "2026-08-26T11:00:00.000Z");
    await saveBalanceSnapshot([], "2026-08-26T12:00:00.000Z");
    const archivedBefore = await wealthDb.accounts.get("lira-invest");

    await expect(archiveAccount("lira-invest", "2026-08-26T13:00:00.000Z"))
      .rejects.toThrow("Account is already archived");

    expect(await wealthDb.accounts.get("lira-invest")).toEqual(archivedBefore);
  });

  it("rejects a snapshot before a future archived-account mutation and rolls back", async () => {
    await initializeWithDemoArchive();
    await archiveAccount("lira-invest", "2026-08-26T13:00:00.000Z");
    const accountsBefore = await wealthDb.accounts.toArray();
    const snapshotCount = await wealthDb.snapshots.count();

    await expect(saveBalanceSnapshot([], "2026-08-26T12:00:00.000Z"))
      .rejects.toThrow("cannot precede account history");

    expect(await wealthDb.accounts.toArray()).toEqual(accountsBefore);
    expect(await wealthDb.snapshots.count()).toBe(snapshotCount);
  });

  it("uses archivedAt as a snapshot chronology boundary even when lastUpdated is older", async () => {
    await initializeWithDemoArchive();
    const liraInvest = await wealthDb.accounts.get("lira-invest");
    await wealthDb.accounts.put({
      ...liraInvest!,
      includedInWealth: false,
      lastUpdated: "2026-08-26T11:00:00.000Z",
      archivedAt: "2026-08-26T13:00:00.000Z",
    });
    const snapshotCount = await wealthDb.snapshots.count();

    await expect(saveBalanceSnapshot([], "2026-08-26T12:00:00.000Z"))
      .rejects.toThrow("cannot precede account history");

    expect(await wealthDb.snapshots.count()).toBe(snapshotCount);
  });

  it("round-trips snapshots captured normally before and after an archival boundary", async () => {
    await initializeWithDemoArchive();
    await saveBalanceSnapshot([], "2026-08-26T12:00:00.000Z");
    await archiveAccount("lira-invest", "2026-08-26T13:00:00.000Z");
    const afterArchive = await saveBalanceSnapshot([], "2026-08-26T14:00:00.000Z");
    const backup = await createBackup("2026-08-26T15:00:00.000Z");

    expect(afterArchive.accountBalances).not.toContainEqual(expect.objectContaining({ accountId: "lira-invest" }));
    expect(() => parseWealthBackup(backup)).not.toThrow();
  });

  it("keeps a repository-created temporal sequence valid for backup round-trip", async () => {
    await initializeWithDemoArchive();
    await createAccount({
      id: "temporal",
      name: "Temporal",
      category: "liquidity",
      currency: "EUR",
      balance: 10,
      includedInWealth: true,
    }, "2026-08-26T09:00:00.000Z");
    await updateAccount("temporal", { balance: 20 }, "2026-08-26T10:00:00.000Z");
    await setCashDenominations(await wealthDb.cashDenominations.toArray(), "2026-08-26T11:00:00.000Z");
    await saveBalanceSnapshot([], "2026-08-26T12:00:00.000Z");
    await archiveAccount("temporal", "2026-08-26T13:00:00.000Z");

    const backup = await createBackup("2026-08-26T14:00:00.000Z");
    expect(() => parseWealthBackup(backup)).not.toThrow();
  });

  it("rolls back mutations that would overflow the current active-account aggregate", async () => {
    await initializeWithDemoArchive();
    const largeBalance = MAX_CURRENCY_AMOUNT / 2 + 1;
    await createAccount({
      id: "large-one",
      name: "Large one",
      category: "investments",
      currency: "EUR",
      balance: largeBalance,
      includedInWealth: true,
    }, "2026-08-26T09:00:00.000Z");

    await expect(createAccount({
      id: "large-two",
      name: "Large two",
      category: "investments",
      currency: "EUR",
      balance: largeBalance,
      includedInWealth: true,
    }, "2026-08-26T10:00:00.000Z")).rejects.toThrow("Total Wealth must remain");
    await expect(updateAccount("banca-aurora", { balance: largeBalance }, "2026-08-26T10:00:00.000Z"))
      .rejects.toThrow("Total Wealth must remain");

    const cashBefore = await wealthDb.accounts.get("cash");
    const denominationsBefore = await wealthDb.cashDenominations.toArray();
    const overflowingCash = denominationsBefore.map((item) => ({
      ...item,
      quantity: item.denomination === 500 ? Math.floor(MAX_CURRENCY_AMOUNT / 500) : 0,
    }));
    await expect(setCashDenominations(overflowingCash, "2026-08-26T10:00:00.000Z"))
      .rejects.toThrow("Total Wealth must remain");

    expect(await wealthDb.accounts.get("large-two")).toBeUndefined();
    expect((await wealthDb.accounts.get("banca-aurora"))?.balance).toBe(4_820.35);
    expect(await wealthDb.accounts.get("cash")).toEqual(cashBefore);
    expect(await wealthDb.cashDenominations.toArray()).toEqual(denominationsBefore);
  });

  it("ignores undefined account patch values instead of persisting invalid fields", async () => {
    await initializeWithDemoArchive();
    const before = await wealthDb.accounts.get("banca-aurora");

    await updateAccount(
      "banca-aurora",
      { name: undefined, includedInWealth: undefined },
      "2026-08-25T00:00:00.000Z",
    );

    expect(await wealthDb.accounts.get("banca-aurora")).toEqual(before);
  });

  it("keeps paychecks distinct even when they are in the same month", async () => {
    await initializeWithDemoArchive();
    const first = await createPaycheck({ id: "aug-01", paymentDate: "2026-08-01", amount: 1000 });
    const second = await createPaycheck({ id: "aug-15", paymentDate: "2026-08-15", amount: 300 });
    await updatePaycheck(first.id, { amount: 1100 });

    expect((await getPaychecks()).filter((paycheck) => paycheck.paymentDate.startsWith("2026-08")))
      .toEqual(expect.arrayContaining([
        { ...first, amount: 1100 },
        second,
      ]));
  });

  it("rejects impossible paycheck calendar dates before persistence", async () => {
    await initializeWithDemoArchive();

    await expect(createPaycheck({ id: "invalid", paymentDate: "2026-99-99", amount: 100 }))
      .rejects.toThrow("Paycheck requires an id, calendar date, and finite non-negative amount");

    expect(await wealthDb.paychecks.get("invalid")).toBeUndefined();
  });

  it("serializes concurrent paycheck patches without dropping independent changes", async () => {
    await initializeWithDemoArchive();

    await Promise.all([
      updatePaycheck("jan-27", { amount: 2000 }),
      updatePaycheck("jan-27", { label: "Salary" }),
    ]);

    expect(await wealthDb.paychecks.get("jan-27")).toMatchObject({ amount: 2000, label: "Salary" });
  });

  it("deletes only the selected paycheck record", async () => {
    await initializeWithDemoArchive();
    await deletePaycheck("jun-26");

    expect(await wealthDb.paychecks.get("jun-26")).toBeUndefined();
    expect(await wealthDb.paychecks.get("jun-30")).toMatchObject({ id: "jun-30", amount: 320 });
  });

  it("creates and updates wealth goals", async () => {
    await initializeWithDemoArchive();
    const goal = await createGoal({ id: "emergency-fund", name: "Emergency fund", targetAmount: 5000 });
    await updateGoal(goal.id, { targetAmount: 6000 });

    expect(await getGoals()).toContainEqual({ id: "emergency-fund", name: "Emergency fund", targetAmount: 6000 });
  });

  it("does not infer access or volatility when an account is created without profile metadata", async () => {
    await initializeWithDemoArchive();

    const created = await createAccount({
      id: "instant-savings",
      name: "Instant savings",
      category: "liquidity",
      currency: "EUR",
      balance: 200,
      includedInWealth: true,
    }, "2026-08-26T09:00:00.000Z");

    expect(created).not.toHaveProperty("access");
    expect(created).not.toHaveProperty("volatility");
  });

  it("preserves access and volatility when category changes", async () => {
    await initializeWithDemoArchive();
    await createAccount({
      id: "profiled",
      name: "Profiled",
      category: "liquidity",
      currency: "EUR",
      balance: 200,
      includedInWealth: true,
      access: "days",
      volatility: "moderate",
    }, "2026-08-26T09:00:00.000Z");

    const updated = await updateAccount(
      "profiled",
      { category: "investments" },
      "2026-08-26T10:00:00.000Z",
    );

    expect(updated).toMatchObject({
      category: "investments",
      access: "days",
      volatility: "moderate",
    });
  });

  it("preserves balance when access and volatility change", async () => {
    await initializeWithDemoArchive();
    const before = await wealthDb.accounts.get("banca-aurora");

    const updated = await updateAccount(
      "banca-aurora",
      { access: "immediate", volatility: "stable" },
      "2026-08-26T09:00:00.000Z",
    );

    expect(updated).toMatchObject({
      balance: before?.balance,
      access: "immediate",
      volatility: "stable",
    });
  });

  it("removes only the optional profile property targeted by an explicit null clear", async () => {
    await initializeWithDemoArchive();
    await updateAccount(
      "banca-aurora",
      { access: "immediate", volatility: "stable" },
      "2026-08-26T09:00:00.000Z",
    );

    const cleared = await updateAccount(
      "banca-aurora",
      { access: null },
      "2026-08-26T10:00:00.000Z",
    );

    expect(cleared.balance).toBe(4_820.35);
    expect(cleared).not.toHaveProperty("access");
    expect(cleared.volatility).toBe("stable");
    expect(await wealthDb.accounts.get("banca-aurora")).toEqual(cleared);

    const clearedVolatility = await updateAccount(
      "banca-aurora",
      { access: "immediate", volatility: null },
      "2026-08-26T11:00:00.000Z",
    );
    expect(clearedVolatility.access).toBe("immediate");
    expect(clearedVolatility).not.toHaveProperty("volatility");
  });

  it("rejects unsupported account profile metadata at persistence boundaries", async () => {
    await initializeWithDemoArchive();
    const before = await wealthDb.accounts.get("banca-aurora");

    await expect(createAccount({
      id: "invalid-profile",
      name: "Invalid profile",
      category: "liquidity",
      currency: "EUR",
      balance: 200,
      includedInWealth: true,
      access: "weekly",
    } as never, "2026-08-26T09:00:00.000Z")).rejects.toThrow("Account access is invalid");
    await expect(createAccount({
      id: "invalid-profile",
      name: "Invalid profile",
      category: "liquidity",
      currency: "EUR",
      balance: 200,
      includedInWealth: true,
      volatility: "extreme",
    } as never, "2026-08-26T09:00:00.000Z")).rejects.toThrow("Account volatility is invalid");
    expect(await wealthDb.accounts.get("invalid-profile")).toBeUndefined();
    await expect(updateAccount(
      "banca-aurora",
      { access: "weekly" } as never,
      "2026-08-26T09:00:00.000Z",
    )).rejects.toThrow("Account access is invalid");
    await expect(updateAccount(
      "banca-aurora",
      { volatility: "extreme" } as never,
      "2026-08-26T09:00:00.000Z",
    )).rejects.toThrow("Account volatility is invalid");
    expect(await wealthDb.accounts.get("banca-aurora")).toEqual(before);
  });

  it("persists goal type and target date while rejecting invalid calendar dates", async () => {
    await initializeWithDemoArchive();
    const goal = await createGoal({
      id: "liquidity-goal",
      name: "Liquidity reserve",
      type: "liquidity",
      targetAmount: 10000,
      targetDate: "2027-03-31",
    });
    await updateGoal(goal.id, { targetDate: "2027-06-30" });

    expect(await wealthDb.goals.get(goal.id)).toMatchObject({
      type: "liquidity",
      targetDate: "2027-06-30",
    });
    await expect(createGoal({
      id: "invalid-goal",
      name: "Invalid",
      targetAmount: 1000,
      targetDate: "2027-02-30",
    })).rejects.toThrow(/goal/i);
  });

  it("serializes concurrent goal patches without dropping independent changes", async () => {
    await initializeWithDemoArchive();

    await Promise.all([
      updateGoal("wealth-goal", { targetAmount: 20000 }),
      updateGoal("wealth-goal", { name: "Next threshold" }),
    ]);

    expect(await wealthDb.goals.get("wealth-goal")).toMatchObject({
      name: "Next threshold",
      targetAmount: 20000,
    });
  });

  it("deletes only the selected goal", async () => {
    await initializeWithDemoArchive();
    await deleteGoal("wealth-goal");

    expect(await getGoals()).toEqual([]);
  });
});
