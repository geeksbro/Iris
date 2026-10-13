"use client";

import { createStoredValue } from "@/features/settings/preferences";

/*
 * The last access on this device, for the lock screen's right-hand leaf
 * (owner, 10 Oct 2026, from the Trading OS lock screen): when the PIN was
 * last accepted here, and how many wrong PINs were typed since.
 *
 * It is a courtesy, not a security record: the PIN itself never comes near
 * it, it holds no financial data, and it lives in localStorage beside the
 * other things the lock screen reads before anything is unlocked. A wrong PIN
 * counts up; an accepted one stamps the time and starts the count again.
 */

export type AccessRecord = { at: string | null; wrongSince: number };

const empty: AccessRecord = { at: null, wrongSince: 0 };

export const accessRecord = createStoredValue<AccessRecord>(
  "wealth-last-access",
  empty,
  (stored) => {
    try {
      const value = JSON.parse(stored) as Partial<AccessRecord>;
      const at = typeof value.at === "string" && !Number.isNaN(Date.parse(value.at)) ? value.at : null;
      const wrongSince = Number.isInteger(value.wrongSince) && (value.wrongSince as number) >= 0 ? value.wrongSince as number : 0;
      return { at, wrongSince };
    } catch {
      return undefined;
    }
  },
  (value) => JSON.stringify(value),
);

/** A PIN was accepted on this device, now. */
export function recordAccess(now = new Date()): void {
  accessRecord.set({ at: now.toISOString(), wrongSince: 0 });
}

/** A wrong PIN was typed on this device. */
export function recordWrongPin(): void {
  const current = accessRecord.get();
  accessRecord.set({ ...current, wrongSince: current.wrongSince + 1 });
}
