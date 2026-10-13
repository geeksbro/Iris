import { describe, expect, it } from "vitest";

import { analyzeMilestones, analyzeWealthTrajectory, buildMonthlyReview } from "./wealth-progress";
import type { WealthSnapshot } from "./types";

function snapshot(id: string, createdAt: string, totalWealth: number): WealthSnapshot {
  return { id, createdAt, totalWealth, accountBalances: [] };
}

const history: WealthSnapshot[] = [
  snapshot("dec", "2025-12-31T12:00:00.000Z", 8000),
  snapshot("jan", "2026-01-31T12:00:00.000Z", 8400),
  snapshot("feb", "2026-02-28T12:00:00.000Z", 8200),
  snapshot("mar", "2026-03-31T12:00:00.000Z", 9000),
  snapshot("apr", "2026-04-30T12:00:00.000Z", 9300),
  snapshot("may", "2026-05-31T12:00:00.000Z", 9700),
  snapshot("jun", "2026-06-30T12:00:00.000Z", 10200),
  snapshot("jul", "2026-07-31T12:00:00.000Z", 11000),
  snapshot("aug", "2026-08-31T12:00:00.000Z", 10500),
];

describe("wealth trajectory analysis", () => {
  it("withholds trajectory metrics when history is too short", () => {
    const result = analyzeWealthTrajectory([
      snapshot("first", "2026-08-01T12:00:00.000Z", 9000),
      snapshot("second", "2026-08-20T12:00:00.000Z", 9200),
    ], "2026-08-20T12:00:00.000Z");

    expect(result.current).toEqual({
      status: "AVAILABLE",
      basis: "OBSERVED",
      value: { amount: 9200, date: "2026-08-20T12:00:00.000Z" },
    });
    expect(result.changes.days30.status).toBe("INSUFFICIENT_DATA");
    expect(result.averageMonthlyPace.status).toBe("INSUFFICIENT_DATA");
    expect(result.acceleration.status).toBe("INSUFFICIENT_DATA");
  });

  it("derives 30, 90, 180 day and YTD changes from nearby observed baselines", () => {
    const result = analyzeWealthTrajectory(history, "2026-08-31T12:00:00.000Z");

    expect(result.changes.days30).toMatchObject({
      status: "AVAILABLE",
      value: { amount: -500, percentage: -4.545454545454546, elapsedDays: 31 },
    });
    expect(result.changes.days90).toMatchObject({
      status: "AVAILABLE",
      value: { amount: 800, percentage: 8.24742268041237, elapsedDays: 92 },
    });
    expect(result.changes.days180).toMatchObject({
      status: "AVAILABLE",
      value: { amount: 2300, percentage: 28.04878048780488, elapsedDays: 184 },
    });
    expect(result.changes.ytd).toMatchObject({
      status: "AVAILABLE",
      value: { amount: 2500, percentage: 31.25, elapsedDays: 243 },
    });
  });

  it("keeps a zero-baseline amount while marking its percentage not applicable", () => {
    const result = analyzeWealthTrajectory([
      snapshot("zero", "2026-05-31T12:00:00.000Z", 0),
      snapshot("mid", "2026-06-30T12:00:00.000Z", 300),
      snapshot("current", "2026-08-31T12:00:00.000Z", 900),
    ], "2026-08-31T12:00:00.000Z");

    expect(result.changes.days90).toMatchObject({
      status: "AVAILABLE",
      value: { amount: 900, percentage: null },
    });
  });

  it("normalizes average and non-overlapping recent pace for irregular intervals", () => {
    const result = analyzeWealthTrajectory(history, "2026-08-31T12:00:00.000Z");

    expect(result.averageMonthlyPace).toMatchObject({
      status: "AVAILABLE",
      value: { amountPerMonth: 313.14, elapsedDays: 243 },
    });
    expect(result.recentMonthlyPace).toMatchObject({
      status: "AVAILABLE",
      value: { amountPerMonth: 264.67, elapsedDays: 92 },
    });
    expect(result.acceleration).toMatchObject({
      status: "AVAILABLE",
      value: {
        recentAmountPerMonth: 264.67,
        previousAmountPerMonth: 496.25,
        differencePerMonth: -231.58,
        direction: "DECELERATING",
      },
    });
  });

  it("reports ATH date and drawdown without erasing a later decline", () => {
    const result = analyzeWealthTrajectory(history, "2026-08-31T12:00:00.000Z");

    expect(result.allTimeHigh).toEqual({
      status: "AVAILABLE",
      basis: "DERIVED",
      value: {
        amount: 11000,
        date: "2026-07-31T12:00:00.000Z",
        distanceAmount: 500,
        distancePercentage: 4.545454545454546,
      },
    });
  });

  it("identifies the best and worst consecutive observed periods", () => {
    const result = analyzeWealthTrajectory(history, "2026-08-31T12:00:00.000Z");

    expect(result.bestPeriod).toMatchObject({
      status: "AVAILABLE",
      value: {
        amount: 800,
        from: "2026-02-28T12:00:00.000Z",
        to: "2026-03-31T12:00:00.000Z",
      },
    });
    expect(result.worstPeriod).toMatchObject({
      status: "AVAILABLE",
      value: {
        amount: -500,
        from: "2026-07-31T12:00:00.000Z",
        to: "2026-08-31T12:00:00.000Z",
      },
    });
  });

  it("uses actual elapsed time across leap-day observations", () => {
    const leapHistory = [
      snapshot("jan", "2024-01-31T12:00:00.000Z", 1000),
      snapshot("feb", "2024-02-29T12:00:00.000Z", 1300),
      snapshot("mar", "2024-03-31T12:00:00.000Z", 1600),
    ];

    const result = analyzeWealthTrajectory(leapHistory, "2024-03-31T12:00:00.000Z");

    expect(result.changes.days30).toMatchObject({
      status: "AVAILABLE",
      value: { amount: 300, elapsedDays: 31 },
    });
    expect(result.averageMonthlyPace).toMatchObject({
      status: "AVAILABLE",
      value: { amountPerMonth: 304.37, elapsedDays: 60 },
    });
  });
});

describe("wealth milestones", () => {
  const milestoneHistory = [
    snapshot("jan", "2026-01-01T12:00:00.000Z", 4000),
    snapshot("feb", "2026-02-01T12:00:00.000Z", 5200),
    snapshot("mar", "2026-03-01T12:00:00.000Z", 8000),
    snapshot("apr", "2026-04-01T12:00:00.000Z", 12000),
    snapshot("may", "2026-05-01T12:00:00.000Z", 9000),
  ];

  it("keeps first-reached dates and distinguishes current from historical status", () => {
    const result = analyzeMilestones(milestoneHistory, 9000, [5000, 7500, 10000, 15000]);

    expect(result.milestones).toEqual([
      {
        amount: 5000,
        status: "CURRENTLY_ABOVE",
        firstReachedDate: "2026-02-01T12:00:00.000Z",
        currentDistance: 0,
        daysFromPreviousReachedMilestone: null,
      },
      {
        amount: 7500,
        status: "CURRENTLY_ABOVE",
        firstReachedDate: "2026-03-01T12:00:00.000Z",
        currentDistance: 0,
        daysFromPreviousReachedMilestone: 28,
      },
      {
        amount: 10000,
        status: "PREVIOUSLY_REACHED",
        firstReachedDate: "2026-04-01T12:00:00.000Z",
        currentDistance: 1000,
        daysFromPreviousReachedMilestone: 31,
      },
      {
        amount: 15000,
        status: "NOT_YET_REACHED",
        firstReachedDate: null,
        currentDistance: 6000,
        daysFromPreviousReachedMilestone: null,
      },
    ]);
  });

  it("derives progress toward the first milestone never reached historically", () => {
    const result = analyzeMilestones(milestoneHistory, 9000, [5000, 7500, 10000, 15000]);

    expect(result.nextMilestone).toEqual({
      status: "AVAILABLE",
      basis: "DERIVED",
      value: {
        amount: 15000,
        distance: 6000,
        progressPercentage: 60,
        previousAmount: 10000,
      },
    });
  });

  it("calculates next-milestone progress from zero to the target amount", () => {
    const result = analyzeMilestones([], 8642.51, [5000, 7500, 10000]);

    expect(result.nextMilestone).toMatchObject({
      status: "AVAILABLE",
      value: {
        amount: 10000,
        distance: 1357.49,
        progressPercentage: 86.4251,
      },
    });
  });

  it("withholds historical reach dates when no snapshot proves a crossing", () => {
    const result = analyzeMilestones([], 6000, [5000, 7500]);

    expect(result.milestones[0]).toMatchObject({
      amount: 5000,
      status: "CURRENTLY_ABOVE",
      firstReachedDate: null,
    });
    expect(result.milestones[1]).toMatchObject({
      amount: 7500,
      status: "NOT_YET_REACHED",
      firstReachedDate: null,
      currentDistance: 1500,
    });
  });
});

describe("monthly wealth review", () => {
  const reviewHistory = [
    snapshot("dec", "2025-12-31T12:00:00.000Z", 8000),
    snapshot("jan-mid", "2026-01-15T12:00:00.000Z", 8600),
    snapshot("jan-close", "2026-01-31T12:00:00.000Z", 9000),
    snapshot("feb", "2026-02-28T12:00:00.000Z", 8700),
    snapshot("mar", "2026-03-31T12:00:00.000Z", 9500),
    snapshot("apr", "2026-04-30T12:00:00.000Z", 10300),
    snapshot("may", "2026-05-31T12:00:00.000Z", 10800),
    snapshot("jun", "2026-06-30T12:00:00.000Z", 11200),
    snapshot("jul", "2026-07-31T12:00:00.000Z", 11900),
  ];

  it("uses real opening and closing observations and reports a negative month", () => {
    const result = buildMonthlyReview(reviewHistory, "2026-02");

    expect(result.opening).toEqual({
      status: "AVAILABLE",
      basis: "OBSERVED",
      value: { amount: 9000, date: "2026-01-31T12:00:00.000Z" },
    });
    expect(result.closing).toEqual({
      status: "AVAILABLE",
      basis: "OBSERVED",
      value: { amount: 8700, date: "2026-02-28T12:00:00.000Z" },
    });
    expect(result.change).toMatchObject({
      status: "AVAILABLE",
      value: { amount: -300, percentage: -3.3333333333333335, elapsedDays: 28 },
    });
  });

  it("does not fabricate a closing observation for a month without snapshots", () => {
    const result = buildMonthlyReview(reviewHistory, "2026-08");

    expect(result.opening.status).toBe("AVAILABLE");
    expect(result.closing.status).toBe("INSUFFICIENT_DATA");
    expect(result.change.status).toBe("INSUFFICIENT_DATA");
  });

  it("reports a first monthly ATH, milestone crossings, and goal progress movement", () => {
    const result = buildMonthlyReview(
      reviewHistory,
      "2026-01",
      { id: "goal", name: "First target", targetAmount: 10000 },
      [8500, 9000, 10000],
    );

    expect(result.allTimeHighReached).toEqual({
      status: "AVAILABLE",
      basis: "DERIVED",
      value: { amount: 9000, date: "2026-01-31T12:00:00.000Z" },
    });
    expect(result.milestonesFirstReached).toEqual([
      { amount: 8500, date: "2026-01-15T12:00:00.000Z" },
      { amount: 9000, date: "2026-01-31T12:00:00.000Z" },
    ]);
    expect(result.goalProgressMovement).toEqual({
      status: "AVAILABLE",
      basis: "DERIVED",
      value: { fromPercentage: 80, toPercentage: 90, differencePercentage: 10 },
    });
  });

  it("marks historical allocation fields not applicable without immutable category metadata", () => {
    const result = buildMonthlyReview(reviewHistory, "2026-07");

    for (const metric of [
      result.categoryAllocation.opening,
      result.categoryAllocation.closing,
      result.categoryAllocation.movement,
    ]) {
      expect(metric).toMatchObject({
        status: "NOT_APPLICABLE",
        basis: "DERIVED",
        reason: expect.stringContaining("immutable category metadata"),
      });
    }
    expect(result.paceComparison.status).toBe("AVAILABLE");
  });
});
