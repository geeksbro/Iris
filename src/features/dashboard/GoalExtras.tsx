import { useId, useState, type CSSProperties } from "react";

import { Check, Flag, Footprints, History, Sparkles } from "lucide-react";

import { formatCurrency } from "@/domain/formatters";
import type { WealthGoal, WealthSnapshot } from "@/domain/types";
import { analyzeMilestones } from "@/domain/wealth-progress";
import { useLanguage } from "@/features/i18n/language";

import { Percent, Sensitive } from "./privacy";
import { Button, Money, cx, formatDate, formatPercent } from "./ui";

/*
 * THE GOALS PAGE'S REASONS TO COME BACK (owner, 17 Oct 2026: "give me a
 * reason to visit this page"). All of it reads the goal and the saved
 * updates only, invents nothing, and says so where a figure cannot be
 * reconstructed (a Liquidity goal: the updates keep totals, not categories).
 *   - GoalSwitcher: every goal side by side, one chosen at a time;
 *   - GoalSimulator: "what if" — a monthly amount and a deadline, moved by
 *     hand, answered at once; it changes nothing unless asked to;
 *   - GoalMilestones: the target cut in four stops, each dated by the first
 *     saved update that reached it, the next one with what it still needs;
 *   - GoalTimeline: every update as a step towards the goal.
 */

const pointsLabel = (value: number, locale: string) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${formatPercent(Math.abs(value), 2, locale).replace("%", "")}`;

/* ── Every goal side by side ─────────────────────────────────────────────── */

const ringRadius = 15;
const ringCircumference = 2 * Math.PI * ringRadius;

export function GoalSwitcher({
  goals,
  selectedId,
  progressOf,
  titleOf,
  onSelect,
}: {
  goals: WealthGoal[];
  selectedId: string;
  /** Percent of each goal reached, by its own basis. */
  progressOf: (goal: WealthGoal) => number;
  titleOf: (goal: WealthGoal) => string;
  onSelect: (id: string) => void;
}) {
  const { locale, text } = useLanguage();
  return (
    <nav aria-label={text("I tuoi obiettivi", "Your goals")} className="goal-switcher">
      {goals.map((goal) => {
        const progress = Math.min(100, Math.max(0, progressOf(goal)));
        const selected = goal.id === selectedId;
        return (
          <button aria-pressed={selected} className={cx("goal-switcher__item", selected && "is-selected")} key={goal.id} onClick={() => onSelect(goal.id)} type="button">
            <span className="goal-switcher__ring">
              <svg aria-hidden="true" viewBox="0 0 36 36">
                <circle className="goal-switcher__track" cx="18" cy="18" r={ringRadius} />
                <circle
                  className="goal-switcher__value"
                  cx="18"
                  cy="18"
                  r={ringRadius}
                  style={{ "--share-length": (progress / 100) * ringCircumference, "--share-circumference": ringCircumference } as CSSProperties}
                  transform="rotate(-90 18 18)"
                />
              </svg>
              {progress >= 100 ? <Check aria-hidden="true" className="goal-switcher__done" size={13} strokeWidth={3} /> : null}
            </span>
            <span className="goal-switcher__text">
              <strong>{titleOf(goal)}</strong>
              <small>
                <Percent>{formatPercent(progress, 0, locale)}</Percent>
                {" · "}
                <Money amount={goal.targetAmount} />
              </small>
            </span>
          </button>
        );
      })}
    </nav>
  );
}

/* ── What if ─────────────────────────────────────────────────────────────── */

const addMonths = (from: Date, months: number) => {
  const date = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + months, Math.min(from.getUTCDate(), 28)));
  return date.toISOString().slice(0, 10);
};

export const monthsUntil = (from: Date, isoDate: string) => {
  const to = new Date(`${isoDate}T12:00:00.000Z`);
  return Math.max(1, (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth()));
};

const roundTo = (value: number, step: number) => Math.max(step, Math.round(value / step) * step);

export function GoalSimulator({
  goal,
  remaining,
  observedPerMonth,
  estimatedMonths,
  onUseDate,
}: {
  goal: WealthGoal;
  remaining: number;
  /** The observed monthly pace, when the history allows one. */
  observedPerMonth: number | null;
  /** The estimate's months at the observed pace, when there is one. */
  estimatedMonths: number | null;
  /** Saves a deadline as the goal's target date; absent, nothing can be saved. */
  onUseDate?: (date: string) => Promise<void>;
}) {
  const { locale, text } = useLanguage();
  const baseId = useId();
  const today = new Date();
  const required = goal.targetDate ? remaining / monthsUntil(today, goal.targetDate) : null;
  const startingMonthly = roundTo(observedPerMonth && observedPerMonth > 0 ? observedPerMonth : required ?? remaining / 24, 10);
  const startingMonths = goal.targetDate ? monthsUntil(today, goal.targetDate) : Math.min(120, Math.max(1, estimatedMonths ?? 24));
  const monthlyMax = roundTo(Math.max(startingMonthly * 2.5, (required ?? 0) * 1.5, remaining / 12, 100), 50);

  const [monthly, setMonthly] = useState(startingMonthly);
  const [months, setMonths] = useState(startingMonths);
  const [saving, setSaving] = useState(false);

  const monthLabel = (iso: string) => {
    const label = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00.000Z`));
    return label.charAt(0).toLocaleUpperCase(locale) + label.slice(1);
  };
  const monthsText = (count: number) => {
    const years = Math.floor(count / 12);
    const rest = count % 12;
    const y = years > 0 ? text(`${years} ${years === 1 ? "anno" : "anni"}`, `${years} ${years === 1 ? "year" : "years"}`) : "";
    const m = rest > 0 ? text(`${rest} ${rest === 1 ? "mese" : "mesi"}`, `${rest} ${rest === 1 ? "month" : "months"}`) : "";
    return [y, m].filter(Boolean).join(text(" e ", " and "));
  };

  const monthsToArrive = monthly > 0 ? Math.ceil(remaining / monthly) : null;
  const arrival = monthsToArrive !== null ? addMonths(today, monthsToArrive) : null;
  const deadline = addMonths(today, months);
  const neededPerMonth = remaining / months;
  const deadlineIsTarget = goal.targetDate?.slice(0, 7) === deadline.slice(0, 7);

  // The timeline spans the farther of the two answers, ten years at most.
  const span = Math.min(120, Math.max(months, monthsToArrive ?? 0, 12));
  const share = (count: number) => Math.min(100, (count / span) * 100);
  const at = (count: number) => `${share(count)}%`;
  // A label near the right edge reads leftwards, so it never leaves the card.
  const edge = (count: number) => (share(count) > 82 ? " is-end" : "");

  return (
    <section aria-labelledby={`${baseId}-title`} className="goal-sim">
      <div className="goal-sim__heading">
        <span aria-hidden="true" className="wealth-context__icon"><Sparkles size={18} strokeWidth={2} /></span>
        <div>
          <h2 id={`${baseId}-title`}>{text("E se…", "What if…")}</h2>
          <p>{text("Muovi i cursori: la risposta cambia subito. È una simulazione, i tuoi dati restano come sono.", "Move the sliders: the answer changes at once. It is a simulation; your data stays as it is.")}</p>
        </div>
      </div>

      <div className="goal-sim__body">
        <div className="goal-sim__control">
          <label htmlFor={`${baseId}-monthly`}>{text("Al mese metto da parte", "Each month I set aside")}</label>
          <strong className="goal-sim__value"><Money amount={monthly} /></strong>
          <input
            aria-valuetext={formatCurrency(monthly)}
            id={`${baseId}-monthly`}
            max={monthlyMax}
            min={0}
            onChange={(event) => setMonthly(Number(event.target.value))}
            step={10}
            type="range"
            value={monthly}
          />
          <p aria-live="polite" className="goal-sim__answer">
            {arrival && monthsToArrive !== null ? (
              <>
                {text("Arrivi a ", "You arrive in ")}<b>{monthLabel(arrival)}</b>
                {text(`, tra ${monthsText(monthsToArrive)}.`, `, in ${monthsText(monthsToArrive)}.`)}
              </>
            ) : text("Senza mettere da parte nulla, l'obiettivo non si avvicina.", "Setting nothing aside, the goal does not come closer.")}
          </p>
          {observedPerMonth !== null ? (
            <small className="goal-sim__note">
              {text("Il tuo ritmo osservato: ", "Your observed pace: ")}
              <Sensitive>{`${formatCurrency(observedPerMonth)} / ${text("mese", "month")}`}</Sensitive>
            </small>
          ) : null}
        </div>

        <div className="goal-sim__control">
          <label htmlFor={`${baseId}-months`}>{text("Voglio arrivare entro", "I want to arrive by")}</label>
          <strong className="goal-sim__value">{monthLabel(deadline)}</strong>
          <input
            aria-valuetext={monthLabel(deadline)}
            id={`${baseId}-months`}
            max={120}
            min={1}
            onChange={(event) => setMonths(Number(event.target.value))}
            step={1}
            type="range"
            value={months}
          />
          <p aria-live="polite" className="goal-sim__answer">
            {text("Servono ", "It takes ")}<b><Sensitive>{`${formatCurrency(neededPerMonth)} / ${text("mese", "month")}`}</Sensitive></b>
            {text(` per ${monthsText(months)}.`, ` for ${monthsText(months)}.`)}
          </p>
          {onUseDate && !deadlineIsTarget ? (
            <Button
              aria-busy={saving}
              className="goal-sim__use"
              disabled={saving}
              onClick={() => {
                setSaving(true);
                void onUseDate(deadline).finally(() => setSaving(false));
              }}
            >
              <Flag aria-hidden="true" size={15} /> {text("Usa come data obiettivo", "Use as target date")}
            </Button>
          ) : deadlineIsTarget ? (
            <small className="goal-sim__note">{text("È già la data del tuo obiettivo.", "It is already your goal's date.")}</small>
          ) : null}
        </div>
      </div>

      {/* Today on the left; where each answer lands on the same line. */}
      <div aria-hidden="true" className="goal-sim__line">
        <span className="goal-sim__track" />
        <span className="goal-sim__mark goal-sim__mark--today" style={{ left: "0%" }}><i />{text("Oggi", "Today")}</span>
        {monthsToArrive !== null && monthsToArrive <= 120 ? (
          <span className={`goal-sim__mark goal-sim__mark--arrival${edge(monthsToArrive)}`} style={{ left: at(monthsToArrive) }}><i />{monthLabel(arrival!)}</span>
        ) : null}
        <span className={`goal-sim__mark goal-sim__mark--deadline${edge(months)}`} style={{ left: at(months) }}><i />{text("Entro", "By")}</span>
      </div>
    </section>
  );
}

/* ── Four stops on the way ───────────────────────────────────────────────── */

export function GoalMilestones({
  goal,
  currentAmount,
  snapshots,
}: {
  goal: WealthGoal;
  currentAmount: number;
  snapshots: WealthSnapshot[];
}) {
  const { locale, text } = useLanguage();
  const baseId = useId();
  const shares = [25, 50, 75, 100];
  const amounts = shares.map((share) => Math.round(goal.targetAmount * share) / 100);
  const datable = goal.type !== "liquidity";
  const analysis = datable ? analyzeMilestones(snapshots, currentAmount, amounts) : null;
  const date = (value: string) => formatDate(value, { locale });
  const nextIndex = amounts.findIndex((amount) => currentAmount < amount);
  const progress = Math.min(100, (currentAmount / goal.targetAmount) * 100);

  return (
    <section aria-labelledby={`${baseId}-title`} className="goal-stops">
      <div className="goal-stops__heading">
        <span aria-hidden="true" className="wealth-context__icon"><Footprints size={18} strokeWidth={2} /></span>
        <h2 id={`${baseId}-title`}>{text("Tappe del percorso", "Stops on the way")}</h2>
      </div>
      <div className="goal-stops__path" style={{ "--goal-progress": `${progress}%` } as CSSProperties}>
        <span aria-hidden="true" className="goal-stops__rail"><span /></span>
        <ol>
          {amounts.map((amount, index) => {
            const milestone = analysis?.milestones.find((item) => item.amount === amount);
            const reachedNow = currentAmount >= amount;
            const isNext = index === nextIndex;
            return (
              <li className={cx("goal-stop", reachedNow && "is-reached", isNext && "is-next")} key={amount}>
                <span aria-hidden="true" className="goal-stop__dot">{reachedNow ? <Check size={13} strokeWidth={3} /> : null}</span>
                <strong className="goal-stop__share"><Percent>{`${shares[index]}%`}</Percent></strong>
                <span className="goal-stop__amount"><Money amount={amount} /></span>
                <small className="goal-stop__status">
                  {reachedNow
                    ? milestone?.firstReachedDate
                      ? text(`Raggiunta il ${date(milestone.firstReachedDate)}`, `Reached on ${date(milestone.firstReachedDate)}`)
                      : datable
                        ? text("Raggiunta: nessun aggiornamento salvato la data ancora", "Reached: no saved update dates it yet")
                        : text("Raggiunta (data non ricostruibile)", "Reached (date not reconstructable)")
                    : isNext
                      ? <>{text("Prossima: mancano ", "Next: ")}<Money amount={Math.max(0, amount - currentAmount)} />{text("", " to go")}</>
                      : milestone?.status === "PREVIOUSLY_REACHED" && milestone.firstReachedDate
                        ? text(`Toccata il ${date(milestone.firstReachedDate)}, ora sotto`, `Touched on ${date(milestone.firstReachedDate)}, now below`)
                        : text("Più avanti", "Further on")}
                </small>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

/* ── Every update as a step ──────────────────────────────────────────────── */

export function GoalTimeline({ goal, snapshots }: { goal: WealthGoal; snapshots: WealthSnapshot[] }) {
  const { locale, text } = useLanguage();
  const baseId = useId();
  const ordered = [...snapshots].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const steps = ordered.map((snapshot, index) => {
    const previous = ordered[index - 1];
    const change = previous ? snapshot.totalWealth - previous.totalWealth : null;
    return {
      id: snapshot.id,
      createdAt: snapshot.createdAt,
      change,
      points: change === null ? null : (change / goal.targetAmount) * 100,
      after: Math.min(100, Math.max(0, (snapshot.totalWealth / goal.targetAmount) * 100)),
    };
  }).reverse().slice(0, 8);

  return (
    <section aria-labelledby={`${baseId}-title`} className="goal-steps">
      <div className="goal-steps__heading">
        <span aria-hidden="true" className="wealth-context__icon"><History size={18} strokeWidth={2} /></span>
        <h2 id={`${baseId}-title`}>{text("Cronologia dei progressi", "Progress history")}</h2>
      </div>
      {goal.type === "liquidity" ? (
        <p className="goal-steps__note">{text("Per un obiettivo sulla Liquidità i passi non sono ricostruibili: gli aggiornamenti salvati conservano i totali, non le categorie.", "For a Liquidity goal the steps cannot be reconstructed: saved updates keep totals, not categories.")}</p>
      ) : steps.length === 0 ? (
        <p className="goal-steps__note">{text("Nessun aggiornamento salvato ancora. Ogni aggiornamento dei saldi diventerà un passo qui.", "No saved update yet. Every balance update will become a step here.")}</p>
      ) : (
        <ol className="goal-steps__list">
          {steps.map((step) => (
            <li className={cx("goal-step", step.change !== null && step.change > 0.004 && "is-up", step.change !== null && step.change < -0.004 && "is-down")} key={step.id}>
              <span className="goal-step__date">{formatDate(step.createdAt, { locale })}</span>
              <span className="goal-step__change">
                {step.change === null
                  ? text("Prima rilevazione", "First update")
                  : Math.abs(step.change) < 0.005
                    ? text("Invariato", "Unchanged")
                    : <>{step.change > 0 ? "+" : "−"}<Money amount={Math.abs(step.change)} /></>}
              </span>
              <span className="goal-step__points">
                {step.points === null ? null : <Percent>{`${pointsLabel(step.points, locale)} ${text("punti", "points")}`}</Percent>}
              </span>
              <span aria-hidden="true" className="goal-step__bar"><span style={{ width: `${step.after}%` }} /></span>
              <span className="goal-step__after"><Percent>{formatPercent(step.after, 1, locale)}</Percent></span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** "+2,10 points since your last visit", or nothing on a first visit. */
export function SinceLastVisit({ from, to }: { from: number | undefined; to: number }) {
  const { locale, text } = useLanguage();
  if (from === undefined || Math.abs(to - from) < 0.005) return null;
  const up = to > from;
  return (
    <span className={cx("goal-since", up ? "is-up" : "is-down")}>
      <Percent>{`${pointsLabel(to - from, locale)} ${text("punti", "points")}`}</Percent>
      {text(" dalla tua ultima visita", " since your last visit")}
    </span>
  );
}

/* ── The pace cards' pictures ────────────────────────────────────────────── */

/** Total wealth over the window a pace was read from, as one soft line. */
export function PaceLine({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const width = 200;
  const height = 40;
  const low = Math.min(...values);
  const high = Math.max(...values);
  const x = (index: number) => 2 + (index / (values.length - 1)) * (width - 4);
  const y = (value: number) => (high === low ? height / 2 : 3 + (1 - (value - low) / (high - low)) * (height - 6));
  const points = values.map((value, index) => `${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(" ");
  const last = values.length - 1;
  return (
    <svg aria-hidden="true" className="pace-line" preserveAspectRatio="none" viewBox={`0 0 ${width} ${height}`}>
      <polyline className="pace-line__area" points={`${x(0)},${height} ${points} ${x(last)},${height}`} />
      <polyline className="pace-line__path" points={points} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** How much of the required pace the observed one covers, as a ring. */
export function CoverageRing({ percent }: { percent: number }) {
  const radius = 22;
  const circumference = 2 * Math.PI * radius;
  const shown = Math.max(0, Math.min(100, percent));
  return (
    <svg aria-hidden="true" className={cx("coverage-ring", percent >= 100 && "is-full")} viewBox="0 0 52 52">
      <circle className="coverage-ring__track" cx="26" cy="26" r={radius} />
      <circle
        className="coverage-ring__value"
        cx="26"
        cy="26"
        r={radius}
        style={{ "--share-length": (shown / 100) * circumference, "--share-circumference": circumference } as CSSProperties}
        transform="rotate(-90 26 26)"
      />
    </svg>
  );
}

/*
 * The observed pace against the required one, as a half dial: the needle is
 * the observed pace, the notch the required one, the dial running from zero
 * to twice the required pace (anything beyond rests at the end).
 */
export function PaceGauge({ observed, required }: { observed: number; required: number }) {
  const scale = Math.max(required * 2, 1);
  const turn = (value: number) => Math.max(0, Math.min(1, value / scale));
  const point = (share: number, radius: number) => {
    const angle = Math.PI * (1 - share);
    return [60 + radius * Math.cos(angle), 60 - radius * Math.sin(angle)];
  };
  const [nx, ny] = point(turn(observed), 40);
  const [ax, ay] = point(0.5, 52);
  const [bx, by] = point(0.5, 40);
  const arc = (from: number, to: number) => {
    const [sx, sy] = point(from, 48);
    const [ex, ey] = point(to, 48);
    return `M${sx.toFixed(1)},${sy.toFixed(1)} A48,48 0 0 1 ${ex.toFixed(1)},${ey.toFixed(1)}`;
  };
  return (
    <svg aria-hidden="true" className="pace-gauge" viewBox="0 0 120 68">
      <path className="pace-gauge__track" d={arc(0, 1)} />
      <path className="pace-gauge__value" d={arc(0, Math.max(0.001, turn(observed)))} />
      <line className="pace-gauge__notch" x1={bx} x2={ax} y1={by} y2={ay} />
      <line className="pace-gauge__needle" x1="60" x2={nx} y1="60" y2={ny} />
      <circle className="pace-gauge__hub" cx="60" cy="60" r="4" />
    </svg>
  );
}

/* ── The estimate's months ───────────────────────────────────────────────── */

/**
 * The months from now to the estimated arrival, one tick each (up to three
 * years), the arrival flagged and the target month marked when there is one.
 */
export function MonthLadder({ months, targetMonths }: { months: number; targetMonths: number | null }) {
  const { locale } = useLanguage();
  const span = Math.min(36, Math.max(months, targetMonths ?? 0, 1));
  const now = new Date();
  const ticks = Array.from({ length: span }, (_, index) => {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + index + 1, 1));
    return {
      index: index + 1,
      initial: new Intl.DateTimeFormat(locale, { month: "narrow", timeZone: "UTC" }).format(date),
      january: date.getUTCMonth() === 0,
      year: date.getUTCFullYear(),
    };
  });
  return (
    <ol aria-hidden="true" className="month-ladder" style={{ "--ladder-months": span } as CSSProperties}>
      {ticks.map((tick) => (
        <li
          className={cx(
            "month-ladder__month",
            tick.index <= months && "is-before",
            tick.index === months && "is-arrival",
            targetMonths !== null && tick.index === targetMonths && "is-target",
          )}
          key={tick.index}
        >
          <i style={{ "--tick-delay": `${tick.index * 22}ms` } as CSSProperties} />
          <small>{tick.january ? `'${String(tick.year).slice(2)}` : tick.initial}</small>
        </li>
      ))}
    </ol>
  );
}
