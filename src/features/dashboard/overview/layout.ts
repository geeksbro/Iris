"use client";

import { createStoredValue } from "@/features/settings/preferences";

/*
 * The Overview's arrangement, as data.
 *
 * Everything the Overview shows below its title is arrangeable, the total
 * and the category cards included: this module is what that workspace is
 * made of. The default arrangement is the page as it has always looked, so
 * a device that never touches any of this never sees a difference.
 *
 * ── The grid ─────────────────────────────────────────────────────────────
 * Six equal units. Six is the smallest count that gives thirds and halves
 * at once, so the two most natural arrangements — a wide panel beside a
 * narrow one, and two equal panels side by side — are both expressible, and
 * 4 + 2 reproduces exactly the 2:1 the Overview has always used. Unequal
 * columns cannot do this: a "wide" panel would be a different width on the
 * left than on the right, and moving it would silently change its shape.
 *
 * A span is honoured only where there is room for it. Below the workspace's
 * own breakpoint every panel is full width, because a third of a phone is
 * not a panel. The stored span is therefore a request resolved against the
 * space available, never a fact about the screen.
 *
 * ── What is stored ───────────────────────────────────────────────────────
 * An order and a span per placed panel, in localStorage. It has to be
 * readable synchronously on the first render, for the same reason the theme
 * is: a layout read a frame late is a layout the reader watches rearrange
 * itself. That also means it stays on this device — a backup carries the
 * ledger, not the furniture.
 *
 * A panel this version does not know is dropped on read, and a panel added
 * in a later version simply is not in a layout written before it existed:
 * it appears in the catalogue, waiting to be chosen, rather than forcing
 * itself onto a page someone else arranged.
 */

/** Every panel the workspace can hold. Order here is the catalogue's order. */
export const panelIds = [
  "hero",
  "context",
  "category-liquidity",
  "category-investments",
  "category-trading",
  "history",
  "allocation",
  "movement",
  "goal",
  "accounts",
  "access",
  "cash",
  "income",
] as const;

export type PanelId = (typeof panelIds)[number];

/** Sixths: a third, a half, two thirds, the whole width. */
export const spans = [2, 3, 4, 6] as const;
export type Span = (typeof spans)[number];

export const gridUnits = 6;

export type PlacedPanel = { id: PanelId; span: Span };
export type OverviewLayout = PlacedPanel[];

function isPanelId(value: unknown): value is PanelId {
  return typeof value === "string" && (panelIds as readonly string[]).includes(value);
}

function isSpan(value: unknown): value is Span {
  return typeof value === "number" && (spans as readonly number[]).includes(value);
}

/*
 * The arrangement a device that has never been arranged starts from: the
 * Overview exactly as it has always looked. The total beside its change
 * metrics at 4 + 2 — the same 2:1 the old two-column top used — the three
 * category cards across one row, then the trend beside the composition at
 * 4 + 2 and the three lower panels across another.
 */
export const defaultLayout: OverviewLayout = [
  { id: "hero", span: 4 },
  { id: "context", span: 2 },
  { id: "category-liquidity", span: 2 },
  { id: "category-investments", span: 2 },
  { id: "category-trading", span: 2 },
  { id: "history", span: 4 },
  { id: "allocation", span: 2 },
  { id: "movement", span: 2 },
  { id: "goal", span: 2 },
  { id: "accounts", span: 2 },
];

/*
 * Anything that is not a recognisable arrangement reads as none at all, and
 * the default returns. Within one that is, each entry is taken only if it
 * names a panel this version has and a span it allows; a panel named twice
 * is kept once, because two of the same panel is not something this version
 * can place. An empty list is a real answer — someone cleared the workspace.
 */
export function parseLayout(stored: string): OverviewLayout | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(stored);
  } catch {
    return undefined;
  }
  if (!Array.isArray(raw)) return undefined;

  const seen = new Set<PanelId>();
  const layout: OverviewLayout = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const { id, span } = entry as { id?: unknown; span?: unknown };
    if (!isPanelId(id) || seen.has(id)) continue;
    seen.add(id);
    layout.push({ id, span: isSpan(span) ? span : 2 });
  }
  return layout;
}

export const overviewLayout = createStoredValue<OverviewLayout>(
  "wealth-overview-layout",
  defaultLayout,
  parseLayout,
  (value) => JSON.stringify(value),
);

/** The panels not placed, in the catalogue's own order. */
export function catalogueFor(layout: OverviewLayout): PanelId[] {
  const placed = new Set(layout.map((panel) => panel.id));
  return panelIds.filter((id) => !placed.has(id));
}

/** Move the panel at `from` so that it sits at `to`, keeping the rest in order. */
export function movePanel(layout: OverviewLayout, from: number, to: number): OverviewLayout {
  if (from === to || from < 0 || from >= layout.length) return layout;
  const next = [...layout];
  const [moved] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(next.length, to)), 0, moved);
  return next;
}

export function removePanel(layout: OverviewLayout, id: PanelId): OverviewLayout {
  return layout.filter((panel) => panel.id !== id);
}

export function addPanel(layout: OverviewLayout, id: PanelId, span: Span): OverviewLayout {
  return layout.some((panel) => panel.id === id) ? layout : [...layout, { id, span }];
}

export function resizePanel(layout: OverviewLayout, id: PanelId, span: Span): OverviewLayout {
  return layout.map((panel) => (panel.id === id ? { ...panel, span } : panel));
}

/** Whether two arrangements are the same, so an edit can be told from a no-op. */
export function sameLayout(a: OverviewLayout, b: OverviewLayout): boolean {
  return a.length === b.length && a.every((panel, index) => panel.id === b[index].id && panel.span === b[index].span);
}
