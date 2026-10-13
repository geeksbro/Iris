"use client";

import { useEffect, useEffectEvent, useLayoutEffect, useRef, type ReactNode } from "react";

import { createTicker, SpringGroup, SpringValue, verticalBoxExtra } from "@/features/dashboard/morph";

/*
 * The two moving parts of Settings' master-detail.
 *
 * One group is shown at a time, so the index is navigation rather than a
 * table of contents, and the detail pane is a single surface that changes
 * what it holds. That is the claim these two morphs have to keep:
 *
 * · the pane is the same surface throughout — it changes contents and
 *   height, it is not replaced by another pane fading in over the first;
 * · the marker is one object travelling between entries, not a border that
 *   is switched off here and on there.
 *
 * Both run on springs, so a reader clicking quickly down the index is never
 * made to wait: the newest choice simply becomes the target, and the current
 * position and speed carry into it. Neither commits anything on a completion
 * callback, which a later click would have made a lie.
 */

/** Heights and offsets settle within half a pixel; the reveal within a thousandth. */
const geometrySpring = { stiffness: 210, ratio: 0.95, positionTolerance: 0.5, velocityTolerance: 8 } as const;
const markerSpring = { stiffness: 320, ratio: 0.9, positionTolerance: 0.3, velocityTolerance: 6 } as const;
const revealSpring = { stiffness: 200, ratio: 1, positionTolerance: 0.004, velocityTolerance: 0.04 } as const;

function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/*
 * The detail pane. It knows nothing about settings: it is told which group is
 * showing, and its whole job is that the change of height reads as one
 * surface resizing.
 */
export function SettingsPane({ active, children }: { active: string; children: ReactNode }) {
  const paneRef = useRef<HTMLDivElement>(null);
  const springsRef = useRef<SpringGroup<"height" | "reveal"> | null>(null);
  const tickerRef = useRef<ReturnType<typeof createTicker> | null>(null);
  const atRestRef = useRef(true);
  /* The height the pane is showing while it is at rest. Kept current by an
     observer rather than read at the moment of the change, because by then
     React has already swapped the contents and the old height is gone. */
  const restHeightRef = useRef(0);
  const shownRef = useRef<string | null>(null);

  /** The height this pane would take if nothing were holding it. */
  const naturalHeight = () => {
    const pane = paneRef.current;
    if (!pane) return 0;
    const held = pane.style.height;
    pane.style.height = "auto";
    const measured = pane.getBoundingClientRect().height;
    pane.style.height = held;
    return Math.ceil(measured) + verticalBoxExtra(pane);
  };

  const render = () => {
    const pane = paneRef.current;
    const springs = springsRef.current;
    if (!pane || !springs) return;
    const { height, reveal } = springs.values();
    pane.style.height = `${Math.max(0, height)}px`;
    pane.style.setProperty("--settings-reveal", `${Math.min(1, Math.max(0, reveal))}`);
  };

  /*
   * At rest the pane gives its height back to the layout, so that anything
   * inside which grows later — an error, the diagnostics fold — simply makes
   * it taller without asking this component's permission.
   */
  const settle = () => {
    const pane = paneRef.current;
    if (!pane) return;
    atRestRef.current = true;
    pane.style.removeProperty("height");
    pane.dataset.morph = "rest";
    pane.style.setProperty("--settings-reveal", "1");
  };

  const frame = (dt: number) => {
    const springs = springsRef.current;
    if (!springs) return true;
    springs.step(dt);
    render();
    if (!springs.settled()) return false;
    springs.snap();
    settle();
    return true;
  };

  const arrive = useEffectEvent(() => {
    const pane = paneRef.current;
    if (!pane) return;

    // First paint, or the same group re-rendering: nothing has to travel.
    if (shownRef.current === null || shownRef.current === active) {
      shownRef.current = active;
      if (atRestRef.current) settle();
      return;
    }
    shownRef.current = active;

    if (prefersReducedMotion()) {
      settle();
      return;
    }

    const to = naturalHeight();
    const from = atRestRef.current ? restHeightRef.current : (springsRef.current?.get("height").value ?? to);

    pane.dataset.morph = "flight";
    if (!springsRef.current || atRestRef.current) {
      // Leaving rest: seeding from the height actually on screen is legitimate
      // here, and only here.
      springsRef.current = new SpringGroup({
        height: new SpringValue(from, geometrySpring),
        // The rows of the group now gone had no counterpart in the group
        // arriving, so the new ones enter honestly, and after there is room.
        reveal: new SpringValue(0, revealSpring),
      });
    } else {
      // Already travelling: retarget, never re-seed.
      springsRef.current.get("reveal").setTarget(0);
      springsRef.current.get("reveal").value = Math.min(springsRef.current.get("reveal").value, 0.35);
    }
    springsRef.current.setTargets({ height: to, reveal: 1 });
    render();
    atRestRef.current = false;
    tickerRef.current ??= createTicker(frame);
    tickerRef.current.start();
  });

  useLayoutEffect(() => {
    arrive();
  }, [active]);

  /*
   * A resize is "recompute the target", never "cancel". While at rest the
   * observer is also what keeps the remembered height honest, so a pane that
   * was resized before a group change still leaves from where it really is.
   */
  const onPaneResize = useEffectEvent(() => {
    const pane = paneRef.current;
    if (!pane) return;
    if (atRestRef.current) {
      restHeightRef.current = pane.getBoundingClientRect().height;
      return;
    }
    springsRef.current?.get("height").setTarget(naturalHeight());
  });

  useEffect(() => {
    const pane = paneRef.current;
    if (!pane || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => onPaneResize());
    observer.observe(pane);
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => tickerRef.current?.stop(), []);

  return (
    <div className="settings-pane" data-morph="rest" ref={paneRef}>
      <div className="settings-pane__content">{children}</div>
    </div>
  );
}

type IndexEntry = { id: string; title: string; summary: string };

/*
 * The index. Its marker is one object that travels: it is measured from the
 * entry it belongs to, so it cannot drift out of step with the type, and it
 * springs rather than jumps.
 */
export function SettingsIndex({ active, entries, label, onSelect }: {
  active: string;
  entries: IndexEntry[];
  label: string;
  onSelect: (id: string) => void;
}) {
  const listRef = useRef<HTMLOListElement>(null);
  const markerRef = useRef<HTMLSpanElement>(null);
  const springsRef = useRef<SpringGroup<"y" | "height"> | null>(null);
  const tickerRef = useRef<ReturnType<typeof createTicker> | null>(null);

  const measure = () => {
    const list = listRef.current;
    const entry = list?.querySelector<HTMLElement>(`[data-entry="${active}"]`);
    if (!list || !entry) return null;
    const listTop = list.getBoundingClientRect().top;
    const rect = entry.getBoundingClientRect();
    return { y: rect.top - listTop, height: rect.height };
  };

  /*
   * The entries are one well (owner, 12 Oct 2026): rectangles cut by 2px,
   * only the group's top and foot curved (--index-group-r, globals.css). The
   * marker takes the shape of where it is — curved on top at the first
   * entry, at the foot at the last, square between — and, travelling, its
   * corners round as it nears an end of the group and square as it leaves.
   */
  const render = () => {
    const marker = markerRef.current;
    const springs = springsRef.current;
    const list = listRef.current;
    if (!marker || !springs) return;
    const { y, height } = springs.values();
    marker.style.transform = `translateY(${y}px)`;
    marker.style.height = `${Math.max(0, height)}px`;
    if (!list) return;
    // The group's curve as the browser resolved it: the first entry's corner.
    const first = list.querySelector<HTMLElement>("li:first-of-type button");
    const radius = first ? Number.parseFloat(getComputedStyle(first).borderTopLeftRadius) || 0 : 0;
    if (radius <= 0) return;
    const fromTop = Math.max(0, y);
    const fromFoot = Math.max(0, list.clientHeight - (y + height));
    const top = radius * Math.max(0, 1 - fromTop / radius);
    const foot = radius * Math.max(0, 1 - fromFoot / radius);
    marker.style.borderRadius = `${top}px ${top}px ${foot}px ${foot}px`;
  };

  const frame = (dt: number) => {
    const springs = springsRef.current;
    if (!springs) return true;
    springs.step(dt);
    render();
    if (!springs.settled()) return false;
    springs.snap();
    render();
    return true;
  };

  const aim = useEffectEvent(() => {
    const target = measure();
    if (!target) return;
    if (!springsRef.current || prefersReducedMotion()) {
      // Born where it belongs: the marker never slides in from nowhere.
      springsRef.current = new SpringGroup({
        y: new SpringValue(target.y, markerSpring),
        height: new SpringValue(target.height, markerSpring),
      });
      render();
      return;
    }
    springsRef.current.setTargets(target);
    render();
    tickerRef.current ??= createTicker(frame);
    tickerRef.current.start();
  });

  useLayoutEffect(() => {
    aim();
  }, [active, entries.length]);

  // The entries carry live summaries, so their heights change with the state
  // they report; the marker follows the entry rather than a remembered number.
  const onListResize = useEffectEvent(() => {
    const target = measure();
    const springs = springsRef.current;
    if (!target || !springs) return;
    springs.setTargets(target);
    tickerRef.current ??= createTicker(frame);
    tickerRef.current.start();
  });

  useEffect(() => {
    const list = listRef.current;
    if (!list || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => onListResize());
    observer.observe(list);
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => tickerRef.current?.stop(), []);

  return (
    <nav aria-label={label} className="settings-index" data-tour="settings-index">
      <ol ref={listRef}>
        {/* Decoration: the current entry is named by aria-current, not by this. */}
        <span aria-hidden="true" className="settings-index__marker" ref={markerRef} />
        {entries.map((entry) => (
          <li key={entry.id}>
            <button
              aria-current={active === entry.id ? "true" : undefined}
              data-entry={entry.id}
              onClick={() => onSelect(entry.id)}
              type="button"
            >
              <span className="settings-index__title">{entry.title}</span>
              <span className="settings-index__summary">{entry.summary}</span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}
