"use client";

import { useEffect, useId, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

/*
 * THE AMBIENT BACKGROUND (owner, 17 Oct 2026, from a white-lavender waves
 * reference): translucent veils of silk drifting behind the content.
 *
 * Mounted on <body> through a portal: .app-shell has a backdrop-filter,
 * which would make a fixed child scroll with the page. It sits at z-index
 * -1, above the body's colour and under everything else; the rail and the
 * top bar are opaque and cover it, so only the content's ground moves.
 *
 * Every layer is its own element, moved only by `transform` (GPU work), on
 * its own duration — primes apart, started at different points — so no two
 * ever line up into a recognisable loop. Each closes on its first frame, so
 * the cycle has no seam. Far layers travel less than near ones; with a fine
 * pointer the cursor adds a few pixels of parallax through the separate
 * `translate` property, which composes with the animation instead of
 * replacing it. Under reduced motion nothing moves and the composition
 * stays as a still image.
 *
 * The dials live in CSS on `.ambient` (section "AMBIENT BACKGROUND"):
 * --ambient-tempo, --ambient-amplitude, --ambient-parallax and
 * --ambient-intensity.
 */

const subscribeNothing = () => () => {};
const onClient = () => true;
const onServer = () => false;

export function AmbientBackground() {
  const mounted = useSyncExternalStore(subscribeNothing, onClient, onServer);
  const ref = useRef<HTMLDivElement>(null);
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");

  // The cursor's parallax: a fine pointer and motion allowed, one write per frame.
  useEffect(() => {
    const layer = ref.current;
    if (!layer || typeof window.matchMedia !== "function") return;
    const allowed = window.matchMedia("(pointer: fine) and (prefers-reduced-motion: no-preference)");
    if (!allowed.matches) return;
    let frame = 0;
    let x = 0;
    let y = 0;
    const write = () => {
      frame = 0;
      layer.style.setProperty("--ambient-px", x.toFixed(3));
      layer.style.setProperty("--ambient-py", y.toFixed(3));
    };
    const onMove = (event: PointerEvent) => {
      x = (event.clientX / window.innerWidth) * 2 - 1;
      y = (event.clientY / window.innerHeight) * 2 - 1;
      if (!frame) frame = requestAnimationFrame(write);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [mounted]);

  if (!mounted) return null;

  const g = (name: string) => `ambient-${name}-${id}`;
  const veil = (name: string, top: string, bottom: string) => (
    <linearGradient id={g(name)} x1="0" x2="0.35" y1="0" y2="1">
      <stop offset="0" style={{ stopColor: `var(${top})` }} />
      <stop offset="1" style={{ stopColor: `var(${bottom})` }} />
    </linearGradient>
  );
  // Each veil: a translucent fill and a hairline of light along its edge.
  const wave = (className: string, d: string, fill: string, slice = false) => (
    <svg className={`ambient__layer ${className}`} preserveAspectRatio={slice ? "xMaxYMin slice" : "none"} viewBox="0 0 1600 900">
      <path className="ambient__shape" d={d} fill={`url(#${g(fill)})`} vectorEffect="non-scaling-stroke" />
    </svg>
  );

  return createPortal(
    <div aria-hidden="true" className="ambient" ref={ref}>
      {/* The veils' gradients, defined once for every layer. */}
      <svg className="ambient__defs" focusable="false">
        <defs>
          {veil("veil-a", "--ambient-veil-light", "--ambient-veil-deep")}
          {veil("veil-b", "--ambient-veil-deep", "--ambient-veil-light")}
          {veil("veil-c", "--ambient-veil-white", "--ambient-veil-clear")}
        </defs>
      </svg>
      <div className="ambient__ground" />
      <div className="ambient__glow ambient__glow--lilac" />
      <div className="ambient__glow ambient__glow--ice" />
      <div className="ambient__glow ambient__glow--white" />

      {/* Far: two great arcs in the upper right, as in the reference. */}
      {wave("ambient__far ambient__far--one", "M1250,-600 a450,450 0 1,0 1,0 Z", "veil-a", true)}
      {wave("ambient__far ambient__far--two", "M1520,-440 a380,380 0 1,0 1,0 Z", "veil-b", true)}

      {/* Middle: bands across the page, each on its own drift. */}
      {wave("ambient__mid ambient__mid--one", "M0,330 C340,300 640,420 960,470 C1220,510 1420,420 1600,330 L1600,410 C1420,500 1220,590 960,550 C640,500 340,380 0,410 Z", "veil-c")}
      {wave("ambient__mid ambient__mid--two", "M0,620 C300,560 520,700 820,690 C1120,680 1300,520 1600,470 L1600,900 L0,900 Z", "veil-a")}
      {wave("ambient__mid ambient__mid--three", "M0,700 C260,640 480,600 760,680 C1040,760 1300,640 1600,560 L1600,900 L0,900 Z", "veil-b")}

      {/* Near: the foreground veils, a little more travel. */}
      {wave("ambient__near ambient__near--one", "M0,790 C320,710 600,830 900,805 C1200,780 1380,700 1600,690 L1600,900 L0,900 Z", "veil-c")}
      {wave("ambient__near ambient__near--two", "M560,900 C800,760 1080,610 1600,240 L1600,330 C1150,680 880,830 700,900 Z", "veil-c")}
    </div>,
    document.body,
  );
}
