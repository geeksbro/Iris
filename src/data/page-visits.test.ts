import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it } from "vitest";

import { createBackup, replaceDatabaseFromBackup } from "./backup";
import { wealthDb } from "./db";
import { getPageVisits, isTrackedPage, recordPageVisit, resetPageVisits, trackedPages } from "./page-visits";
import { resetDatabaseForTests } from "./repository";
import { initializeWithDemoArchive } from "@/test/demo-archive";

const none = { overview: 0, accounts: 0, "cash-flow": 0, progress: 0, goals: 0, scenario: 0 };

describe("page visits", () => {
  beforeEach(async () => {
    await resetDatabaseForTests();
    await initializeWithDemoArchive();
  });

  it("tracks exactly the six main pages, under the dashboard's view ids", () => {
    expect(trackedPages).toEqual(["overview", "accounts", "cash-flow", "progress", "goals", "scenario"]);
    expect(isTrackedPage("settings")).toBe(false);
    expect(isTrackedPage("investments")).toBe(false);
  });

  it("reads 0 for every page on a device that never counted", async () => {
    expect(await getPageVisits()).toEqual(none);
  });

  it("counts one visit to the page entered and leaves the others alone", async () => {
    await recordPageVisit("overview");
    await recordPageVisit("accounts");
    await recordPageVisit("overview");
    expect(await getPageVisits()).toEqual({ ...none, overview: 2, accounts: 1 });
  });

  it("loses no visit when entries land at the same time (one transaction each)", async () => {
    await Promise.all(Array.from({ length: 5 }, () => recordPageVisit("goals")));
    expect((await getPageVisits()).goals).toBe(5);
  });

  it("keeps the counts when the storage is opened again", async () => {
    await recordPageVisit("overview");
    await recordPageVisit("scenario");

    wealthDb.close();
    await wealthDb.open();

    expect(await getPageVisits()).toEqual({ ...none, overview: 1, scenario: 1 });
  });

  it("reads a damaged record as 0 rather than trusting it, and counts on from there", async () => {
    await wealthDb.metadata.put({ key: "page-visits", value: { ...none, overview: -3, accounts: 1.5, goals: 4 } });
    expect(await getPageVisits()).toEqual({ ...none, goals: 4 });

    await wealthDb.metadata.put({ key: "page-visits", value: true });
    await recordPageVisit("accounts");
    expect(await getPageVisits()).toEqual({ ...none, accounts: 1 });
  });

  // The reset is the one destructive thing in the diagnostics panel: it must
  // be able to touch the counters and nothing whatsoever beside them.
  it("clears the counters and leaves every financial record where it was", async () => {
    const before = {
      accounts: await wealthDb.accounts.count(),
      snapshots: await wealthDb.snapshots.count(),
      paychecks: await wealthDb.paychecks.count(),
      goals: await wealthDb.goals.count(),
      denominations: await wealthDb.cashDenominations.count(),
    };
    const balances = (await wealthDb.accounts.toArray()).map((account) => [account.id, account.balance]);

    await recordPageVisit("overview");
    await recordPageVisit("goals");
    expect(await getPageVisits()).toEqual({ ...none, overview: 1, goals: 1 });

    await resetPageVisits();

    expect(await getPageVisits()).toEqual(none);
    expect({
      accounts: await wealthDb.accounts.count(),
      snapshots: await wealthDb.snapshots.count(),
      paychecks: await wealthDb.paychecks.count(),
      goals: await wealthDb.goals.count(),
      denominations: await wealthDb.cashDenominations.count(),
    }).toEqual(before);
    expect((await wealthDb.accounts.toArray()).map((account) => [account.id, account.balance])).toEqual(balances);

    // And it counts on from zero, rather than refusing to record again.
    await recordPageVisit("overview");
    expect(await getPageVisits()).toEqual({ ...none, overview: 1 });
  });

  it("is device state: a backup neither carries it nor replaces it", async () => {
    await recordPageVisit("progress");
    const backup = await createBackup();
    expect(backup).not.toContain("page-visits");

    await replaceDatabaseFromBackup(backup);
    expect((await getPageVisits()).progress).toBe(1);
  });
});
