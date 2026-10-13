"use client";

import {
  createContext,
  useContext,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

/*
 * The dashboard entrance: the one choreography that plays on arrival, and the
 * deliberate exception to "nothing animates on page load" (see the motion
 * layer in globals.css). Structure first, data second:
 *
 *   phase 1  the ground brightens; rail and top bar settle; then the cards,
 *            row by row, left to right, while the shell is still settling;
 *   phase 2  each card's figures count up, its bars grow and its lines draw,
 *            once that card has nearly settled.
 *
 * Every time below is read from here: CSS gets them as custom properties on
 * the shell, the count-ups and the donut read them directly. Nothing hidden
 * lives outside a CSS animation with a `backwards` fill, so the page can
 * never be left invisible: an animation always ends on its own, and the shell
 * drops the whole choreography once `durationMs` has passed.
 *
 * It plays once per document: on the first dashboard a page load shows, never
 * again for a re-render, a data refresh, a view change or an unlock after an
 * idle lock. Under reduced motion it does not play at all.
 */

/**
 * How long the whole arrival takes, measured against the times fitted to the
 * reference video. Owner, 16 Sep 2026: 30% longer.
 *
 * It is one multiplier and not thirty rewritten numbers, so every start,
 * stagger and duration below stays the value that was fitted, and the pace
 * can only stretch the choreography — never reshape it. The numbers in this
 * file are therefore always readable as "the fitted time"; what the page
 * plays is that time at `entrancePace`.
 *
 * The Allocation panel's own 1.3s composition is deliberately NOT scaled (the
 * owner's standing exception for that donut): only its start moves with the
 * pace. See `entranceDurationMs`.
 */
export const entrancePace = 1.3;

/** A time from the fitted choreography, in the milliseconds actually played. */
const at = (fitted: number) => Math.round(fitted * entrancePace);

export const entranceTimeline = {
  /** Structure: the project's --ease-smooth-out. */
  ease: [0.22, 1, 0.36, 1],
  /** Data: slow start, quick middle, long tail, fitted to the reference count.
   *  Lines, bars and fades keep it; the figures no longer do (see countShape). */
  dataEase: [0.55, 0.05, 0.05, 1],
  /**
   * The figures alone, in three phases set by the value shown (owner, 27 Sep
   * 2026): a slow start up to 30% of the figure, a very fast run from 30% to
   * 75%, then a long, slow approach from 75% to 100%. No single cubic-bezier
   * holds three phases, so countCurve builds them piece by piece with the
   * speed continuous at both joins: no jolt where one phase hands over.
   * `fastSpeed` is the run's speed as a multiple of the count's average, and
   * it sets the rest: at 3, 30% is shown at 30% of the time, 75% at 45%, and
   * the last quarter of the figure takes the remaining 55%.
   * (Before: cubic-bezier(0.3, 0.1, 0.55, 0.92), owner, 16 Sep 2026.)
   */
  countShape: { slowUntil: 0.3, fastUntil: 0.75, fastSpeed: 3 },

  /** The ground starts this much dimmer and clears, slower than the cards. */
  ambient: { duration: at(1_100), dim: 0.035 },
  /** Rail and top bar: a short slide, no scale and no blur on full-height surfaces. */
  shell: { duration: at(560), distance: 12, rail: 0, topbar: at(60) },
  /** What the rail and the bar hold: brand, navigation, identity and controls. */
  items: { duration: at(420), distance: 6, brand: at(120), nav: at(160), navStagger: at(40), railNote: at(420), topbar: at(180), topbarStagger: at(60) },
  /**
   * Every card: from { opacity 0, y 18px, scale 0.975, blur 6px }. Owner's
   * call (15 Sep 2026): a slower settle than the first 520ms; the counts keep
   * their start, when a card is already ~94% settled.
   */
  card: { duration: at(850), distance: 18, scale: 0.975, blur: 6 },
  /** When each card starts, ms after the shell mounts. */
  cards: {
    hero: at(280),
    context: at(380),
    categories: at(500),
    categoryStagger: at(100),
    /*
     * The workspace panels. Their arrangement is the reader's, so they can no
     * longer each have a time of their own: the first starts where the trend
     * has always started, and every panel after it follows by one stagger, in
     * the order the page actually shows them. The stagger is the average of
     * the gaps the original five were fitted to (100, 100, 80, 80).
     */
    panels: at(800),
    panelStagger: at(90),
    /*
     * How many panels are staggered before the rest arrive together. A
     * workspace can hold more panels than a screen shows, and an arrival that
     * grew longer every time one was added would stretch past the brief for
     * motion no one is looking at: after the sixth, every later panel starts
     * with the sixth, far below the fold.
     */
    staggeredPanels: 6,
    /** The Allocation panel keeps its own 1.3s composition, wherever it lands. */
    allocationComposition: 1_300,
  },
  /** Data starts `lag` after its card, once that card has nearly settled. */
  data: { lag: at(380), count: at(1_400), line: at(1_200), meter: at(1_000), fade: at(400), stagger: at(70) },
} as const;

type Timeline = typeof entranceTimeline;

/** A figure that counts up, and the card it belongs to. */
/*
 * When the figure inside the panel in a given place starts counting: its
 * panel's arrival, plus the lag that lets the panel settle first. There is no
 * table of named slots any more — the hero, the category cards and everything
 * else are panels the reader arranges, so a figure's turn is wherever its
 * panel has been put.
 */
export function countStart(index: number, timeline: Timeline = entranceTimeline): number {
  return panelStartMs(index, timeline) + timeline.data.lag;
}

/** The last thing to finish: the Allocation composition, a count, a line or a bar. */
export function entranceDurationMs(timeline: Timeline = entranceTimeline): number {
  const { cards, data } = timeline;
  const lastCategory = cards.categories + 2 * cards.categoryStagger;
  /* Every panel after the staggered ones starts with the last of them, so
     this covers any arrangement however long. */
  const lastPanel = panelStartMs(cards.staggeredPanels - 1, timeline);
  return Math.max(
    cards.hero + data.lag + data.count,
    lastCategory + data.lag + data.count,
    cards.panels + data.lag + data.line + data.fade / 2,
    // The donut's own composition, the one thing the pace does not stretch.
    lastPanel + cards.allocationComposition,
    lastPanel + data.lag + data.meter,
    lastPanel + timeline.card.duration,
  );
}

const ms = (value: number) => `${value}ms`;
const bezier = (points: readonly number[]) => `cubic-bezier(${points.join(", ")})`;

/** The timeline as the custom properties the entrance section of globals.css reads. */
export function entranceVariables(timeline: Timeline = entranceTimeline): CSSProperties {
  const { ambient, shell, items, card, cards, data } = timeline;
  return {
    "--entrance-ease": bezier(timeline.ease),
    "--entrance-data-ease": bezier(timeline.dataEase),
    "--entrance-ambient-dur": ms(ambient.duration),
    "--entrance-ambient-dim": String(ambient.dim),
    "--entrance-shell-dur": ms(shell.duration),
    "--entrance-shell-distance": `${shell.distance}px`,
    "--entrance-rail-at": ms(shell.rail),
    "--entrance-topbar-at": ms(shell.topbar),
    "--entrance-item-dur": ms(items.duration),
    "--entrance-item-distance": `${items.distance}px`,
    "--entrance-brand-at": ms(items.brand),
    "--entrance-nav-at": ms(items.nav),
    "--entrance-nav-stagger": ms(items.navStagger),
    "--entrance-rail-note-at": ms(items.railNote),
    "--entrance-topbar-items-at": ms(items.topbar),
    "--entrance-topbar-stagger": ms(items.topbarStagger),
    "--entrance-card-dur": ms(card.duration),
    "--entrance-card-distance": `${card.distance}px`,
    "--entrance-card-scale": String(card.scale),
    "--entrance-card-blur": `${card.blur}px`,
    "--entrance-hero-at": ms(cards.hero),
    "--entrance-context-at": ms(cards.context),
    "--entrance-categories-at": ms(cards.categories),
    "--entrance-category-stagger": ms(cards.categoryStagger),
    "--entrance-panels-at": ms(cards.panels),
    "--entrance-panel-stagger": ms(cards.panelStagger),
    "--entrance-data-lag": ms(data.lag),
    "--entrance-line-dur": ms(data.line),
    "--entrance-meter-dur": ms(data.meter),
    "--entrance-fade-dur": ms(data.fade),
    "--entrance-data-stagger": ms(data.stagger),
  } as CSSProperties;
}

/** A CSS cubic-bezier as a function of progress, for the count-ups. */
export function cubicBezier([x1, y1, x2, y2]: readonly number[]): (progress: number) => number {
  const sample = (a1: number, a2: number, t: number) => ((1 - 3 * a2 + 3 * a1) * t + (3 * a2 - 6 * a1)) * t * t + 3 * a1 * t;
  const slope = (a1: number, a2: number, t: number) => 3 * (1 - 3 * a2 + 3 * a1) * t * t + 2 * (3 * a2 - 6 * a1) * t + 3 * a1;
  return (progress) => {
    if (progress <= 0) return 0;
    if (progress >= 1) return 1;
    // Newton's method on x(t) = progress, kept inside [low, high] by bisection.
    let low = 0;
    let high = 1;
    let t = progress;
    for (let step = 0; step < 24; step += 1) {
      const error = sample(x1, x2, t) - progress;
      if (Math.abs(error) < 1e-6) break;
      if (error > 0) high = t;
      else low = t;
      const derivative = slope(x1, x2, t);
      const next = Math.abs(derivative) > 1e-6 ? t - error / derivative : Number.NaN;
      t = next > low && next < high ? next : (low + high) / 2;
    }
    return sample(y1, y2, t);
  };
}

/**
 * The count's curve: progress in time → share of the figure shown.
 *
 *   slow   speed grows from 0 as the square of time, up to `fastSpeed`,
 *          until `slowUntil` of the figure is shown;
 *   fast   constant `fastSpeed` until `fastUntil`;
 *   settle speed falls from `fastSpeed` to 0 as a power of the time left,
 *          so the figure keeps moving, ever slower, until it lands.
 *
 * The slow phase covers its share at a third of the fast speed on average,
 * which fixes its length; the settle's power is chosen so it starts at the
 * fast speed. Both joins are therefore smooth in position and in speed.
 */
export function countCurve({ slowUntil, fastUntil, fastSpeed }: { slowUntil: number; fastUntil: number; fastSpeed: number }): (progress: number) => number {
  const slowEnd = (3 * slowUntil) / fastSpeed;
  const fastEnd = slowEnd + (fastUntil - slowUntil) / fastSpeed;
  const settlePower = (fastSpeed * (1 - fastEnd)) / (1 - fastUntil);
  return (progress) => {
    if (progress <= 0) return 0;
    if (progress >= 1) return 1;
    if (progress < slowEnd) return (fastSpeed * progress ** 3) / (3 * slowEnd ** 2);
    if (progress < fastEnd) return slowUntil + fastSpeed * (progress - slowEnd);
    const settled = (progress - fastEnd) / (1 - fastEnd);
    return fastUntil + (1 - fastUntil) * (1 - (1 - settled) ** settlePower);
  };
}

const countProgress = countCurve(entranceTimeline.countShape);

// Once per document: a module lives exactly as long as the page.
let playedInThisDocument = false;

/** Test seam: lets a test start from a fresh page load. */
export function resetEntranceForTests() {
  playedInThisDocument = false;
}

function motionAllowed(): boolean {
  // No matchMedia (jsdom, very old engines): no entrance, the page as it is.
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

type EntranceState = {
  /** The choreography is on: the shell carries data-entrance and its timings. */
  running: boolean;
  /** Still on the view the dashboard opened on; a view change ends the content part. */
  contentLive: boolean;
  /** performance.now() at the shell's first render, the zero of every time above. */
  startedAt: number;
};

const EntranceContext = createContext<EntranceState | null>(null);

/**
 * The app shell, carrying the entrance while it plays. `contentKey` is the
 * current view: the cards' part of the choreography belongs to the view the
 * dashboard opened on, so another view, or the same one opened again, simply
 * renders as it always has.
 */
export function EntranceShell({ className, contentKey, children }: { className: string; contentKey: string; children: ReactNode }) {
  // Decided once, on the shell's first render: before its first paint, so no
  // settled frame ever shows ahead of the entrance.
  const [plan] = useState(() => ({ play: !playedInThisDocument && motionAllowed(), startedAt: performance.now() }));
  const [running, setRunning] = useState(plan.play);
  const [openingKey] = useState(contentKey);
  const [contentLive, setContentLive] = useState(plan.play);
  if (contentLive && contentKey !== openingKey) {
    setContentLive(false);
  }

  useEffect(() => {
    playedInThisDocument = true;
  }, []);

  // The one timer: the whole choreography is dropped once it has finished.
  // Also ends it at once if reduced motion is switched on meanwhile.
  useEffect(() => {
    if (!running) return;
    const timer = window.setTimeout(() => setRunning(false), Math.max(0, plan.startedAt + entranceDurationMs() + 120 - performance.now()));
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const stop = () => { if (motion.matches) setRunning(false); };
    motion.addEventListener?.("change", stop);
    return () => {
      window.clearTimeout(timer);
      motion.removeEventListener?.("change", stop);
    };
  }, [plan, running]);

  const state = useMemo(() => ({ running, contentLive, startedAt: plan.startedAt }), [running, contentLive, plan]);

  return (
    <div className={className} data-entrance={running ? "" : undefined} style={running ? entranceVariables() : undefined}>
      <EntranceContext.Provider value={state}>{children}</EntranceContext.Provider>
    </div>
  );
}

/** Whether the arrival choreography is still playing (false outside the shell). */
export function useEntranceRunning(): boolean {
  return useContext(EntranceContext)?.running ?? false;
}

/** True for the view the entrance opens on, for its whole life; false for any later mount. */
export function useEntranceContent(): boolean {
  const entrance = useContext(EntranceContext);
  const [entering] = useState(() => Boolean(entrance?.running && entrance.contentLive));
  return entering;
}

/**
 * Which place in the workspace a panel occupies, for the one thing inside a
 * panel that has to know: an animation of its own that should start when its
 * panel arrives. The arrangement is the reader's, so the turn cannot be read
 * off the panel's name any more — it is handed down from where it is placed.
 */
const PanelSlotContext = createContext(0);

export function PanelSlot({ index, children }: { index: number; children: ReactNode }) {
  return <PanelSlotContext value={index}>{children}</PanelSlotContext>;
}

/** When the panel in a given place starts, ms after the shell mounts. */
export function panelStartMs(index: number, timeline: Timeline = entranceTimeline): number {
  const place = Math.min(Math.max(0, index), timeline.cards.staggeredPanels - 1);
  return timeline.cards.panels + place * timeline.cards.panelStagger;
}

/**
 * The delay that places a card's own internal animation in the timeline: its
 * panel's start while the entrance opens on it, 0 for any later mount.
 */
export function useEntranceDelay(): number {
  const entering = useEntranceContent();
  const slot = useContext(PanelSlotContext);
  return entering ? panelStartMs(slot) : 0;
}

/**
 * A figure that counts from zero up to its value during the entrance.
 * Returns whether it is counting: while it is, the caller renders an empty,
 * aria-hidden element for `paint` to write into and keeps the real value in
 * the accessibility tree; once it is not, the caller renders the value as
 * always, so the last word is React's own text. The count stops at once, on
 * the real value, if the value changes, the slot goes away (amounts hidden)
 * or the entrance ends.
 */
export function useCountUp(value: number, enabled: boolean, paint: (current: number) => void): boolean {
  const entrance = useContext(EntranceContext);
  const slot = useContext(PanelSlotContext);
  const [counting, setCounting] = useState(() => Boolean(enabled && entrance?.running && entrance.contentLive));
  const [target] = useState(value);
  if (counting && (value !== target || !enabled || !entrance?.running)) {
    setCounting(false);
  }

  const paintFrame = useEffectEvent(paint);

  // Layout effect: zero is written before the first paint, so the real value
  // never flashes ahead of its count.
  useLayoutEffect(() => {
    if (!counting || !enabled || !entrance) return;
    const start = entrance.startedAt + countStart(slot);
    const duration = entranceTimeline.data.count;
    paintFrame(0);
    let frame = window.requestAnimationFrame(function tick(now) {
      const progress = (now - start) / duration;
      if (progress >= 1) {
        paintFrame(target);
        setCounting(false);
        return;
      }
      paintFrame(target * countProgress(progress));
      frame = window.requestAnimationFrame(tick);
    });
    return () => window.cancelAnimationFrame(frame);
    // Started once per count; `entrance` and `target` are fixed for its life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [counting]);

  return counting;
}
