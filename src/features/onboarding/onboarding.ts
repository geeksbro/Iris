"use client";

import { onboarding, onboardingTourVersion, type OnboardingRecord } from "@/features/settings/preferences";

/*
 * The tour's record on this device (the preference itself, its shape and why
 * absence is not "new", are in settings/preferences.ts). Three moments write
 * it, and nothing else does:
 *
 * - the first PIN is created on this device: "not-started", unless the device
 *   already holds a decision (its IndexedDB was cleared but not its
 *   localStorage — the owner's choice still stands);
 * - a tour is finished: "completed";
 * - a tour is skipped: "skipped" — except over an earlier completion, which a
 *   skipped re-run from Settings never undoes.
 *
 * Only "not-started" opens the tour by itself. A tour interrupted by the lock
 * writes nothing, so a first run that was cut short is offered again at the
 * next unlock.
 */

export type TourOutcome = "completed" | "skipped";

/** The first PIN was just created here: this device is new to IRIS. */
export function markOnboardingFirstRun(now: Date = new Date()): void {
  if (onboarding.get() !== null) return;
  onboarding.set({ version: onboardingTourVersion, status: "not-started", firstRunAt: now.toISOString() });
}

/** Whether the tour opens by itself: only a first run that has not decided yet. */
export function shouldStartOnboarding(record: OnboardingRecord | null): boolean {
  return record?.status === "not-started";
}

export function settleOnboarding(outcome: TourOutcome, now: Date = new Date()): void {
  const current = onboarding.get();
  if (outcome === "skipped" && current?.status === "completed") return;
  onboarding.set({
    version: onboardingTourVersion,
    status: outcome,
    ...(current?.firstRunAt ? { firstRunAt: current.firstRunAt } : {}),
    decidedAt: now.toISOString(),
  });
}
