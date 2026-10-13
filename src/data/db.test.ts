import "fake-indexeddb/auto";

import Dexie from "dexie";
import { afterEach, describe, expect, it } from "vitest";

import { wealthDb } from "./db";

const stores = {
  accounts: "id, category, includedInWealth, archivedAt",
  cashDenominations: "denomination",
  snapshots: "id, createdAt",
  paychecks: "id, paymentDate",
  goals: "id",
  metadata: "key",
};

const cashDenominations = [
  { denomination: 5, quantity: 0 },
  { denomination: 10, quantity: 1 },
  { denomination: 20, quantity: 2 },
  { denomination: 50, quantity: 2 },
  { denomination: 100, quantity: 0 },
  { denomination: 200, quantity: 0 },
  { denomination: 500, quantity: 0 },
];

async function seedLegacyDatabase(
  accounts: Record<string, unknown>[],
  snapshots: Record<string, unknown>[],
): Promise<void> {
  wealthDb.close();
  await Dexie.delete("personal-wealth-dashboard");
  const legacy = new Dexie("personal-wealth-dashboard");
  legacy.version(1).stores(stores);
  await legacy.open();
  await legacy.table("accounts").bulkAdd(accounts);
  await legacy.table("cashDenominations").bulkAdd(cashDenominations);
  await legacy.table("snapshots").bulkAdd(snapshots);
  await legacy.table("paychecks").add({
    id: "legacy-paycheck",
    paymentDate: "2026-08-25",
    amount: 100,
  });
  await legacy.table("goals").add({ id: "legacy-goal", name: "Goal", targetAmount: 1_000 });
  await legacy.table("metadata").add({ key: "initialized", value: true });
  legacy.close();
}

const cashAccount = {
  id: "cash",
  name: "Cash",
  category: "liquidity",
  currency: "EUR",
  balance: 150,
  includedInWealth: true,
  lastUpdated: "2026-08-25T12:00:00.000Z",
};

const cashSnapshot = {
  id: "legacy-snapshot",
  createdAt: "2026-08-25T12:00:00.000Z",
  totalWealth: 150,
  accountBalances: [{ accountId: "cash", balance: 150 }],
};

describe("WealthDatabase migration", () => {
  afterEach(async () => {
    wealthDb.close();
    await Dexie.delete("personal-wealth-dashboard");
  });

  it("upgrades coherent version 1 state across every persistent domain", async () => {
    await seedLegacyDatabase([cashAccount], [cashSnapshot]);

    await wealthDb.open();

    expect(await wealthDb.accounts.get("cash")).toMatchObject({
      createdAt: "2026-08-25T12:00:00.000Z",
      balance: 150,
    });
    expect(await wealthDb.snapshots.get("legacy-snapshot")).toEqual({
      id: "legacy-snapshot",
      createdAt: "2026-08-25T12:00:00.000Z",
      totalWealth: 150,
      accountBalances: [{ accountId: "cash", balance: 150, includedInWealth: true }],
    });
    expect(await wealthDb.paychecks.get("legacy-paycheck")).toMatchObject({ amount: 100 });
    expect(await wealthDb.goals.get("legacy-goal")).toMatchObject({ targetAmount: 1_000 });
  });

  it.each([
    ["missing", []],
    ["archived", [{ ...cashAccount, archivedAt: "2026-08-25T13:00:00.000Z" }]],
  ])("aborts and preserves version 1 records when reserved Cash is %s", async (_case, accounts) => {
    const snapshots = accounts.length === 0
      ? [{ ...cashSnapshot, totalWealth: 0, accountBalances: [] }]
      : [cashSnapshot];
    await seedLegacyDatabase(accounts, snapshots);

    await expect(wealthDb.open()).rejects.toThrow("exactly one active reserved Cash account");
    wealthDb.close();

    const inspector = new Dexie("personal-wealth-dashboard");
    inspector.version(1).stores(stores);
    await inspector.open();
    expect(inspector.verno).toBe(1);
    expect(await inspector.table("accounts").toArray()).toEqual(accounts);
    expect(await inspector.table("snapshots").toArray()).toEqual(snapshots);
    inspector.close();
  });

  it("aborts an incomplete legacy snapshot instead of persisting invalid version 2 history", async () => {
    const laterUncapturedAccount = {
      id: "bank",
      name: "Bank",
      category: "liquidity",
      currency: "EUR",
      balance: 10,
      includedInWealth: false,
      lastUpdated: "2026-08-25T12:00:00.000Z",
    };
    await seedLegacyDatabase([cashAccount, laterUncapturedAccount], [cashSnapshot]);

    await expect(wealthDb.open()).rejects.toThrow("complete set of accounts");
    wealthDb.close();

    const inspector = new Dexie("personal-wealth-dashboard");
    inspector.version(1).stores(stores);
    await inspector.open();
    expect(await inspector.table("accounts").get("bank")).not.toHaveProperty("createdAt");
    expect(await inspector.table("snapshots").get("legacy-snapshot"))
      .toEqual(cashSnapshot);
    inspector.close();
  });

  it.each([
    ["paychecks", "legacy-paycheck", { amount: -1 }],
    ["goals", "legacy-goal", { targetAmount: 0 }],
  ])("validates legacy %s records before committing version 2", async (tableName, key, invalidChanges) => {
    await seedLegacyDatabase([cashAccount], [cashSnapshot]);
    const corruptor = new Dexie("personal-wealth-dashboard");
    corruptor.version(1).stores(stores);
    await corruptor.open();
    await corruptor.table(tableName).update(key, invalidChanges);
    corruptor.close();

    await expect(wealthDb.open()).rejects.toThrow();
    wealthDb.close();

    const inspector = new Dexie("personal-wealth-dashboard");
    inspector.version(1).stores(stores);
    await inspector.open();
    expect(inspector.verno).toBe(1);
    expect(await inspector.table(tableName).get(key)).toMatchObject(invalidChanges);
    inspector.close();
  });
});
