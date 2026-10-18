/*
 * The Cash Flow summary's glyphs that carry a state (morphing skill: a glyph
 * with a state is one glyph whose constant parts stay put while only the
 * difference moves; two icons cross-fading would read as "another icon").
 *
 *   - Income: one year is one calendar; all years slide a second sheet out
 *     from behind it, the front calendar stepping aside to make room.
 *   - Last salary: one arrow, turned up, level or down against the salary
 *     before it. Its shape never changes, only its heading.
 *
 * The state is `data-state` on the svg; the motion is CSS (section "Summary
 * glyphs" in globals.css). Under reduced motion the glyph changes at once.
 */

const svgProps = {
  "aria-hidden": true,
  fill: "none",
  stroke: "currentColor",
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  strokeWidth: 2,
  viewBox: "0 0 24 24",
};

/** "year" = one calendar; "all" = the same calendar with a second sheet behind it. */
export function IncomeYearsGlyph({ scope, size = 20 }: { scope: "year" | "all"; size?: number }) {
  return (
    <svg {...svgProps} className="income-glyph income-glyph--years" data-state={scope} height={size} width={size}>
      <path className="income-glyph__sheet" d="M8 3h10a3 3 0 0 1 3 3v10" pathLength={1} />
      <g className="income-glyph__calendar">
        <rect height="15" rx="2.5" width="16" x="4" y="5.5" />
        <path d="M8 3.5v4M16 3.5v4M4 10.5h16" />
      </g>
    </svg>
  );
}

/** "up" / "level" / "down": the last salary against the one before it. */
export function SalaryTrendGlyph({ trend, size = 20 }: { trend: "up" | "level" | "down"; size?: number }) {
  return (
    <svg {...svgProps} className="income-glyph income-glyph--trend" data-state={trend} height={size} width={size}>
      <g className="income-glyph__arrow">
        <path d="M5 12h14M13 6l6 6-6 6" />
      </g>
    </svg>
  );
}
