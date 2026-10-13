"use client";

import { useEffect } from "react";

/*
 * Fill from the pointer (owner, 12 Oct 2026: "invent a hover animation and
 * apply it where you like"). Under the pointer, a clickable row or card is
 * filled by a quiet tint that grows as a circle from the very point the
 * pointer came in at, and shrinks back towards the point it left by. No
 * scale, no lift, no glow: the owner removed all three from the dashboard.
 *
 * This only records where the pointer crossed the element's edge, as
 * --hx/--hy on it; the circle itself is CSS (".hover-fill" section of
 * globals.css), so it runs on the compositor and costs no render. One
 * listener on the document serves every target, present and future.
 */
export const hoverFillTargets = [
  ".overview-view .movement-row",
  ".overview-view .account-preview",
  ".overview-view .category-summary",
  ".settings-index li button",
].join(", ");

function place(event: PointerEvent, element: HTMLElement) {
  const box = element.getBoundingClientRect();
  element.style.setProperty("--hx", `${event.clientX - box.left}px`);
  element.style.setProperty("--hy", `${event.clientY - box.top}px`);
}

export function useHoverFill() {
  useEffect(() => {
    // The edge crossed is the one that matters: moves inside the target, from
    // one of its children to another, are not entries or exits.
    const cross = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" && event.pointerType !== "pen") return;
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>(hoverFillTargets) : null;
      if (!target) return;
      const other = event.relatedTarget;
      if (other instanceof Node && target.contains(other)) return;
      place(event, target);
    };
    document.addEventListener("pointerover", cross);
    document.addEventListener("pointerout", cross);
    return () => {
      document.removeEventListener("pointerover", cross);
      document.removeEventListener("pointerout", cross);
    };
  }, []);
}
