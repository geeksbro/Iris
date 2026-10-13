"use client";

import { useEffect, useRef } from "react";

import { isTrackedPage, recordPageVisit } from "@/data/page-visits";

/**
 * Counts an entry into the page on screen: once when the dashboard first
 * shows it, and again each time another view gives way to it. Re-renders,
 * state changes inside the page and child refreshes do not re-run the effect
 * (its inputs are unchanged). The ref remembers the page last counted, so
 * Strict Mode's rehearsal of the effect in development counts nothing twice;
 * a real remount (the ledger shown again after an unlock) starts afresh.
 * Child views and Settings are views too: leaving one for a page counts.
 */
export function usePageVisitCounter(view: string, shown: boolean) {
  const countedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!shown || countedRef.current === view) return;
    countedRef.current = view;
    if (isTrackedPage(view)) {
      // A statistic, never in the way: a failed write costs one visit, nothing else.
      void recordPageVisit(view).catch(() => undefined);
    }
  }, [shown, view]);
}
