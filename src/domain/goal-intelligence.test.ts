import { describe, expect, it } from "vitest";

import { analyzeGoal, type Metric, type PaceValue } from "./wealth-progress";
import type { WealthGoal } from "./types";

const observedPace: Metric<PaceValue> = {
  status: "AVAILABLE",
  basis: "DERIVED",
  value: {
    amountPerMonth: 430,
    from: "2026-05-31T12:00:00.000Z",
    to: "2026-08-31T12:00:00.000Z",
    elapsedDays: 92,
  },
};

describe("goal intelligence", () => {
  it("derives remaining amount, estimated target date, required pace, and pace gap", () => {
    const goal: WealthGoal = {
      id: "wealth-goal",
      name: "Next threshold",
      type: "total-wealth",
      targetAmount: 15000,
      targetDate: "2027-03-31",
    };

    const result = analyzeGoal(goal, 9500, observedPace, "2026-08-31");

    expect(result.currentAmount).toBe(9500);
    expect(result.remainingAmount).toBe(5500);
    expect(result.percentageCompleted).toBe(63.33333333333333);
    expect(result.estimatedTarget).toEqual({
      status: "AVAILABLE",
      basis: "DERIVED",
      value: { months: 13, date: "2027-09-30" },
    });
    expect(result.requiredMonthlyPace).toEqual({
      status: "AVAILABLE",
      basis: "DERIVED",
      value: 785.71,
    });
    expect(result.paceGap).toEqual({
      status: "AVAILABLE",
      basis: "DERIVED",
      value: -355.71,
    });
  });

  it("marks an already reached target without projecting beyond it", () => {
    const result = analyzeGoal(
      { id: "goal", name: "Reached", targetAmount: 15000 },
      16000,
      observedPace,
      "2026-08-31",
    );

    expect(result.remainingAmount).toBe(0);
    expect(result.percentageCompleted).toBe(100);
    expect(result.estimatedTarget.status).toBe("NOT_APPLICABLE");
  });

  it("withholds an estimated target when observed pace is zero or negative", () => {
    const zeroPace: Metric<PaceValue> = {
      ...observedPace,
      value: { ...observedPace.value, amountPerMonth: 0 },
    };

    const result = analyzeGoal(
      { id: "goal", name: "Target", targetAmount: 15000 },
      9500,
      zeroPace,
      "2026-08-31",
    );

    expect(result.estimatedTarget).toEqual({
      status: "NOT_APPLICABLE",
      basis: "DERIVED",
      reason: "Observed pace must be positive to estimate a target date.",
    });
  });

  it("propagates insufficient or unsupported observed pace honestly", () => {
    const insufficient: Metric<PaceValue> = {
      status: "INSUFFICIENT_DATA",
      basis: "DERIVED",
      reason: "At least three observations are required.",
    };
    const unsupported: Metric<PaceValue> = {
      status: "NOT_APPLICABLE",
      basis: "DERIVED",
      reason: "Historical liquidity categories are unavailable.",
    };

    expect(analyzeGoal(
      { id: "goal", name: "Target", targetAmount: 15000 },
      9500,
      insufficient,
      "2026-08-31",
    ).estimatedTarget.status).toBe("INSUFFICIENT_DATA");
    expect(analyzeGoal(
      { id: "goal", name: "Liquidity", type: "liquidity", targetAmount: 10000 },
      6500,
      unsupported,
      "2026-08-31",
    ).estimatedTarget.status).toBe("NOT_APPLICABLE");
  });
});
