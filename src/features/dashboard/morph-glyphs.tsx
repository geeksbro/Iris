"use client";

import { useId } from "react";

/**
 * Top-bar glyphs that morph instead of cross-fading (morphing skill).
 *
 * The eye, the speaker and the sun/moon each carry a state, so they are drawn
 * as ONE glyph whose constant parts stay put while only the difference moves:
 * a slash draws across the eye, the sound waves retract and an X draws in, the
 * sun's rays fold in while a bite slides over the disc to leave a crescent.
 * Two different icons cross-fading would read as "another icon appeared", not
 * as "this one changed".
 *
 * The state lives on the parent `.icon-swap[data-state]` ("shown" / "hidden"),
 * exactly as before, so tests and the rest of the bar keep reading it there.
 * All motion is CSS (section "TOP-BAR GLYPH MORPHS" in globals.css); under
 * reduced motion the glyph changes at once.
 */

/** A DOM-safe id for masks and clips: two toggles can share a page (bar and profile panel). */
function useSvgId(prefix: string): string {
  return `${prefix}-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
}

const svgProps = {
  "aria-hidden": true,
  fill: "none",
  stroke: "currentColor",
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  strokeWidth: 2,
  viewBox: "0 0 24 24",
};

/** Privacy eye: "shown" = open eye; "hidden" = the same eye, struck through. */
export function EyeGlyph({ size = 20 }: { size?: number }) {
  const cut = useSvgId("eye-cut");
  return (
    <svg {...svgProps} className="glyph-morph glyph-eye" height={size} width={size}>
      <defs>
        {/* The slash cuts a gap through the eye as it draws, like lucide's EyeOff. */}
        <mask id={cut} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
          <rect fill="white" height="24" width="24" />
          <path className="glyph-eye__gap" d="M3 3l18 18" pathLength={1} stroke="black" strokeWidth={5} />
        </mask>
      </defs>
      <g mask={`url(#${cut})`}>
        <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
        <circle className="glyph-eye__pupil" cx="12" cy="12" r="3" />
      </g>
      <path className="glyph-eye__slash" d="M3 3l18 18" pathLength={1} />
    </svg>
  );
}

/** Interface sounds: "shown" = speaker with waves; "hidden" = the same speaker, muted. */
export function SoundGlyph({ size = 20 }: { size?: number }) {
  return (
    <svg {...svgProps} className="glyph-morph glyph-sound" height={size} width={size}>
      <path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z" />
      <path className="glyph-sound__wave glyph-sound__wave--near" d="M16 9a5 5 0 0 1 0 6" pathLength={1} />
      <path className="glyph-sound__wave glyph-sound__wave--far" d="M19.364 18.364a9 9 0 0 0 0-12.728" pathLength={1} />
      <path className="glyph-sound__x glyph-sound__x--a" d="M22 9l-6 6" pathLength={1} />
      <path className="glyph-sound__x glyph-sound__x--b" d="M16 9l6 6" pathLength={1} />
    </svg>
  );
}

/**
 * Theme: "shown" = sun (light theme in force); "hidden" = moon (dark).
 * One disc: in the sun it is small with rays; for the moon the rays fold in,
 * the disc grows and a bite slides over it. The bite's edge is drawn only
 * inside the disc (plus half a stroke, so the two outlines meet without
 * notches), so the crescent keeps a closed outline. The clip sits on a group
 * that never moves: a clip on the moving circle would travel with it.
 */
export function ThemeGlyph({ size = 19 }: { size?: number }) {
  const bite = useSvgId("theme-bite");
  const disc = useSvgId("theme-disc");
  return (
    <svg {...svgProps} className="glyph-morph glyph-theme" height={size} width={size}>
      <defs>
        <mask id={bite} maskUnits="userSpaceOnUse" x="-12" y="-12" width="48" height="48">
          <rect fill="white" height="48" width="48" x="-12" y="-12" />
          <circle className="glyph-theme__bite" cx="17.5" cy="6.5" fill="black" r="6" stroke="none" />
        </mask>
        <clipPath id={disc}>
          <circle className="glyph-theme__disc-area" cx="12" cy="12" />
        </clipPath>
      </defs>
      <g className="glyph-theme__body">
        <circle className="glyph-theme__disc" cx="12" cy="12" mask={`url(#${bite})`} />
        <g clipPath={`url(#${disc})`}>
          <circle className="glyph-theme__bite glyph-theme__bite-edge" cx="17.5" cy="6.5" r="6" />
        </g>
        <g className="glyph-theme__rays">
          <path d="M12 2v2" />
          <path d="M12 20v2" />
          <path d="m4.93 4.93 1.41 1.41" />
          <path d="m17.66 17.66 1.41 1.41" />
          <path d="M2 12h2" />
          <path d="M20 12h2" />
          <path d="m6.34 17.66-1.41 1.41" />
          <path d="m19.07 4.93-1.41 1.41" />
        </g>
      </g>
    </svg>
  );
}
