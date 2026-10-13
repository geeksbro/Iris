import { roundCurrency } from "./calculations";
import type { WealthSnapshot } from "./types";
import type { WealthGoal } from "./types";

export type MetricBasis = "OBSERVED" | "DERIVED" | "SIMULATED";

export type Metric<T> =
  | { status: "AVAILABLE"; value: T; basis: MetricBasis }
  | { status: "INSUFFICIENT_DATA"; reason: string; basis: "DERIVED" }
  | { status: "NOT_APPLICABLE"; reason: string; basis: "DERIVED" | "SIMULATED" };

export type ObservedPoint = {
  amount: number;
  date: string;
};

export type ObservedPeriodChange = {
  amount: number;
  percentage: number | null;
  from: string;
  to: string;
  elapsedDays: number;
};

export type PaceValue = {
  amountPerMonth: number;
  from: string;
  to: string;
  elapsedDays: number;
};

export type AccelerationValue = {
  recentAmountPerMonth: number;
  previousAmountPerMonth: number;
  differencePerMonth: number;
  direction: "ACCELERATING" | "DECELERATING" | "STEADY";
};

export type AllTimeHighValue = {
  amount: number;
  date: string;
  distanceAmount: number;
  distancePercentage: number | null;
};

export type WealthTrajectory = {
  current: Metric<ObservedPoint>;
  changes: {
    days30: Metric<ObservedPeriodChange>;
    days90: Metric<ObservedPeriodChange>;
    days180: Metric<ObservedPeriodChange>;
    ytd: Metric<ObservedPeriodChange>;
  };
  averageMonthlyPace: Metric<PaceValue>;
  recentMonthlyPace: Metric<PaceValue>;
  acceleration: Metric<AccelerationValue>;
  allTimeHigh: Metric<AllTimeHighValue>;
  bestPeriod: Metric<ObservedPeriodChange>;
  worstPeriod: Metric<ObservedPeriodChange>;
};

export type GoalAnalysis = {
  currentAmount: number;
  remainingAmount: number;
  percentageCompleted: number;
  observedMonthlyPace: Metric<PaceValue>;
  estimatedTarget: Metric<{ months: number; date: string }>;
  requiredMonthlyPace: Metric<number>;
  paceGap: Metric<number>;
};

export type MilestoneStatus = "CURRENTLY_ABOVE" | "PREVIOUSLY_REACHED" | "NOT_YET_REACHED";

export type WealthMilestone = {
  amount: number;
  status: MilestoneStatus;
  firstReachedDate: string | null;
  currentDistance: number;
  daysFromPreviousReachedMilestone: number | null;
};

export type MilestoneAnalysis = {
  milestones: WealthMilestone[];
  nextMilestone: Metric<{
    amount: number;
    distance: number;
    progressPercentage: number;
    previousAmount: number;
  }>;
};

export type MonthlyReview = {
  month: string;
  opening: Metric<ObservedPoint>;
  closing: Metric<ObservedPoint>;
  change: Metric<ObservedPeriodChange>;
  allTimeHighReached: Metric<ObservedPoint>;
  milestonesFirstReached: Array<{ amount: number; date: string }>;
  goalProgressMovement: Metric<{
    fromPercentage: number;
    toPercentage: number;
    differencePercentage: number;
  }>;
  paceComparison: Metric<AccelerationValue>;
  categoryAllocation: {
    opening: Metric<never>;
    closing: Metric<never>;
    movement: Metric<never>;
  };
};

const DAY_MS = 24 * 60 * 60 * 1000;
const AVERAGE_MONTH_DAYS = 365.2425 / 12;
const MINIMUM_PACE_DAYS = 60;

function insufficient<T>(reason: string): Metric<T> {
  return { status: "INSUFFICIENT_DATA", reason, basis: "DERIVED" };
}

function notApplicable<T>(reason: string, basis: "DERIVED" | "SIMULATED" = "DERIVED"): Metric<T> {
  return { status: "NOT_APPLICABLE", reason, basis };
}

function available<T>(value: T, basis: MetricBasis = "DERIVED"): Metric<T> {
  return { status: "AVAILABLE", value, basis };
}

function timestamp(value: string): number {
  return new Date(value).getTime();
}

function elapsedDays(from: WealthSnapshot, to: WealthSnapshot): number {
  return Math.round((timestamp(to.createdAt) - timestamp(from.createdAt)) / DAY_MS);
}

function normalizedHistory(
  snapshots: ReadonlyArray<WealthSnapshot>,
  referenceDate: Date | string,
): WealthSnapshot[] {
  const referenceTime = new Date(referenceDate).getTime();
  if (!Number.isFinite(referenceTime)) return [];

  return snapshots
    .filter((item) => (
      Number.isFinite(item.totalWealth) &&
      Number.isFinite(timestamp(item.createdAt)) &&
      timestamp(item.createdAt) <= referenceTime
    ))
    .sort((first, second) => timestamp(first.createdAt) - timestamp(second.createdAt));
}

function changeBetween(from: WealthSnapshot, to: WealthSnapshot): ObservedPeriodChange {
  const amount = roundCurrency(to.totalWealth - from.totalWealth);
  return {
    amount,
    percentage: from.totalWealth === 0 ? null : (amount / from.totalWealth) * 100,
    from: from.createdAt,
    to: to.createdAt,
    elapsedDays: elapsedDays(from, to),
  };
}

function nearestObservedBaseline(
  history: ReadonlyArray<WealthSnapshot>,
  targetTime: number,
  toleranceDays: number,
): WealthSnapshot | undefined {
  const toleranceMs = toleranceDays * DAY_MS;
  return history.reduce<WealthSnapshot | undefined>((nearest, item) => {
    const distance = Math.abs(timestamp(item.createdAt) - targetTime);
    if (distance > toleranceMs) return nearest;
    if (!nearest) return item;
    return distance < Math.abs(timestamp(nearest.createdAt) - targetTime) ? item : nearest;
  }, undefined);
}

function periodChange(
  history: ReadonlyArray<WealthSnapshot>,
  windowDays: number,
): Metric<ObservedPeriodChange> {
  const current = history.at(-1);
  if (!current || history.length < 2) {
    return insufficient(`A ${windowDays}-day change needs another observed snapshot.`);
  }

  const toleranceDays = Math.max(7, Math.round(windowDays * 0.2));
  const targetTime = timestamp(current.createdAt) - windowDays * DAY_MS;
  const baseline = nearestObservedBaseline(history.slice(0, -1), targetTime, toleranceDays);
  if (!baseline) {
    return insufficient(`No observed snapshot is close enough to the ${windowDays}-day baseline.`);
  }

  return available(changeBetween(baseline, current));
}

function yearToDateChange(history: ReadonlyArray<WealthSnapshot>): Metric<ObservedPeriodChange> {
  const current = history.at(-1);
  if (!current || history.length < 2) {
    return insufficient("Year-to-date change needs another observed snapshot.");
  }

  const currentDate = new Date(current.createdAt);
  const yearStart = Date.UTC(currentDate.getUTCFullYear(), 0, 1, 0, 0, 0, 0);
  const baseline = nearestObservedBaseline(history.slice(0, -1), yearStart, 31);
  if (!baseline) {
    return insufficient("No observed snapshot is close enough to the start of the year.");
  }

  return available(changeBetween(baseline, current));
}

function paceBetween(from: WealthSnapshot, to: WealthSnapshot): Metric<PaceValue> {
  const days = elapsedDays(from, to);
  if (days < MINIMUM_PACE_DAYS) {
    return insufficient(`Observed pace needs at least ${MINIMUM_PACE_DAYS} days of history.`);
  }

  return available({
    amountPerMonth: roundCurrency(((to.totalWealth - from.totalWealth) / days) * AVERAGE_MONTH_DAYS),
    from: from.createdAt,
    to: to.createdAt,
    elapsedDays: days,
  });
}

function averagePace(history: ReadonlyArray<WealthSnapshot>): Metric<PaceValue> {
  if (history.length < 3) {
    return insufficient("Average monthly pace needs at least three observed snapshots.");
  }
  return paceBetween(history[0], history[history.length - 1]);
}

function paceWindows(history: ReadonlyArray<WealthSnapshot>): {
  recent: Metric<PaceValue>;
  acceleration: Metric<AccelerationValue>;
} {
  const current = history.at(-1);
  if (!current) {
    return {
      recent: insufficient("Recent pace needs observed history."),
      acceleration: insufficient("Acceleration needs two comparable observed periods."),
    };
  }

  const currentTime = timestamp(current.createdAt);
  const recentBaseline = nearestObservedBaseline(history.slice(0, -1), currentTime - 90 * DAY_MS, 18);
  if (!recentBaseline) {
    return {
      recent: insufficient("Recent pace needs an observed baseline near 90 days ago."),
      acceleration: insufficient("Acceleration needs two comparable observed periods."),
    };
  }

  const recent = paceBetween(recentBaseline, current);
  const previousBaseline = nearestObservedBaseline(
    history.filter((item) => timestamp(item.createdAt) < timestamp(recentBaseline.createdAt)),
    currentTime - 180 * DAY_MS,
    36,
  );
  if (recent.status !== "AVAILABLE" || !previousBaseline) {
    return {
      recent,
      acceleration: insufficient("Acceleration needs two non-overlapping observed periods of at least 60 days."),
    };
  }

  const previous = paceBetween(previousBaseline, recentBaseline);
  if (previous.status !== "AVAILABLE") {
    return {
      recent,
      acceleration: insufficient("Acceleration needs two non-overlapping observed periods of at least 60 days."),
    };
  }

  const differencePerMonth = roundCurrency(
    recent.value.amountPerMonth - previous.value.amountPerMonth,
  );
  const direction = differencePerMonth > 0
    ? "ACCELERATING"
    : differencePerMonth < 0
      ? "DECELERATING"
      : "STEADY";

  return {
    recent,
    acceleration: available({
      recentAmountPerMonth: recent.value.amountPerMonth,
      previousAmountPerMonth: previous.value.amountPerMonth,
      differencePerMonth,
      direction,
    }),
  };
}

function allTimeHigh(history: ReadonlyArray<WealthSnapshot>): Metric<AllTimeHighValue> {
  const current = history.at(-1);
  if (!current) return insufficient("An all-time high needs an observed snapshot.");

  const high = history.reduce((highest, item) => (
    item.totalWealth > highest.totalWealth ? item : highest
  ));
  const distanceAmount = roundCurrency(Math.max(0, high.totalWealth - current.totalWealth));
  return available({
    amount: high.totalWealth,
    date: high.createdAt,
    distanceAmount,
    distancePercentage: high.totalWealth === 0 ? null : (distanceAmount / high.totalWealth) * 100,
  });
}

function extremaPeriods(history: ReadonlyArray<WealthSnapshot>): {
  best: Metric<ObservedPeriodChange>;
  worst: Metric<ObservedPeriodChange>;
} {
  if (history.length < 2) {
    return {
      best: insufficient("A best period needs two observed snapshots."),
      worst: insufficient("A worst period needs two observed snapshots."),
    };
  }

  const periods = history.slice(1).map((item, index) => changeBetween(history[index], item));
  return {
    best: available(periods.reduce((best, item) => item.amount > best.amount ? item : best)),
    worst: available(periods.reduce((worst, item) => item.amount < worst.amount ? item : worst)),
  };
}

export function analyzeWealthTrajectory(
  snapshots: ReadonlyArray<WealthSnapshot>,
  referenceDate: Date | string = new Date(),
): WealthTrajectory {
  const history = normalizedHistory(snapshots, referenceDate);
  const current = history.at(-1);
  const pace = paceWindows(history);
  const extrema = extremaPeriods(history);

  return {
    current: current
      ? available({ amount: current.totalWealth, date: current.createdAt }, "OBSERVED")
      : insufficient("Current trajectory needs an observed snapshot."),
    changes: {
      days30: periodChange(history, 30),
      days90: periodChange(history, 90),
      days180: periodChange(history, 180),
      ytd: yearToDateChange(history),
    },
    averageMonthlyPace: averagePace(history),
    recentMonthlyPace: pace.recent,
    acceleration: pace.acceleration,
    allTimeHigh: allTimeHigh(history),
    bestPeriod: extrema.best,
    worstPeriod: extrema.worst,
  };
}

function parseCalendarDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCFullYear() === Number(match[1]) &&
    date.getUTCMonth() === Number(match[2]) - 1 &&
    date.getUTCDate() === Number(match[3])
    ? date
    : null;
}

function formatCalendarDate(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function addCalendarMonths(value: string, months: number): string | null {
  const source = parseCalendarDate(value);
  if (!source) return null;
  const originalDay = source.getUTCDate();
  const result = new Date(source);
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(originalDay, lastDay));
  return formatCalendarDate(result);
}

function calendarMonthsBetween(fromValue: string, toValue: string): number | null {
  const from = parseCalendarDate(fromValue);
  const to = parseCalendarDate(toValue);
  if (!from || !to || to.getTime() <= from.getTime()) return null;
  const wholeMonths = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 +
    (to.getUTCMonth() - from.getUTCMonth());
  const dayFraction = (to.getUTCDate() - from.getUTCDate()) /
    new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() + 1, 0)).getUTCDate();
  return wholeMonths + dayFraction;
}

export function analyzeGoal(
  goal: WealthGoal,
  currentAmount: number,
  observedMonthlyPace: Metric<PaceValue>,
  referenceDate: string,
): GoalAnalysis {
  const remainingAmount = roundCurrency(Math.max(0, goal.targetAmount - currentAmount));
  const percentageCompleted = goal.targetAmount <= 0
    ? 0
    : Math.max(0, Math.min(100, (currentAmount / goal.targetAmount) * 100));

  let estimatedTarget: GoalAnalysis["estimatedTarget"];
  if (remainingAmount === 0) {
    estimatedTarget = notApplicable("Target already reached.");
  } else if (observedMonthlyPace.status !== "AVAILABLE") {
    estimatedTarget = observedMonthlyPace.status === "INSUFFICIENT_DATA"
      ? insufficient(observedMonthlyPace.reason)
      : notApplicable(observedMonthlyPace.reason);
  } else if (observedMonthlyPace.value.amountPerMonth <= 0) {
    estimatedTarget = notApplicable("Observed pace must be positive to estimate a target date.");
  } else {
    const months = Math.ceil(remainingAmount / observedMonthlyPace.value.amountPerMonth);
    const date = addCalendarMonths(referenceDate, months);
    estimatedTarget = date
      ? available({ months, date })
      : insufficient("A valid reference date is required for a target estimate.");
  }

  let requiredMonthlyPace: GoalAnalysis["requiredMonthlyPace"];
  if (!goal.targetDate) {
    requiredMonthlyPace = notApplicable("Add a target date to calculate the required monthly pace.");
  } else if (remainingAmount === 0) {
    requiredMonthlyPace = notApplicable("Target already reached.");
  } else {
    const months = calendarMonthsBetween(referenceDate, goal.targetDate);
    requiredMonthlyPace = months && months > 0
      ? available(roundCurrency(remainingAmount / months))
      : notApplicable("Target date must be after the reference date.");
  }

  let paceGap: GoalAnalysis["paceGap"];
  if (requiredMonthlyPace.status !== "AVAILABLE") {
    paceGap = requiredMonthlyPace.status === "INSUFFICIENT_DATA"
      ? insufficient(requiredMonthlyPace.reason)
      : notApplicable(requiredMonthlyPace.reason);
  } else if (observedMonthlyPace.status !== "AVAILABLE") {
    paceGap = observedMonthlyPace.status === "INSUFFICIENT_DATA"
      ? insufficient(observedMonthlyPace.reason)
      : notApplicable(observedMonthlyPace.reason);
  } else {
    paceGap = available(roundCurrency(
      observedMonthlyPace.value.amountPerMonth - requiredMonthlyPace.value,
    ));
  }

  return {
    currentAmount,
    remainingAmount,
    percentageCompleted,
    observedMonthlyPace,
    estimatedTarget,
    requiredMonthlyPace,
    paceGap,
  };
}

export function analyzeMilestones(
  snapshots: ReadonlyArray<WealthSnapshot>,
  currentWealth: number,
  configuredAmounts: ReadonlyArray<number>,
): MilestoneAnalysis {
  const history = snapshots
    .filter((item) => Number.isFinite(item.totalWealth) && Number.isFinite(timestamp(item.createdAt)))
    .sort((first, second) => timestamp(first.createdAt) - timestamp(second.createdAt));
  const amounts = [...new Set(configuredAmounts)]
    .filter((amount) => Number.isFinite(amount) && amount > 0)
    .sort((first, second) => first - second);

  const milestones: WealthMilestone[] = amounts.map((amount, index) => {
    const firstReached = history.find((item) => item.totalWealth >= amount);
    const previousAmount = amounts[index - 1];
    const previousReached = previousAmount === undefined
      ? undefined
      : history.find((item) => item.totalWealth >= previousAmount);
    const status: MilestoneStatus = currentWealth >= amount
      ? "CURRENTLY_ABOVE"
      : firstReached
        ? "PREVIOUSLY_REACHED"
        : "NOT_YET_REACHED";

    return {
      amount,
      status,
      firstReachedDate: firstReached?.createdAt ?? null,
      currentDistance: roundCurrency(Math.max(0, amount - currentWealth)),
      daysFromPreviousReachedMilestone: firstReached && previousReached
        ? Math.round((timestamp(firstReached.createdAt) - timestamp(previousReached.createdAt)) / DAY_MS)
        : null,
    };
  });

  const nextIndex = milestones.findIndex((item) => item.status === "NOT_YET_REACHED");
  if (nextIndex === -1) {
    return {
      milestones,
      nextMilestone: notApplicable("Every configured milestone has already been reached."),
    };
  }

  const next = milestones[nextIndex];
  const previousAmount = amounts[nextIndex - 1] ?? 0;
  const progressPercentage = next.amount <= 0
    ? 0
    : Math.max(0, Math.min(100, (currentWealth / next.amount) * 100));

  return {
    milestones,
    nextMilestone: available({
      amount: next.amount,
      distance: next.currentDistance,
      progressPercentage,
      previousAmount,
    }),
  };
}

function monthBounds(month: string): { start: number; end: number } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return null;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  if (monthIndex < 0 || monthIndex > 11) return null;
  return {
    start: Date.UTC(year, monthIndex, 1),
    end: Date.UTC(year, monthIndex + 1, 1),
  };
}

function observedPoint(item: WealthSnapshot): Metric<ObservedPoint> {
  return available({ amount: item.totalWealth, date: item.createdAt }, "OBSERVED");
}

function goalCompletion(amount: number, targetAmount: number): number {
  if (targetAmount <= 0) return 0;
  return Math.max(0, Math.min(100, (amount / targetAmount) * 100));
}

export function buildMonthlyReview(
  snapshots: ReadonlyArray<WealthSnapshot>,
  month: string,
  goal?: WealthGoal,
  configuredMilestones: ReadonlyArray<number> = [],
): MonthlyReview {
  const bounds = monthBounds(month);
  const allocationReason = "Historical snapshots lack immutable category metadata, so allocation cannot be reconstructed honestly.";
  const unavailableAllocation = {
    opening: notApplicable<never>(allocationReason),
    closing: notApplicable<never>(allocationReason),
    movement: notApplicable<never>(allocationReason),
  };

  if (!bounds) {
    const reason = "Monthly review needs a valid YYYY-MM month.";
    return {
      month,
      opening: insufficient(reason),
      closing: insufficient(reason),
      change: insufficient(reason),
      allTimeHighReached: insufficient(reason),
      milestonesFirstReached: [],
      goalProgressMovement: insufficient(reason),
      paceComparison: insufficient(reason),
      categoryAllocation: unavailableAllocation,
    };
  }

  const history = snapshots
    .filter((item) => Number.isFinite(item.totalWealth) && Number.isFinite(timestamp(item.createdAt)))
    .sort((first, second) => timestamp(first.createdAt) - timestamp(second.createdAt));
  const openingSnapshot = history.filter((item) => timestamp(item.createdAt) < bounds.start).at(-1);
  const observationsInMonth = history.filter((item) => {
    const time = timestamp(item.createdAt);
    return time >= bounds.start && time < bounds.end;
  });
  const closingSnapshot = observationsInMonth.at(-1);
  const opening = openingSnapshot
    ? observedPoint(openingSnapshot)
    : insufficient<ObservedPoint>("No observed snapshot exists before this month.");
  const closing = closingSnapshot
    ? observedPoint(closingSnapshot)
    : insufficient<ObservedPoint>("No observed snapshot exists inside this month.");
  const change = openingSnapshot && closingSnapshot
    ? available(changeBetween(openingSnapshot, closingSnapshot))
    : insufficient<ObservedPeriodChange>("Monthly change needs observed opening and closing snapshots.");

  let allTimeHighReached: MonthlyReview["allTimeHighReached"];
  if (!closingSnapshot) {
    allTimeHighReached = insufficient("A monthly ATH needs an observed closing snapshot.");
  } else {
    const throughClosing = history.filter((item) => timestamp(item.createdAt) <= timestamp(closingSnapshot.createdAt));
    const maximum = Math.max(...throughClosing.map((item) => item.totalWealth));
    const firstMaximum = throughClosing.find((item) => item.totalWealth === maximum);
    allTimeHighReached = firstMaximum && timestamp(firstMaximum.createdAt) >= bounds.start
      ? available({ amount: firstMaximum.totalWealth, date: firstMaximum.createdAt })
      : notApplicable("No new all-time high was first observed in this month.");
  }

  const milestonesFirstReached = closingSnapshot
    ? [...new Set(configuredMilestones)]
      .filter((amount) => Number.isFinite(amount) && amount > 0)
      .sort((first, second) => first - second)
      .flatMap((amount) => {
        const firstReached = history.find((item) => (
          timestamp(item.createdAt) <= timestamp(closingSnapshot.createdAt) && item.totalWealth >= amount
        ));
        return firstReached && timestamp(firstReached.createdAt) >= bounds.start
          ? [{ amount, date: firstReached.createdAt }]
          : [];
      })
    : [];

  let goalProgressMovement: MonthlyReview["goalProgressMovement"];
  if (!goal) {
    goalProgressMovement = notApplicable("No Goal is configured for this review.");
  } else if (goal.type === "liquidity") {
    goalProgressMovement = notApplicable("Historical liquidity is unavailable because snapshots lack immutable category metadata.");
  } else if (!openingSnapshot || !closingSnapshot) {
    goalProgressMovement = insufficient("Goal progress movement needs observed opening and closing snapshots.");
  } else {
    const fromPercentage = goalCompletion(openingSnapshot.totalWealth, goal.targetAmount);
    const toPercentage = goalCompletion(closingSnapshot.totalWealth, goal.targetAmount);
    goalProgressMovement = available({
      fromPercentage,
      toPercentage,
      differencePercentage: toPercentage - fromPercentage,
    });
  }

  const trajectory = closingSnapshot
    ? analyzeWealthTrajectory(history, closingSnapshot.createdAt)
    : null;

  return {
    month,
    opening,
    closing,
    change,
    allTimeHighReached,
    milestonesFirstReached,
    goalProgressMovement,
    paceComparison: trajectory?.acceleration ?? insufficient("Pace comparison needs an observed closing snapshot."),
    categoryAllocation: unavailableAllocation,
  };
}
