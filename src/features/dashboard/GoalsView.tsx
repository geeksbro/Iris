import { useEffect, useRef, useState, type ReactNode } from "react";

import { Activity, CalendarClock, Check, CircleDashed, Flag, Gauge, Info, PencilLine, Plus, Scale, Target, TrendingUp, TriangleAlert } from "lucide-react";

import { calculateCategoryTotals, calculateTotalWealth } from "@/domain/calculations";
import { formatCurrency } from "@/domain/formatters";
import {
  analyzeGoal,
  analyzeMilestones,
  analyzeWealthTrajectory,
  type Metric,
  type PaceValue,
} from "@/domain/wealth-progress";
import type { Account, WealthGoal, WealthSnapshot } from "@/domain/types";
import { useLanguage } from "@/features/i18n/language";
import { goalSeen, selectedGoal } from "@/features/settings/preferences";

import { BasisMark, Button, Entering, Money, formatDate, formatPercent } from "./ui";
import { CoverageRing, GoalMilestones, GoalSimulator, GoalSwitcher, GoalTimeline, MonthLadder, PaceGauge, PaceLine, SinceLastVisit, monthsUntil } from "./GoalExtras";
import { PageFacts } from "./PageFacts";
import { Percent, Sensitive, usePrivacy } from "./privacy";

/** The name the seed data gives the goal: a default, not a name anyone chose. */
const seededGoalName = "Total Wealth";

type Pending = { key: string; label: string; status: string; requirement: string };

export function GoalsView({
  accounts,
  goal: onlyGoal,
  goals,
  snapshots,
  onEditGoal,
  onAddGoal,
  onSetTargetDate,
}: {
  accounts: Account[];
  /** A single goal, when the caller has one (the tests do). */
  goal?: WealthGoal;
  /** Every goal, the first being the main one the other pages follow. */
  goals?: WealthGoal[];
  totalWealth: number;
  snapshots: WealthSnapshot[];
  /** Edits the given goal; without one, creates the first. */
  onEditGoal: (goal?: WealthGoal) => void;
  onAddGoal?: () => void;
  /** Saves a deadline chosen in the simulator as the goal's target date. */
  onSetTargetDate?: (goal: WealthGoal, date: string) => Promise<void>;
}) {
  const { locale, reason, text } = useLanguage();
  const { amountsHidden } = usePrivacy();
  const allGoals = goals ?? (onlyGoal ? [onlyGoal] : []);
  // The goal shown: the one last chosen on this device, or the main one.
  const chosenId = selectedGoal.use();
  const goal = allGoals.find((item) => item.id === chosenId) ?? allGoals[0];
  const totalWealth = calculateTotalWealth(accounts);
  const liquidity = calculateCategoryTotals(accounts).liquidity;
  const amountFor = (item: WealthGoal) => item.type === "liquidity" ? liquidity : totalWealth;
  const currentAmount = goal ? amountFor(goal) : totalWealth;
  const trajectory = analyzeWealthTrajectory(
    snapshots,
    snapshots.at(-1)?.createdAt ?? new Date(),
  );
  const unsupportedLiquidityPace: Metric<PaceValue> = {
    status: "NOT_APPLICABLE",
    basis: "DERIVED",
    reason: "Historical liquidity categories are unavailable in stored snapshots.",
  };
  const averagePace = goal?.type === "liquidity"
    ? unsupportedLiquidityPace
    : trajectory.averageMonthlyPace;
  const recentPace = goal?.type === "liquidity"
    ? unsupportedLiquidityPace
    : trajectory.recentMonthlyPace;
  const paceForEstimate = recentPace.status === "AVAILABLE" ? recentPace : averagePace;
  const referenceDate = new Date().toISOString().slice(0, 10);
  const intelligence = goal
    ? analyzeGoal(goal, currentAmount, paceForEstimate, referenceDate)
    : null;

  // Since the last visit: this device remembers how far each goal had come
  // when it last showed it; the bar starts from there and moves to today's.
  const [seenAtArrival] = useState(() => goalSeen.get());
  const barRef = useRef<HTMLSpanElement>(null);
  const goalId = goal?.id;
  const progressNow = intelligence ? Math.min(intelligence.percentageCompleted, 100) : null;
  useEffect(() => {
    if (!goalId || progressNow === null) return;
    const from = seenAtArrival[goalId];
    const bar = barRef.current;
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? true;
    if (bar && from !== undefined && Math.abs(from - progressNow) > 0.005 && !amountsHidden && !still && typeof bar.animate === "function") {
      bar.animate([{ width: `${Math.min(from, 100)}%` }, { width: `${progressNow}%` }], { duration: 1100, delay: 250, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "backwards" });
    }
    goalSeen.set({ ...goalSeen.get(), [goalId]: progressNow });
  }, [goalId, progressNow, amountsHidden, seenAtArrival]);

  const header = (
    <header className="view-header view-header--facts">
      <div>
        <p className="eyebrow">{text("Pianificazione patrimoniale", "Wealth planning")}</p>
        <h1>{text("Obiettivi", "Goals")}</h1>
      </div>
      <PageFacts
        facts={[
          { icon: Flag, text: text("Il traguardo che hai scelto", "The target you chose") },
          { icon: Gauge, text: text("Quanto sei vicino e quanto manca", "How close you are and what remains") },
          { icon: TriangleAlert, text: text("Le stime seguono il ritmo osservato e non sono garanzie", "Estimates follow the observed pace and are not guarantees") },
        ]}
      />
      <div className="goals-header__side">
        {goal ? <GoalBasisLegend /> : null}
        {goal && onAddGoal ? (
          <Button onClick={onAddGoal}><Plus aria-hidden="true" size={16} /> {text("Nuovo obiettivo", "New goal")}</Button>
        ) : null}
        <Button onClick={() => onEditGoal(goal)} variant="primary">
          {goal ? <PencilLine aria-hidden="true" size={16} /> : <Plus aria-hidden="true" size={16} />}
          {goal ? text("Modifica obiettivo", "Edit goal") : text("Aggiungi obiettivo", "Add goal")}
        </Button>
      </div>
    </header>
  );

  if (!goal || !intelligence) {
    return (
      <div className="management-view goals-view view-enter">
        {header}
        <section aria-labelledby="goal-empty-title" className="goal-empty-state">
          <p className="goal-empty-state__label">{text("Nessun obiettivo configurato", "No goal set")}</p>
          <h2 id="goal-empty-title">{text("Scegli il traguardo da raggiungere", "Choose the target you want to reach")}</h2>
          <p>{text("Un obiettivo può seguire il Patrimonio totale o la Liquidità corrente. Qui vedrai quanto sei vicino e quanto manca; le stime compaiono quando lo storico osservato è sufficiente.", "A goal can follow Total Wealth or current Liquidity. Here you will see how close you are and what remains; estimates appear once there is enough observed history.")}</p>
          <Button onClick={() => (onAddGoal ?? onEditGoal)()} variant="primary"><Plus aria-hidden="true" size={16} /> {text("Aggiungi obiettivo", "Add goal")}</Button>
        </section>
      </div>
    );
  }

  const reached = intelligence.remainingAmount === 0;
  const titleOf = (item: WealthGoal) => item.name.trim() === seededGoalName ? text("Obiettivo patrimoniale", "Wealth goal") : item.name;
  const title = titleOf(goal);
  const basisLabel = goal.type === "liquidity" ? text("Liquidità", "Liquidity") : text("Patrimonio totale", "Total Wealth");
  const percent = formatPercent(intelligence.percentageCompleted, 2, locale);
  const date = (value: string) => formatDate(value.length === 10 ? `${value}T12:00:00.000Z` : value, { timeZone: value.length === 10 ? "UTC" : undefined, locale });
  const monthYear = (value: string) => {
    const label = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T12:00:00.000Z`));
    return label.charAt(0).toLocaleUpperCase(locale) + label.slice(1);
  };
  const perMonth = (amount: number, signed = true) => `${signed && amount >= 0 ? "+" : ""}${formatCurrency(amount)} / ${text("mese", "month")}`;

  // First saved update at or above the target: the same "first observed"
  // reading the milestones use. Snapshots hold totals only, so a Liquidity
  // goal cannot be dated this way.
  const firstObservedAtTarget = reached && goal.type !== "liquidity"
    ? analyzeMilestones(snapshots, currentAmount, [goal.targetAmount]).milestones[0]?.firstReachedDate ?? null
    : null;

  const estimate = intelligence.estimatedTarget.status === "AVAILABLE" && paceForEstimate.status === "AVAILABLE" ? {
    ...intelligence.estimatedTarget.value,
    pace: paceForEstimate.value,
    paceName: recentPace.status === "AVAILABLE" ? text("ritmo mensile recente", "recent monthly pace") : text("ritmo medio osservato", "average observed pace"),
  } : null;

  const targetMonths = goal.targetDate ? monthsUntil(new Date(), goal.targetDate) : null;

  const statusFor = (metric: Metric<unknown>, whenNotApplicable?: string) => metric.status === "INSUFFICIENT_DATA"
    ? text("In attesa", "Waiting")
    : whenNotApplicable ?? text("Non disponibile", "Not available");

  const pending: Pending[] = [];
  const insights: Array<{ key: string; label: string; icon: ReactNode; content: ReactNode }> = [];
  // Total wealth at every saved update since a date: what a pace was read from.
  const wealthSince = (from: string) => snapshots
    .filter((snapshot) => snapshot.createdAt.slice(0, 10) >= from.slice(0, 10))
    .map((snapshot) => snapshot.totalWealth);

  if (!reached && !estimate) {
    pending.push({ key: "estimate", label: text("Stima di raggiungimento", "Estimated arrival"), status: statusFor(intelligence.estimatedTarget), requirement: reason(intelligence.estimatedTarget.status === "AVAILABLE" ? "" : intelligence.estimatedTarget.reason) });
  }
  if (!reached) {
    for (const [key, label, metric] of [
      ["recent", text("Ritmo mensile osservato", "Observed monthly pace"), recentPace],
      ["average", text("Ritmo medio osservato", "Average observed pace"), averagePace],
    ] as const) {
      if (metric.status === "AVAILABLE") {
        insights.push({
          key,
          label,
          icon: key === "recent" ? <Activity size={18} strokeWidth={2} /> : <TrendingUp size={18} strokeWidth={2} />,
          content: (
            <>
              <strong className={`goal-insight__value is-${metric.value.amountPerMonth > 0 ? "positive" : metric.value.amountPerMonth < 0 ? "negative" : "neutral"}`}><Sensitive>{perMonth(metric.value.amountPerMonth)}</Sensitive></strong>
              <small>{text(`Su ${metric.value.elapsedDays} giorni osservati, dal ${date(metric.value.from)}`, `Over ${metric.value.elapsedDays} observed days, since ${date(metric.value.from)}`)}</small>
              {amountsHidden ? null : <PaceLine values={wealthSince(metric.value.from)} />}
            </>
          ),
        });
      } else {
        pending.push({ key, label, status: statusFor(metric), requirement: reason(metric.reason) });
      }
    }

    const required = intelligence.requiredMonthlyPace;
    if (required.status === "AVAILABLE") {
      const coverage = paceForEstimate.status === "AVAILABLE" && required.value > 0
        ? (paceForEstimate.value.amountPerMonth / required.value) * 100
        : null;
      insights.push({
        key: "required",
        label: text("Ritmo mensile necessario", "Required monthly pace"),
        icon: <Target size={18} strokeWidth={2} />,
        content: (
          <>
            <strong className="goal-insight__value"><Sensitive>{perMonth(required.value, false)}</Sensitive></strong>
            <small>{goal.targetDate ? text(`Per arrivare entro il ${date(goal.targetDate)}`, `To arrive by ${date(goal.targetDate)}`) : null}</small>
            {coverage !== null && !amountsHidden ? (
              <span className="goal-coverage">
                <CoverageRing percent={coverage} />
                <span>
                  {text(`Il tuo ${recentPace.status === "AVAILABLE" ? "ritmo recente" : "ritmo medio"} ne copre il `, `Your ${recentPace.status === "AVAILABLE" ? "recent" : "average"} pace covers `)}
                  <b><Percent>{formatPercent(Math.max(0, coverage), 0, locale)}</Percent></b>
                </span>
              </span>
            ) : null}
          </>
        ),
      });
    } else {
      pending.push({
        key: "required",
        label: text("Ritmo mensile necessario", "Required monthly pace"),
        status: goal.targetDate ? statusFor(required) : text("Richiede una data obiettivo", "Needs a target date"),
        requirement: reason(required.reason),
      });
    }

    const gap = intelligence.paceGap;
    if (gap.status === "AVAILABLE" && required.status === "AVAILABLE" && paceForEstimate.status === "AVAILABLE") {
      const standing = gap.value > 0
        ? text("Sopra il ritmo richiesto", "Above the required pace")
        : gap.value < 0
          ? text("Sotto il ritmo richiesto", "Below the required pace")
          : text("In linea con il ritmo richiesto", "In line with the required pace");
      const observed = paceForEstimate.value.amountPerMonth;
      insights.push({
        key: "gap",
        label: text("Scostamento del ritmo", "Pace gap"),
        icon: <Scale size={18} strokeWidth={2} />,
        content: (
          <>
            <strong className="goal-insight__value">{standing}</strong>
            <small><Sensitive>{`${gap.value >= 0 ? "+" : ""}${formatCurrency(gap.value)} / ${text("mese", "month")}`}</Sensitive>{" · "}{text(`${recentPace.status === "AVAILABLE" ? "ritmo recente" : "ritmo medio"} rispetto al necessario`, `${recentPace.status === "AVAILABLE" ? "recent" : "average"} pace vs the required one`)}</small>
            {amountsHidden ? null : (
              <div aria-hidden="true" className="goal-gauge">
                <PaceGauge observed={observed} required={required.value} />
                <span className="goal-gauge__legend">
                  <span><i className="goal-gauge__key goal-gauge__key--observed" />{text("Osservato", "Observed")}</span>
                  <span><i className="goal-gauge__key goal-gauge__key--required" />{text("Necessario", "Required")}</span>
                </span>
              </div>
            )}
          </>
        ),
      });
    } else {
      pending.push({ key: "gap", label: text("Scostamento del ritmo", "Pace gap"), status: goal.targetDate ? statusFor(gap) : text("Richiede una data obiettivo", "Needs a target date"), requirement: reason(gap.status === "AVAILABLE" ? "" : gap.reason) });
    }
  }

  return (
    <div className="management-view goals-view view-enter">
      {header}

      {/* Every goal, one shown at a time (owner, 17 Oct 2026). */}
      {allGoals.length > 1 ? (
        <GoalSwitcher
          goals={allGoals}
          onSelect={(id) => selectedGoal.set(id)}
          progressOf={(item) => (amountFor(item) / item.targetAmount) * 100}
          selectedId={goal.id}
          titleOf={titleOf}
        />
      ) : null}

      {/* 1 · The goal: target first, then progress, current, remaining. */}
      <section aria-labelledby="active-goal-title" className={`goal-hero${reached ? " goal-hero--reached" : ""}`}>
        <div className="goal-hero__top">
          <div className="goal-hero__identity">
            <h2 id="active-goal-title">{title}</h2>
            <span className="goal-hero__basis">{basisLabel}</span>
          </div>
          <p className="goal-hero__date">
            <BasisMark basis="defined" />
            <span>{text("Data obiettivo", "Target date")}</span>
            <strong>{goal.targetDate ? date(goal.targetDate) : text("Non impostata", "Not set")}</strong>
          </p>
        </div>

        <div className="goal-hero__main">
          <div className="goal-hero__target">
            <span className="goal-hero__label"><BasisMark basis="defined" />{text("Target", "Target")}</span>
            <strong><Money amount={goal.targetAmount} /></strong>
          </div>
          <div className="goal-hero__progress">
            {reached ? (
              <span className="goal-hero__reached"><Check aria-hidden="true" size={15} strokeWidth={3} />{text("Obiettivo raggiunto", "Goal reached")}</span>
            ) : (
              <>
                <strong><Sensitive>{percent}</Sensitive></strong>
                <span className="goal-hero__label"><BasisMark basis="derived" />{text("raggiunto", "reached")}</span>
                {amountsHidden ? null : <SinceLastVisit from={seenAtArrival[goal.id]} to={intelligence.percentageCompleted} />}
              </>
            )}
          </div>
        </div>

        <div
          aria-label={amountsHidden ? text("Avanzamento nascosto", "Progress hidden") : text(`${percent} dell'obiettivo raggiunto`, `${percent} of goal reached`)}
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={amountsHidden ? undefined : intelligence.percentageCompleted}
          aria-valuetext={amountsHidden ? text("Nascosto", "Hidden") : undefined}
          className={`goal-hero__track${amountsHidden ? " is-masked" : ""}`}
          role="progressbar"
        >
          {/* Current over target, drawn no further than the end of the track. */}
          <span ref={barRef} style={{ width: amountsHidden ? "0%" : `${Math.min(intelligence.percentageCompleted, 100)}%` }} />
        </div>

        <dl className="goal-hero__facts">
          <div>
            <dt><BasisMark basis="observed" />{goal.type === "liquidity" ? text("Liquidità attuale", "Current liquidity") : text("Patrimonio attuale", "Current wealth")}</dt>
            <dd><Money amount={intelligence.currentAmount} /></dd>
          </div>
          {reached ? (
            <div>
              <dt><BasisMark basis="observed" />{text("Prima rilevazione sopra il target", "First update at or above target")}</dt>
              <dd className="goal-hero__fact-text">
                {firstObservedAtTarget
                  ? date(firstObservedAtTarget)
                  : goal.type === "liquidity"
                    ? text("Non ricostruibile: le rilevazioni non conservano le categorie", "Not reconstructable: updates do not keep categories")
                    : text("Nessuna rilevazione salvata lo registra ancora", "No saved update records it yet")}
              </dd>
            </div>
          ) : (
            <div>
              <dt><BasisMark basis="derived" />{text("Mancano", "Remaining")}</dt>
              <dd><Money amount={intelligence.remainingAmount} /></dd>
            </div>
          )}
        </dl>

        {!goal.targetDate && !reached ? (
          <p className="goal-hero__hint">{text("Con una data obiettivo si calcolano anche il ritmo necessario e lo scostamento dal ritmo osservato.", "With a target date, the required pace and the gap from the observed pace are calculated too.")}</p>
        ) : null}
      </section>

      {/* The stops on the way, and "what if" while the goal is ahead. */}
      <GoalMilestones currentAmount={currentAmount} goal={goal} key={`stops-${goal.id}`} snapshots={snapshots} />
      {!reached ? (
        <GoalSimulator
          estimatedMonths={estimate?.months ?? null}
          goal={goal}
          key={`sim-${goal.id}-${goal.targetDate ?? ""}`}
          observedPerMonth={paceForEstimate.status === "AVAILABLE" && goal.type !== "liquidity" ? paceForEstimate.value.amountPerMonth : null}
          onUseDate={onSetTargetDate ? (date) => onSetTargetDate(goal, date) : undefined}
          remaining={intelligence.remainingAmount}
        />
      ) : null}

      {/* 2 · Estimate and what the history is still building towards. */}
      {estimate || pending.length > 0 ? (
        <div className={`goal-outlook${estimate && pending.length > 0 ? " goal-outlook--split" : ""}`}>
          {estimate ? (
            <Entering aria-labelledby="estimate-title" as="section" className="goal-estimate">
              <div className="goal-estimate__text">
                <p className="goal-estimate__label" id="estimate-title">
                  <span aria-hidden="true" className="wealth-context__icon"><CalendarClock size={18} strokeWidth={2} /></span>
                  <BasisMark basis="derived" />{text("Stima di raggiungimento", "Estimated arrival")}
                </p>
                <strong className="goal-estimate__value">{monthYear(estimate.date)}</strong>
                {targetMonths !== null ? (
                  <span className={`goal-estimate__versus ${estimate.months < targetMonths ? "is-ahead" : estimate.months > targetMonths ? "is-behind" : ""}`}>
                    {estimate.months < targetMonths
                      ? text(`In anticipo di ${targetMonths - estimate.months} ${targetMonths - estimate.months === 1 ? "mese" : "mesi"} sulla data obiettivo`, `${targetMonths - estimate.months} ${targetMonths - estimate.months === 1 ? "month" : "months"} ahead of the target date`)
                      : estimate.months > targetMonths
                        ? text(`In ritardo di ${estimate.months - targetMonths} ${estimate.months - targetMonths === 1 ? "mese" : "mesi"} sulla data obiettivo`, `${estimate.months - targetMonths} ${estimate.months - targetMonths === 1 ? "month" : "months"} behind the target date`)
                        : text("In linea con la data obiettivo", "In line with the target date")}
                  </span>
                ) : null}
                <p className="goal-estimate__basis">
                  {text(`Circa ${estimate.months} ${estimate.months === 1 ? "mese" : "mesi"}, al ${estimate.paceName} di `, `About ${estimate.months} ${estimate.months === 1 ? "month" : "months"}, at the ${estimate.paceName} of `)}
                  <Sensitive>{perMonth(estimate.pace.amountPerMonth)}</Sensitive>
                  {text(` osservato su ${estimate.pace.elapsedDays} giorni.`, ` observed over ${estimate.pace.elapsedDays} days.`)}
                </p>
                <small>{text("Solo se quel ritmo restasse invariato: non è una garanzia.", "Only if that pace stayed unchanged: it is not a guarantee.")}</small>
              </div>
              <div className="goal-estimate__ladder">
                <MonthLadder months={estimate.months} targetMonths={targetMonths} />
                <span className="goal-estimate__ladder-key">
                  <span><i className="goal-estimate__key goal-estimate__key--arrival" />{text("Arrivo stimato", "Estimated arrival")}</span>
                  {targetMonths !== null ? <span><i className="goal-estimate__key goal-estimate__key--target" />{text("Data obiettivo", "Target date")}</span> : null}
                </span>
              </div>
            </Entering>
          ) : null}

          {pending.length > 0 ? (
            <section aria-label={text("Dati in costruzione", "Data in progress")} className="goal-readiness">
              <div className="goal-readiness__heading">
                <CircleDashed aria-hidden="true" size={17} />
                <strong>{text("Dati in costruzione", "Data in progress")}</strong>
              </div>
              <ul>
                {pending.map((item) => (
                  <li key={item.key}>
                    <strong>{item.label}</strong>
                    <Entering as="span" className="goal-readiness__status" key={item.status} variant="state">{item.status}</Entering>
                    <small>{item.requirement}</small>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}

      {/* 3 · Pace, only the parts that can be calculated. */}
      {insights.length > 0 ? (
        <section aria-labelledby="goal-pace-title" className="goal-pace">
          <h2 className="goal-section-title" id="goal-pace-title"><BasisMark basis="derived" />{text("Ritmo verso l'obiettivo", "Pace towards the goal")}</h2>
          <div aria-label={text("Analisi obiettivo", "Goal intelligence")} className="goal-insight-grid" role="group">
            {insights.map((insight) => (
              <Entering as="article" className={`goal-insight goal-insight--${insight.key}`} key={insight.key}>
                <span className="goal-insight__head">
                  <span aria-hidden="true" className="wealth-context__icon">{insight.icon}</span>
                  <span className="goal-insight__label">{insight.label}</span>
                </span>
                {insight.content}
              </Entering>
            ))}
          </div>
        </section>
      ) : null}

      <GoalTimeline goal={goal} key={`steps-${goal.id}`} snapshots={snapshots} />

      {/* 4 · Method, visible but quiet. */}
      <aside aria-label={text("Nota metodologica", "Method note")} className="goal-method">
        <Info aria-hidden="true" size={17} />
        <p>
          {text("Le stime usano il ritmo osservato nelle rilevazioni disponibili: non sono una previsione garantita. Il ritmo è la variazione del patrimonio salvato e non separa depositi, prelievi, spese, mercato o trading.", "Estimates use the pace observed in your saved updates: they are not a guaranteed forecast. Pace is the change in saved wealth and does not separate deposits, withdrawals, spending, market moves or trading.")}
        </p>
      </aside>
    </div>
  );
}

function GoalBasisLegend() {
  const { text } = useLanguage();
  return (
    <div aria-label={text("Legenda origine dati", "Data basis legend")} className="goal-basis-legend" role="group">
      <span><BasisMark basis="observed" />{text("Osservato", "Observed")}</span>
      <span><BasisMark basis="defined" />{text("Definito da te", "Set by you")}</span>
      <span><BasisMark basis="derived" />{text("Derivato", "Derived")}</span>
    </div>
  );
}
