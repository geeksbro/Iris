import { describe, expect, it } from "vitest";

import {
  calculateAccountBalanceMovements,
  calculateAccountBalanceTotal,
  calculateAccountShare,
  calculateAllTimeHigh,
  calculateCashTotal,
  calculateCategoryPercentages,
  calculateCategoryTotals,
  calculateGoalProgress,
  calculateGoalRemaining,
  calculateHighestPayment,
  calculateIncomeAverage,
  calculateIncomeTotal,
  calculatePeriodChange,
  calculateSnapshotDelta,
  calculateTotalWealth,
  calculateTypicalSalary,
  findMissingSalaryMonths,
  paycheckTypeOf,
} from "./calculations";
import { demoAccounts, demoPaychecks } from "@/data/demo";

import { formatCurrency } from "./formatters";
import type { Account, CashDenomination, Paycheck, WealthSnapshot } from "./types";

// The fictional example archive (data/demo.ts): its figures are no one's.
const accounts: Account[] = demoAccounts();

const snapshots: WealthSnapshot[] = [
  { id: "december", createdAt: new Date(2025, 11, 31).toISOString(), totalWealth: 7000, accountBalances: [] },
  { id: "january", createdAt: new Date(2026, 0, 1).toISOString(), totalWealth: 8000, accountBalances: [] },
  { id: "july", createdAt: new Date(2026, 6, 31).toISOString(), totalWealth: 9000, accountBalances: [] },
  { id: "august-start", createdAt: new Date(2026, 7, 1).toISOString(), totalWealth: 9100, accountBalances: [] },
  { id: "august-current", createdAt: new Date(2026, 7, 25).toISOString(), totalWealth: 9500, accountBalances: [] },
];

const paychecks: Paycheck[] = demoPaychecks;

describe("financial calculations", () => {
  it("derives the €9,420.40 total wealth from the included example accounts", () => {
    expect(calculateTotalWealth(accounts)).toBe(9420.4);
  });

  it("keeps total account balances distinct from included Total Wealth", () => {
    const excluded = { ...accounts[0], includedInWealth: false };

    expect(calculateAccountBalanceTotal([excluded, ...accounts.slice(1)])).toBe(9420.4);
    expect(calculateTotalWealth([excluded, ...accounts.slice(1)])).toBe(4600.05);
  });

  it("excludes accounts outside wealth from totals and account share", () => {
    const excluded = { ...accounts[0], includedInWealth: false };

    expect(calculateTotalWealth([excluded, ...accounts.slice(1)])).toBe(4600.05);
    expect(calculateAccountShare(excluded, 9420.4)).toBe(0);
  });

  it("derives category totals and percentages without hardcoded values", () => {
    const totals = calculateCategoryTotals(accounts);

    expect(totals).toEqual({ liquidity: 5615.75, investments: 3379.05, trading: 425.6 });
    const percentages = calculateCategoryPercentages(totals, 9420.4);
    expect(percentages.liquidity).toBeCloseTo(59.612649, 5);
    expect(percentages.investments).toBeCloseTo(35.869496, 5);
    expect(percentages.trading).toBeCloseTo(4.517855, 5);
  });

  it("returns zero for percentage and share operations with no wealth denominator", () => {
    expect(calculateCategoryPercentages({ liquidity: 0, investments: 0, trading: 0 }, 0)).toEqual({
      liquidity: 0,
      investments: 0,
      trading: 0,
    });
    expect(calculateAccountShare(accounts[0], 0)).toBe(0);
  });

  it("returns zero instead of NaN when an account share receives a non-finite denominator", () => {
    expect(calculateAccountShare(accounts[0], Number.NaN)).toBe(0);
  });

  it("calculates a €15,000 goal's progress and non-negative remaining amount", () => {
    expect(calculateGoalProgress(9420.4, 20000)).toBeCloseTo(47.102);
    expect(calculateGoalRemaining(9420.4, 20000)).toBe(10579.6);
    expect(calculateGoalRemaining(16000, 15000)).toBe(0);
  });

  it("returns absolute and percentage deltas only when a previous snapshot exists", () => {
    expect(calculateSnapshotDelta(snapshots[4], snapshots[3])).toEqual({ amount: 400, percentage: 4.395604395604396 });
    expect(calculateSnapshotDelta(snapshots[0])).toBeNull();
  });

  it("normalizes sub-cent snapshot changes instead of exposing negative zero", () => {
    const delta = calculateSnapshotDelta(
      { totalWealth: 100.004 },
      { totalWealth: 100.005 },
    );

    expect(delta).toEqual({ amount: 0, percentage: 0 });
    expect(Object.is(delta?.amount, -0)).toBe(false);
    expect(Object.is(delta?.percentage, -0)).toBe(false);
  });

  it("derives only comparable account balance movements between real snapshots", () => {
    const previous: WealthSnapshot = {
      id: "previous",
      createdAt: "2026-08-25T00:00:00.000Z",
      totalWealth: 300,
      accountBalances: [
        { accountId: "bank", balance: 200, includedInWealth: true },
        { accountId: "broker", balance: 100, includedInWealth: true },
      ],
    };
    const current: WealthSnapshot = {
      id: "current",
      createdAt: "2026-08-26T00:00:00.000Z",
      totalWealth: 350,
      accountBalances: [
        { accountId: "bank", balance: 170, includedInWealth: true },
        { accountId: "broker", balance: 180, includedInWealth: true },
        { accountId: "new-account", balance: 40, includedInWealth: false },
      ],
    };

    expect(calculateAccountBalanceMovements(current, previous)).toEqual([
      { accountId: "broker", amount: 80 },
      { accountId: "bank", amount: -30 },
    ]);
    expect(calculateAccountBalanceMovements(current)).toEqual([]);
  });

  it("keeps an absolute zero-baseline change while marking its percentage undefined", () => {
    expect(calculateSnapshotDelta(
      { totalWealth: 250 },
      { totalWealth: 0 },
    )).toEqual({ amount: 250, percentage: null });
  });

  it("uses snapshots at MTD and YTD boundaries as their baselines", () => {
    const localReference = new Date(2026, 7, 25, 12);
    expect(calculatePeriodChange(snapshots, "mtd", localReference)).toEqual({ amount: 400, percentage: 4.395604395604396 });
    expect(calculatePeriodChange(snapshots, "ytd", localReference)).toEqual({ amount: 1500, percentage: 18.75 });
  });

  it("derives MTD and YTD boundaries from the user's local calendar", () => {
    class ControlledLocalCalendarReference extends Date {
      override getFullYear(): number { return 2026; }
      override getMonth(): number { return 7; }
    }

    const localSnapshots: WealthSnapshot[] = [
      { id: "local-year-start", createdAt: new Date(2026, 0, 1, 0, 0, 0).toISOString(), totalWealth: 8000, accountBalances: [] },
      { id: "local-month-start", createdAt: new Date(2026, 7, 1, 0, 0, 0).toISOString(), totalWealth: 9100, accountBalances: [] },
      { id: "local-current", createdAt: new Date(2026, 7, 25, 12, 0, 0).toISOString(), totalWealth: 9500, accountBalances: [] },
    ];
    const reference = new ControlledLocalCalendarReference("2035-12-20T12:00:00.000Z");

    expect(calculatePeriodChange(localSnapshots, "mtd", reference)).toEqual({
      amount: 400,
      percentage: 4.395604395604396,
    });
    expect(calculatePeriodChange(localSnapshots, "ytd", reference)).toEqual({
      amount: 1500,
      percentage: 18.75,
    });
  });

  it("returns no period metric when there is insufficient historical data", () => {
    expect(calculatePeriodChange([snapshots[4]], "mtd", "2026-08-25T12:00:00.000Z")).toBeNull();
    expect(calculateAllTimeHigh([])).toBeNull();
  });

  it("finds the stored all-time high without recalculating historical balances", () => {
    expect(calculateAllTimeHigh(snapshots)).toBe(9500);
  });

  it("derives physical cash from denomination quantities", () => {
    const cash: CashDenomination[] = [
      { denomination: 5, quantity: 0 },
      { denomination: 10, quantity: 1 },
      { denomination: 20, quantity: 2 },
      { denomination: 50, quantity: 2 },
    ];

    expect(calculateCashTotal(cash)).toBe(150);
  });

  it("keeps June paychecks distinct in income aggregates", () => {
    expect(paychecks.filter((paycheck) => paycheck.paymentDate.startsWith("2026-06")).map((paycheck) => paycheck.id)).toEqual(["jun-26", "jun-30"]);
    expect(calculateIncomeTotal(paychecks)).toBe(10605);
    expect(calculateIncomeAverage(paychecks)).toBe(1325.625);
    expect(calculateHighestPayment(paychecks)).toBe(1495);
  });

  it("reads a paycheck without a type as a salary, and the typical salary as the median of salaries only", () => {
    expect(paycheckTypeOf({})).toBe("salary");
    expect(paycheckTypeOf({ type: "bonus" })).toBe("bonus");
    const income: Paycheck[] = [
      { id: "a", paymentDate: "2026-01-27", amount: 2100 },
      { id: "b", paymentDate: "2026-02-27", amount: 2300, type: "salary" },
      { id: "c", paymentDate: "2026-03-27", amount: 2200, type: "salary" },
      { id: "d", paymentDate: "2026-07-27", amount: 2000, type: "extra-month" },
      { id: "e", paymentDate: "2026-05-16", amount: 9000, type: "freelance" },
    ];
    expect(calculateTypicalSalary(income)).toBe(2200);
    expect(calculateTypicalSalary(income.slice(0, 2))).toBe(2200);
    expect(calculateTypicalSalary([{ id: "x", paymentDate: "2026-01-01", amount: 5, type: "other" }])).toBeNull();
  });

  it("names months a regular salary did not reach, counting the current month only past its pay day", () => {
    const salary = (paymentDate: string): Paycheck => ({ id: paymentDate, paymentDate, amount: 2000 });
    const series = [salary("2026-01-10"), salary("2026-02-10"), salary("2026-03-10"), salary("2026-05-10")];
    // 12 June: the 10th plus three days of grace has not passed, so June is not due yet.
    expect(findMissingSalaryMonths(series, new Date(2026, 5, 12))).toEqual(["2026-04"]);
    expect(findMissingSalaryMonths(series, new Date(2026, 5, 14))).toEqual(["2026-04", "2026-06"]);
    // Fewer than three salaries are not a series; other income never counts as one.
    expect(findMissingSalaryMonths(series.slice(0, 2), new Date(2026, 5, 14))).toEqual([]);
    expect(findMissingSalaryMonths([...series, { id: "b", paymentDate: "2026-04-20", amount: 500, type: "bonus" }], new Date(2026, 5, 12))).toEqual(["2026-04"]);
  });

  it("formats euro amounts through the Italian currency formatter", () => {
    expect(formatCurrency(9420.4)).toBe("9.420,40 €");
  });
});
