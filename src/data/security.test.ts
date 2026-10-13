import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it } from "vitest";

import { createBackup, replaceDatabaseFromBackup } from "./backup";
import { wealthDb } from "./db";
import { resetDatabaseForTests } from "./repository";
import { defaultIdleTimeoutMs, getIdleTimeoutMs, idleTimeoutChoices, setIdleTimeoutMs } from "./security";
import { initializeWithDemoArchive } from "@/test/demo-archive";

describe("security policy", () => {
  beforeEach(async () => {
    await resetDatabaseForTests();
    await initializeWithDemoArchive();
  });

  it("keeps the original two minutes on a device that never chose", async () => {
    expect(defaultIdleTimeoutMs).toBe(120_000);
    expect(await getIdleTimeoutMs()).toBe(120_000);
  });

  it("offers only bounded durations: no 'never'", () => {
    expect(idleTimeoutChoices).toEqual([30_000, 60_000, 120_000, 300_000, 900_000]);
    expect(Math.max(...idleTimeoutChoices)).toBeLessThanOrEqual(15 * 60_000);
  });

  it("persists a chosen duration and refuses any other", async () => {
    await setIdleTimeoutMs(300_000);
    expect(await getIdleTimeoutMs()).toBe(300_000);

    await expect(setIdleTimeoutMs(0)).rejects.toThrow("offered durations");
    await expect(setIdleTimeoutMs(Number.POSITIVE_INFINITY)).rejects.toThrow("offered durations");
    await expect(setIdleTimeoutMs(45_000)).rejects.toThrow("offered durations");
    expect(await getIdleTimeoutMs()).toBe(300_000);
  });

  it("reads a damaged stored policy as the default rather than trusting it", async () => {
    await wealthDb.metadata.put({ key: "security-policy", value: { idleTimeoutMs: 1 } });
    expect(await getIdleTimeoutMs()).toBe(120_000);
    await wealthDb.metadata.put({ key: "security-policy", value: true });
    expect(await getIdleTimeoutMs()).toBe(120_000);
  });

  it("is device state: a backup neither carries it nor replaces it", async () => {
    await setIdleTimeoutMs(60_000);
    const backup = await createBackup();
    expect(backup).not.toContain("idleTimeoutMs");

    await replaceDatabaseFromBackup(backup);
    expect(await getIdleTimeoutMs()).toBe(60_000);
  });
});
