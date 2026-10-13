import { describe, expect, it } from "vitest";

import { calculateAccessAggregation } from "./calculations";
import type { Account } from "./types";

const baseAccount: Account = {
  id: "account",
  name: "Account",
  category: "liquidity",
  currency: "EUR",
  balance: 0,
  includedInWealth: true,
  createdAt: "2026-08-25T00:00:00.000Z",
  lastUpdated: "2026-08-25T00:00:00.000Z",
};

describe("account access aggregation", () => {
  it("aggregates a mixed collection across every access bucket", () => {
    const result = calculateAccessAggregation([
      { ...baseAccount, id: "immediate", balance: 100, access: "immediate" },
      { ...baseAccount, id: "days", balance: 200, access: "days" },
      { ...baseAccount, id: "locked", balance: 300, access: "locked" },
      { ...baseAccount, id: "unclassified", balance: 400 },
    ]);

    expect(result).toEqual({
      immediate: { amount: 100, percentage: 10 },
      days: { amount: 200, percentage: 20 },
      locked: { amount: 300, percentage: 30 },
      unclassified: { amount: 400, percentage: 40 },
    });
  });

  it("gives excluded accounts zero weight in amounts and Total Wealth percentages", () => {
    const result = calculateAccessAggregation([
      { ...baseAccount, id: "included", balance: 100, access: "immediate" },
      { ...baseAccount, id: "excluded", balance: 900, access: "locked", includedInWealth: false },
    ]);

    expect(result).toEqual({
      immediate: { amount: 100, percentage: 100 },
      days: { amount: 0, percentage: 0 },
      locked: { amount: 0, percentage: 0 },
      unclassified: { amount: 0, percentage: 0 },
    });
  });

  it("gives archived accounts zero weight even if they remain included", () => {
    const result = calculateAccessAggregation([
      { ...baseAccount, id: "active", balance: 100, access: "locked" },
      {
        ...baseAccount,
        id: "archived",
        balance: 900,
        access: "immediate",
        archivedAt: "2026-08-26T00:00:00.000Z",
      },
    ]);

    expect(result).toEqual({
      immediate: { amount: 0, percentage: 0 },
      days: { amount: 0, percentage: 0 },
      locked: { amount: 100, percentage: 100 },
      unclassified: { amount: 0, percentage: 0 },
    });
  });

  it("returns zero percentages when Total Wealth is zero", () => {
    const result = calculateAccessAggregation([
      { ...baseAccount, id: "zero", balance: 0, access: "days" },
    ]);

    expect(result).toEqual({
      immediate: { amount: 0, percentage: 0 },
      days: { amount: 0, percentage: 0 },
      locked: { amount: 0, percentage: 0 },
      unclassified: { amount: 0, percentage: 0 },
    });
  });
});
