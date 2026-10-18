import { useState, type CSSProperties, type ReactNode } from "react";

import { calculateIncomeTotal, paycheckTypeOf } from "@/domain/calculations";
import { paycheckTypes, type Paycheck, type PaycheckType } from "@/domain/types";
import { useLanguage } from "@/features/i18n/language";

import { incomeTypeFill } from "./Charts";
import { Percent } from "./privacy";
import { Money, cx, formatDate, formatPercent, paycheckTypeLabel } from "./ui";

/*
 * THE SUMMARY'S PICTURES (owner, 17 Oct 2026: "bars or a donut" for the Cash
 * Flow summary). Each one draws what its figure already says, from the same
 * scope as the chart below, and adds nothing the records do not hold:
 *   - the year's income by type, a donut in the chart's own type colours;
 *   - every salary as one soft line (owner, same day: no bars, no median
 *     line), the latest point marked. A line shows change, not size, so its
 *     scale is the salaries' own range;
 *   - the twelve months as a ring of twelve arcs, January at the top, like
 *     the mix beside it: filled where something was recorded, a thin outline
 *     where a regular salary is missing (the months the notice below names).
 *     Across all years the ring splits by year instead.
 * Amounts stay behind the eye: every figure goes through Money or Percent.
 */

const ringRadius = 40;
const ringCircumference = 2 * Math.PI * ringRadius;
/** The surface gap between two segments, in the ring's units (≈2px at 92px). */
const ringGap = 2.6;

export function IncomeMix({ paychecks }: { paychecks: Paycheck[] }) {
  const { text } = useLanguage();
  const [active, setActive] = useState<PaycheckType | null>(null);
  const total = calculateIncomeTotal(paychecks);
  const parts = paycheckTypes
    .map((type) => ({ type, amount: calculateIncomeTotal(paychecks.filter((paycheck) => paycheckTypeOf(paycheck) === type)) }))
    .filter((part) => part.amount > 0.004);
  if (total <= 0 || parts.length === 0) return null;

  const share = (amount: number) => (amount / total) * 100;
  // The centre shows the salary's share, or the share the pointer is on (the
  // legend row lights up to name it; owner, 17 Oct 2026: no caption inside).
  const focus = parts.find((part) => part.type === (active ?? "salary")) ?? parts[0];
  const gap = parts.length > 1 ? ringGap : 0;
  // Each segment starts where the shares before it end.
  const segments = parts.map((part, index) => {
    const before = parts.slice(0, index).reduce((sum, previous) => sum + previous.amount, 0);
    const length = (part.amount / total) * ringCircumference;
    return { ...part, start: (before / total) * ringCircumference, length: Math.max(length - gap, 0.6) };
  });

  return (
    <figure className={cx("income-mix", active && "is-focused")} onPointerLeave={() => setActive(null)}>
      <div className="income-mix__ring">
        <svg aria-hidden="true" viewBox="0 0 100 100">
          <g transform="rotate(-90 50 50)">
            {segments.map((segment, index) => (
              <circle
                className={cx("income-mix__segment", active === segment.type && "is-active")}
                cx="50"
                cy="50"
                key={segment.type}
                onPointerEnter={() => setActive(segment.type)}
                r={ringRadius}
                style={{
                  "--segment-length": segment.length,
                  "--ring-circumference": ringCircumference,
                  "--segment-delay": `${index * 90}ms`,
                  stroke: incomeTypeFill[segment.type],
                  strokeDashoffset: -segment.start,
                } as CSSProperties}
              />
            ))}
          </g>
        </svg>
        <span className="income-mix__centre">
          <strong><Percent>{formatPercent(share(focus.amount), 0)}</Percent></strong>
        </span>
      </div>
      <figcaption className="income-mix__legend">
        <ul>
          {parts.map((part) => (
            <li
              className={cx(active === part.type && "is-active")}
              key={part.type}
              onPointerEnter={() => setActive(part.type)}
            >
              <i aria-hidden="true" style={{ background: incomeTypeFill[part.type] }} />
              <span className="income-mix__type">{paycheckTypeLabel(part.type, text)}</span>
              <span className="income-mix__share"><Percent>{formatPercent(share(part.amount))}</Percent></span>
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}

/** The detail line a picture may take over while the pointer is on it. */
export type Hovered = ReactNode | null;

const sparkWidth = 300;
const sparkHeight = 60;
const sparkPad = 5;

export function SalaryLine({ salaries, onHover }: { salaries: Paycheck[]; onHover: (detail: Hovered) => void }) {
  const { locale } = useLanguage();
  const [active, setActive] = useState<number | null>(null);
  // The last twelve, oldest on the left.
  const shown = salaries.slice(0, 12).reverse();
  if (shown.length < 2) return null;
  const amounts = shown.map((paycheck) => paycheck.amount);
  const low = Math.min(...amounts);
  const high = Math.max(...amounts);
  // A line shows change: its scale is the salaries' range. Equal salaries sit
  // on one level line through the middle.
  const y = (amount: number) => high === low
    ? sparkHeight / 2
    : sparkPad + (1 - (amount - low) / (high - low)) * (sparkHeight - 2 * sparkPad);
  const x = (index: number) => sparkPad + (index / (shown.length - 1)) * (sparkWidth - 2 * sparkPad);
  const points = shown.map((paycheck, index) => ({ x: x(index), y: y(paycheck.amount), paycheck }));
  // A gentle curve through every point (Catmull-Rom as cubic Béziers).
  const line = points.reduce((path, point, index) => {
    if (index === 0) return `M${point.x},${point.y}`;
    const before = points[index - 2] ?? points[index - 1];
    const previous = points[index - 1];
    const after = points[index + 1] ?? point;
    const c1x = previous.x + (point.x - before.x) / 6;
    const c1y = previous.y + (point.y - before.y) / 6;
    const c2x = point.x - (after.x - previous.x) / 6;
    const c2y = point.y - (after.y - previous.y) / 6;
    return `${path} C${c1x},${c1y} ${c2x},${c2y} ${point.x},${point.y}`;
  }, "");
  const area = `${line} L${points[points.length - 1].x},${sparkHeight} L${points[0].x},${sparkHeight} Z`;
  const date = (value: string) => formatDate(value, { timeZone: "UTC", locale });
  const marked = points[active ?? points.length - 1];
  const slot = (sparkWidth - 2 * sparkPad) / (shown.length - 1);

  return (
    <svg
      aria-hidden="true"
      className="income-line"
      onPointerLeave={() => { setActive(null); onHover(null); }}
      viewBox={`0 0 ${sparkWidth} ${sparkHeight}`}
    >
      <path className="income-line__area" d={area} />
      <path className="income-line__path" d={line} pathLength={1} />
      {active !== null ? <line className="income-line__guide" x1={marked.x} x2={marked.x} y1={0} y2={sparkHeight} /> : null}
      <circle className="income-line__dot" cx={marked.x} cy={marked.y} r={4} />
      {points.map((point, index) => (
        <rect
          className="income-line__hit"
          height={sparkHeight}
          key={point.paycheck.id}
          onPointerEnter={() => { setActive(index); onHover(<>{date(point.paycheck.paymentDate)} · <Money amount={point.paycheck.amount} /></>); }}
          width={slot}
          x={point.x - slot / 2}
          y={0}
        />
      ))}
    </svg>
  );
}

const clockRadius = 30;
const clockCircumference = 2 * Math.PI * clockRadius;
const clockGap = 3.2;

type Arc = { key: string; className: string; length: number; start: number; describe: string };

function Clock({ arcs, centre, caption, onHover }: { arcs: Arc[]; centre: ReactNode; caption: string; onHover: (detail: Hovered) => void }) {
  const [active, setActive] = useState<string | null>(null);
  return (
    <div className={cx("income-clock", active && "is-focused")} onPointerLeave={() => { setActive(null); onHover(null); }}>
      <svg aria-hidden="true" viewBox="0 0 80 80">
        <g transform="rotate(-90 40 40)">
          {arcs.map((arc, index) => (
            <circle
              className={cx("income-clock__arc", arc.className, active === arc.key && "is-active")}
              cx="40"
              cy="40"
              key={arc.key}
              onPointerEnter={() => { setActive(arc.key); onHover(arc.describe); }}
              r={clockRadius}
              style={{
                "--segment-length": arc.length,
                "--ring-circumference": clockCircumference,
                "--segment-delay": `${index * 30}ms`,
                strokeDashoffset: -arc.start,
              } as CSSProperties}
            />
          ))}
        </g>
      </svg>
      <span aria-hidden="true" className="income-clock__centre">
        <strong>{centre}</strong>
        <small>{caption}</small>
      </span>
    </div>
  );
}

export function MonthRing({
  paychecks,
  year,
  missingMonths,
  onHover,
}: {
  /** The year's payments. */
  paychecks: Paycheck[];
  year: string;
  /** "YYYY-MM" months where a regular salary was not recorded. */
  missingMonths: string[];
  onHover: (detail: Hovered) => void;
}) {
  const { locale, text } = useLanguage();
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const step = clockCircumference / 12;
  const months = Array.from({ length: 12 }, (_, index) => {
    const key = `${year}-${String(index + 1).padStart(2, "0")}`;
    const raw = new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(new Date(`${key}-01T12:00:00Z`));
    return {
      index,
      key,
      name: raw.charAt(0).toLocaleUpperCase(locale) + raw.slice(1),
      count: paychecks.filter((paycheck) => paycheck.paymentDate.startsWith(`${key}-`)).length,
      missing: missingMonths.includes(key),
      future: key > currentMonth,
    };
  });
  const arcs = months.map((month): Arc => ({
    key: month.key,
    start: month.index * step,
    length: step - clockGap,
    className: month.count > 0 ? "is-recorded" : month.missing ? "is-missing" : month.future ? "is-future" : "is-empty",
    describe: month.count > 0
      ? text(`${month.name}: ${month.count} ${month.count === 1 ? "pagamento" : "pagamenti"}`, `${month.name}: ${month.count} ${month.count === 1 ? "payment" : "payments"}`)
      : month.missing
        ? text(`${month.name}: nessuno stipendio registrato`, `${month.name}: no salary recorded`)
        : month.future
          ? text(`${month.name}: non ancora arrivato`, `${month.name}: not here yet`)
          : text(`${month.name}: nessun pagamento`, `${month.name}: no payments`),
  }));
  const recorded = months.filter((month) => month.count > 0).length;

  return <Clock arcs={arcs} caption={text("mesi", "months")} centre={`${recorded}/12`} onHover={onHover} />;
}

export function YearRing({ years, onHover }: { years: { key: string; paychecks: Paycheck[] }[]; onHover: (detail: Hovered) => void }) {
  const { text } = useLanguage();
  // Oldest first, clockwise from the top; the latest year solid.
  const shown = [...years].reverse();
  const total = shown.reduce((sum, group) => sum + group.paychecks.length, 0);
  if (shown.length < 2 || total === 0) return null;
  const arcs = shown.map((group, index): Arc => {
    const before = shown.slice(0, index).reduce((sum, previous) => sum + previous.paychecks.length, 0);
    const count = group.paychecks.length;
    return {
      key: group.key,
      start: (before / total) * clockCircumference,
      length: Math.max((count / total) * clockCircumference - clockGap, 0.6),
      className: index === shown.length - 1 ? "is-recorded" : "is-earlier",
      describe: text(`${group.key}: ${count} ${count === 1 ? "pagamento" : "pagamenti"}`, `${group.key}: ${count} ${count === 1 ? "payment" : "payments"}`),
    };
  });

  return <Clock arcs={arcs} caption={text("anni", "years")} centre={shown.length} onHover={onHover} />;
}
