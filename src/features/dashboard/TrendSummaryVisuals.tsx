import { useState, type CSSProperties } from "react";

import type { WealthSnapshot } from "@/domain/types";
import { useLanguage } from "@/features/i18n/language";

import { Percent } from "./privacy";
import { Money, cx, formatDate, formatPercent } from "./ui";

/*
 * THE TREND SUMMARY'S PICTURES (owner, 18 Oct 2026: "innovate this too").
 * Each draws what its figure says, from the saved updates only:
 *   - current wealth: the saved updates as one line, today's figure as the
 *     last point (a line shows change, so its scale is the series' range);
 *   - all-time high: how much of the high the current wealth is, as a gauge
 *     filled to it, the high at the end;
 *   - latest change: the last changes between updates as bars around zero,
 *     up for gains and down for losses, the latest one solid.
 * A bar or point under the pointer speaks in its cell's detail line.
 */

export type TrendHover = { date: string; amount: number } | null;

export function WealthSpark({ snapshots, currentWealth, onHover }: { snapshots: WealthSnapshot[]; currentWealth: number; onHover: (point: TrendHover) => void }) {
  const [active, setActive] = useState<number | null>(null);
  const series = snapshots.slice(-11).map((snapshot) => ({ date: snapshot.createdAt, amount: snapshot.totalWealth }));
  if (series.length === 0) return null;
  // Today's figure closes the line, unless it is the last update itself.
  const last = series[series.length - 1];
  if (Math.abs(last.amount - currentWealth) > 0.004) series.push({ date: "", amount: currentWealth });
  if (series.length < 2) return null;
  const width = 300;
  const height = 96;
  const low = Math.min(...series.map((point) => point.amount));
  const high = Math.max(...series.map((point) => point.amount));
  const x = (index: number) => 4 + (index / (series.length - 1)) * (width - 8);
  const y = (amount: number) => (high === low ? height / 2 : 6 + (1 - (amount - low) / (high - low)) * (height - 12));
  const points = series.map((point, index) => `${x(index).toFixed(1)},${y(point.amount).toFixed(1)}`).join(" ");
  const marked = active ?? series.length - 1;
  const slot = (width - 8) / (series.length - 1);

  return (
    <svg aria-hidden="true" className="trend-spark" onPointerLeave={() => { setActive(null); onHover(null); }} preserveAspectRatio="none" viewBox={`0 0 ${width} ${height}`}>
      <polyline className="trend-spark__area" points={`${x(0)},${height} ${points} ${x(series.length - 1)},${height}`} />
      <polyline className="trend-spark__path" points={points} vectorEffect="non-scaling-stroke" />
      {active !== null ? <line className="trend-spark__guide" vectorEffect="non-scaling-stroke" x1={x(active)} x2={x(active)} y1={0} y2={height} /> : null}
      <circle className="trend-spark__dot" cx={x(marked)} cy={y(series[marked].amount)} r={4} vectorEffect="non-scaling-stroke" />
      {series.map((point, index) => (
        <rect
          className="trend-spark__hit"
          height={height}
          key={`${point.date}-${index}`}
          onPointerEnter={() => { setActive(index); onHover(point); }}
          width={slot}
          x={x(index) - slot / 2}
          y={0}
        />
      ))}
    </svg>
  );
}

export function HighGauge({ currentWealth, high }: { currentWealth: number; high: number }) {
  const { locale, text } = useLanguage();
  const share = high > 0 ? Math.min(100, Math.max(0, (currentWealth / high) * 100)) : 0;
  const atHigh = currentWealth >= high - 0.004;
  return (
    <div className={cx("high-gauge", atHigh && "is-at-high")}>
      <div aria-hidden="true" className="high-gauge__track">
        <span className="high-gauge__fill" style={{ "--gauge-share": `${share}%` } as CSSProperties} />
        <span className="high-gauge__peak" />
      </div>
      <span className="high-gauge__caption">
        {atHigh
          ? text("Sei al massimo storico", "You are at the all-time high")
          : <><Percent>{formatPercent(share, 1, locale)}</Percent>{text(" del massimo", " of the high")}</>}
      </span>
    </div>
  );
}

export function ChangeBars({ snapshots, onHover }: { snapshots: WealthSnapshot[]; onHover: (point: TrendHover) => void }) {
  const changes = snapshots.slice(-11).flatMap((snapshot, index, list) => (
    index === 0 ? [] : [{ date: snapshot.createdAt, amount: snapshot.totalWealth - list[index - 1].totalWealth }]
  ));
  if (changes.length === 0) return null;
  // The zero line sits where the gains and losses split the height: at the
  // foot when every change is a gain, at the top when every one is a loss.
  const gain = Math.max(0, ...changes.map((change) => change.amount));
  const loss = Math.max(0, ...changes.map((change) => -change.amount));
  const span = Math.max(gain + loss, 1);
  const zero = (gain / span) * 100;

  return (
    <div aria-hidden="true" className="change-bars" onPointerLeave={() => onHover(null)} style={{ "--zero": `${zero}%` } as CSSProperties}>
      <span className="change-bars__zero" />
      {changes.map((change, index) => (
        <span
          className={cx("change-bars__bar", change.amount < 0 ? "is-down" : "is-up", index === changes.length - 1 && "is-latest")}
          key={change.date}
          onPointerEnter={() => onHover(change)}
          style={{ "--bar-size": `${(Math.abs(change.amount) / span) * 100}%`, "--bar-delay": `${index * 40}ms` } as CSSProperties}
        />
      ))}
    </div>
  );
}

/** The detail line while a point or bar is under the pointer. */
export function TrendHoverDetail({ point, signed = false }: { point: NonNullable<TrendHover>; signed?: boolean }) {
  const { locale, text } = useLanguage();
  return (
    <>
      {point.date ? formatDate(point.date, { locale }) : text("Oggi", "Today")}
      {" · "}
      {signed ? (point.amount >= 0 ? "+" : "−") : null}
      <Money amount={signed ? Math.abs(point.amount) : point.amount} />
    </>
  );
}
