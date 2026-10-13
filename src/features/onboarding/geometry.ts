/*
 * The tour's geometry, in viewport coordinates (everything the tour draws is
 * position: fixed). Pure functions: the component measures, these decide.
 */

export type Box = { left: number; top: number; width: number; height: number };
export type Size = { width: number; height: number };
export type Side = "bottom" | "top" | "right" | "left";
export type PanelPlacement = Side | "center" | "sheet-top" | "sheet-bottom";

/** Below this width the panel is a sheet across the screen, not a bubble beside the target. */
export const sheetBelow = 640;

const right = (box: Box) => box.left + box.width;
const bottom = (box: Box) => box.top + box.height;
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));

/** The smallest box holding them all; null for none. */
export function unionBox(boxes: ReadonlyArray<Box>): Box | null {
  if (boxes.length === 0) return null;
  const left = Math.min(...boxes.map((box) => box.left));
  const top = Math.min(...boxes.map((box) => box.top));
  return {
    left,
    top,
    width: Math.max(...boxes.map(right)) - left,
    height: Math.max(...boxes.map(bottom)) - top,
  };
}

/** The opening around a target: the target grown by `pad`, never past the screen's edge. */
export function spotlightBox(target: Box, viewport: Size, pad = 8, margin = 4): Box {
  const left = Math.max(margin, target.left - pad);
  const top = Math.max(margin, target.top - pad);
  return {
    left,
    top,
    width: Math.max(0, Math.min(viewport.width - margin, right(target) + pad) - left),
    height: Math.max(0, Math.min(viewport.height - margin, bottom(target) + pad) - top),
  };
}

/**
 * The opening's corner, concentric with the target's (outer = inner +
 * padding, the rule every IRIS container follows), never rounder than a pill.
 */
export function spotlightRadius(targetRadius: number, pad: number, box: Size): number {
  return Math.max(0, Math.min(targetRadius + pad, Math.min(box.width, box.height) / 2));
}

/** How much of a box shows between the bar's foot and the screen's foot (0–1). */
export function visibleShare(box: Box, viewport: Size, topInset = 0): number {
  if (box.height <= 0) return 0;
  const shown = Math.min(bottom(box), viewport.height) - Math.max(box.top, topInset);
  return clamp(shown / box.height, 0, 1);
}

/**
 * Where the panel goes: beside the opening, on the first side in `prefer`
 * where it fits whole, centred on the opening along that side and kept
 * `margin` inside the screen. With no opening it is centred; on a narrow
 * screen, or when no side has room, it is a sheet at the screen's top or
 * foot, whichever the opening leaves free.
 */
export function placePanel(
  hole: Box | null,
  panel: Size,
  viewport: Size,
  prefer: ReadonlyArray<Side> = ["bottom", "top", "right", "left"],
  gap = 16,
  margin = 16,
): { left: number; top: number; placement: PanelPlacement } {
  const centredLeft = (viewport.width - panel.width) / 2;
  if (!hole) {
    return { left: Math.max(margin, centredLeft), top: Math.max(margin, (viewport.height - panel.height) / 2), placement: "center" };
  }

  if (viewport.width >= sheetBelow) {
    const alongX = clamp(hole.left + hole.width / 2 - panel.width / 2, margin, viewport.width - panel.width - margin);
    const alongY = clamp(hole.top + hole.height / 2 - panel.height / 2, margin, viewport.height - panel.height - margin);
    for (const side of prefer) {
      if (side === "bottom" && bottom(hole) + gap + panel.height <= viewport.height - margin) {
        return { left: alongX, top: bottom(hole) + gap, placement: side };
      }
      if (side === "top" && hole.top - gap - panel.height >= margin) {
        return { left: alongX, top: hole.top - gap - panel.height, placement: side };
      }
      if (side === "right" && right(hole) + gap + panel.width <= viewport.width - margin) {
        return { left: right(hole) + gap, top: alongY, placement: side };
      }
      if (side === "left" && hole.left - gap - panel.width >= margin) {
        return { left: hole.left - gap - panel.width, top: alongY, placement: side };
      }
    }
  }

  // A sheet on the half the opening leaves free.
  const left = Math.max(margin, centredLeft);
  const holeCentre = hole.top + hole.height / 2;
  return holeCentre > viewport.height / 2
    ? { left, top: margin, placement: "sheet-top" }
    : { left, top: Math.max(margin, viewport.height - panel.height - margin), placement: "sheet-bottom" };
}
