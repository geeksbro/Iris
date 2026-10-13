import { useEffect, useRef, type RefObject } from "react";

/*
 * The jiggle of arranging (owner, 12 Oct 2026): like the icons of an iPhone
 * home screen being moved, every panel shakes quickly from side to side while
 * the Overview is being arranged — the sign that the panels have come loose.
 *
 * It is played with Web Animations on the individual `rotate` and `translate`
 * properties, never on `transform` or `animation`: the reorder's FLIP owns
 * `transform`, and the Allocation panel's CSS reveal owns `animation`, which
 * would replay if a rule took it over and gave it back.
 *
 * A panel is far wider than an icon, so the swing is set by how far its
 * corners travel, not by an angle: a full-width panel tilts less than a third
 * of one, and both move their edges by the same couple of pixels. Each panel
 * keeps its own tempo and phase, so they never swing in step. The panel being
 * dragged holds still, as an icon does under the finger.
 */

/** How far, in px, a panel's corners travel at the top of a swing. */
const edgeTravelPx = 1.6;
/** Never more than an icon's tilt, however narrow the panel. */
const maxDegrees = 1.2;
/** One swing, one way; each panel adds up to `swingSpreadMs` of its own. */
const swingMs = 118;
const swingSpreadMs = 34;
/** The small rise and fall under the swing, on a tempo of its own. */
const bobPx = 0.5;
const bobRatio = 1.37;
/** A change of width beyond this share restarts the panel's swing at its new size. */
const widthTolerance = 0.1;

export function jiggleDegrees(width: number) {
  if (!(width > 0)) return 0;
  return Math.min(maxDegrees, (Math.atan(edgeTravelPx / (width / 2)) * 180) / Math.PI);
}

type Jiggle = { width: number; animations: Animation[] };

function startJiggle(element: HTMLElement, width: number, index: number): Animation[] {
  const degrees = jiggleDegrees(width);
  const swing = swingMs + Math.random() * swingSpreadMs;
  // Neighbours start on opposite sides, then drift apart on their own tempo.
  const lean = index % 2 === 0 ? 1 : -1;
  const sway = element.animate(
    [{ rotate: `${-degrees * lean}deg` }, { rotate: `${degrees * lean}deg` }],
    { delay: -Math.random() * swing, direction: "alternate", duration: swing, easing: "ease-in-out", iterations: Infinity },
  );
  const bob = element.animate(
    [{ translate: `0 ${-bobPx}px` }, { translate: `0 ${bobPx}px` }],
    { delay: -Math.random() * swing, direction: "alternate", duration: swing * bobRatio, easing: "ease-in-out", iterations: Infinity },
  );
  return [sway, bob];
}

function stop(jiggle: Jiggle) {
  for (const animation of jiggle.animations) animation.cancel();
}

/**
 * Shakes every `[data-panel-index]` inside `grid` while `active`, except the
 * panel at index `still`. `arrangement` is any value that changes when panels
 * are added, removed, moved or resized, so new panels join in and resized
 * ones swing at their new size.
 */
export function useJiggle(grid: RefObject<HTMLElement | null>, active: boolean, still: number | null, arrangement: string) {
  const running = useRef(new Map<HTMLElement, Jiggle>());

  useEffect(() => {
    const jiggles = running.current;
    const root = grid.current;
    const canAnimate = typeof Element !== "undefined" && typeof Element.prototype.animate === "function";
    const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (!active || !root || !canAnimate || reduced) {
      for (const jiggle of jiggles.values()) stop(jiggle);
      jiggles.clear();
      return;
    }

    const panels = new Set(root.querySelectorAll<HTMLElement>("[data-panel-index]"));
    for (const [element, jiggle] of jiggles) {
      if (panels.has(element)) continue;
      stop(jiggle);
      jiggles.delete(element);
    }

    for (const element of panels) {
      const index = Number(element.dataset.panelIndex);
      const width = element.offsetWidth;
      const current = jiggles.get(element);
      if (index === still) {
        if (current) {
          stop(current);
          jiggles.delete(element);
        }
        continue;
      }
      if (current && Math.abs(current.width - width) <= width * widthTolerance) continue;
      if (current) stop(current);
      jiggles.set(element, { width, animations: startJiggle(element, width, index) });
    }
  }, [active, still, arrangement, grid]);

  useEffect(() => {
    const jiggles = running.current;
    return () => {
      for (const jiggle of jiggles.values()) stop(jiggle);
      jiggles.clear();
    };
  }, []);
}
