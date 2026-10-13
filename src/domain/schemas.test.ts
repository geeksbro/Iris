import { describe, expect, it } from "vitest";

import { parseWealthBackup, wealthBackupSchema } from "./schemas";
import { MAX_CURRENCY_AMOUNT } from "./calculations";

const validBackup = {
  version: 2,
  exportedAt: "2026-08-25T12:00:00.000Z",
  accounts: [{
    id: "cash",
    name: "Cash",
    category: "liquidity",
    currency: "EUR",
    balance: 150,
    includedInWealth: true,
    createdAt: "2026-08-25T10:00:00.000Z",
    lastUpdated: "2026-08-25T12:00:00.000Z",
  }],
  cashDenominations: [
    { denomination: 5, quantity: 0 },
    { denomination: 10, quantity: 0 },
    { denomination: 20, quantity: 0 },
    { denomination: 50, quantity: 3 },
    { denomination: 100, quantity: 0 },
    { denomination: 200, quantity: 0 },
    { denomination: 500, quantity: 0 },
  ],
  snapshots: [{
    id: "snapshot-1",
    createdAt: "2026-08-25T12:00:00.000Z",
    totalWealth: 150,
    accountBalances: [{ accountId: "cash", balance: 150, includedInWealth: true }],
  }],
  paychecks: [{ id: "june-10", paymentDate: "2026-06-26", amount: 1480 }],
  goals: [{ id: "wealth-goal", name: "Total Wealth", targetAmount: 15000 }],
} as const;

describe("wealth backup validation", () => {
  it("accepts optional account access and volatility metadata without changing backup version", () => {
    const withMetadata = {
      ...validBackup,
      accounts: [{
        ...validBackup.accounts[0],
        access: "immediate",
        volatility: "stable",
      }],
    };

    const parsed = parseWealthBackup(JSON.stringify(withMetadata));

    expect(parsed.version).toBe(2);
    expect(parsed.accounts[0]).toMatchObject({ access: "immediate", volatility: "stable" });
  });

  it("rejects unsupported account access and volatility values", () => {
    expect(wealthBackupSchema.safeParse({
      ...validBackup,
      accounts: [{ ...validBackup.accounts[0], access: "weekly" }],
    }).success).toBe(false);
    expect(wealthBackupSchema.safeParse({
      ...validBackup,
      accounts: [{ ...validBackup.accounts[0], volatility: "extreme" }],
    }).success).toBe(false);
  });

  it("keeps version 2 accounts without profile metadata unclassified", () => {
    const parsed = parseWealthBackup(JSON.stringify(validBackup));

    expect(parsed.accounts[0]).not.toHaveProperty("access");
    expect(parsed.accounts[0]).not.toHaveProperty("volatility");
  });

  it("accepts a complete, self-validating version 2 backup", () => {
    expect(parseWealthBackup(JSON.stringify(validBackup))).toEqual(validBackup);
    expect(wealthBackupSchema.safeParse(validBackup).success).toBe(true);
  });

  it("keeps legacy goals valid while accepting backward-compatible goal intelligence fields", () => {
    expect(wealthBackupSchema.safeParse(validBackup).success).toBe(true);
    expect(wealthBackupSchema.safeParse({
      ...validBackup,
      goals: [{
        ...validBackup.goals[0],
        type: "liquidity",
        targetDate: "2027-03-31",
      }],
    }).success).toBe(true);
  });

  it("rejects invalid goal types and impossible target dates", () => {
    expect(wealthBackupSchema.safeParse({
      ...validBackup,
      goals: [{ ...validBackup.goals[0], type: "portfolio" }],
    }).success).toBe(false);
    expect(wealthBackupSchema.safeParse({
      ...validBackup,
      goals: [{ ...validBackup.goals[0], targetDate: "2027-02-30" }],
    }).success).toBe(false);
  });

  it("upgrades a coherent version 1 backup without changing its historical total", () => {
    const legacy = structuredClone(validBackup) as unknown as Record<string, unknown> & {
      version: number;
      accounts: Array<Record<string, unknown>>;
      snapshots: Array<{ accountBalances: Array<Record<string, unknown>> }>;
    };
    legacy.version = 1;
    legacy.accounts.forEach((account) => Reflect.deleteProperty(account, "createdAt"));
    legacy.snapshots.forEach((snapshot) => snapshot.accountBalances.forEach(
      (balance) => Reflect.deleteProperty(balance, "includedInWealth"),
    ));

    const upgraded = parseWealthBackup(JSON.stringify(legacy));

    expect(upgraded.version).toBe(2);
    expect(upgraded.snapshots[0].totalWealth).toBe(150);
    expect(upgraded.snapshots[0].accountBalances).toEqual([
      { accountId: "cash", balance: 150, includedInWealth: true },
    ]);
    expect(upgraded.accounts[0].createdAt).toBe("2026-08-25T12:00:00.000Z");
  });

  it("rejects malformed JSON and schema-invalid payloads", () => {
    expect(() => parseWealthBackup("{not json")).toThrow();
    expect(() => parseWealthBackup(JSON.stringify({ version: 2 }))).toThrow();
  });

  it("rejects unsafe monetary leaves before derived arithmetic can overflow", () => {
    expect(wealthBackupSchema.safeParse({
      ...validBackup,
      accounts: [{ ...validBackup.accounts[0], balance: Number.MAX_VALUE }],
    }).success).toBe(false);
    expect(wealthBackupSchema.safeParse({
      ...validBackup,
      paychecks: [{ ...validBackup.paychecks[0], amount: Number.POSITIVE_INFINITY }],
    }).success).toBe(false);
  });

  it("rejects a finite current active-account aggregate that exceeds the safe currency limit", () => {
    const largeBalance = MAX_CURRENCY_AMOUNT / 2 + 1;
    const laterAccounts = ["large-a", "large-b"].map((id, index) => ({
      id,
      name: `Large ${index + 1}`,
      category: "investments" as const,
      currency: "EUR" as const,
      balance: largeBalance,
      includedInWealth: true,
      createdAt: `2026-08-26T0${index + 1}:00:00.000Z`,
      lastUpdated: `2026-08-26T0${index + 1}:00:00.000Z`,
    }));

    expect(wealthBackupSchema.safeParse({
      ...validBackup,
      accounts: [...validBackup.accounts, ...laterAccounts],
    }).success).toBe(false);
  });

  it("rejects paycheck dates that match the ISO shape but are not calendar dates", () => {
    expect(wealthBackupSchema.safeParse({
      ...validBackup,
      paychecks: [{ ...validBackup.paychecks[0], paymentDate: "2026-99-99" }],
    }).success).toBe(false);
  });

  it("accepts a known income type on a paycheck, and none, but not an unknown one", () => {
    expect(wealthBackupSchema.safeParse({
      ...validBackup,
      paychecks: [{ ...validBackup.paychecks[0], type: "extra-month" }],
    }).success).toBe(true);
    expect(wealthBackupSchema.safeParse(validBackup).success).toBe(true);
    expect(wealthBackupSchema.safeParse({
      ...validBackup,
      paychecks: [{ ...validBackup.paychecks[0], type: "lottery" }],
    }).success).toBe(false);
  });

  it("rejects duplicate identifiers instead of accepting ambiguous records", () => {
    expect(wealthBackupSchema.safeParse({
      ...validBackup,
      accounts: [validBackup.accounts[0], { ...validBackup.accounts[0] }],
    }).success).toBe(false);
  });

  it("requires every persistent data domain", () => {
    const withoutPaychecks = { ...validBackup } as Record<string, unknown>;
    Reflect.deleteProperty(withoutPaychecks, "paychecks");
    expect(wealthBackupSchema.safeParse(withoutPaychecks).success).toBe(false);
  });

  it("rejects snapshots captured at the same instant because their order is ambiguous", () => {
    const duplicateCapture = {
      ...validBackup.snapshots[0],
      id: "snapshot-2",
      createdAt: "2026-08-25T14:00:00+02:00",
    };

    expect(wealthBackupSchema.safeParse({
      ...validBackup,
      snapshots: [validBackup.snapshots[0], duplicateCapture],
    }).success).toBe(false);
  });

  it("requires exactly one active reserved Cash account with its canonical identity", () => {
    const missingCash = { ...validBackup, accounts: [] };
    const archivedCash = {
      ...validBackup,
      accounts: [{ ...validBackup.accounts[0], archivedAt: "2026-08-25T13:00:00.000Z" }],
    };
    const renamedCash = {
      ...validBackup,
      accounts: [{ ...validBackup.accounts[0], name: "Wallet" }],
    };

    expect(wealthBackupSchema.safeParse(missingCash).success).toBe(false);
    expect(wealthBackupSchema.safeParse(archivedCash).success).toBe(false);
    expect(wealthBackupSchema.safeParse(renamedCash).success).toBe(false);
  });

  it("rejects snapshots that reference an account absent from the backup", () => {
    expect(wealthBackupSchema.safeParse({
      ...validBackup,
      snapshots: [{
        ...validBackup.snapshots[0],
        accountBalances: [{ accountId: "deleted-account", balance: 150, includedInWealth: true }],
      }],
    }).success).toBe(false);
  });

  it("requires each historical snapshot to capture every account active at that time", () => {
    const eligibleAccount = {
      id: "savings",
      name: "Savings",
      category: "liquidity",
      currency: "EUR",
      balance: 25,
      includedInWealth: true,
      createdAt: "2026-08-25T11:00:00.000Z",
      lastUpdated: "2026-08-25T11:00:00.000Z",
    };

    expect(wealthBackupSchema.safeParse({
      ...validBackup,
      accounts: [...validBackup.accounts, eligibleAccount],
    }).success).toBe(false);
  });

  it("allows older snapshots to omit accounts created later", () => {
    const laterAccount = {
      id: "later-account",
      name: "Later account",
      category: "investments",
      currency: "EUR",
      balance: 25,
      includedInWealth: true,
      createdAt: "2026-08-26T09:00:00.000Z",
      lastUpdated: "2026-08-26T09:00:00.000Z",
    };

    expect(wealthBackupSchema.safeParse({
      ...validBackup,
      accounts: [...validBackup.accounts, laterAccount],
    }).success).toBe(true);
  });

  it("rejects duplicate captures and a corrupted stored snapshot total", () => {
    expect(wealthBackupSchema.safeParse({
      ...validBackup,
      snapshots: [{
        ...validBackup.snapshots[0],
        accountBalances: [validBackup.snapshots[0].accountBalances[0], validBackup.snapshots[0].accountBalances[0]],
      }],
    }).success).toBe(false);
    expect(wealthBackupSchema.safeParse({
      ...validBackup,
      snapshots: [{ ...validBackup.snapshots[0], totalWealth: 149.99 }],
    }).success).toBe(false);
  });

  it("requires the exact supported EUR Cash denomination set", () => {
    const missingDenomination = {
      ...validBackup,
      cashDenominations: validBackup.cashDenominations.filter((item) => item.denomination !== 500),
    };
    const unsupportedDenomination = {
      ...validBackup,
      cashDenominations: [...validBackup.cashDenominations, { denomination: 1, quantity: 0 }],
    };

    expect(wealthBackupSchema.safeParse(missingDenomination).success).toBe(false);
    expect(wealthBackupSchema.safeParse(unsupportedDenomination).success).toBe(false);
  });

  it("accepts an exact all-zero counter only when Cash and its snapshot total are also zero", () => {
    const zeroCashAccount = { ...validBackup.accounts[0], balance: 0 };
    const zeroSnapshot = {
      ...validBackup.snapshots[0],
      totalWealth: 0,
      accountBalances: [{ accountId: "cash", balance: 0, includedInWealth: true }],
    };

    expect(wealthBackupSchema.safeParse({
      ...validBackup,
      accounts: [zeroCashAccount],
      cashDenominations: [],
      snapshots: [zeroSnapshot],
    }).success).toBe(false);
    expect(wealthBackupSchema.safeParse({
      ...validBackup,
      accounts: [zeroCashAccount],
      cashDenominations: validBackup.cashDenominations.map((item) => ({ ...item, quantity: 0 })),
      snapshots: [zeroSnapshot],
    }).success).toBe(true);
  });
});
