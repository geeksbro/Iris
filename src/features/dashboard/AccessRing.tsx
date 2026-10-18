import { useId, type CSSProperties } from "react";

import type { AccessBucket } from "@/domain/calculations";

import { Percent } from "./privacy";
import { cx, formatPercent } from "./ui";

/*
 * THE ACCESS RING (owner, 17 Oct 2026: the Cash Flow summary's language on
 * the Accounts page). The wealth split by how fast it can be reached, as one
 * ring in the access colours, clockwise from the top: immediate, within days,
 * locked, then what has no timing yet, hatched as everywhere else. The centre
 * holds one number and no caption: the share of the bucket the pointer is
 * on, or the share reachable at once. The rows beside it name each bucket.
 */

const radius = 40;
const circumference = 2 * Math.PI * radius;
/** The surface gap between segments, in the ring's units (≈2px at 148px). */
const gap = 1.6;

export function AccessRing({
  shares,
  active,
  onActive,
}: {
  /** Percent of total wealth per bucket, in ring order. */
  shares: { access: AccessBucket; percentage: number }[];
  active: AccessBucket | null;
  onActive: (access: AccessBucket | null) => void;
}) {
  const hatch = `access-hatch-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const drawn = shares.filter((share) => share.percentage > 0);
  const focus = shares.find((share) => share.access === (active ?? "immediate")) ?? shares[0];
  const segmentGap = drawn.length > 1 ? gap : 0;
  const segments = drawn.map((share, index) => {
    const before = drawn.slice(0, index).reduce((sum, previous) => sum + previous.percentage, 0);
    const length = (share.percentage / 100) * circumference;
    return { ...share, start: (before / 100) * circumference, length: Math.max(length - segmentGap, 0.6) };
  });

  return (
    <div className={cx("access-ring", active && "is-focused")} onPointerLeave={() => onActive(null)}>
      <svg aria-hidden="true" viewBox="0 0 100 100">
        <defs>
          <pattern height="5" id={hatch} patternTransform="rotate(45)" patternUnits="userSpaceOnUse" width="5">
            <rect className="access-ring__hatch-ground" height="5" width="5" />
            <rect className="access-ring__hatch-line" height="5" width="1.6" />
          </pattern>
        </defs>
        <circle className="access-ring__track" cx="50" cy="50" r={radius} />
        <g transform="rotate(-90 50 50)">
          {segments.map((segment, index) => (
            <circle
              className={cx("access-ring__segment", `access-ring__segment--${segment.access}`, active === segment.access && "is-active")}
              cx="50"
              cy="50"
              key={segment.access}
              onPointerEnter={() => onActive(segment.access)}
              r={radius}
              style={{
                "--segment-length": segment.length,
                "--ring-circumference": circumference,
                "--segment-delay": `${index * 90}ms`,
                strokeDashoffset: -segment.start,
                ...(segment.access === "unclassified" ? { stroke: `url(#${hatch})` } : {}),
              } as CSSProperties}
            />
          ))}
        </g>
      </svg>
      <strong className="access-ring__centre">
        {focus ? <Percent>{formatPercent(focus.percentage, 0)}</Percent> : "—"}
      </strong>
    </div>
  );
}
