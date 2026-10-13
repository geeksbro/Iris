"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  Rectangle,
  ReferenceLine,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type RectangleProps,
} from "recharts";

import { calculateIncomeTotal, calculateSnapshotDelta, paycheckTypeOf, type CategoryTotals } from "@/domain/calculations";
import { formatCurrency } from "@/domain/formatters";
import { paycheckTypes, type AccountCategory, type Paycheck, type PaycheckType, type WealthSnapshot } from "@/domain/types";
import type { ScenarioPoint } from "@/domain/scenarios";
import { useLanguage } from "@/features/i18n/language";

import { useEntranceDelay } from "./entrance";
import { categoryColors, categoryLabels, cx, formatDate, formatPercent, paycheckTypeLabel } from "./ui";
import { Percent, Sensitive, usePrivacy } from "./privacy";

export type HistoryRange = "1M" | "3M" | "6M" | "YTD" | "1Y" | "ALL";

const ranges: HistoryRange[] = ["1M", "3M", "6M", "YTD", "1Y", "ALL"];

function subtractCalendarMonths(date: Date, months: number): Date {
  const result = new Date(date);
  const originalDay = result.getDate();
  result.setDate(1);
  result.setMonth(result.getMonth() - months);
  const lastDayOfTargetMonth = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(originalDay, lastDayOfTargetMonth));
  return result;
}

function filterSnapshots(snapshots: WealthSnapshot[], range: HistoryRange): WealthSnapshot[] {
  if (range === "ALL" || snapshots.length === 0) {
    return snapshots;
  }

  const latest = new Date(snapshots[snapshots.length - 1].createdAt);
  const cutoff = new Date(latest);
  if (range === "YTD") {
    cutoff.setMonth(0, 1);
    cutoff.setHours(0, 0, 0, 0);
  } else {
    const months = range === "1M" ? 1 : range === "3M" ? 3 : range === "6M" ? 6 : 12;
    return snapshots.filter((snapshot) => new Date(snapshot.createdAt) >= subtractCalendarMonths(cutoff, months));
  }

  return snapshots.filter((snapshot) => new Date(snapshot.createdAt) >= cutoff);
}

function localCalendarDayKey(value: string): string {
  const parts = new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(new Date(value));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function buildWealthHistoryTickLabels(values: string[], locale: string): Record<string, string> {
  const dayCounts = values.reduce<Record<string, number>>((counts, value) => {
    const dayKey = localCalendarDayKey(value);
    counts[dayKey] = (counts[dayKey] ?? 0) + 1;
    return counts;
  }, {});

  return Object.fromEntries(values.map((value) => {
    const dateLabel = formatDate(value, { locale }).replace(/\s\d{4}$/, "");
    if (dayCounts[localCalendarDayKey(value)] === 1) {
      return [value, dateLabel];
    }

    const timeLabel = new Intl.DateTimeFormat(locale, {
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
    return [value, `${dateLabel}, ${timeLabel}`];
  }));
}

export function formatWealthAxisTick(value: number, locale: string): string {
  if (value === 0) {
    return "";
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value / 1000)}k`;
}

/*
 * The period, as one dropdown: the app's native select (as in its windows),
 * so the platform draws the list — a sheet on phones, the keyboard's arrows
 * and type-ahead on desktop — and the chosen period stays in the trigger.
 * A period that could not change the view is offered but disabled.
 */
function RangeSelector({
  label,
  labels,
  onChange,
  range,
  snapshots,
}: {
  label: string;
  labels: Record<HistoryRange, string>;
  onChange: (range: HistoryRange) => void;
  range: HistoryRange;
  snapshots: WealthSnapshot[];
}) {
  return (
    <span className="range-select">
      <select
        aria-label={label}
        className="range-select__control"
        onChange={(event) => onChange(event.target.value as HistoryRange)}
        value={range}
      >
        {ranges.map((item) => (
          <option disabled={!isHistoryRangeUseful(snapshots, item)} key={item} value={item}>
            {labels[item]}
          </option>
        ))}
      </select>
      <ChevronDown aria-hidden="true" className="range-select__chevron" size={15} strokeWidth={2.25} />
    </span>
  );
}

export function isHistoryRangeUseful(snapshots: WealthSnapshot[], range: HistoryRange): boolean {
  return range === "ALL" || filterSnapshots(snapshots, range).length !== snapshots.length;
}

export function WealthHistoryChart({
  snapshots,
  allTimeHigh,
  goalTarget,
  header,
  markerRadius = 3.5,
  labelLatest = false,
  curve = "monotone",
}: {
  snapshots: WealthSnapshot[];
  allTimeHigh?: number;
  goalTarget?: number;
  /** When given, the heading and the range selector share one wrapping row, so they can never overlap. */
  header?: ReactNode;
  /** Radius of the observation markers; the hover marker is drawn 1.5px larger. */
  markerRadius?: number;
  /** Writes the latest plotted total beside its marker: an end label, not a new figure. */
  labelLatest?: boolean;
  /** "linear" joins observations with straight segments, so no curve suggests a value between them. */
  curve?: "monotone" | "linear";
}) {
  const [range, setRange] = useState<HistoryRange>("ALL");
  // Set by the first period change: from then on the chart cross-fades to the
  // new range. The line itself never tweens between two different datasets.
  const [rangeChanged, setRangeChanged] = useState(false);
  const { amountsHidden } = usePrivacy();
  const { locale, text } = useLanguage();
  const data = useMemo(() => {
    const visible = filterSnapshots(snapshots, range);
    return visible.map((snapshot) => {
      const sourceIndex = snapshots.findIndex((item) => item.id === snapshot.id);
      const change = calculateSnapshotDelta(snapshot, snapshots[sourceIndex - 1]);
      return {
        date: snapshot.createdAt,
        wealth: snapshot.totalWealth,
        changeAmount: change?.amount ?? null,
        changePercentage: change?.percentage ?? null,
      };
    });
  }, [range, snapshots]);
  const tickLabels = useMemo(
    () => buildWealthHistoryTickLabels(data.map((point) => point.date), locale),
    [data, locale],
  );
  // Across calendar years a day and month alone are ambiguous, so the tick adds a two-digit year.
  const spansYears = data.length > 1 && new Date(data[0].date).getFullYear() !== new Date(data[data.length - 1].date).getFullYear();
  // Display labels only: the HistoryRange values stay as they are.
  const rangeLabels: Record<HistoryRange, string> = {
    "1M": "1M",
    "3M": "3M",
    "6M": "6M",
    YTD: "YTD",
    "1Y": text("1A", "1Y"),
    ALL: text("Tutto", "All"),
  };

  const rangeSelector = snapshots.length >= 2 ? (
    <RangeSelector
      label={text("Periodo dell'andamento", "Trend period")}
      labels={rangeLabels}
      onChange={(next) => {
        setRange(next);
        setRangeChanged(true);
      }}
      range={range}
      snapshots={snapshots}
    />
  ) : null;

  return (
    <div className={cx("chart-block", header !== undefined && "chart-block--with-header")}>
      {header !== undefined ? (
        <div className="chart-block__header">
          {header}
          {rangeSelector}
        </div>
      ) : rangeSelector}
      {data.length < 2 ? (
        <div className={cx("chart-empty", rangeChanged && "is-range-update")} key={`empty-${range}`} role="status">
          <div className="chart-empty__line" aria-hidden="true" />
          <strong>{snapshots.length >= 2 ? text("Nessun confronto in questo intervallo.", "No comparison in this range.") : text("Lo storico inizia con il prossimo aggiornamento.", "History starts with your next update.")}</strong>
          <span>
            {snapshots.length >= 2
              ? text("Scegli un periodo più ampio per confrontare gli aggiornamenti salvati.", "Choose a longer period to compare saved updates.")
              : snapshots.length === 0
                // A new archive: there is no update yet to repeat.
                ? text("Salva il primo aggiornamento dei saldi, poi un altro, per vedere l'andamento del patrimonio.", "Save a first balance update, then another, to reveal your wealth trend.")
                : text("Aggiorna di nuovo i saldi per vedere l'andamento del patrimonio.", "Update your balances again to reveal your wealth trend.")}
          </span>
        </div>
      ) : (
        <div className={cx("chart-canvas chart-canvas--history", rangeChanged && "is-range-update")} key={range}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: labelLatest ? 30 : 18, right: 8, left: 0, bottom: 0 }}>
              {/* Chart ink reads --chart-* tokens with the previous values as
                  fallbacks: a view that defines none renders exactly as before. */}
              <defs>
                <linearGradient id="wealth-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--chart-line, var(--teal))" style={{ stopOpacity: "var(--chart-fill-top, 0.28)" }} />
                  <stop offset="100%" stopColor="var(--chart-line, var(--teal))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--chart-grid, var(--line-soft))" vertical={false} />
              <XAxis
                axisLine={false}
                dataKey="date"
                height={44}
                interval={data.length <= 8 ? 0 : "preserveStartEnd"}
                minTickGap={32}
                padding={{ right: 52 }}
                tick={{ fill: "var(--chart-tick, var(--muted))", fontSize: 11 }}
                tickFormatter={(value: string) => {
                  const label = tickLabels[value] ?? formatDate(value, { locale }).replace(/\s\d{4}$/, "");
                  return spansYears && !label.includes(",") ? `${label} ${String(new Date(value).getFullYear()).slice(2)}` : label;
                }}
                tickMargin={18}
                tickLine={false}
              />
              <YAxis
                axisLine={false}
                tick={{ fill: "var(--chart-tick, var(--muted))", fontSize: 11 }}
                tickFormatter={(value: number) => (amountsHidden ? "*" : formatWealthAxisTick(value, locale))}
                tickMargin={18}
                tickLine={false}
                width={54}
              />
              {allTimeHigh !== undefined ? (
                <ReferenceLine
                  label={{ value: "ATH", fill: "var(--chart-ath-label, var(--muted))", fontSize: 10, position: "insideTopRight" }}
                  stroke="var(--chart-ath, var(--text))"
                  strokeDasharray="4 4"
                  y={allTimeHigh}
                />
              ) : null}
              {goalTarget !== undefined ? (
                <ReferenceLine
                  label={{ value: text("OBIETTIVO", "GOAL"), fill: "var(--chart-goal, var(--blue))", fontSize: 10, position: "insideTopRight" }}
                  stroke="var(--chart-goal, var(--blue))"
                  strokeDasharray="7 5"
                  y={goalTarget}
                />
              ) : null}
              <Tooltip
                content={(props) => {
                  const point = props.payload?.[0]?.payload as HistoryPoint | undefined;
                  return <WealthHistoryTooltip active={props.active} point={point} />;
                }}
                cursor={{ stroke: "var(--chart-cursor, #ccc)", strokeWidth: 1 }}
              />
              <Area
                activeDot={{ fill: "var(--chart-active-fill, var(--surface-high))", r: markerRadius + 1.5, stroke: "var(--chart-active-ring, var(--teal))", strokeWidth: 2 }}
                dataKey="wealth"
                dot={{ fill: "var(--chart-dot-fill, var(--surface-high))", r: markerRadius, stroke: "var(--chart-line, var(--teal))", strokeWidth: 2 }}
                fill="url(#wealth-fill)"
                isAnimationActive={false}
                label={labelLatest
                  ? (props: { x?: number | string; y?: number | string; index?: number }) => {
                      if (props.index !== data.length - 1 || props.x === undefined || props.y === undefined) {
                        return <g key={`label-${props.index}`} />;
                      }
                      const latest = formatCurrency(data[data.length - 1].wealth);
                      // Below the marker after a fall, so the label never sits on the descending line.
                      const fell = data.length > 1 && data[data.length - 1].wealth < data[data.length - 2].wealth;
                      return (
                        <text
                          className="chart-latest-label"
                          key="latest-label"
                          textAnchor="end"
                          x={Number(props.x) + markerRadius}
                          y={fell ? Number(props.y) + markerRadius + 20 : Number(props.y) - markerRadius - 10}
                        >
                          {amountsHidden ? latest.replace(/\d/g, "*") : latest}
                        </text>
                      );
                    }
                  : undefined}
                stroke="var(--chart-line, var(--teal))"
                strokeWidth={2}
                type={curve}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

export type HistoryPoint = {
  date: string;
  wealth: number;
  changeAmount: number | null;
  changePercentage: number | null;
};

export function WealthHistoryTooltip({ active, point }: { active?: boolean; point?: HistoryPoint }) {
  const { locale, text } = useLanguage();
  if (!active || !point) {
    return null;
  }

  const tone = point.changeAmount === null || point.changeAmount === 0
    ? "neutral"
    : point.changeAmount > 0 ? "positive" : "negative";

  return (
    <div className="chart-tooltip">
      <span>{formatDate(point.date, { includeTime: true, locale })}</span>
      <strong><Sensitive>{formatCurrency(point.wealth)}</Sensitive></strong>
      <small className={cx("chart-tooltip__change", `chart-tooltip__change--${tone}`)}>
        {point.changeAmount === null
          ? text("Primo aggiornamento salvato", "First saved update")
          : <>
              <Sensitive>{`${point.changeAmount >= 0 ? "+" : ""}${formatCurrency(point.changeAmount)} · ${point.changePercentage === null ? "—" : `${point.changePercentage >= 0 ? "+" : ""}${formatPercent(point.changePercentage)}`}`}</Sensitive>
              {" "}
              <span className="chart-tooltip__basis">{text("rispetto al precedente", "vs the previous")}</span>
            </>}
      </small>
    </div>
  );
}

/**
 * The shape of the stored history, drawn small inside the wealth hero. It plots
 * the same saved totals as the main chart and nothing else: straight segments
 * between observations, so no curve suggests a value that was never recorded.
 * The vertical scale is padded by at least 5% of the level, so a small move
 * reads as a gentle slope rather than a cliff. The main chart below carries
 * the axes; hovering the line shows the same tooltip as the main chart, for
 * the saved update under the pointer (owner, 26 Sep 2026).
 */
export function WealthSparkline({ snapshots }: { snapshots: WealthSnapshot[] }) {
  const data: HistoryPoint[] = snapshots.map((snapshot, index) => {
    const change = calculateSnapshotDelta(snapshot, snapshots[index - 1]);
    return {
      date: snapshot.createdAt,
      wealth: snapshot.totalWealth,
      changeAmount: change?.amount ?? null,
      changePercentage: change?.percentage ?? null,
    };
  });
  if (data.length < 2) {
    return null;
  }

  const values = data.map((point) => point.wealth);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const padding = Math.max((maximum - minimum) * 0.35, Math.abs(maximum) * 0.05, 1);
  const lastIndex = data.length - 1;
  // Keyed by the saved totals: new data remounts the line (and replays its
  // fade) instead of morphing the old line into the new one.
  const signature = data.map((point) => `${point.date}:${point.wealth}`).join("|");

  return (
    <div className="wealth-sparkline" aria-hidden="true" key={signature}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 10, right: 10, bottom: 10, left: 4 }}>
          <defs>
            <linearGradient id="wealth-sparkline-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--hero-spark)" stopOpacity={0.2} />
              <stop offset="100%" stopColor="var(--hero-spark)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="date" hide />
          <YAxis domain={[minimum - padding, maximum + padding]} hide />
          {/* The line is shorter than the card, so the card is pinned to the
              top of the line's box and lifted above it by CSS: never over the
              line, never past the hero's clipped edge. */}
          <Tooltip
            allowEscapeViewBox={{ x: false, y: true }}
            position={{ y: 0 }}
            content={(props) => {
              const point = props.payload?.[0]?.payload as HistoryPoint | undefined;
              return <WealthHistoryTooltip active={props.active} point={point} />;
            }}
            cursor={{ stroke: "var(--hero-spark)", strokeOpacity: 0.45, strokeWidth: 1 }}
            isAnimationActive={false}
          />
          <Area
            activeDot={{ className: "wealth-sparkline__active", r: 4.5 }}
            dataKey="wealth"
            dot={(props: { cx?: number; cy?: number; index?: number }) => (
              props.index === lastIndex && props.cx !== undefined && props.cy !== undefined
                ? <circle className="wealth-sparkline__end" cx={props.cx} cy={props.cy} key="end" r={3.5} />
                : <g key={props.index} />
            )}
            fill="url(#wealth-sparkline-fill)"
            isAnimationActive={false}
            stroke="var(--hero-spark)"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.75}
            type="linear"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function AllocationChart({ totals }: { totals: CategoryTotals }) {
  const { categoryLabel, text } = useLanguage();
  // During the dashboard entrance the ring's sweep waits for its panel's turn;
  // the composition itself is unchanged.
  const entranceDelay = useEntranceDelay();
  const total = Object.values(totals).reduce((sum, value) => sum + value, 0);
  const data = (Object.keys(categoryLabels) as AccountCategory[]).map((category) => ({
    category,
    name: categoryLabel(category),
    value: totals[category],
    percentage: total > 0 ? (totals[category] / total) * 100 : 0,
  }));
  const allocationAnimationKey = data
    .filter((item) => item.value > 0)
    .map((item) => `${item.category}-${item.value}`)
    .join("|");

  if (data.every((item) => item.value === 0)) {
    return (
      <div className="allocation-visual allocation-visual--empty" aria-label={text("Composizione per categoria", "Composition by category")} role="status">
        <strong>{text("Nessun conto incluso nel Patrimonio totale.", "No account is included in Total Wealth.")}</strong>
        <span>{text("Includi un conto nel Patrimonio totale per mostrarne la composizione.", "Include an account in Total Wealth to reveal its composition.")}</span>
      </div>
    );
  }

  return (
    <div className="allocation-visual" aria-label={text("Composizione per categoria", "Composition by category")}>
      <div className="allocation-chart" aria-hidden="true">
        <ResponsiveContainer key={allocationAnimationKey} width="100%" height="100%">
          <PieChart>
            {/* The ring draws itself segment by segment; "auto" skips it under reduced motion. */}
            <Pie
              animationBegin={150 + entranceDelay}
              animationDuration={900}
              animationEasing="ease-out"
              data={data.filter((item) => item.value > 0)}
              cornerRadius={4}
              dataKey="value"
              innerRadius="78%"
              isAnimationActive="auto"
              outerRadius="96%"
              paddingAngle={3}
              stroke="none"
            >
              {data.filter((item) => item.value > 0).map((entry) => (
                <Cell fill={categoryColors[entry.category]} key={entry.category} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <span className="allocation-chart__total">
          <strong><Sensitive>{formatCurrency(total)}</Sensitive></strong>
          <small>{text("Patrimonio totale", "Total wealth")}</small>
        </span>
      </div>
      <div className="allocation-legend">
        {data.map((item) => (
          <div key={item.category}>
            <span className="legend-dot" style={{ background: categoryColors[item.category] }} />
            <span>{item.name}</span>
            <span className="allocation-legend__metrics">
              <strong><Sensitive>{formatCurrency(item.value)}</Sensitive></strong>
              <small><Percent>{formatPercent(item.percentage)}</Percent></small>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AccountHistoryChart({
  accountId,
  snapshots,
}: {
  accountId: string;
  snapshots: WealthSnapshot[];
}) {
  const { amountsHidden } = usePrivacy();
  const { locale, text } = useLanguage();
  const data = snapshots.flatMap((snapshot) => {
    const balance = snapshot.accountBalances.find((entry) => entry.accountId === accountId);
    return balance ? [{ date: snapshot.createdAt, balance: balance.balance }] : [];
  });

  if (data.length < 2) {
    return <p className="inline-empty">{text("Serve un'altra rilevazione salvata per mostrare lo storico del saldo.", "Another snapshot is needed to show Balance History.")}</p>;
  }

  return (
    <div className="chart-canvas chart-canvas--compact">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
          <XAxis dataKey="date" hide />
          <YAxis hide domain={["dataMin", "dataMax"]} />
          <Tooltip
            contentStyle={{ background: "var(--pw-surface)", border: "1px solid var(--pw-hairline)", borderRadius: 12, boxShadow: "0 12px 28px -12px rgba(21, 26, 54, 0.22)", color: "var(--pw-ink)", fontSize: 13 }}
            cursor={{ stroke: "var(--chart-cursor, #c7cae0)", strokeWidth: 1 }}
            formatter={(value) => [amountsHidden ? "*****" : formatCurrency(Number(value)), text("Saldo", "Balance")]}
            itemStyle={{ color: "var(--pw-ink)", fontWeight: 600 }}
            labelFormatter={(label) => formatDate(String(label), { locale })}
            labelStyle={{ color: "var(--pw-ink-3)", marginBottom: 2 }}
            separator=": "
          />
          <Area
            activeDot={{ r: 4, fill: "var(--pw-accent)", stroke: "var(--pw-surface)", strokeWidth: 2 }}
            dataKey="balance"
            fill="var(--pw-accent)"
            fillOpacity={0.08}
            stroke="var(--pw-accent)"
            strokeWidth={2}
            type="linear"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export type IncomeMonth = { month: string; total: number | null; count: number };

/**
 * A view over the stored paychecks, never persisted: one entry per calendar
 * month from the first to the last payment. Months with no payment keep
 * `total: null`, so a gap stays a gap instead of reading as income of zero.
 */
export function summarizeIncomeByMonth(paychecks: ReadonlyArray<Paycheck>): IncomeMonth[] {
  const groups = new Map<string, Paycheck[]>();
  for (const paycheck of paychecks) {
    const key = paycheck.paymentDate.slice(0, 7);
    groups.set(key, [...(groups.get(key) ?? []), paycheck]);
  }
  const keys = [...groups.keys()].sort();
  if (keys.length === 0) return [];

  const months: IncomeMonth[] = [];
  let [year, month] = keys[0].split("-").map(Number);
  const [lastYear, lastMonth] = keys[keys.length - 1].split("-").map(Number);
  while (year < lastYear || (year === lastYear && month <= lastMonth)) {
    const key = `${year}-${String(month).padStart(2, "0")}`;
    const payments = groups.get(key) ?? [];
    months.push({ month: key, total: payments.length > 0 ? calculateIncomeTotal(payments) : null, count: payments.length });
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
}

/** What the income chart shows: one calendar year ("2025"), or every year summed ("all"). */
export type IncomeScope = string;
export const allIncomeYears: IncomeScope = "all";

/** A month's income split by type; a type with no payment that month is absent. */
export type IncomeCalendarMonth = IncomeMonth & { types: Partial<Record<PaycheckType, number>> };

/**
 * The twelve calendar months, January to December, for one year or for all of
 * them summed month by month (owner, 26 Sep 2026: the year is chosen, so the
 * axis names months only). Keys are "01"–"12". A month with no payment keeps
 * `total: null`, so a gap stays a gap instead of reading as income of zero.
 */
export function summarizeIncomeByCalendarMonth(paychecks: ReadonlyArray<Paycheck>, scope: IncomeScope): IncomeCalendarMonth[] {
  const inScope = scope === allIncomeYears ? paychecks : paychecks.filter((paycheck) => paycheck.paymentDate.startsWith(`${scope}-`));
  return Array.from({ length: 12 }, (_, index) => {
    const month = String(index + 1).padStart(2, "0");
    const payments = inScope.filter((paycheck) => paycheck.paymentDate.slice(5, 7) === month);
    const types: Partial<Record<PaycheckType, number>> = {};
    for (const type of paycheckTypes) {
      const ofType = payments.filter((paycheck) => paycheckTypeOf(paycheck) === type);
      if (ofType.length > 0) types[type] = calculateIncomeTotal(ofType);
    }
    return { month, total: payments.length > 0 ? calculateIncomeTotal(payments) : null, count: payments.length, types };
  });
}

/** A calendar month by its "01"–"12" key: "gen" / "gennaio", with no year. */
export function formatCalendarMonth(month: string, locale: string, style: "long" | "short"): string {
  const formatted = new Intl.DateTimeFormat(locale, { month: style, timeZone: "UTC" }).format(new Date(Date.UTC(2000, Number(month) - 1, 1)));
  return style === "long" ? formatted.charAt(0).toLocaleUpperCase(locale) + formatted.slice(1) : formatted.replace(".", "");
}

// Stack order, bottom to top: the salary carries the bar, the rest sit on it.
// Colours are CSS tokens (--income-*), validated as a set for both themes.
const incomeTypeFill: Record<PaycheckType, string> = {
  salary: "var(--income-salary)",
  "extra-month": "var(--income-extra-month)",
  bonus: "var(--income-bonus)",
  freelance: "var(--income-freelance)",
  other: "var(--income-other)",
};

function IncomeMonthTooltip({ active, payload, scope }: { active?: boolean; payload?: ReadonlyArray<{ payload?: IncomeCalendarMonth }>; scope: IncomeScope }) {
  const { locale, text } = useLanguage();
  const point = payload?.[0]?.payload;
  if (!active || !point) {
    return null;
  }
  const parts = paycheckTypes.filter((type) => point.types[type] !== undefined);

  return (
    <div className="chart-tooltip chart-tooltip--income">
      <span>{formatCalendarMonth(point.month, locale, "long")} {scope === allIncomeYears ? text("· tutti gli anni", "· all years") : scope}</span>
      {point.total === null ? (
        <strong>{text("Nessun pagamento registrato", "No payment recorded")}</strong>
      ) : (
        <>
          <strong><Sensitive>{formatCurrency(point.total)}</Sensitive></strong>
          <small>{text(`${point.count} ${point.count === 1 ? "pagamento" : "pagamenti"}`, `${point.count} ${point.count === 1 ? "payment" : "payments"}`)}</small>
          {parts.length > 1 ? (
            <ul className="chart-tooltip__parts">
              {parts.map((type) => (
                <li key={type}>
                  <i style={{ background: incomeTypeFill[type] }} />
                  <span>{paycheckTypeLabel(type, text)}</span>
                  <b className="chart-tooltip__part-value"><Sensitive>{formatCurrency(point.types[type] ?? 0)}</Sensitive></b>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </div>
  );
}

export function IncomeChart({ paychecks, scope }: { paychecks: Paycheck[]; scope: IncomeScope }) {
  const { amountsHidden } = usePrivacy();
  const { locale, text } = useLanguage();
  const data = summarizeIncomeByCalendarMonth(paychecks, scope);
  const withIncome = data.flatMap((point, index) => (point.total === null ? [] : [index]));
  const scopeLabel = scope === allIncomeYears ? text("tutti gli anni", "all years") : scope;
  // Only the types this scope holds get a bar and a legend entry: records
  // without a type are all salaries, so they draw one bar as before.
  const presentTypes = paycheckTypes.filter((type) => data.some((point) => point.types[type] !== undefined));

  if (withIncome.length === 0) {
    return (
      <div className="income-chart-empty">
        <strong>{text("Nessuna entrata registrata", "No income recorded")}</strong>
        <span>{text("Aggiungi uno stipendio: qui vedrai il totale di ogni mese.", "Add a paycheck to see each month's total here.")}</span>
      </div>
    );
  }

  // The last month with income carries its figure; the table reads from the
  // first month with income to the last, as the chart did before.
  const lastIndex = withIncome[withIncome.length - 1];
  const tableRows = data.slice(withIncome[0], lastIndex + 1);
  const axisNumber = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  // The axis is as wide as its longest label, so six-figure months stay on one line.
  const largestMonth = Math.max(...data.map((point) => point.total ?? 0));
  const axisWidth = Math.max(52, Math.ceil(`${axisNumber.format(largestMonth * 1.25)} €`.length * 7.4) + 10);
  const monthTick = (value: string) => formatCalendarMonth(value, locale, "short");
  // The top segment of a month is the last present type in stack order: only
  // it gets the rounded end and, in the latest month, the figure.
  const topType = (point: IncomeCalendarMonth) => [...paycheckTypes].reverse().find((type) => point.types[type] !== undefined);

  return (
    <>
    {presentTypes.length > 1 ? (
      <ul aria-label={text("Tipi di entrata", "Income types")} className="income-chart-legend">
        {presentTypes.map((type) => (
          <li key={type}><i style={{ background: incomeTypeFill[type] }} />{paycheckTypeLabel(type, text)}</li>
        ))}
      </ul>
    ) : null}
    <div
      aria-label={text(
        `Entrate registrate per mese, ${scopeLabel}`,
        `Recorded income by month, ${scopeLabel}`,
      )}
      className="chart-canvas chart-canvas--income"
      role="img"
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 28, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="var(--chart-grid, #eef0f5)" vertical={false} />
          <XAxis
            axisLine={false}
            dataKey="month"
            interval="preserveStartEnd"
            minTickGap={4}
            tick={{ fill: "var(--chart-tick, #5f6480)", fontSize: 12 }}
            tickFormatter={monthTick}
            tickLine={false}
          />
          <YAxis
            allowDecimals={false}
            axisLine={false}
            domain={[0, "auto"]}
            tick={{ fill: "var(--chart-tick, #5f6480)", fontSize: 12 }}
            tickFormatter={(value: number) => (amountsHidden ? "*" : `${axisNumber.format(value)} €`)}
            tickLine={false}
            width={axisWidth}
          />
          <Tooltip content={<IncomeMonthTooltip scope={scope} />} cursor={{ fill: "var(--chart-cursor-band, rgba(79, 70, 229, 0.06))" }} />
          {presentTypes.map((type) => (
            <Bar
              dataKey={(point: IncomeCalendarMonth) => point.types[type] ?? null}
              fill={incomeTypeFill[type]}
              isAnimationActive={false}
              key={type}
              label={(props: { x?: number | string; y?: number | string; width?: number | string; index?: number }) => {
                // Only the latest month carries its figure, above its top
                // segment, and only while the bar is wide enough to hold it
                // clear of its neighbour; the tooltip and the table hold the rest.
                const point = props.index === undefined ? undefined : data[props.index];
                if (props.index !== lastIndex || !point || point.total === null || topType(point) !== type || Number(props.width) < 48) return null;
                return (
                  <text className="chart-latest-label" textAnchor="end" x={Number(props.x) + Number(props.width)} y={Number(props.y) - 10}>
                    {amountsHidden ? formatCurrency(point.total).replace(/\d/g, "*") : formatCurrency(point.total)}
                  </text>
                );
              }}
              maxBarSize={56}
              name={paycheckTypeLabel(type, text)}
              shape={(props: RectangleProps & { payload?: IncomeCalendarMonth }) => (
                // A 2px surface seam between stacked segments; the top one rounds.
                <Rectangle
                  {...props}
                  radius={props.payload && topType(props.payload) === type ? [6, 6, 0, 0] : 0}
                  stroke="var(--pw-surface)"
                  strokeWidth={presentTypes.length > 1 ? 2 : 0}
                />
              )}
              stackId="income"
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
    <table className="visually-hidden">
      <caption>{text(`Entrate registrate per mese, ${scopeLabel}`, `Recorded income by month, ${scopeLabel}`)}</caption>
      <thead><tr><th scope="col">{text("Mese", "Month")}</th><th scope="col">{text("Totale", "Total")}</th><th scope="col">{text("Pagamenti", "Payments")}</th></tr></thead>
      <tbody>
        {tableRows.map((point) => (
          <tr key={point.month}>
            <th scope="row">{formatCalendarMonth(point.month, locale, "long")}</th>
            <td>{point.total === null ? text("Nessun pagamento registrato", "No payment recorded") : <Sensitive>{formatCurrency(point.total)}</Sensitive>}</td>
            <td>{point.count}</td>
          </tr>
        ))}
      </tbody>
    </table>
    </>
  );
}

export function ScenarioChart({
  baselinePoints,
  decisionPoints,
  targetAmount,
}: {
  baselinePoints: ScenarioPoint[];
  decisionPoints: ScenarioPoint[];
  targetAmount?: number;
}) {
  const { amountsHidden } = usePrivacy();
  const { locale, text } = useLanguage();
  const chartData = baselinePoints.map((point, index) => ({
    date: point.date,
    baselineWealth: point.wealth,
    decisionWealth: decisionPoints[index]?.wealth ?? point.wealth,
  }));
  // Two identical paths drawn on top of each other would look like one line
  // posing as two; they are drawn once and the legend says so.
  const coincident = chartData.every((point) => point.baselineWealth === point.decisionWealth);
  const yAxisDomain = calculateScenarioYAxisDomain(chartData.flatMap((point) => [point.baselineWealth, point.decisionWealth]));
  const baselineLabel = text("Baseline — senza decisione", "Baseline — without decision");
  const decisionLabel = text("Decisione", "Decision");
  const spansYears = chartData.length > 1 && chartData[0].date.slice(0, 4) !== chartData[chartData.length - 1].date.slice(0, 4);
  const monthTick = (value: string) => {
    const label = new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" }).format(new Date(`${value}T12:00:00.000Z`)).replace(".", "");
    return spansYears ? `${label} ${value.slice(2, 4)}` : label;
  };

  return (
    <div aria-label={text("Confronto traiettorie", "Trajectory comparison")} className="chart-canvas chart-canvas--scenario projection-chart" role="region">
      <ul className="projection-chart__legend" aria-label={text("Legenda traiettorie", "Trajectory legend")}>
        {coincident ? (
          <li><i className="projection-chart__swatch projection-chart__swatch--shared" />{text("Baseline e decisione coincidono", "Baseline and decision coincide")}</li>
        ) : (
          <>
            <li><i className="projection-chart__swatch projection-chart__swatch--baseline" />{baselineLabel}</li>
            <li><i className="projection-chart__swatch projection-chart__swatch--decision" />{decisionLabel}</li>
          </>
        )}
        {targetAmount !== undefined ? <li><i className="projection-chart__swatch projection-chart__swatch--target" />{text("Obiettivo", "Target")}</li> : null}
      </ul>
      {chartData.length < 2 ? (
        <p className="projection-chart__empty">{text("Con un orizzonte di 0 mesi non c'è una traiettoria da disegnare.", "With a 0-month horizon there is no trajectory to draw.")}</p>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 16, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="var(--chart-grid, var(--line-soft))" vertical={false} />
            <XAxis axisLine={false} dataKey="date" minTickGap={30} tick={{ fill: "var(--chart-tick, var(--muted))", fontSize: 12 }} tickFormatter={monthTick} tickLine={false} />
            <YAxis axisLine={false} domain={yAxisDomain} tick={{ fill: "var(--chart-tick, var(--muted))", fontSize: 12 }} tickFormatter={(value: number) => amountsHidden ? "*" : formatScenarioAxisTick(value, locale)} tickLine={false} width={48} />
            {targetAmount !== undefined ? <ReferenceLine stroke="var(--chart-target, #8b5cf6)" strokeDasharray="3 5" y={targetAmount} /> : null}
            <Tooltip
              contentStyle={{ background: "var(--chart-tooltip-bg, var(--surface-high))", border: "1px solid var(--chart-tooltip-border, var(--line))", borderRadius: 12, color: "var(--chart-tooltip-ink, inherit)" }}
              formatter={(value, name) => [amountsHidden ? "*****" : formatCurrency(Number(value)), coincident ? text("Baseline e decisione", "Baseline and decision") : name === "baselineWealth" ? baselineLabel : decisionLabel]}
              labelFormatter={(label) => formatDate(`${String(label)}T12:00:00.000Z`, { timeZone: "UTC", locale })}
            />
            {coincident ? (
              <Line dataKey="baselineWealth" dot={false} isAnimationActive={false} name="baselineWealth" stroke="var(--chart-shared, #454b66)" strokeWidth={2.25} type="linear" />
            ) : (
              <>
                <Line dataKey="baselineWealth" dot={false} isAnimationActive={false} name="baselineWealth" stroke="var(--chart-baseline, var(--muted))" strokeDasharray="7 5" strokeWidth={2} type="linear" />
                <Line dataKey="decisionWealth" dot={false} isAnimationActive={false} name="decisionWealth" stroke="var(--chart-decision, #8b5cf6)" strokeWidth={2.5} type="linear" />
              </>
            )}
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

/**
 * The scenario axis starts at zero, like every other wealth chart here: a
 * truncated axis would make a small difference between the two paths look
 * large. Simulated wealth never goes below zero, so zero is always in range.
 * The top is the largest value plus 8%, rounded up to a readable step.
 */
export function calculateScenarioYAxisDomain(values: number[]): [number, number] {
  const finiteValues = values.filter(Number.isFinite);
  const maximum = Math.max(0, ...finiteValues);
  if (maximum === 0) {
    return [0, 1000];
  }

  const padded = maximum * 1.08;
  const step = 10 ** Math.max(0, Math.floor(Math.log10(padded)) - 1);
  return [0, Math.ceil(padded / step) * step];
}

export function formatScenarioAxisTick(value: number, locale: string): string {
  if (value === 0) return "0";
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value / 1000)}k`;
}
