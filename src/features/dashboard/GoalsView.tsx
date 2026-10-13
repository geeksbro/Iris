import type { ReactNode } from "react";

import { Check, CircleDashed, Info, PencilLine, Plus } from "lucide-react";

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

import { BasisMark, Button, Entering, Money, formatDate, formatPercent } from "./ui";
import { Sensitive, usePrivacy } from "./privacy";

/** The name the seed data gives the goal: a default, not a name anyone chose. */
const seededGoalName = "Total Wealth";

type Pending = { key: string; label: string; status: string; requirement: string };

export function GoalsView({
  accounts,
  goal,
  snapshots,
  onEditGoal,
}: {
  accounts: Account[];
  goal?: WealthGoal;
  totalWealth: number;
  snapshots: WealthSnapshot[];
  onEditGoal: () => void;
}) {
  const { locale, reason, text } = useLanguage();
  const { amountsHidden } = usePrivacy();
  const totalWealth = calculateTotalWealth(accounts);
  const liquidity = calculateCategoryTotals(accounts).liquidity;
  const currentAmount = goal?.type === "liquidity" ? liquidity : totalWealth;
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

  const header = (
    <header className="view-header">
      <div>
        <p className="eyebrow">{text("Pianificazione patrimoniale", "Wealth planning")}</p>
        <h1>{text("Obiettivi", "Goals")}</h1>
        <p>{text("Il traguardo che hai scelto, quanto sei vicino e quanto manca. Le stime seguono il ritmo osservato e non sono garanzie.", "The target you chose, how close you are and what remains. Estimates follow the observed pace and are not guarantees.")}</p>
      </div>
      <div className="goals-header__side">
        {goal ? <GoalBasisLegend /> : null}
        <Button onClick={onEditGoal} variant="primary">
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
          <Button onClick={onEditGoal} variant="primary"><Plus aria-hidden="true" size={16} /> {text("Aggiungi obiettivo", "Add goal")}</Button>
        </section>
      </div>
    );
  }

  const reached = intelligence.remainingAmount === 0;
  const title = goal.name.trim() === seededGoalName ? text("Obiettivo patrimoniale", "Wealth goal") : goal.name;
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

  const statusFor = (metric: Metric<unknown>, whenNotApplicable?: string) => metric.status === "INSUFFICIENT_DATA"
    ? text("In attesa", "Waiting")
    : whenNotApplicable ?? text("Non disponibile", "Not available");

  const pending: Pending[] = [];
  const insights: Array<{ key: string; label: string; content: ReactNode }> = [];

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
          content: (
            <>
              <strong className={`goal-insight__value is-${metric.value.amountPerMonth > 0 ? "positive" : metric.value.amountPerMonth < 0 ? "negative" : "neutral"}`}><Sensitive>{perMonth(metric.value.amountPerMonth)}</Sensitive></strong>
              <small>{text(`Su ${metric.value.elapsedDays} giorni osservati, dal ${date(metric.value.from)}`, `Over ${metric.value.elapsedDays} observed days, since ${date(metric.value.from)}`)}</small>
            </>
          ),
        });
      } else {
        pending.push({ key, label, status: statusFor(metric), requirement: reason(metric.reason) });
      }
    }

    const required = intelligence.requiredMonthlyPace;
    if (required.status === "AVAILABLE") {
      insights.push({
        key: "required",
        label: text("Ritmo mensile necessario", "Required monthly pace"),
        content: (
          <>
            <strong className="goal-insight__value"><Sensitive>{perMonth(required.value, false)}</Sensitive></strong>
            <small>{goal.targetDate ? text(`Per arrivare entro il ${date(goal.targetDate)}`, `To arrive by ${date(goal.targetDate)}`) : null}</small>
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
      const scale = Math.max(Math.abs(observed), Math.abs(required.value), 1);
      insights.push({
        key: "gap",
        label: text("Scostamento del ritmo", "Pace gap"),
        content: (
          <>
            <strong className="goal-insight__value">{standing}</strong>
            <small><Sensitive>{`${gap.value >= 0 ? "+" : ""}${formatCurrency(gap.value)} / ${text("mese", "month")}`}</Sensitive>{" · "}{text(`${recentPace.status === "AVAILABLE" ? "ritmo recente" : "ritmo medio"} rispetto al necessario`, `${recentPace.status === "AVAILABLE" ? "recent" : "average"} pace vs the required one`)}</small>
            {observed >= 0 ? (
              <div aria-hidden="true" className="goal-pace-bars">
                <span><i>{text("Osservato", "Observed")}</i><b style={{ width: `${(observed / scale) * 100}%` }} /></span>
                <span><i>{text("Necessario", "Required")}</i><b className="goal-pace-bars__required" style={{ width: `${(required.value / scale) * 100}%` }} /></span>
              </div>
            ) : null}
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
          <span style={{ width: amountsHidden ? "0%" : `${Math.min(intelligence.percentageCompleted, 100)}%` }} />
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

      {/* 2 · Estimate and what the history is still building towards. */}
      {estimate || pending.length > 0 ? (
        <div className={`goal-outlook${estimate && pending.length > 0 ? " goal-outlook--split" : ""}`}>
          {estimate ? (
            <Entering aria-labelledby="estimate-title" as="section" className="goal-estimate">
              <p className="goal-estimate__label" id="estimate-title"><BasisMark basis="derived" />{text("Stima di raggiungimento", "Estimated arrival")}</p>
              <strong className="goal-estimate__value">{monthYear(estimate.date)}</strong>
              <p className="goal-estimate__basis">
                {text(`Circa ${estimate.months} ${estimate.months === 1 ? "mese" : "mesi"}, al ${estimate.paceName} di `, `About ${estimate.months} ${estimate.months === 1 ? "month" : "months"}, at the ${estimate.paceName} of `)}
                <Sensitive>{perMonth(estimate.pace.amountPerMonth)}</Sensitive>
                {text(` osservato su ${estimate.pace.elapsedDays} giorni.`, ` observed over ${estimate.pace.elapsedDays} days.`)}
              </p>
              <small>{text("Solo se quel ritmo restasse invariato: non è una garanzia.", "Only if that pace stayed unchanged: it is not a guarantee.")}</small>
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
              <Entering as="article" className={`goal-insight${insight.key === "gap" ? " goal-insight--gap" : ""}`} key={insight.key}>
                <span className="goal-insight__label">{insight.label}</span>
                {insight.content}
              </Entering>
            ))}
          </div>
        </section>
      ) : null}

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
