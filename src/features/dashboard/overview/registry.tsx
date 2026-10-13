"use client";

import { useId, useRef, type CSSProperties, type ReactNode } from "react";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  ChartCandlestick,
  Banknote,
  CalendarDays,
  ChartNoAxesColumnIncreasing,
  Clock,
  ChartPie,
  ChartSpline,
  ChevronRight,
  Goal,
  HandCoins,
  Hourglass,
  Info,
  Minus,
  PencilLine,
  Trophy,
  Wallet,
} from "lucide-react";

import {
  calculateAccessAggregation,
  calculateAllTimeHigh,
  calculateCategoryPercentages,
  calculatePeriodChange,
  calculateSnapshotDelta,
  calculateAccountBalanceMovements,
  calculateAccountShare,
  calculateCashTotal,
  calculateCategoryTotals,
  calculateGoalProgress,
  calculateGoalRemaining,
  calculateHighestPayment,
  calculateIncomeAverage,
  calculateIncomeTotal,
} from "@/domain/calculations";
import { formatCurrency } from "@/domain/formatters";
import type { Account, AccountCategory, CashDenomination, Paycheck, WealthGoal, WealthSnapshot } from "@/domain/types";
import { useLanguage } from "@/features/i18n/language";

import { AllocationChart, WealthHistoryChart, WealthSparkline } from "../Charts";
import { AccountName, Percent, Sensitive, usePrivacy } from "../privacy";
import { useCountUp } from "../entrance";
import {
  AccountMark,
  Button,
  Delta,
  Money,
  SectionHeading,
  accountDialogFocusId,
  categoryColors,
  categoryDetailFocusId,
  categoryLabels,
  cx,
  formatDate,
  formatPercent,
} from "../ui";
import type { PanelId, Span } from "./layout";

/*
 * What the workspace can hold, and what each of those things needs to know.
 *
 * Every entry here draws on a calculation this dashboard already performs.
 * That is the whole rule for what may be in the catalogue: a panel is a new
 * way of reading something IRIS knows, never a promise that it will learn
 * something new. There is deliberately no panel for investment return or
 * P&L — the Overview says in as many words that balance movement is neither,
 * and a catalogue entry, even a locked one, would suggest otherwise.
 */

/** The pair of strings every label in this app is written as. */
export type Text = (italian: string, english: string) => string;

export type PanelData = {
  accounts: Account[];
  snapshots: WealthSnapshot[];
  paychecks: Paycheck[];
  cashDenominations: CashDenomination[];
  goal?: WealthGoal;
  totalWealth: number;
};

export type PanelActions = {
  onOpenAccount: (account: Account) => void;
  onShowCategory: (category: AccountCategory) => void;
  onShowAccounts: () => void;
  onShowGoals: () => void;
  onEditGoal: () => void;
};

export type PanelProps = PanelData & PanelActions;

type PanelDefinition = {
  id: PanelId;
  /** The name it goes by in the catalogue and in the editing controls. */
  name: (text: Text) => string;
  /** One line saying what it shows, for the catalogue. */
  summary: (text: Text) => string;
  defaultSpan: Span;
  /**
   * Why this panel cannot be added yet, or null when it can. A panel already
   * placed keeps rendering whatever happens to its data — it says so in its
   * own words — so this gates the catalogue, not the page.
   */
  unavailable: (data: PanelData, text: Text) => string | null;
  /**
   * True for a panel that is already a surface of its own — the hero, the
   * category cards. They are placed and moved like every other panel, but
   * the workspace must not wrap them in a second card.
   */
  bare?: boolean;
  Render: (props: PanelProps) => React.JSX.Element;
};

/* ── The Overview's own five ────────────────────────────────────────────── */

const categoryIcons: Record<AccountCategory, typeof Wallet> = {
  liquidity: Wallet,
  investments: ChartSpline,
  trading: ChartCandlestick,
};

/*
 * The figure is set like a statement total: whole euros at full size, the
 * cents and the currency a step down. Same string, split at the decimal comma.
 */
function splitFigure(figure: string): [units: string, fraction: string] {
  const decimalAt = figure.lastIndexOf(",");
  return decimalAt === -1 ? [figure, ""] : [figure.slice(0, decimalAt), figure.slice(decimalAt)];
}

/**
 * The total. During the dashboard entrance it counts up to itself; it is its
 * own component so the count's start and end re-render only the figure.
 */
function WealthFigure({ amount }: { amount: number }) {
  const { amountsHidden } = usePrivacy();
  const unitsRef = useRef<HTMLSpanElement>(null);
  const fractionRef = useRef<HTMLSpanElement>(null);
  const counting = useCountUp(amount, !amountsHidden, (current) => {
    const [units, fraction] = splitFigure(formatCurrency(current));
    if (unitsRef.current) unitsRef.current.textContent = units;
    if (fractionRef.current) fractionRef.current.textContent = fraction;
  });
  const figure = formatCurrency(amount);
  const [units, fraction] = splitFigure(figure);

  return (
    <h1 className="wealth-figure">
      <Sensitive>
        {counting ? (
          <>
            {/* Drawn by the count-up; the heading's text stays the real total. */}
            <span aria-hidden="true" className="wealth-figure__units" ref={unitsRef} />
            <span aria-hidden="true" className="wealth-figure__fraction" ref={fractionRef} />
            <span className="visually-hidden">{figure}</span>
          </>
        ) : (
          <>
            <span className="wealth-figure__units">{units}</span>
            <span className="wealth-figure__fraction">{fraction}</span>
          </>
        )}
      </Sensitive>
    </h1>
  );
}

function HeroMetric({ label, value, detail, icon }: { label: string; value: ReactNode; detail?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="wealth-context__item">
      <span className="wealth-context__head">
        {icon ? <span aria-hidden="true" className="wealth-context__icon">{icon}</span> : null}
        <span className="wealth-context__label">{label}</span>
      </span>
      <strong className="wealth-context__value">{value}</strong>
      {detail ? <small className="wealth-context__detail">{detail}</small> : null}
    </div>
  );
}

function HeroPanel({ snapshots, totalWealth }: PanelProps) {
  const { text } = useLanguage();
  // The move the last saved update made on the one before it (owner, 27 Sep
  // 2026). It used to compare live balances with the last update, which
  // "Aggiorna saldi" makes equal by definition, so it read 0,00 € nearly
  // always. Null until there are two updates to compare.
  const currentChange = calculateSnapshotDelta(snapshots.at(-1), snapshots.at(-2));
  const hasTrend = snapshots.length >= 2;
  const tone = !currentChange || currentChange.amount === 0
    ? "neutral"
    : currentChange.amount > 0 ? "positive" : "negative";
  const ChangeIcon = tone === "positive" ? ArrowUpRight : tone === "negative" ? ArrowDownRight : Minus;

  return (
    <section className={cx("wealth-hero", hasTrend && "wealth-hero--with-trend")} data-testid="wealth-hero" data-tour="overview-wealth">
      <div className="wealth-hero__primary">
        <p className="eyebrow">{text("PATRIMONIO TOTALE", "TOTAL WEALTH")}</p>
        <WealthFigure amount={totalWealth} />
        <div className="wealth-hero__change">
          {currentChange ? (
            <>
              <span className={`wealth-hero__pill wealth-hero__pill--${tone}`}>
                <ChangeIcon aria-hidden="true" size={15} strokeWidth={2.25} />
                <Delta {...currentChange} split />
              </span>
              <span className="wealth-hero__since">{text("rispetto all'aggiornamento precedente", "since the previous update")}</span>
            </>
          ) : (
            <span className="wealth-hero__since">
              {snapshots.length === 0
                ? text("Nessun aggiornamento salvato", "No update saved yet")
                : text("La variazione compare dal prossimo aggiornamento", "The change shows from the next update")}
            </span>
          )}
        </div>
      </div>
      {hasTrend ? <WealthSparkline snapshots={snapshots} /> : null}
    </section>
  );
}

function ContextPanel({ snapshots, totalWealth }: PanelProps) {
  const { locale, text } = useLanguage();
  const latest = snapshots.at(-1);
  const previous = snapshots.at(-2);
  const latestChange = calculateSnapshotDelta(latest, previous);
  const mtd = calculatePeriodChange(snapshots, "mtd");
  const ytd = calculatePeriodChange(snapshots, "ytd");
  const high = calculateAllTimeHigh(snapshots);
  void totalWealth;

  return (
    <section className="wealth-context" aria-label={text("Metriche di variazione patrimoniale", "Wealth change metrics")}>
      <HeroMetric
        detail={latest ? formatDate(latest.createdAt, { locale }) : text("Non ancora salvato", "Not saved yet")}
        icon={<Clock size={19} strokeWidth={2} />}
        label={text("Ultimo aggiornamento", "Last update")}
        value={latestChange ? <Delta {...latestChange} countUp indicator split /> : "—"}
      />
      {/* Every figure here counts up with the entrance, on the same curve as
          the total (owner, 27 Sep 2026). */}
      <HeroMetric icon={<CalendarDays size={19} strokeWidth={2} />} label={text("Da inizio mese", "Month to date")} value={mtd ? <Delta {...mtd} countUp indicator split /> : "—"} />
      <HeroMetric icon={<ChartNoAxesColumnIncreasing size={19} strokeWidth={2} />} label={text("Da inizio anno", "Year to date")} value={ytd ? <Delta {...ytd} countUp indicator split /> : "—"} />
      <HeroMetric icon={<Trophy size={19} strokeWidth={2} />} label={text("Massimo storico", "All-time high")} value={high === null ? "—" : <Money amount={high} countUp />} />
    </section>
  );
}

/** One category card. The same card as ever, now placed like any other panel. */
function CategoryPanel({ category, accounts, totalWealth, onShowCategory }: PanelProps & { category: AccountCategory }) {
  const { categoryLabel, text } = useLanguage();
  const totals = calculateCategoryTotals(accounts);
  const percentages = calculateCategoryPercentages(totals, totalWealth);
  const Icon = categoryIcons[category];

  return (
    <button
      aria-label={text(`Apri dettaglio ${categoryLabel(category)}`, `Open ${categoryLabels[category]} detail`)}
      className="category-summary"
      id={categoryDetailFocusId(category)}
      onClick={() => onShowCategory(category)}
      style={{ "--mark-color": categoryColors[category] } as CSSProperties}
      type="button"
    >
      <span className="category-summary__head">
        <span className="category-summary__icon" aria-hidden="true"><Icon size={18} strokeWidth={2} /></span>
        <span className="category-summary__label">{categoryLabel(category)}</span>
        {/* The drill-in chevron of the detail rows, not a trend arrow. */}
        <ChevronRight aria-hidden="true" className="category-summary__go" size={17} />
      </span>
      <Money amount={totals[category]} countUp />
      <span className="category-summary__share">
        <span className="category-summary__percent">
          <Percent>{formatPercent(percentages[category])}</Percent> {text("del patrimonio", "of total wealth")}
        </span>
        {/* Its own track, filled from the left to this category's share
            of total wealth. The percentage above says the same thing. */}
        <span className="category-summary__meter" aria-hidden="true">
          <span style={{ width: `${Math.min(Math.max(percentages[category], 0), 100)}%` }} />
        </span>
      </span>
    </button>
  );
}

/* ── The five the Overview has always shown ─────────────────────────────── */

function HistoryPanel({ snapshots }: PanelProps) {
  const { text } = useLanguage();
  return (
    <WealthHistoryChart
      header={<SectionHeading eyebrow={text("Evoluzione nel tempo", "Change over time")} icon={<ChartSpline size={20} strokeWidth={2.25} />} title={text("Andamento del patrimonio", "Wealth trend")} />}
      labelLatest
      // Smaller markers (owner, 27 Sep 2026): with a long history they
      // crowded the line. The hover marker stays 1.5px larger.
      markerRadius={2.5}
      snapshots={snapshots}
    />
  );
}

function AllocationPanel({ accounts }: PanelProps) {
  const { text } = useLanguage();
  const totals = calculateCategoryTotals(accounts);
  return (
    <>
      <SectionHeading eyebrow={text("Composizione attuale", "Current composition")} icon={<ChartPie size={20} strokeWidth={2.25} />} title={text("Composizione del patrimonio", "Wealth composition")} />
      <AllocationChart totals={totals} />
    </>
  );
}

function MovementPanel({ accounts, snapshots, onOpenAccount }: PanelProps) {
  const { categoryLabel, text } = useLanguage();
  const latest = snapshots.at(-1);
  const previous = snapshots.at(-2);
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const movements = calculateAccountBalanceMovements(latest, previous)
    .flatMap((movement) => {
      const account = accountById.get(movement.accountId);
      return account ? [{ ...movement, account }] : [];
    });

  return (
    <>
      <SectionHeading
        eyebrow={text("Confronto tra gli ultimi due aggiornamenti", "Last two updates compared")}
        icon={<ChartNoAxesColumnIncreasing size={20} strokeWidth={2.25} />}
        title={text("Cosa è cambiato", "What changed")}
      />
      {latest && previous ? (
        movements.length > 0 ? (
          <div className="movement-list">
            {movements.slice(0, 5).map(({ account, amount }) => (
              <button className="movement-row" key={account.id} onClick={() => onOpenAccount(account)} type="button">
                <AccountMark account={account} />
                <span className="movement-row__identity"><strong><AccountName name={account.name} /></strong><small>{text(`Saldo ${categoryLabel(account.category)}`, `${categoryLabels[account.category]} balance`)}</small></span>
                <span className={cx("movement-row__amount", amount > 0 ? "movement-positive" : "movement-negative")}><Sensitive>{`${amount > 0 ? "+" : ""}${formatCurrency(amount)}`}</Sensitive></span>
              </button>
            ))}
          </div>
        ) : <p className="inline-empty">{text("Nessun saldo confrontabile è cambiato tra gli ultimi due aggiornamenti.", "No comparable account balance changed between the last two updates.")}</p>
      ) : (
        <p className="inline-empty">{text("Aggiorna di nuovo i saldi per confrontarli con l'ultimo aggiornamento.", "Update your balances again to compare them with the last update.")}</p>
      )}
      <p className="financial-disclaimer financial-disclaimer--note">
        <Info aria-hidden="true" className="financial-disclaimer__icon" size={17} />
        <span>{text("La variazione del saldo non è rendimento d'investimento né P&L di trading. I flussi di capitale non sono ancora attribuibili.", "Balance movement is not investment return or trading P&L. Capital flows are not yet attributable.")}</span>
      </p>
    </>
  );
}

/*
 * The goal's own measure over time, drawn as a quiet wave at the foot of the
 * goal card: the trajectory its eyebrow names. Resampled to a dozen evenly
 * spaced points and smoothed, so it reads as a direction, not a chart — the
 * trend panel is where the updates are read one by one. No axis and no
 * figure, so it gives no amount away with amounts hidden.
 */
const trajectorySamples = 12;

function resampleTrajectory(points: { time: number; value: number }[]): [number, number][] {
  const first = points[0].time;
  const span = points.at(-1)!.time - first || 1;
  const samples: number[] = [];
  let cursor = 0;
  for (let index = 0; index < trajectorySamples; index += 1) {
    const time = first + (span * index) / (trajectorySamples - 1);
    while (cursor < points.length - 2 && points[cursor + 1].time < time) cursor += 1;
    const from = points[cursor];
    const to = points[Math.min(cursor + 1, points.length - 1)];
    const share = to.time === from.time ? 0 : Math.min(Math.max((time - from.time) / (to.time - from.time), 0), 1);
    samples.push(from.value + (to.value - from.value) * share);
  }
  const low = Math.min(...samples);
  const range = Math.max(...samples) - low || 1;
  // x across 0–100, y from 32 (lowest) up to 14 (highest) of a 40-unit box:
  // a gentle rise, whatever the range, so it never reads as a scale.
  return samples.map((value, index) => [(100 * index) / (trajectorySamples - 1), 32 - ((value - low) / range) * 18]);
}

/** A Catmull-Rom curve through the points, written as cubic Béziers. */
function smoothPath(points: [number, number][]): string {
  const round = (value: number) => Math.round(value * 100) / 100;
  let path = `M${round(points[0][0])} ${round(points[0][1])}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const [x0, y0] = points[index - 1] ?? points[index];
    const [x1, y1] = points[index];
    const [x2, y2] = points[index + 1];
    const [x3, y3] = points[index + 2] ?? points[index + 1];
    path += ` C${round(x1 + (x2 - x0) / 6)} ${round(y1 + (y2 - y0) / 6)} ${round(x2 - (x3 - x1) / 6)} ${round(y2 - (y3 - y1) / 6)} ${round(x2)} ${round(y2)}`;
  }
  return path;
}

function GoalTrajectory({ points }: { points: { time: number; value: number }[] }) {
  // useId's colons and guillemets are not safe inside url(#…).
  const gradientId = `goal-wave-${useId().replace(/[^\w-]/g, "")}`;
  const line = smoothPath(resampleTrajectory(points));
  const area = `${line} L100 40 L0 40 Z`;
  // The dot grid is CSS (so its dots stay round), cut to the area by a mask
  // drawn from the same path.
  const mask = `url("data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 40' preserveAspectRatio='none'><path d='${area}'/></svg>`,
  )}")`;

  return (
    <div aria-hidden="true" className="goal-trajectory">
      <span className="goal-trajectory__dots" style={{ maskImage: mask, WebkitMaskImage: mask }} />
      <svg preserveAspectRatio="none" viewBox="0 0 100 40">
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--goal-wave)" stopOpacity="0.3" />
            <stop offset="100%" stopColor="var(--goal-wave)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${gradientId})`} />
        <path className="goal-trajectory__line" d={line} fill="none" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}

function GoalPanel({ accounts, goal, snapshots, totalWealth, onShowGoals, onEditGoal }: PanelProps) {
  const { text } = useLanguage();
  const { amountsHidden } = usePrivacy();
  const totals = calculateCategoryTotals(accounts);
  const target = goal?.targetAmount ?? 0;
  const goalCurrent = goal?.type === "liquidity" ? totals.liquidity : totalWealth;
  const progress = calculateGoalProgress(goalCurrent, target);
  const remaining = calculateGoalRemaining(goalCurrent, target);
  const liquidityIds = new Set(accounts.filter((account) => account.category === "liquidity").map((account) => account.id));
  const trajectory = snapshots.map((snapshot) => ({
    time: new Date(snapshot.createdAt).getTime(),
    value: goal?.type === "liquidity"
      ? snapshot.accountBalances.reduce((sum, entry) => sum + (entry.includedInWealth && liquidityIds.has(entry.accountId) ? entry.balance : 0), 0)
      : snapshot.totalWealth,
  }));

  return (
    <>
      <SectionHeading
        eyebrow={text("Traiettoria / prossimo", "Trajectory / next")}
        icon={<Goal size={20} strokeWidth={2.25} />}
        title={goal ? text(`Obiettivo ${goal.name}`, `${goal.name} goal`) : text("Nessun obiettivo attivo", "No active goal")}
        action={goal ? (
          <button aria-label={text("Modifica obiettivo patrimoniale", "Edit wealth goal")} className="icon-button" onClick={onEditGoal} type="button">
            <PencilLine aria-hidden="true" size={16} />
          </button>
        ) : <Button onClick={onShowGoals} variant="ghost">{text("Apri Obiettivi", "Open Goals")} <ArrowRight aria-hidden="true" size={15} /></Button>}
      />
      {goal ? (
        <div className="goal-content">
          <div className="goal-content__numbers">
            <div><span>{text(`Valore corrente: ${goal.type === "liquidity" ? "liquidità" : "patrimonio"}`, `Current ${goal.type === "liquidity" ? "liquidity" : "wealth"}`)}</span><Money amount={goalCurrent} /></div>
            <div className="goal-content__target"><span>{text("Obiettivo", "Target")}</span><Money amount={target} /></div>
          </div>
          {/* Progress towards a known target gives the balance away, so it hides with amounts. */}
          <div className={cx("progress-track", amountsHidden && "is-masked")} aria-label={amountsHidden ? text("Avanzamento nascosto", "Progress hidden") : text(`${formatPercent(progress)} dell'obiettivo raggiunto`, `${formatPercent(progress)} of goal reached`)} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={amountsHidden ? undefined : progress} aria-valuetext={amountsHidden ? text("Nascosto", "Hidden") : undefined}>
            <span style={{ width: amountsHidden ? "0%" : `${progress}%` }} />
          </div>
          <div className="goal-content__footer">
            <strong><Sensitive>{formatPercent(progress)}</Sensitive> {text("completato", "complete")}</strong>
            <span><Sensitive>{formatCurrency(remaining)}</Sensitive> {text("rimanenti", "remaining")}</span>
          </div>
        </div>
      ) : null}
      {goal && trajectory.length >= 2 ? <GoalTrajectory points={trajectory} /> : null}
      {goal ? null : (
        <div className="goal-empty">
          <p className="inline-empty">{text("Crea un obiettivo patrimoniale per monitorare la prossima soglia.", "Create a wealth goal to track your next threshold.")}</p>
          <Button onClick={onEditGoal} variant="ghost">{text("Aggiungi obiettivo patrimoniale", "Add wealth goal")}</Button>
        </div>
      )}
    </>
  );
}

function AccountsPanel({ accounts, totalWealth, onOpenAccount, onShowAccounts }: PanelProps) {
  const { categoryLabel, locale, text } = useLanguage();
  const previewAccounts = [...accounts].sort((a, b) => b.balance - a.balance).slice(0, 4);
  return (
    <>
      <SectionHeading
        eyebrow={text(`${accounts.length} conti attivi`, `${accounts.length} active accounts`)}
        icon={<Wallet size={20} strokeWidth={2.25} />}
        title={text("Conti", "Accounts")}
        action={<Button className="panel-link-button" onClick={onShowAccounts} variant="ghost">{text("Vedi tutti", "View all")} <ArrowRight aria-hidden="true" size={15} /></Button>}
      />
      <div className="account-preview-list">
        {previewAccounts.map((account) => (
          <button
            className="account-preview"
            id={accountDialogFocusId(account.id)}
            key={account.id}
            onClick={() => onOpenAccount(account)}
            type="button"
          >
            <AccountMark account={account} />
            <span className="account-preview__identity">
              <strong><AccountName name={account.name} /></strong>
              <small>{categoryLabel(account.category)} · {formatDate(account.lastUpdated, { locale })}</small>
            </span>
            <span className="account-preview__figures">
              <Money amount={account.balance} />
              <span className="account-preview__share">
                {account.includedInWealth ? <Percent>{formatPercent(calculateAccountShare(account, totalWealth))}</Percent> : text("Escluso", "Excluded")}
              </span>
            </span>
            <ChevronRight aria-hidden="true" className="account-preview__go" size={17} />
          </button>
        ))}
      </div>
    </>
  );
}

/* ── Three more readings of what IRIS already computes ──────────────────── */

const accessOrder = ["immediate", "days", "locked", "unclassified"] as const;

/** How fast the wealth can be reached, from the access profile on each account. */
function AccessPanel({ accounts }: PanelProps) {
  const { text } = useLanguage();
  const aggregation = calculateAccessAggregation(accounts);
  const labels: Record<(typeof accessOrder)[number], string> = {
    immediate: text("Subito", "Immediate"),
    days: text("In pochi giorni", "Within days"),
    locked: text("Vincolato", "Locked"),
    unclassified: text("Non classificato", "Unclassified"),
  };
  const present = accessOrder.filter((bucket) => aggregation[bucket].amount !== 0);

  return (
    <>
      <SectionHeading eyebrow={text("Accesso al capitale", "Access to capital")} icon={<Hourglass size={20} strokeWidth={2.25} />} title={text("Quanto in fretta ci arrivi", "How fast you reach it")} />
      {present.length > 0 ? (
        <div className="access-rows">
          {present.map((bucket) => (
            <div className="access-row" key={bucket}>
              <span className="access-row__label">{labels[bucket]}</span>
              <span className="access-row__meter" aria-hidden="true">
                <span data-bucket={bucket} style={{ width: `${Math.min(100, aggregation[bucket].percentage)}%` }} />
              </span>
              <Money amount={aggregation[bucket].amount} />
              <span className="access-row__share"><Percent>{formatPercent(aggregation[bucket].percentage)}</Percent></span>
            </div>
          ))}
        </div>
      ) : <p className="inline-empty">{text("Nessun conto entra nel patrimonio.", "No account counts towards your wealth.")}</p>}
    </>
  );
}

/** The cash counted by denomination, as the ledger records it. */
function CashPanel({ cashDenominations }: PanelProps) {
  const { locale, text } = useLanguage();
  const total = calculateCashTotal(cashDenominations);
  const held = cashDenominations.filter((denomination) => denomination.quantity > 0);

  return (
    <>
      <SectionHeading eyebrow={text("Contato per taglio", "Counted by denomination")} icon={<Banknote size={20} strokeWidth={2.25} />} title={text("Contante", "Cash")} />
      {held.length > 0 ? (
        <>
          <div className="cash-total"><Money amount={total} /></div>
          <div className="cash-rows">
            {held.map((denomination) => (
              <div className="cash-row" key={denomination.denomination}>
                <span>{formatCurrency(denomination.denomination)}</span>
                <span className="cash-row__count">× {denomination.quantity.toLocaleString(locale)}</span>
                <Money amount={denomination.denomination * denomination.quantity} />
              </div>
            ))}
          </div>
        </>
      ) : <p className="inline-empty">{text("Nessun taglio registrato.", "No denomination recorded.")}</p>}
    </>
  );
}

/** What has been paid in, from the paychecks recorded on this device. */
function IncomePanel({ paychecks }: PanelProps) {
  const { text } = useLanguage();
  const total = calculateIncomeTotal(paychecks);
  const average = calculateIncomeAverage(paychecks);
  const highest = calculateHighestPayment(paychecks);

  return (
    <>
      <SectionHeading
        eyebrow={text(`${paychecks.length} pagamenti registrati`, `${paychecks.length} payments recorded`)}
        icon={<HandCoins size={20} strokeWidth={2.25} />}
        title={text("Entrate", "Income")}
      />
      {paychecks.length > 0 ? (
        <div className="income-figures">
          <div><span>{text("Totale", "Total")}</span><Money amount={total} /></div>
          <div><span>{text("Media", "Average")}</span><Money amount={average} /></div>
          <div><span>{text("Più alto", "Highest")}</span><Money amount={highest} /></div>
        </div>
      ) : <p className="inline-empty">{text("Nessuno stipendio registrato su questo dispositivo.", "No paycheck recorded on this device.")}</p>}
      <p className="financial-disclaimer">{text("Somma di ciò che hai registrato, non un reddito certificato.", "The sum of what you recorded, not certified income.")}</p>
    </>
  );
}

/* ── The registry ───────────────────────────────────────────────────────── */

export const panelRegistry: Record<PanelId, PanelDefinition> = {
  hero: {
    id: "hero",
    name: (text) => text("Patrimonio totale", "Total wealth"),
    summary: (text) => text("Il totale, quanto è cambiato e la sua linea recente.", "The total, how much it moved, and its recent line."),
    defaultSpan: 4,
    unavailable: () => null,
    bare: true,
    Render: HeroPanel,
  },
  context: {
    id: "context",
    name: (text) => text("Metriche di variazione", "Change metrics"),
    summary: (text) => text("Ultimo aggiornamento, da inizio mese, da inizio anno, massimo storico.", "Last update, month to date, year to date, all-time high."),
    defaultSpan: 2,
    unavailable: () => null,
    bare: true,
    Render: ContextPanel,
  },
  "category-liquidity": {
    id: "category-liquidity",
    name: (text) => text("Liquidità", "Liquidity"),
    summary: (text) => text("Il totale liquido e la sua quota del patrimonio.", "The liquid total and its share of your wealth."),
    defaultSpan: 2,
    unavailable: () => null,
    bare: true,
    Render: (props) => <CategoryPanel {...props} category="liquidity" />,
  },
  "category-investments": {
    id: "category-investments",
    name: (text) => text("Investimenti", "Investments"),
    summary: (text) => text("Il totale investito e la sua quota del patrimonio.", "The invested total and its share of your wealth."),
    defaultSpan: 2,
    unavailable: () => null,
    bare: true,
    Render: (props) => <CategoryPanel {...props} category="investments" />,
  },
  "category-trading": {
    id: "category-trading",
    name: (text) => text("Trading", "Trading"),
    summary: (text) => text("Il capitale di trading e la sua quota del patrimonio.", "Trading capital and its share of your wealth."),
    defaultSpan: 2,
    unavailable: () => null,
    bare: true,
    Render: (props) => <CategoryPanel {...props} category="trading" />,
  },
  history: {
    id: "history",
    name: (text) => text("Andamento del patrimonio", "Wealth trend"),
    summary: (text) => text("Il valore nel tempo, rilevazione dopo rilevazione.", "The value over time, update after update."),
    defaultSpan: 4,
    unavailable: (data, text) => data.snapshots.length >= 2 ? null : text("Servono almeno due rilevazioni.", "Needs at least two updates."),
    Render: HistoryPanel,
  },
  allocation: {
    id: "allocation",
    name: (text) => text("Composizione del patrimonio", "Wealth composition"),
    summary: (text) => text("Come il patrimonio si divide fra liquidità, investimenti e trading.", "How your wealth splits across liquidity, investments and trading."),
    defaultSpan: 2,
    unavailable: (data, text) => data.accounts.length > 0 ? null : text("Serve almeno un conto.", "Needs at least one account."),
    Render: AllocationPanel,
  },
  movement: {
    id: "movement",
    name: (text) => text("Cosa è cambiato", "What changed"),
    summary: (text) => text("I saldi che si sono mossi fra le ultime due rilevazioni.", "The balances that moved between the last two updates."),
    defaultSpan: 2,
    unavailable: (data, text) => data.snapshots.length >= 2 ? null : text("Servono almeno due rilevazioni.", "Needs at least two updates."),
    Render: MovementPanel,
  },
  goal: {
    id: "goal",
    name: (text) => text("Obiettivo", "Goal"),
    summary: (text) => text("Quanto manca alla soglia che hai fissato.", "How far the threshold you set still is."),
    defaultSpan: 2,
    unavailable: () => null,
    Render: GoalPanel,
  },
  accounts: {
    id: "accounts",
    name: (text) => text("Conti", "Accounts"),
    summary: (text) => text("I conti più grandi e la loro quota.", "Your largest accounts and their share."),
    defaultSpan: 2,
    unavailable: (data, text) => data.accounts.length > 0 ? null : text("Serve almeno un conto.", "Needs at least one account."),
    Render: AccountsPanel,
  },
  access: {
    id: "access",
    name: (text) => text("Accesso al capitale", "Access to capital"),
    summary: (text) => text("Quanto del patrimonio è raggiungibile subito, in pochi giorni o vincolato.", "How much is reachable at once, within days, or locked."),
    defaultSpan: 3,
    unavailable: (data, text) => data.accounts.length > 0 ? null : text("Serve almeno un conto.", "Needs at least one account."),
    Render: AccessPanel,
  },
  cash: {
    id: "cash",
    name: (text) => text("Contante", "Cash"),
    summary: (text) => text("Il contante contato taglio per taglio.", "Cash counted denomination by denomination."),
    defaultSpan: 2,
    unavailable: (data, text) => data.cashDenominations.some((denomination) => denomination.quantity > 0)
      ? null
      : text("Nessun taglio registrato.", "No denomination recorded."),
    Render: CashPanel,
  },
  income: {
    id: "income",
    name: (text) => text("Entrate", "Income"),
    summary: (text) => text("Totale, media e pagamento più alto fra gli stipendi registrati.", "Total, average and highest of the paychecks recorded."),
    defaultSpan: 3,
    unavailable: (data, text) => data.paychecks.length > 0 ? null : text("Nessuno stipendio registrato.", "No paycheck recorded."),
    Render: IncomePanel,
  },
};

/** The class each panel has always carried, kept so its own styling still finds it. */
export const panelClassName: Record<PanelId, string> = {
  hero: "hero-panel",
  context: "context-panel",
  "category-liquidity": "category-panel",
  "category-investments": "category-panel",
  "category-trading": "category-panel",
  history: "history-panel",
  allocation: "allocation-panel",
  movement: "movement-panel",
  goal: "goal-panel",
  accounts: "accounts-preview-panel",
  access: "access-panel",
  cash: "cash-panel",
  income: "income-panel",
};
