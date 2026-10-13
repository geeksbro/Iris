import { roundCurrency } from "./calculations";
import type { Metric } from "./wealth-progress";

export type ScenarioInput = {
  startingWealth: number;
  oneTimeAdjustment: number;
  monthlyContribution: number;
  horizonMonths: number;
  startDate: string;
  targetAmount?: number;
  targetDate?: string;
};

export type ScenarioPoint = {
  month: number;
  date: string;
  wealth: number;
  basis: "SIMULATED";
};

export type ScenarioResult = {
  basis: "SIMULATED";
  observedStartingWealth: number;
  simulatedStartingWealth: number;
  points: ScenarioPoint[];
  targetEstimate: Metric<{ months: number; date: string }>;
  requiredMonthlyContribution: Metric<number>;
  wealthAtHorizon: number;
  differenceAgainstBaseline: number;
};

export type DecisionComparisonInput = {
  startingWealth: number;
  baselineMonthlyContribution: number;
  decisionOneTimeAdjustment: number;
  decisionMonthlyContribution: number;
  horizonMonths: number;
  startDate: string;
  targetAmount?: number;
  targetDate?: string;
};

export type TargetImpactStatus =
  | "DELAYED"
  | "ACCELERATED"
  | "UNCHANGED"
  | "NOT_APPLICABLE"
  | "UNREACHABLE";

export type TargetImpact = {
  status: TargetImpactStatus;
  basis: "SIMULATED";
  monthsDifference: number | null;
  baselineMonths: number | null;
  decisionMonths: number | null;
  reason: string;
};

export type DecisionComparisonResult = {
  basis: "SIMULATED";
  baseline: ScenarioResult;
  decision: ScenarioResult;
  wealthImpactAtHorizon: number;
  targetImpact: TargetImpact;
  recoveryPoint: Metric<{ months: number; date: string }>;
  compensation: Metric<{
    monthlyContribution: number;
    increaseOverBaseline: number;
    baselineTargetMonths: number;
  }>;
};

function parseCalendarDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month && date.getUTCDate() === day
    ? date
    : null;
}

function formatCalendarDate(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function addMonthsFromOrigin(origin: Date, months: number): string {
  const result = new Date(origin);
  const originalDay = origin.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(origin.getUTCMonth() + months);
  const finalDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(originalDay, finalDay));
  return formatCalendarDate(result);
}

function calendarMonthsBetween(from: Date, to: Date): number | null {
  if (to.getTime() <= from.getTime()) return null;
  const wholeMonths = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 +
    (to.getUTCMonth() - from.getUTCMonth());
  const dayFraction = (to.getUTCDate() - from.getUTCDate()) /
    new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() + 1, 0)).getUTCDate();
  return wholeMonths + dayFraction;
}

function simulatedAvailable<T>(value: T): Metric<T> {
  return { status: "AVAILABLE", basis: "SIMULATED", value };
}

function simulatedNotApplicable<T>(reason: string): Metric<T> {
  return { status: "NOT_APPLICABLE", basis: "SIMULATED", reason };
}

function assertScenarioInput(input: ScenarioInput): Date {
  if (
    !Number.isFinite(input.startingWealth) || input.startingWealth < 0 ||
    !Number.isFinite(input.oneTimeAdjustment) ||
    !Number.isFinite(input.monthlyContribution) ||
    !Number.isInteger(input.horizonMonths) || input.horizonMonths < 0 || input.horizonMonths > 600
  ) {
    throw new Error("Scenario amounts must be finite and horizon must be an integer between 0 and 600 months");
  }
  const start = parseCalendarDate(input.startDate);
  if (!start) throw new Error("Scenario start date must be a real calendar date");
  if (input.targetAmount !== undefined && (!Number.isFinite(input.targetAmount) || input.targetAmount <= 0)) {
    throw new Error("Scenario target must be a positive finite amount");
  }
  if (input.targetDate !== undefined && !parseCalendarDate(input.targetDate)) {
    throw new Error("Scenario target date must be a real calendar date");
  }
  return start;
}

export function simulateWealthScenario(input: ScenarioInput): ScenarioResult {
  const start = assertScenarioInput(input);
  const simulatedStartingWealth = roundCurrency(Math.max(0, input.startingWealth + input.oneTimeAdjustment));
  const points = Array.from({ length: input.horizonMonths + 1 }, (_, month): ScenarioPoint => ({
    month,
    date: addMonthsFromOrigin(start, month),
    wealth: roundCurrency(Math.max(0, simulatedStartingWealth + input.monthlyContribution * month)),
    basis: "SIMULATED",
  }));
  const wealthAtHorizon = points[points.length - 1].wealth;

  let targetEstimate: ScenarioResult["targetEstimate"];
  if (input.targetAmount === undefined) {
    targetEstimate = simulatedNotApplicable("Add a target amount to estimate a target date.");
  } else if (simulatedStartingWealth >= input.targetAmount) {
    targetEstimate = simulatedAvailable({ months: 0, date: input.startDate });
  } else if (input.monthlyContribution <= 0) {
    targetEstimate = simulatedNotApplicable(
      "A positive monthly contribution is required to reach a higher target in this scenario.",
    );
  } else {
    const months = Math.ceil((input.targetAmount - simulatedStartingWealth) / input.monthlyContribution);
    targetEstimate = simulatedAvailable({ months, date: addMonthsFromOrigin(start, months) });
  }

  let requiredMonthlyContribution: ScenarioResult["requiredMonthlyContribution"];
  if (input.targetAmount === undefined || input.targetDate === undefined) {
    requiredMonthlyContribution = simulatedNotApplicable(
      "Add both target amount and target date to calculate a required contribution.",
    );
  } else if (simulatedStartingWealth >= input.targetAmount) {
    requiredMonthlyContribution = simulatedNotApplicable("Target is already reached in this scenario.");
  } else {
    const targetDate = parseCalendarDate(input.targetDate);
    const months = targetDate ? calendarMonthsBetween(start, targetDate) : null;
    requiredMonthlyContribution = months && months > 0
      ? simulatedAvailable(roundCurrency((input.targetAmount - simulatedStartingWealth) / months))
      : simulatedNotApplicable("Target date must be after the scenario start date.");
  }

  return {
    basis: "SIMULATED",
    observedStartingWealth: input.startingWealth,
    simulatedStartingWealth,
    points,
    targetEstimate,
    requiredMonthlyContribution,
    wealthAtHorizon,
    differenceAgainstBaseline: roundCurrency(wealthAtHorizon - input.startingWealth),
  };
}

function targetMonths(result: ScenarioResult): number | null {
  return result.targetEstimate.status === "AVAILABLE" ? result.targetEstimate.value.months : null;
}

function compareTargetTiming(
  targetAmount: number | undefined,
  baseline: ScenarioResult,
  decision: ScenarioResult,
): TargetImpact {
  if (targetAmount === undefined) {
    return {
      status: "NOT_APPLICABLE",
      basis: "SIMULATED",
      monthsDifference: null,
      baselineMonths: null,
      decisionMonths: null,
      reason: "Add a target amount to compare target timing.",
    };
  }

  const baselineMonths = targetMonths(baseline);
  const decisionMonths = targetMonths(decision);
  if (baselineMonths === null && decisionMonths === null) {
    return {
      status: "UNREACHABLE",
      basis: "SIMULATED",
      monthsDifference: null,
      baselineMonths,
      decisionMonths,
      reason: "Neither path reaches the target under the selected monthly paces.",
    };
  }
  if (baselineMonths === null && decisionMonths !== null) {
    return {
      status: "ACCELERATED",
      basis: "SIMULATED",
      monthsDifference: null,
      baselineMonths,
      decisionMonths,
      reason: "The decision makes the target reachable while the baseline without decision does not.",
    };
  }
  if (baselineMonths !== null && decisionMonths === null) {
    return {
      status: "UNREACHABLE",
      basis: "SIMULATED",
      monthsDifference: null,
      baselineMonths,
      decisionMonths,
      reason: "The decision path does not reach a target that the baseline without decision reaches.",
    };
  }

  const monthsDifference = (decisionMonths as number) - (baselineMonths as number);
  return {
    status: monthsDifference > 0 ? "DELAYED" : monthsDifference < 0 ? "ACCELERATED" : "UNCHANGED",
    basis: "SIMULATED",
    monthsDifference,
    baselineMonths,
    decisionMonths,
    reason: monthsDifference > 0
      ? `The decision reaches the target ${monthsDifference} months later than the baseline without decision.`
      : monthsDifference < 0
        ? `The decision reaches the target ${Math.abs(monthsDifference)} months earlier than the baseline without decision.`
        : "The decision does not change the simulated target month.",
  };
}

function calculateRecoveryPoint(
  input: DecisionComparisonInput,
  baseline: ScenarioResult,
  decision: ScenarioResult,
): Metric<{ months: number; date: string }> {
  if (decision.simulatedStartingWealth >= baseline.simulatedStartingWealth) {
    return simulatedNotApplicable("The decision does not start below the baseline without decision.");
  }

  const start = parseCalendarDate(input.startDate);
  if (!start) return simulatedNotApplicable("Recovery requires a valid scenario start date.");

  for (let month = 1; month <= 600; month += 1) {
    const baselineWealth = roundCurrency(Math.max(
      0,
      baseline.simulatedStartingWealth + input.baselineMonthlyContribution * month,
    ));
    const decisionWealth = roundCurrency(Math.max(
      0,
      decision.simulatedStartingWealth + input.decisionMonthlyContribution * month,
    ));
    if (decisionWealth >= baselineWealth) {
      return simulatedAvailable({ months: month, date: addMonthsFromOrigin(start, month) });
    }
  }

  return simulatedNotApplicable("The decision does not recover within the 600-month model limit.");
}

function calculateCompensation(
  input: DecisionComparisonInput,
  baseline: ScenarioResult,
  decision: ScenarioResult,
): DecisionComparisonResult["compensation"] {
  if (input.targetAmount === undefined) {
    return simulatedNotApplicable("Add a target amount to calculate a compensation pace.");
  }
  if (baseline.targetEstimate.status !== "AVAILABLE") {
    return simulatedNotApplicable("The baseline without decision must reach the target to calculate compensation.");
  }
  const baselineTargetMonths = baseline.targetEstimate.value.months;
  if (baselineTargetMonths === 0 || decision.simulatedStartingWealth >= input.targetAmount) {
    return simulatedNotApplicable("Compensation is unnecessary because the target is already reached.");
  }

  const monthlyContribution = roundCurrency(
    (input.targetAmount - decision.simulatedStartingWealth) / baselineTargetMonths,
  );
  return simulatedAvailable({
    monthlyContribution,
    increaseOverBaseline: roundCurrency(monthlyContribution - input.baselineMonthlyContribution),
    baselineTargetMonths,
  });
}

export function compareDecisionScenario(input: DecisionComparisonInput): DecisionComparisonResult {
  const shared = {
    startingWealth: input.startingWealth,
    horizonMonths: input.horizonMonths,
    startDate: input.startDate,
    targetAmount: input.targetAmount,
    targetDate: input.targetDate,
  };
  const baseline = simulateWealthScenario({
    ...shared,
    oneTimeAdjustment: 0,
    monthlyContribution: input.baselineMonthlyContribution,
  });
  const decision = simulateWealthScenario({
    ...shared,
    oneTimeAdjustment: input.decisionOneTimeAdjustment,
    monthlyContribution: input.decisionMonthlyContribution,
  });

  return {
    basis: "SIMULATED",
    baseline,
    decision,
    wealthImpactAtHorizon: roundCurrency(decision.wealthAtHorizon - baseline.wealthAtHorizon),
    targetImpact: compareTargetTiming(input.targetAmount, baseline, decision),
    recoveryPoint: calculateRecoveryPoint(input, baseline, decision),
    compensation: calculateCompensation(input, baseline, decision),
  };
}
