"use client";

import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";

import type { PageTransition } from "@/features/settings/preferences";

/*
 * The page change chosen in Settings › Esperienza (owner, 18 Oct 2026).
 *
 *   fade       the view's own short slide (`.view-enter`), as it always was;
 *   cascade    the old page goes at once; the new one's cards arrive top to
 *              bottom, already in place, rising 20px row by row;
 *   cinematic  the reference video: the old page empties in bands from the
 *              bottom up, a beat of empty page, then the new one is built
 *              from the top — the first card drops in, the rest open
 *              downward row by row.
 *
 * The rail's pill and the view's name answer the click at once in every
 * mode: only the content waits for the old page to leave. A choice made
 * while the old page is leaving wins (the latest page is the one shown), and
 * choosing the page being left calls the leaving off. The system's Reduce
 * motion, or no way to read it, keeps the plain change.
 */

/** The cards a page is built from: what leaves and arrives, one by one. */
export const pageCardSelector = [
  ".management-view > .view-header",
  ".overview-view .workspace-panel",
  ".overview-view .wealth-context",
  ".overview-view .panel",
  ".trend-panel", ".trend-summary", ".trend-insight",
  ".access-profile", ".account-ledger",
  ".income-summary", ".income-chart-panel", ".paycheck-ledger",
  ".goal-hero", ".goal-insight", ".goal-estimate", ".goal-sim", ".goal-stops", ".goal-steps",
  ".projection-assumptions", ".projection-compare", ".projection-trajectory",
  ".projection-result", ".projection-method", ".afford-question", ".afford-answer", ".afford-chart", ".afford-saved",
  ".settings-index", ".settings-section",
].join(", ");

/** Every time the two moving modes use, in milliseconds. */
export const pageTransitionTiming = {
  cascade: {
    /** The old page, all at once. */
    leave: 120,
    /** Each card's arrival, and the step from one row to the next: twice
     *  the first tuning (240 / 32, and a 10px rise), owner, 18 Oct 2026. */
    enter: 480,
    stagger: 64,
    /** Rows after this one arrive with it, so the change stays short. */
    rows: 5,
  },
  cinematic: {
    /** One band of the old page, and the step to the band above it. */
    band: 150,
    bandStagger: 110,
    /** The bands share this much time at most, however many there are. */
    bandsWithin: 440,
    /** The empty page between the two. */
    gap: 40,
    /** Each card's arrival, and the step from one row to the next: 220ms,
     *  twice the first 110 (owner, 18 Oct 2026). One card at a time, 20ms
     *  then 5ms apart, was tried and reverted the same day. */
    enter: 480,
    first: 360,
    stagger: 220,
    rows: 6,
  },
} as const;

/** Rows closer than this are one row. */
const rowTolerance = 12;

const reducedMotionQuery = "(prefers-reduced-motion: reduce)";

function subscribeToMotion(onChange: () => void) {
  const query = typeof window.matchMedia === "function" ? window.matchMedia(reducedMotionQuery) : null;
  query?.addEventListener?.("change", onChange);
  return () => query?.removeEventListener?.("change", onChange);
}

/** Motion as the system allows it: false under Reduce motion or where it cannot be read. */
function useMotionAllowed(): boolean {
  return useSyncExternalStore(
    subscribeToMotion,
    () => typeof window.matchMedia === "function" && !window.matchMedia(reducedMotionQuery).matches,
    () => false,
  );
}

/**
 * The page's cards, outermost only (a card inside a card moves with it), and
 * none that runs an animation of its own: taking its animation for the
 * change would restart it when the change lets go.
 */
function pageCards(content: HTMLElement): HTMLElement[] {
  const found = Array.from(content.querySelectorAll<HTMLElement>(pageCardSelector));
  return found.filter(
    (card) => !found.some((other) => other !== card && other.contains(card)) && getComputedStyle(card).animationName === "none",
  );
}

/** The cards on screen: only they take a turn, so none off screen delays them. */
function onScreen(cards: HTMLElement[]): HTMLElement[] {
  return cards.filter((card) => {
    const box = card.getBoundingClientRect();
    return box.bottom >= 0 && box.top <= window.innerHeight;
  });
}

/** Each card's row, from the top: cards whose tops are within the tolerance share one. */
function rowsFromTop(cards: HTMLElement[]): number[] {
  const tops = cards.map((card) => card.getBoundingClientRect().top);
  const rowTops: number[] = [];
  for (const top of [...tops].sort((a, b) => a - b)) {
    if (rowTops.length === 0 || top - rowTops[rowTops.length - 1] > rowTolerance) rowTops.push(top);
  }
  return tops.map((top) => rowTops.filter((rowTop) => rowTop <= top + rowTolerance).length - 1);
}

function forget(cards: HTMLElement[]) {
  for (const card of cards) {
    delete card.dataset.pageCard;
    delete card.dataset.pageFirst;
    card.style.removeProperty("--page-out-at");
    card.style.removeProperty("--page-in-at");
  }
}

/**
 * The view the content shows, which trails the chosen view while the old
 * page leaves, and the ref for the element holding it. `enabled` false (the
 * guided tour, which measures the page as it moves) keeps the plain change.
 */
export function usePageTransition<V extends string>(view: V, mode: PageTransition, enabled: boolean) {
  const motionAllowed = useMotionAllowed();
  const moving = enabled && motionAllowed && mode !== "fade";
  const contentRef = useRef<HTMLElement>(null);
  const [shown, setShown] = useState(view);
  const [leavingFor, setLeavingFor] = useState<V | null>(null);

  // Decided while rendering, so no frame shows the new page before its turn.
  if (shown !== view) {
    if (!moving) {
      setShown(view);
      if (leavingFor !== null) setLeavingFor(null);
    } else if (leavingFor !== view) {
      setLeavingFor(view);
    }
  } else if (leavingFor !== null) {
    setLeavingFor(null);
  }

  // The latest choice, for the moment the old page has gone.
  const targetRef = useRef<V | null>(null);
  useLayoutEffect(() => {
    targetRef.current = leavingFor;
  });

  const leaving = leavingFor !== null;

  // The old page leaves: at once (cascade) or in bands from the bottom up
  // (cinematic), counting only the bands on screen.
  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!leaving || !content || mode === "fade") return;
    const cards = pageCards(content);
    let duration: number = pageTransitionTiming.cascade.leave;
    if (mode === "cinematic") {
      const { band, bandStagger, bandsWithin, gap } = pageTransitionTiming.cinematic;
      const visible = onScreen(cards);
      const rows = rowsFromTop(visible);
      const lastRow = Math.max(0, ...rows);
      const step = lastRow > 0 ? Math.min(bandStagger, bandsWithin / lastRow) : 0;
      visible.forEach((card, index) => card.style.setProperty("--page-out-at", `${Math.round((lastRow - rows[index]) * step)}ms`));
      duration = band + lastRow * step + gap;
    }
    for (const card of cards) card.dataset.pageCard = "";
    content.dataset.pageLeave = mode;
    const timer = window.setTimeout(() => {
      const target = targetRef.current;
      if (target === null) return;
      setShown(target);
      setLeavingFor(null);
    }, duration);
    return () => {
      window.clearTimeout(timer);
      delete content.dataset.pageLeave;
      forget(cards);
    };
  }, [leaving, mode]);

  // The new page arrives, row by row from the top, before its first paint.
  // The view the arrival choreography opens on is left to it.
  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content || !moving || content.querySelector(".entrance-content")) return;
    // Only the cards on screen arrive: the first one seen is the first row.
    const cards = onScreen(pageCards(content));
    if (cards.length === 0) return;
    const timing = pageTransitionTiming[mode];
    const rows = rowsFromTop(cards).map((row) => Math.min(row, timing.rows));
    cards.forEach((card, index) => {
      card.dataset.pageCard = "";
      if (mode === "cinematic" && rows[index] === 0) card.dataset.pageFirst = "";
      card.style.setProperty("--page-in-at", `${rows[index] * timing.stagger}ms`);
    });
    content.dataset.pageEnter = mode;
    const timer = window.setTimeout(() => {
      delete content.dataset.pageEnter;
      forget(cards);
    }, timing.enter + Math.max(...rows) * timing.stagger + 60);
    return () => {
      window.clearTimeout(timer);
      delete content.dataset.pageEnter;
      forget(cards);
    };
    // Once per page shown: a later change of mode applies to the next page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown]);

  return { contentView: moving ? shown : view, contentRef, mode: moving ? mode : null };
}
