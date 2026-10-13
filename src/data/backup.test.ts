import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createBackup, replaceDatabaseFromBackup } from "./backup";
import { resetDatabaseForTests, wealthDb } from "./repository";
import { initializeWithDemoArchive } from "@/test/demo-archive";

describe("wealth backup", () => {
  beforeEach(async () => {
    await resetDatabaseForTests();
    await initializeWithDemoArchive();
  });

  afterEach(async () => {
    await resetDatabaseForTests();
  });

  it("replaces every persisted domain from a validated backup", async () => {
    const replacement = JSON.parse(await createBackup("2026-08-26T09:00:00.000Z"));
    replacement.accounts = [
      {
        id: "cash",
        name: "Cash",
        category: "liquidity",
        currency: "EUR",
        balance: 20,
        includedInWealth: true,
        createdAt: "2026-08-26T08:00:00.000Z",
        lastUpdated: "2026-08-26T09:00:00.000Z",
      },
      {
        id: "archived-account",
        name: "Archived account",
        category: "liquidity",
        currency: "EUR",
        balance: 20,
        includedInWealth: false,
        createdAt: "2026-08-26T08:00:00.000Z",
        lastUpdated: "2026-08-26T09:00:00.000Z",
        archivedAt: "2026-08-26T09:00:00.000Z",
      },
    ];
    replacement.cashDenominations = [
      { denomination: 5, quantity: 0 },
      { denomination: 10, quantity: 0 },
      { denomination: 20, quantity: 1 },
      { denomination: 50, quantity: 0 },
      { denomination: 100, quantity: 0 },
      { denomination: 200, quantity: 0 },
      { denomination: 500, quantity: 0 },
    ];
    replacement.snapshots = [{
      id: "replacement-snapshot",
      createdAt: "2026-08-26T09:00:00.000Z",
      totalWealth: 20,
      accountBalances: [{ accountId: "cash", balance: 20, includedInWealth: true }],
    }];
    replacement.paychecks = [{ id: "replacement-paycheck", paymentDate: "2026-08-26", amount: 100 }];
    replacement.goals = [{ id: "replacement-goal", name: "Replacement", targetAmount: 200 }];

    await replaceDatabaseFromBackup(JSON.stringify(replacement));

    expect(await wealthDb.accounts.toArray()).toEqual(expect.arrayContaining(replacement.accounts));
    expect(await wealthDb.accounts.count()).toBe(replacement.accounts.length);
    expect(await wealthDb.snapshots.toArray()).toEqual(replacement.snapshots);
    expect(await wealthDb.paychecks.toArray()).toEqual(replacement.paychecks);
    expect(await wealthDb.goals.toArray()).toEqual(replacement.goals);
  });

  it("preserves existing records when backup validation rejects the import", async () => {
    const before = await createBackup("2026-08-26T09:00:00.000Z");
    const invalid = JSON.parse(before);
    invalid.accounts[0].balance = -1;

    await expect(replaceDatabaseFromBackup(JSON.stringify(invalid))).rejects.toThrow();

    expect(await createBackup("2026-08-26T09:00:00.000Z")).toBe(before);
  });

  it("rejects an active Cash account that disagrees with the Cash Counter without changing data", async () => {
    const before = await createBackup("2026-08-26T09:00:00.000Z");
    const incoherent = JSON.parse(before);
    incoherent.accounts.find((account: { id: string }) => account.id === "cash").balance = 999;

    await expect(replaceDatabaseFromBackup(JSON.stringify(incoherent)))
      .rejects.toThrow("Active Cash account balance must equal the Cash Counter total");

    expect(await createBackup("2026-08-26T09:00:00.000Z")).toBe(before);
  });

  it("rejects missing or archived reserved Cash without changing data", async () => {
    const before = await createBackup("2026-08-26T09:00:00.000Z");
    const missing = JSON.parse(before);
    missing.accounts = missing.accounts.filter((account: { id: string }) => account.id !== "cash");
    const archived = JSON.parse(before);
    archived.accounts.find((account: { id: string }) => account.id === "cash").archivedAt = "2026-08-26T10:00:00.000Z";

    await expect(replaceDatabaseFromBackup(JSON.stringify(missing)))
      .rejects.toThrow("exactly one active reserved Cash account");
    await expect(replaceDatabaseFromBackup(JSON.stringify(archived)))
      .rejects.toThrow("exactly one active reserved Cash account");
    expect(await createBackup("2026-08-26T09:00:00.000Z")).toBe(before);
  });

  it("rejects corrupted or incomplete historical snapshots without changing data", async () => {
    const before = await createBackup("2026-08-26T09:00:00.000Z");
    const corruptTotal = JSON.parse(before);
    corruptTotal.snapshots[0].totalWealth += 0.01;
    const incomplete = JSON.parse(before);
    incomplete.snapshots[0].accountBalances.pop();

    await expect(replaceDatabaseFromBackup(JSON.stringify(corruptTotal)))
      .rejects.toThrow("totalWealth must equal");
    await expect(replaceDatabaseFromBackup(JSON.stringify(incomplete)))
      .rejects.toThrow("complete set of accounts");
    expect(await createBackup("2026-08-26T09:00:00.000Z")).toBe(before);
  });

  it("round-trips a version 2 backup with self-contained historical inclusion state", async () => {
    await initializeWithDemoArchive();
    const serialized = await createBackup("2026-08-26T09:00:00.000Z");
    const parsed = JSON.parse(serialized);

    expect(parsed.version).toBe(2);
    expect(parsed.snapshots[0].accountBalances.every(
      (balance: { includedInWealth?: boolean }) => typeof balance.includedInWealth === "boolean",
    )).toBe(true);

    await replaceDatabaseFromBackup(serialized);
    expect(JSON.parse(await createBackup("2026-08-26T09:00:00.000Z"))).toEqual(JSON.parse(serialized));
  });

  it("imports legacy version 2 accounts without profile metadata", async () => {
    const serialized = await createBackup("2026-08-26T09:00:00.000Z");

    await replaceDatabaseFromBackup(serialized);

    const imported = await wealthDb.accounts.get("banca-aurora");
    expect(imported).not.toHaveProperty("access");
    expect(imported).not.toHaveProperty("volatility");
  });

  it("round-trips optional account profile metadata through version 2 export and import", async () => {
    await wealthDb.accounts.update("banca-aurora", {
      access: "days",
      volatility: "moderate",
    });

    const serialized = await createBackup("2026-08-26T09:00:00.000Z");
    await resetDatabaseForTests();
    await replaceDatabaseFromBackup(serialized);

    expect(await wealthDb.accounts.get("banca-aurora")).toMatchObject({
      access: "days",
      volatility: "moderate",
    });
    expect(JSON.parse(await createBackup("2026-08-26T09:00:00.000Z")))
      .toEqual(JSON.parse(serialized));
  });

  it("rejects a date-only export timestamp that the importer would reject", async () => {
    await expect(createBackup("2026-08-26"))
      .rejects.toThrow("Export timestamp must be a valid ISO date-time with offset");
  });

  it("refuses to serialize invalid version 2 state read directly from the database", async () => {
    await wealthDb.accounts.delete("cash");

    await expect(createBackup("2026-08-26T09:00:00.000Z"))
      .rejects.toThrow("exactly one active reserved Cash account");
  });
});
