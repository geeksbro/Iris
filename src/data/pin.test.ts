import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it } from "vitest";

import { createBackup, replaceDatabaseFromBackup } from "./backup";
import { wealthDb } from "./db";
import { changePin, getPinCredentials, getPinLength, getPinSetAt, resetPinForTests, setupPin, verifyPin } from "./pin";
import { resetDatabaseForTests } from "./repository";
import { initializeWithDemoArchive } from "@/test/demo-archive";

describe("pin access", () => {
  beforeEach(async () => {
    await resetDatabaseForTests();
    await initializeWithDemoArchive();
    await resetPinForTests();
  });

  it("verifies the configured PIN and rejects any other PIN", async () => {
    await setupPin("2026");

    expect(await verifyPin("2026")).toBe(true);
    expect(await verifyPin("2027")).toBe(false);
    expect(await verifyPin("")).toBe(false);
  });

  it("rejects PINs outside the 4-8 digit format", async () => {
    await expect(setupPin("12")).rejects.toThrow("4 to 8 digits");
    await expect(setupPin("123456789")).rejects.toThrow("4 to 8 digits");
    await expect(setupPin("abcd")).rejects.toThrow("4 to 8 digits");
    expect(await getPinCredentials()).toBeNull();
  });

  it("stores a salted hash rather than the PIN itself", async () => {
    await setupPin("2026");

    const credentials = await getPinCredentials();
    expect(credentials).not.toBeNull();
    expect(credentials?.hash).not.toContain("2026");
    expect(credentials?.salt).not.toBe(credentials?.hash);
    expect(credentials?.iterations).toBeGreaterThan(0);
  });

  it("refuses to replace an existing PIN", async () => {
    await setupPin("2026");

    await expect(setupPin("9999")).rejects.toThrow("already configured");
    expect(await verifyPin("2026")).toBe(true);
    expect(await verifyPin("9999")).toBe(false);
  });

  it("keeps the PIN when a wealth backup is imported", async () => {
    await setupPin("2026");

    await replaceDatabaseFromBackup(await createBackup());

    expect(await verifyPin("2026")).toBe(true);
  });

  it("changes the PIN only for someone who knows the current one", async () => {
    await setupPin("2026");

    // A wrong current PIN changes nothing.
    expect(await changePin("1111", "4321")).toBe(false);
    expect(await verifyPin("2026")).toBe(true);
    expect(await verifyPin("4321")).toBe(false);

    const before = await getPinCredentials();
    expect(await changePin("2026", "4321")).toBe(true);
    expect(await verifyPin("4321")).toBe(true);
    expect(await verifyPin("2026")).toBe(false);
    // A fresh salt and hash, never the PIN itself.
    const after = await getPinCredentials();
    expect(after?.salt).not.toBe(before?.salt);
    expect(after?.hash).not.toContain("4321");
  });

  it("refuses a new PIN outside the format, keeping the current one", async () => {
    await setupPin("2026");

    await expect(changePin("2026", "12")).rejects.toThrow("4 to 8 digits");
    expect(await verifyPin("2026")).toBe(true);
  });

  it("tells when the PIN in force was set, and nothing else about it", async () => {
    expect(await getPinSetAt()).toBeNull();
    await setupPin("2026");

    // A date string: the hash and the salt never leave the data layer this way.
    expect(await getPinSetAt()).toBe((await getPinCredentials())?.createdAt);
  });

  it("keeps a changed PIN when a wealth backup is imported", async () => {
    await setupPin("2026");
    await changePin("2026", "4321");

    await replaceDatabaseFromBackup(await createBackup());

    expect(await verifyPin("4321")).toBe(true);
  });

  it("keeps the PIN's length, so the lock screen can unlock on the last digit", async () => {
    expect(await getPinLength()).toBeNull();
    await setupPin("765271");
    expect(await getPinLength()).toBe(6);
    await changePin("765271", "4321");
    expect(await getPinLength()).toBe(4);
  });

  it("learns the length of a PIN set before it was kept, from a correct entry only", async () => {
    await setupPin("20261");
    // As a PIN created before 10 Oct 2026 was stored: no length.
    const { length, ...older } = (await getPinCredentials())!;
    expect(length).toBe(5);
    await wealthDb.metadata.put({ key: "pin-credentials", value: older });
    expect(await getPinLength()).toBeNull();

    expect(await verifyPin("99999")).toBe(false);
    expect(await getPinLength()).toBeNull();

    expect(await verifyPin("20261")).toBe(true);
    expect(await getPinLength()).toBe(5);
  });

  it("clears the PIN when reset for tests", async () => {
    await setupPin("2026");
    await resetPinForTests();

    expect(await getPinCredentials()).toBeNull();
    expect(await verifyPin("2026")).toBe(false);
  });
});
