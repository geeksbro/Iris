import { describe, expect, it } from "vitest";

import { compareDecisionScenario, simulateWealthScenario } from "./scenarios";

describe("wealth scenario simulation", () => {
  it("applies a one-time decision without mutating the supplied assumptions", () => {
    const input = {
      startingWealth: 10000,
      oneTimeAdjustment: -1999,
      monthlyContribution: 0,
      horizonMonths: 12,
      startDate: "2026-08-31",
    } as const;
    const before = structuredClone(input);

    const result = simulateWealthScenario(input);

    expect(input).toEqual(before);
    expect(result.basis).toBe("SIMULATED");
    expect(result.observedStartingWealth).toBe(10000);
    expect(result.simulatedStartingWealth).toBe(8001);
    expect(result.wealthAtHorizon).toBe(8001);
    expect(result.differenceAgainstBaseline).toBe(-1999);
  });

  it("builds a transparent recurring monthly trajectory", () => {
    const result = simulateWealthScenario({
      startingWealth: 9500,
      oneTimeAdjustment: 0,
      monthlyContribution: 500,
      horizonMonths: 12,
      startDate: "2026-08-31",
      targetAmount: 15000,
    });

    expect(result.points).toHaveLength(13);
    expect(result.wealthAtHorizon).toBe(15500);
    expect(result.differenceAgainstBaseline).toBe(6000);
    expect(result.targetEstimate).toEqual({
      status: "AVAILABLE",
      basis: "SIMULATED",
      value: { months: 11, date: "2027-07-31" },
    });
  });

  it("marks an already reached target at month zero", () => {
    const result = simulateWealthScenario({
      startingWealth: 16000,
      oneTimeAdjustment: 0,
      monthlyContribution: 0,
      horizonMonths: 12,
      startDate: "2026-08-31",
      targetAmount: 15000,
    });

    expect(result.targetEstimate).toEqual({
      status: "AVAILABLE",
      basis: "SIMULATED",
      value: { months: 0, date: "2026-08-31" },
    });
  });

  it("marks a future target unreachable when monthly contribution is not positive", () => {
    const result = simulateWealthScenario({
      startingWealth: 9500,
      oneTimeAdjustment: 0,
      monthlyContribution: -100,
      horizonMonths: 12,
      startDate: "2026-08-31",
      targetAmount: 15000,
    });

    expect(result.targetEstimate).toEqual({
      status: "NOT_APPLICABLE",
      basis: "SIMULATED",
      reason: "A positive monthly contribution is required to reach a higher target in this scenario.",
    });
  });

  it("floors simulated wealth at zero after negative assumptions", () => {
    const result = simulateWealthScenario({
      startingWealth: 1000,
      oneTimeAdjustment: -1500,
      monthlyContribution: -200,
      horizonMonths: 3,
      startDate: "2026-08-31",
    });

    expect(result.simulatedStartingWealth).toBe(0);
    expect(result.points.map((point) => point.wealth)).toEqual([0, 0, 0, 0]);
  });

  it("clamps each simulated month from the original end-of-month date", () => {
    const result = simulateWealthScenario({
      startingWealth: 1000,
      oneTimeAdjustment: 0,
      monthlyContribution: 100,
      horizonMonths: 2,
      startDate: "2027-01-31",
    });

    expect(result.points.map((point) => point.date)).toEqual([
      "2027-01-31",
      "2027-02-28",
      "2027-03-31",
    ]);
  });

  it("derives the monthly contribution required for an explicit target date", () => {
    const result = simulateWealthScenario({
      startingWealth: 9000,
      oneTimeAdjustment: 0,
      monthlyContribution: 500,
      horizonMonths: 12,
      startDate: "2027-01-31",
      targetAmount: 15000,
      targetDate: "2027-07-31",
    });

    expect(result.requiredMonthlyContribution).toEqual({
      status: "AVAILABLE",
      basis: "SIMULATED",
      value: 1000,
    });
  });
});

describe("decision comparison", () => {
  it("keeps no action and an identical decision on the same path", () => {
    const result = compareDecisionScenario({
      startingWealth: 9420.4,
      baselineMonthlyContribution: 250,
      decisionOneTimeAdjustment: 0,
      decisionMonthlyContribution: 250,
      horizonMonths: 12,
      startDate: "2026-08-29",
      targetAmount: 15000,
    });

    expect(result.basis).toBe("SIMULATED");
    expect(result.baseline.wealthAtHorizon).toBe(12420.4);
    expect(result.decision.wealthAtHorizon).toBe(12420.4);
    expect(result.wealthImpactAtHorizon).toBe(0);
    expect(result.baseline.points).toEqual(result.decision.points);
  });

  it("quantifies a negative decision and positive recurring pace against no action", () => {
    const result = compareDecisionScenario({
      startingWealth: 9420.4,
      baselineMonthlyContribution: 0,
      decisionOneTimeAdjustment: -1999,
      decisionMonthlyContribution: 500,
      horizonMonths: 12,
      startDate: "2026-08-29",
      targetAmount: 15000,
    });

    expect(result.baseline.simulatedStartingWealth).toBe(9420.4);
    expect(result.decision.simulatedStartingWealth).toBe(7421.4);
    expect(result.baseline.wealthAtHorizon).toBe(9420.4);
    expect(result.decision.wealthAtHorizon).toBe(13421.4);
    expect(result.wealthImpactAtHorizon).toBe(4001);
  });

  it("supports a positive adjustment and a negative decision pace", () => {
    const result = compareDecisionScenario({
      startingWealth: 1000,
      baselineMonthlyContribution: 0,
      decisionOneTimeAdjustment: 600,
      decisionMonthlyContribution: -100,
      horizonMonths: 12,
      startDate: "2026-08-31",
    });

    expect(result.baseline.wealthAtHorizon).toBe(1000);
    expect(result.decision.wealthAtHorizon).toBe(400);
    expect(result.wealthImpactAtHorizon).toBe(-600);
  });

  it("keeps zero wealth and long floored paths deterministic", () => {
    const result = compareDecisionScenario({
      startingWealth: 0,
      baselineMonthlyContribution: -10,
      decisionOneTimeAdjustment: -100,
      decisionMonthlyContribution: -20,
      horizonMonths: 600,
      startDate: "2024-02-29",
    });

    expect(result.baseline.points).toHaveLength(601);
    expect(result.decision.points).toHaveLength(601);
    expect(result.baseline.wealthAtHorizon).toBe(0);
    expect(result.decision.wealthAtHorizon).toBe(0);
    expect(result.baseline.points[12].date).toBe("2025-02-28");
  });

  it("does not mutate comparison assumptions", () => {
    const input = {
      startingWealth: 9000,
      baselineMonthlyContribution: 100,
      decisionOneTimeAdjustment: -500,
      decisionMonthlyContribution: 300,
      horizonMonths: 24,
      startDate: "2026-01-31",
      targetAmount: 15000,
      targetDate: "2028-01-31",
    } as const;
    const before = structuredClone(input);

    compareDecisionScenario(input);

    expect(input).toEqual(before);
  });

  it("rejects invalid shared calendar dates", () => {
    expect(() => compareDecisionScenario({
      startingWealth: 9000,
      baselineMonthlyContribution: 0,
      decisionOneTimeAdjustment: 0,
      decisionMonthlyContribution: 100,
      horizonMonths: 12,
      startDate: "2026-02-30",
      targetDate: "2027-02-30",
    })).toThrow(/real calendar date/i);
  });

  it("rejects an invalid target date when the start date is valid", () => {
    expect(() => compareDecisionScenario({
      startingWealth: 9000,
      baselineMonthlyContribution: 0,
      decisionOneTimeAdjustment: 0,
      decisionMonthlyContribution: 100,
      horizonMonths: 12,
      startDate: "2026-02-28",
      targetAmount: 15000,
      targetDate: "2027-02-30",
    })).toThrow(/real calendar date/i);
  });

  it("reports delayed, accelerated, and unchanged target timing", () => {
    const shared = {
      startingWealth: 10000,
      horizonMonths: 12,
      startDate: "2026-08-31",
      targetAmount: 15000,
    } as const;

    expect(compareDecisionScenario({
      ...shared,
      baselineMonthlyContribution: 500,
      decisionOneTimeAdjustment: -1000,
      decisionMonthlyContribution: 500,
    }).targetImpact).toMatchObject({
      status: "DELAYED",
      monthsDifference: 2,
      baselineMonths: 10,
      decisionMonths: 12,
    });

    expect(compareDecisionScenario({
      ...shared,
      baselineMonthlyContribution: 500,
      decisionOneTimeAdjustment: 0,
      decisionMonthlyContribution: 1000,
    }).targetImpact).toMatchObject({
      status: "ACCELERATED",
      monthsDifference: -5,
      baselineMonths: 10,
      decisionMonths: 5,
    });

    expect(compareDecisionScenario({
      ...shared,
      baselineMonthlyContribution: 500,
      decisionOneTimeAdjustment: 0,
      decisionMonthlyContribution: 500,
    }).targetImpact).toMatchObject({
      status: "UNCHANGED",
      monthsDifference: 0,
      baselineMonths: 10,
      decisionMonths: 10,
    });
  });

  it("distinguishes newly reachable, newly unreachable, and mutually unreachable targets", () => {
    const shared = {
      startingWealth: 9500,
      decisionOneTimeAdjustment: 0,
      horizonMonths: 12,
      startDate: "2026-08-31",
      targetAmount: 15000,
    } as const;

    expect(compareDecisionScenario({
      ...shared,
      baselineMonthlyContribution: 0,
      decisionMonthlyContribution: 500,
    }).targetImpact).toMatchObject({
      status: "ACCELERATED",
      monthsDifference: null,
      baselineMonths: null,
      decisionMonths: 11,
      reason: expect.stringContaining("makes the target reachable"),
    });

    expect(compareDecisionScenario({
      ...shared,
      baselineMonthlyContribution: 500,
      decisionMonthlyContribution: 0,
    }).targetImpact).toMatchObject({
      status: "UNREACHABLE",
      baselineMonths: 11,
      decisionMonths: null,
      reason: expect.stringContaining("decision path does not reach"),
    });

    expect(compareDecisionScenario({
      ...shared,
      baselineMonthlyContribution: 0,
      decisionMonthlyContribution: 0,
    }).targetImpact).toMatchObject({
      status: "UNREACHABLE",
      baselineMonths: null,
      decisionMonths: null,
      reason: expect.stringContaining("Neither path"),
    });
  });

  it("marks a target reached at the start as unchanged and no target as not applicable", () => {
    expect(compareDecisionScenario({
      startingWealth: 16000,
      baselineMonthlyContribution: 0,
      decisionOneTimeAdjustment: 0,
      decisionMonthlyContribution: 100,
      horizonMonths: 12,
      startDate: "2026-08-31",
      targetAmount: 15000,
    }).targetImpact).toMatchObject({ status: "UNCHANGED", monthsDifference: 0 });

    expect(compareDecisionScenario({
      startingWealth: 10000,
      baselineMonthlyContribution: 0,
      decisionOneTimeAdjustment: 0,
      decisionMonthlyContribution: 100,
      horizonMonths: 12,
      startDate: "2026-08-31",
    }).targetImpact).toMatchObject({
      status: "NOT_APPLICABLE",
      reason: expect.stringContaining("target amount"),
    });
  });

  it("finds the first pointwise recovery month and calendar date", () => {
    const result = compareDecisionScenario({
      startingWealth: 9420.4,
      baselineMonthlyContribution: 0,
      decisionOneTimeAdjustment: -1999,
      decisionMonthlyContribution: 500,
      horizonMonths: 12,
      startDate: "2026-08-29",
      targetAmount: 15000,
    });

    expect(result.recoveryPoint).toEqual({
      status: "AVAILABLE",
      basis: "SIMULATED",
      value: { months: 4, date: "2026-12-29" },
    });
  });

  it("separates purchase cost, compensation pace, and trajectory recovery", () => {
    const samePace = compareDecisionScenario({
      startingWealth: 9420.4,
      baselineMonthlyContribution: 500,
      decisionOneTimeAdjustment: -1999,
      decisionMonthlyContribution: 500,
      horizonMonths: 12,
      startDate: "2026-08-29",
      targetAmount: 15000,
    });

    expect(samePace.wealthImpactAtHorizon).toBe(-1999);
    expect(samePace.targetImpact).toMatchObject({ status: "DELAYED", monthsDifference: 4 });
    expect(samePace.compensation).toEqual({
      status: "AVAILABLE",
      basis: "SIMULATED",
      value: {
        monthlyContribution: 631.55,
        increaseOverBaseline: 131.55,
        baselineTargetMonths: 12,
      },
    });
    expect(samePace.recoveryPoint).toMatchObject({
      status: "NOT_APPLICABLE",
      reason: expect.stringContaining("does not recover"),
    });

    const fasterDecision = compareDecisionScenario({
      startingWealth: 9420.4,
      baselineMonthlyContribution: 500,
      decisionOneTimeAdjustment: -1999,
      decisionMonthlyContribution: 700,
      horizonMonths: 12,
      startDate: "2026-08-29",
      targetAmount: 15000,
    });

    expect(fasterDecision.recoveryPoint).toEqual({
      status: "AVAILABLE",
      basis: "SIMULATED",
      value: { months: 10, date: "2027-06-29" },
    });
  });

  it("withholds recovery when there is no initial deficit or no crossing", () => {
    expect(compareDecisionScenario({
      startingWealth: 10000,
      baselineMonthlyContribution: 0,
      decisionOneTimeAdjustment: 0,
      decisionMonthlyContribution: 500,
      horizonMonths: 12,
      startDate: "2026-08-31",
    }).recoveryPoint).toMatchObject({
      status: "NOT_APPLICABLE",
      reason: expect.stringContaining("does not start below"),
    });

    expect(compareDecisionScenario({
      startingWealth: 10000,
      baselineMonthlyContribution: 0,
      decisionOneTimeAdjustment: -1000,
      decisionMonthlyContribution: 0,
      horizonMonths: 12,
      startDate: "2026-08-31",
    }).recoveryPoint).toMatchObject({
      status: "NOT_APPLICABLE",
      reason: expect.stringContaining("not recover within"),
    });
  });

  it("handles zero floors and end-of-month dates in recovery", () => {
    expect(compareDecisionScenario({
      startingWealth: 1000,
      baselineMonthlyContribution: -200,
      decisionOneTimeAdjustment: -500,
      decisionMonthlyContribution: -100,
      horizonMonths: 12,
      startDate: "2026-08-31",
    }).recoveryPoint).toMatchObject({
      status: "AVAILABLE",
      value: { months: 5, date: "2027-01-31" },
    });

    expect(compareDecisionScenario({
      startingWealth: 1000,
      baselineMonthlyContribution: 0,
      decisionOneTimeAdjustment: -100,
      decisionMonthlyContribution: 60,
      horizonMonths: 12,
      startDate: "2027-01-31",
    }).recoveryPoint).toMatchObject({
      status: "AVAILABLE",
      value: { months: 2, date: "2027-03-31" },
    });
  });

  it("rejects a zero target instead of treating it as a meaningful goal", () => {
    expect(() => compareDecisionScenario({
      startingWealth: 0,
      baselineMonthlyContribution: 0,
      decisionOneTimeAdjustment: 0,
      decisionMonthlyContribution: 0,
      horizonMonths: 12,
      startDate: "2026-08-31",
      targetAmount: 0,
    })).toThrow(/positive finite amount/i);
  });
});
