import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createBackup, recordBackupExport, replaceDatabaseFromBackup } from "./backup";
import { backupReminderFor, fingerprintOf, getBackupHealth, type BackupHealth } from "./backup-health";
import { demoCreatedAt } from "./demo";
import { createAccount, initializeDatabase, loadDemoData, resetDatabaseForTests, saveBalanceSnapshot, wealthDb } from "./repository";
import { getPersistRequest, requestPersistentStorage } from "./storage-persistence";

const now = new Date("2026-10-20T10:00:00.000Z");
// Moments after the archive was initialised (its Cash account is created "now").
const later = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();
const health = (changes: Partial<BackupHealth>): BackupHealth => ({ hasOwnData: true, lastExportAt: null, upToDate: false, changesSinceExport: 0, ...changes });

async function addOwnAccount(id = "mine") {
  await createAccount({ id, name: "Mine", category: "liquidity", currency: "EUR", balance: 100, includedInWealth: true }, later(1));
}

describe("backup reminders", () => {
  it("asks for a first backup only once there is something of the owner's, and never when the last one still matches", () => {
    expect(backupReminderFor(health({ hasOwnData: false }), now, null)).toBeNull();
    expect(backupReminderFor(health({}), now, null)).toEqual({ reason: "first" });
    expect(backupReminderFor(health({ upToDate: true }), now, null)).toBeNull();
  });

  it("asks again after two weeks with changes, or after several changes, and stays quiet while put off", () => {
    const exported = "2026-10-01T10:00:00.000Z";
    expect(backupReminderFor(health({ lastExportAt: "2026-10-15T10:00:00.000Z", changesSinceExport: 1 }), now, null)).toBeNull();
    expect(backupReminderFor(health({ lastExportAt: exported, changesSinceExport: 1 }), now, null)).toEqual({ reason: "time", days: 19 });
    expect(backupReminderFor(health({ lastExportAt: "2026-10-15T10:00:00.000Z", changesSinceExport: 3 }), now, null)).toEqual({ reason: "changes", changes: 3 });
    expect(backupReminderFor(health({}), now, "2026-10-22T10:00:00.000Z")).toBeNull();
    expect(backupReminderFor(health({}), now, "2026-10-19T10:00:00.000Z")).toEqual({ reason: "first" });
  });

  it("fingerprints equal content equally and any change differently", () => {
    const tables = { accounts: [], cashDenominations: [{ denomination: 5, quantity: 1 }], snapshots: [], paychecks: [], goals: [] };
    expect(fingerprintOf(tables)).toBe(fingerprintOf(structuredClone(tables)));
    expect(fingerprintOf(tables)).not.toBe(fingerprintOf({ ...tables, cashDenominations: [{ denomination: 5, quantity: 2 }] }));
  });
});

describe("backup health of the archive", () => {
  beforeEach(async () => {
    await resetDatabaseForTests();
    await initializeDatabase();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await resetDatabaseForTests();
  });

  it("sees nothing of the owner's in a new archive or in the example archive", async () => {
    expect(await getBackupHealth()).toMatchObject({ hasOwnData: false });
    await loadDemoData(demoCreatedAt);
    expect(await getBackupHealth()).toMatchObject({ hasOwnData: false });
  });

  it("knows when the last export still matches, and counts the changes made since", async () => {
    await addOwnAccount();
    expect(await getBackupHealth()).toMatchObject({ hasOwnData: true, lastExportAt: null, upToDate: false, changesSinceExport: 1 });

    const exportedAt = later(2);
    await createBackup(exportedAt);
    await recordBackupExport(exportedAt);
    expect(await getBackupHealth()).toMatchObject({ upToDate: true, changesSinceExport: 0, lastExportAt: exportedAt });

    await saveBalanceSnapshot([{ accountId: "mine", balance: 150 }], later(3));
    expect(await getBackupHealth()).toMatchObject({ upToDate: false, changesSinceExport: 1 });
  });

  it("restores a backup in a separate, empty archive exactly as it was exported, and counts it as backed up", async () => {
    await addOwnAccount();
    await saveBalanceSnapshot([{ accountId: "mine", balance: 150 }], later(2));
    const backup = await createBackup(later(3));
    const before = JSON.parse(backup);

    // A different device: nothing in it.
    await resetDatabaseForTests();
    await initializeDatabase();
    await replaceDatabaseFromBackup(backup);

    expect(JSON.parse(await createBackup(before.exportedAt))).toEqual(before);
    expect(await getBackupHealth()).toMatchObject({ upToDate: true, lastExportAt: null });
  });

  it("records how the browser answered the request for persistent storage", async () => {
    vi.stubGlobal("navigator", { storage: { persisted: async () => false, persist: async () => false } });
    expect(await requestPersistentStorage("2026-10-12T09:00:00.000Z")).toBe("denied");
    expect(await getPersistRequest()).toEqual({ outcome: "denied", at: "2026-10-12T09:00:00.000Z" });

    vi.stubGlobal("navigator", { storage: { persisted: async () => false, persist: async () => true } });
    expect(await requestPersistentStorage()).toBe("granted");

    vi.stubGlobal("navigator", {});
    expect(await requestPersistentStorage()).toBe("unsupported");
    expect(await wealthDb.metadata.get("storage-persist-request")).toBeDefined();
  });
});
