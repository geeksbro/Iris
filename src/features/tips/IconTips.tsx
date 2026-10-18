"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/*
 * The name of an icon, after the mouse has rested on it (owner, 18 Oct
 * 2026): a second on a control without clicking (three at first, "too
 * long" the same day), and a small panel under it says what it is —
 * "Nascondi importi" over the eye.
 *
 * One listener for the whole app, lock screen included, so no control has
 * to opt in. A control qualifies when it is an icon (no visible words of
 * its own, a name for assistive tech) or already carried a native tooltip
 * (`title`). The native tooltip is taken off the moment the pointer arrives
 * — it would show after a second, before this one, and twice — and its words
 * are kept: where a control's title says more than its name (the lock
 * screen's "Passa al tema scuro"), the panel says that.
 *
 * Resting means resting: moving more than a few pixels starts the second
 * again, and a click, a key, a scroll or the pointer leaving puts
 * the panel away and keeps it away until the pointer comes back. Only a
 * mouse: touch has no hover to rest in.
 */

export const iconTipDelayMs = 1_000;

/** Movement within this many pixels still counts as resting. */
const restTolerance = 4;
/** The panel's distance from its control, and from the window's edges. */
const tipGap = 10;
const edgeGap = 8;

const controlSelector = 'button, a[href], [role="button"], [role="switch"]';

type Tip = { text: string; left: number; top: number; below: boolean };

/** What the control is called: its tooltip words, else its accessible name. */
function nameOf(control: HTMLElement): string {
  const stashed = control.dataset.tipTitle;
  if (stashed) return stashed;
  const label = control.getAttribute("aria-label");
  if (label) return label;
  const labelledBy = control.getAttribute("aria-labelledby");
  if (labelledBy) {
    return labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
      .filter(Boolean)
      .join(" ");
  }
  return "";
}

/** An icon: no visible words beyond a short mark (EN/IT), but a name. */
function isIcon(control: HTMLElement): boolean {
  const visible = (control.innerText ?? control.textContent ?? "").trim();
  return visible.length <= 3 && Boolean(control.getAttribute("aria-label") || control.getAttribute("aria-labelledby"));
}

function qualifies(control: HTMLElement): boolean {
  if (control.closest("[data-no-tip]")) return false;
  // An open menu or panel already says what the control is.
  if (control.getAttribute("aria-expanded") === "true") return false;
  return control.hasAttribute("title") || Boolean(control.dataset.tipTitle) || isIcon(control);
}

/** Moves a native tooltip's words aside so the browser never shows them. */
function quietNativeTooltip(control: HTMLElement) {
  const title = control.getAttribute("title");
  if (title === null) return;
  if (title) control.dataset.tipTitle = title;
  control.removeAttribute("title");
}

function placeFor(control: HTMLElement, text: string): Tip {
  const box = control.getBoundingClientRect();
  // Under the control, or above it when it sits near the bottom edge.
  const below = box.bottom + tipGap + 40 < window.innerHeight;
  return { text, left: box.left + box.width / 2, top: below ? box.bottom + tipGap : box.top - tipGap, below };
}

export function IconTips() {
  const [tip, setTip] = useState<Tip | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);

  // Centred on its control, but never past the window's edges (the profile
  // sits at the far right): measured before the first paint, then nudged.
  useLayoutEffect(() => {
    const element = tipRef.current;
    if (!element) return;
    const box = element.getBoundingClientRect();
    const pastRight = box.right - (window.innerWidth - edgeGap);
    const pastLeft = edgeGap - box.left;
    const shift = pastRight > 0 ? -pastRight : pastLeft > 0 ? pastLeft : 0;
    element.style.setProperty("--tip-shift", `${Math.round(shift)}px`);
  }, [tip]);

  useEffect(() => {
    let current: HTMLElement | null = null;
    let timer: number | undefined;
    let restX = 0;
    let restY = 0;
    // A click or a key on the control: no panel until the pointer comes back.
    let dismissed = false;

    const clear = () => {
      window.clearTimeout(timer);
      timer = undefined;
      setTip(null);
    };

    const arm = () => {
      window.clearTimeout(timer);
      const control = current;
      if (!control || dismissed) return;
      timer = window.setTimeout(() => {
        if (!control.isConnected || current !== control || !qualifies(control)) return;
        const text = nameOf(control);
        if (text) setTip(placeFor(control, text));
      }, iconTipDelayMs);
    };

    const onOver = (event: PointerEvent) => {
      if (event.pointerType === "touch" || event.pointerType === "pen") return;
      const control = (event.target as Element | null)?.closest?.<HTMLElement>(controlSelector) ?? null;
      if (control === current) return;
      clear();
      current = control && qualifies(control) ? control : null;
      dismissed = false;
      if (!current) return;
      quietNativeTooltip(current);
      restX = event.clientX;
      restY = event.clientY;
      arm();
    };

    const onMove = (event: PointerEvent) => {
      if (!current || dismissed) return;
      // React may give a native tooltip back on a re-render: keep it quiet.
      quietNativeTooltip(current);
      if (Math.hypot(event.clientX - restX, event.clientY - restY) <= restTolerance) return;
      restX = event.clientX;
      restY = event.clientY;
      // Still moving: the panel goes, and the second starts again.
      setTip(null);
      arm();
    };

    const onOut = (event: PointerEvent) => {
      if (!current) return;
      const next = event.relatedTarget as Node | null;
      if (next && current.contains(next)) return;
      current = null;
      dismissed = false;
      clear();
    };

    const dismiss = () => {
      if (!current) return;
      dismissed = true;
      clear();
    };

    const reset = () => {
      current = null;
      dismissed = false;
      clear();
    };

    document.addEventListener("pointerover", onOver);
    document.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerout", onOut);
    document.addEventListener("pointerdown", dismiss, true);
    document.addEventListener("keydown", dismiss, true);
    window.addEventListener("scroll", reset, { capture: true, passive: true });
    window.addEventListener("blur", reset);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerout", onOut);
      document.removeEventListener("pointerdown", dismiss, true);
      document.removeEventListener("keydown", dismiss, true);
      window.removeEventListener("scroll", reset, { capture: true });
      window.removeEventListener("blur", reset);
    };
  }, []);

  if (!tip || typeof document === "undefined") return null;
  return createPortal(
    // The control already carries its name for assistive tech: the panel is
    // for the eye only, so it is not announced a second time.
    <div
      aria-hidden="true"
      className="icon-tip"
      data-side={tip.below ? "below" : "above"}
      ref={tipRef}
      style={{ left: tip.left, top: tip.top }}
    >
      {tip.text}
    </div>,
    document.body,
  );
}
