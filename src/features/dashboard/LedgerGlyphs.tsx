import type { CSSProperties } from "react";

import type { AccessBucket } from "@/domain/calculations";
import type { AccountVolatility } from "@/domain/types";

import { cx } from "./ui";

/*
 * The accounts ledger's small pictures (owner, 17 Oct 2026: the access
 * ring's language carried into the table). Decorative: every one sits
 * beside the words or the figure it draws, which stay the accessible text.
 */

const ringRadius = 8;
const ringCircumference = 2 * Math.PI * ringRadius;

/** A share of total wealth as a small ring, in its access bucket's colour. */
export function ShareRing({ percentage, access, excluded = false }: { percentage: number; access: AccessBucket; excluded?: boolean }) {
  const length = Math.max(0, Math.min(100, percentage)) / 100 * ringCircumference;
  return (
    <svg aria-hidden="true" className={cx("share-ring", `share-ring--${access}`, excluded && "is-excluded")} viewBox="0 0 22 22">
      <circle className="share-ring__track" cx="11" cy="11" r={ringRadius} />
      {excluded ? null : (
        <circle
          className="share-ring__value"
          cx="11"
          cy="11"
          r={ringRadius}
          style={{ "--share-length": length, "--share-circumference": ringCircumference } as CSSProperties}
          transform="rotate(-90 11 11)"
        />
      )}
    </svg>
  );
}

/*
 * Volatility as the line it describes: flat when stable, a gentle wave when
 * moderate, a sharp zig-zag when volatile, a dotted line when not set.
 */
const volatilityPaths: Record<AccountVolatility | "unset", string> = {
  stable: "M1 6 H23",
  moderate: "M1 6 C4 2.5 7 2.5 9 6 S14 9.5 17 6 S21 3 23 4.5",
  volatile: "M1 7 L4 2 L7 10 L10 3 L13 9 L16 1.5 L19 8.5 L23 4",
  unset: "M1 6 H23",
};

export function VolatilityGlyph({ volatility }: { volatility?: AccountVolatility }) {
  const kind = volatility ?? "unset";
  return (
    <svg aria-hidden="true" className={cx("volatility-glyph", `volatility-glyph--${kind}`)} viewBox="0 0 24 12">
      <path d={volatilityPaths[kind]} />
    </svg>
  );
}

/*
 * A balance's recent course, read from the saved updates (snapshots) only:
 * the last twelve values as one line, the newest marked, and the change
 * since the update before it. A line shows change, not size, so its scale
 * is the series' own range. One update or none: nothing is drawn.
 */
const sparkWidth = 132;
const sparkHeight = 30;
const sparkPad = 3;

export function TrendLine({ values, access }: { values: number[]; access: AccessBucket }) {
  const shown = values.slice(-12);
  if (shown.length < 2) return null;
  const low = Math.min(...shown);
  const high = Math.max(...shown);
  const x = (index: number) => sparkPad + (index / (shown.length - 1)) * (sparkWidth - 2 * sparkPad);
  const y = (value: number) => high === low
    ? sparkHeight / 2
    : sparkPad + (1 - (value - low) / (high - low)) * (sparkHeight - 2 * sparkPad);
  const points = shown.map((value, index) => `${x(index).toFixed(1)},${y(value).toFixed(1)}`);
  const last = shown.length - 1;
  return (
    <svg aria-hidden="true" className={cx("trend-line", `trend-line--${access}`)} viewBox={`0 0 ${sparkWidth} ${sparkHeight}`}>
      <polyline className="trend-line__area" points={`${x(0)},${sparkHeight} ${points.join(" ")} ${x(last)},${sparkHeight}`} />
      <polyline className="trend-line__path" pathLength={1} points={points.join(" ")} />
      <circle className="trend-line__dot" cx={x(last)} cy={y(shown[last])} r={2.6} />
    </svg>
  );
}
