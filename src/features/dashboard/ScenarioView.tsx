"use client";

import { Fragment, useMemo, useState, type ReactNode } from "react";
import { Info, RotateCcw } from "lucide-react";

import { formatCurrency } from "@/domain/formatters";
import { compareDecisionScenario, type ScenarioResult } from "@/domain/scenarios";
import type { WealthGoal } from "@/domain/types";
import { useLanguage, type Language } from "@/features/i18n/language";

import { ScenarioChart } from "./Charts";
import { DateField } from "./DateField";
import { NumberInput } from "./NumberInput";
import { Sensitive, usePrivacy } from "./privacy";
import { BasisMark, Button, Entering, cx, formatDate } from "./ui";

const configuredMilestones = [5000, 7500, 10000, 15000, 20000, 25000, 50000, 100000];
const maximumHorizonMonths = 600;

function todayCalendarDate(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function localizeScenarioReason(reason: string, language: Language): string {
  if (language === "en") return reason;
  const exact: Record<string, string> = {
    "Add a target amount to compare target timing.": "Aggiungi un obiettivo per confrontare i tempi di raggiungimento.",
    "Neither path reaches the target under the selected monthly paces.": "Nessuna delle due traiettorie raggiunge l'obiettivo con i ritmi mensili selezionati.",
    "The decision makes the target reachable while the baseline without decision does not.": "La decisione rende raggiungibile l'obiettivo, mentre la baseline senza decisione non lo raggiunge.",
    "The decision path does not reach a target that the baseline without decision reaches.": "La traiettoria della decisione non raggiunge un obiettivo che la baseline senza decisione raggiunge.",
    "The decision does not change the simulated target month.": "La decisione non modifica il mese simulato di raggiungimento.",
    "The decision does not start below the baseline without decision.": "La decisione non parte sotto la baseline senza decisione.",
    "Recovery requires a valid scenario start date.": "Il recupero richiede una data iniziale valida.",
    "The decision does not recover within the 600-month model limit.": "La traiettoria della decisione non recupera entro il limite di 600 mesi del modello.",
    "Add a target amount to calculate a compensation pace.": "Aggiungi un obiettivo per calcolare il ritmo di compensazione.",
    "The baseline without decision must reach the target to calculate compensation.": "La baseline senza decisione deve raggiungere l'obiettivo per calcolare la compensazione.",
    "Compensation is unnecessary because the target is already reached.": "La compensazione non è necessaria perché l'obiettivo è già raggiunto.",
  };
  if (exact[reason]) return exact[reason];
  const later = /^The decision reaches the target (\d+) months later than the baseline without decision\.$/.exec(reason);
  if (later) return `La decisione raggiunge l'obiettivo ${later[1]} mesi dopo la baseline senza decisione.`;
  const earlier = /^The decision reaches the target (\d+) months earlier than the baseline without decision\.$/.exec(reason);
  if (earlier) return `La decisione raggiunge l'obiettivo ${earlier[1]} mesi prima della baseline senza decisione.`;
  return reason;
}

/**
 * A typed figure the scenario engine can take. While a field is mid-edit
 * ("-", "1e") or out of range ("1e400") it reads as the fallback, so the
 * engine never receives a value it rejects.
 */
function finiteInput(value: string, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function ScenarioView({ currentWealth, goal }: { currentWealth: number; goal?: WealthGoal }) {
  const { language, locale, text } = useLanguage();
  const { amountsHidden } = usePrivacy();
  // With no saved goal the target starts empty: a target is an assumption the
  // user makes, never one the page makes for them.
  const defaultTarget = goal ? String(goal.targetAmount) : "";
  const [startingWealth, setStartingWealth] = useState(String(currentWealth));
  const [baselineMonthlyContribution, setBaselineMonthlyContribution] = useState("0");
  const [decisionOneTimeAdjustment, setDecisionOneTimeAdjustment] = useState("0");
  const [decisionMonthlyContribution, setDecisionMonthlyContribution] = useState("0");
  const [decisionPaceCustomized, setDecisionPaceCustomized] = useState(false);
  const [horizonMonths, setHorizonMonths] = useState("12");
  const [targetAmount, setTargetAmount] = useState(defaultTarget);
  const [targetDate, setTargetDate] = useState(goal?.targetDate ?? "");
  const startDate = todayCalendarDate();

  const horizon = Math.max(0, Math.min(maximumHorizonMonths, Math.trunc(Number(horizonMonths) || 0)));
  const typedTarget = finiteInput(targetAmount);
  const target = typedTarget > 0 ? typedTarget : undefined;
  const baselinePace = finiteInput(baselineMonthlyContribution);
  const decisionPace = finiteInput(decisionMonthlyContribution);
  const adjustment = finiteInput(decisionOneTimeAdjustment);
  // The engine starts from zero or more; a negative entry is shown back to
  // the user and simulated from zero.
  const typedStart = finiteInput(startingWealth);
  const startNegative = typedStart < 0;
  const start = Math.max(0, typedStart);

  const comparison = useMemo(() => compareDecisionScenario({
    startingWealth: start,
    baselineMonthlyContribution: baselinePace,
    decisionOneTimeAdjustment: adjustment,
    decisionMonthlyContribution: decisionPace,
    horizonMonths: horizon,
    startDate,
    targetAmount: target,
    targetDate: targetDate || undefined,
  }), [adjustment, baselinePace, decisionPace, horizon, start, startDate, target, targetDate]);

  const reset = () => {
    setStartingWealth(String(currentWealth));
    setBaselineMonthlyContribution("0");
    setDecisionOneTimeAdjustment("0");
    setDecisionMonthlyContribution("0");
    setDecisionPaceCustomized(false);
    setHorizonMonths("12");
    setTargetAmount(defaultTarget);
    setTargetDate(goal?.targetDate ?? "");
  };

  const nextMilestone = configuredMilestones.find((amount) => amount > start);
  const milestoneComparison = nextMilestone === undefined ? null : compareDecisionScenario({
    startingWealth: start,
    baselineMonthlyContribution: baselinePace,
    decisionOneTimeAdjustment: adjustment,
    decisionMonthlyContribution: decisionPace,
    horizonMonths: horizon,
    startDate,
    targetAmount: nextMilestone,
  });

  // Presentation reading of results the engine already produced.
  const identical = comparison.baseline.points.every((point, index) => point.wealth === comparison.decision.points[index]?.wealth);
  const impact = comparison.wealthImpactAtHorizon;
  const signed = (amount: number) => `${amount > 0 ? "+" : ""}${formatCurrency(amount)}`;
  const months = (count: number) => text(`${count} ${count === 1 ? "mese" : "mesi"}`, `${count} ${count === 1 ? "month" : "months"}`);
  // Built from its parts: with a tiny contribution an estimate can fall past
  // the year 9999, which an ISO date string cannot express, and a date past
  // the calendar's end comes back from the engine as not a number at all.
  const monthYear = (value: string) => {
    const [year, month] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, 1, 12));
    if (!Number.isFinite(date.getTime())) return text("Oltre ogni data calcolabile", "Beyond any calculable date");
    const label = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(date);
    return label.charAt(0).toLocaleUpperCase(locale) + label.slice(1);
  };
  const startEdited = Math.abs(start - currentWealth) > 0.004;
  const targetFromGoal = goal !== undefined && target === goal.targetAmount;

  const reach = (result: ScenarioResult): ReactNode => {
    if (result.targetEstimate.status !== "AVAILABLE") return <span className="projection-muted">{text("Non raggiunto con questi contributi", "Not reached with these contributions")}</span>;
    const { months: count, date } = result.targetEstimate.value;
    if (count === 0) return text("Già raggiunto all'inizio", "Already reached at the start");
    return (
      <>
        {monthYear(date)}
        <small>{months(count)}{count > horizon ? text(" · oltre l'orizzonte", " · beyond the horizon") : ""}</small>
      </>
    );
  };
  const required = (result: ScenarioResult): ReactNode => result.requiredMonthlyContribution.status === "AVAILABLE"
    ? <Sensitive>{`${formatCurrency(result.requiredMonthlyContribution.value)} / ${text("mese", "month")}`}</Sensitive>
    : <span className="projection-muted">{result.requiredMonthlyContribution.reason === "Target is already reached in this scenario." ? text("Già raggiunto", "Already reached") : text("Non calcolabile", "Not calculable")}</span>;

  const bothUnreachable = target !== undefined && comparison.baseline.targetEstimate.status !== "AVAILABLE" && comparison.decision.targetEstimate.status !== "AVAILABLE";
  const showRequired = target !== undefined && Boolean(targetDate);

  const consequences: ReactNode[] = [];
  const recovery = comparison.recoveryPoint;
  if (identical) {
    // Nothing differs, so nothing follows from the decision.
  } else if (recovery.status === "AVAILABLE") {
    consequences.push(
      <Entering as="article" className="projection-consequence" key="recovery">
        <span className="projection-consequence__label">{text("Punto di recupero", "Recovery point")}</span>
        <strong>{text(`Recupero dopo ${recovery.value.months} mesi`, `Recovery after ${recovery.value.months} months`)}</strong>
        <small>{text(`Con queste assunzioni la decisione torna al livello della baseline a ${monthYear(recovery.value.date).toLowerCase()}.`, `With these assumptions the decision is back level with the baseline in ${monthYear(recovery.value.date)}.`)}</small>
      </Entering>,
    );
  } else if (recovery.reason.startsWith("The decision does not recover")) {
    consequences.push(
      <Entering as="article" className="projection-consequence projection-consequence--note" key="recovery">
        <span className="projection-consequence__label">{text("Punto di recupero", "Recovery point")}</span>
        <small>{localizeScenarioReason(recovery.reason, language)}</small>
      </Entering>,
    );
  }
  if (!identical && target !== undefined && !bothUnreachable && comparison.targetImpact.status !== "UNCHANGED" && comparison.targetImpact.status !== "NOT_APPLICABLE") {
    consequences.push(
      <Entering as="article" className="projection-consequence" key="target">
        <span className="projection-consequence__label">{text("Impatto sull'obiettivo", "Target impact")}</span>
        <strong>{comparison.targetImpact.status === "DELAYED" ? text("Più tardi", "Later") : comparison.targetImpact.status === "ACCELERATED" ? text("Prima", "Sooner") : text("Non raggiunto dalla decisione", "Not reached by the decision")}</strong>
        <small>{localizeScenarioReason(comparison.targetImpact.reason, language)}</small>
      </Entering>,
    );
  }
  // Compensation only matters when the decision arrives later, or not at all.
  const decisionFallsBehind = comparison.targetImpact.status === "DELAYED" ||
    (comparison.targetImpact.status === "UNREACHABLE" && comparison.targetImpact.baselineMonths !== null);
  if (!identical && decisionFallsBehind && comparison.compensation.status === "AVAILABLE") {
    consequences.push(
      <Entering as="article" className="projection-consequence" key="compensation">
        <span className="projection-consequence__label">{text("Ritmo di compensazione", "Compensation pace")}</span>
        <strong data-testid="compensation-pace"><Sensitive>{formatCurrency(comparison.compensation.value.monthlyContribution)}</Sensitive> / {text("mese", "month")}</strong>
        <small data-testid="compensation-increase"><Sensitive>{signed(comparison.compensation.value.increaseOverBaseline)}</Sensitive> {text("rispetto alla baseline per mantenere lo stesso mese obiettivo", "versus baseline to preserve its target month")}</small>
      </Entering>,
    );
  }
  // The next milestone earns a card only when it tells something the target
  // row does not: a different amount, reached in different months.
  const milestoneMonths = (result: ScenarioResult) => result.targetEstimate.status === "AVAILABLE" ? result.targetEstimate.value.months : null;
  const milestoneUseful = !identical && milestoneComparison !== null && nextMilestone !== undefined && nextMilestone !== target &&
    (milestoneMonths(milestoneComparison.baseline) !== null || milestoneMonths(milestoneComparison.decision) !== null) &&
    milestoneMonths(milestoneComparison.baseline) !== milestoneMonths(milestoneComparison.decision);
  if (milestoneUseful && milestoneComparison && nextMilestone !== undefined) {
    const describe = (result: ScenarioResult, name: string) => (
      <div>
        <dt>{name}</dt>
        <dd>
          {result.targetEstimate.status !== "AVAILABLE"
            ? <span className="projection-muted">{text("Non raggiunta", "Not reached")}</span>
            : result.targetEstimate.value.months === 0
              // A one-time impact can lift the decision past the threshold on day one.
              ? <>{text("Già superata all'inizio", "Already passed at the start")} <small>{text("con l'impatto una tantum", "with the one-time impact")}</small></>
              : <>{monthYear(result.targetEstimate.value.date)} <small>{text(`${result.targetEstimate.value.months} mesi simulati`, `${result.targetEstimate.value.months} simulated ${result.targetEstimate.value.months === 1 ? "month" : "months"}`)}</small></>}
        </dd>
      </div>
    );
    consequences.push(
      <section aria-label={text("Impatto sulla prossima milestone", "Next milestone impact")} className="projection-consequence projection-consequence--milestone" key="milestone">
        <span className="projection-consequence__label">{text("Prossima milestone", "Next milestone")} <strong><Sensitive>{formatCurrency(nextMilestone)}</Sensitive></strong></span>
        <dl>
          {describe(milestoneComparison.baseline, "Baseline")}
          {describe(milestoneComparison.decision, text("Decisione", "Decision"))}
        </dl>
      </section>,
    );
  }

  const field = ({ label, aria, value, onChange, unit, hint, basis, min, max, step = "0.01", type = "number", sensitive = true }: {
    label: string; aria?: string; value: string; onChange: (value: string) => void; unit?: string; hint?: ReactNode; basis: "observed" | "defined"; min?: string; max?: string; step?: string; type?: "number" | "date"; sensitive?: boolean;
  }) => {
    const masked = sensitive && type === "number" && amountsHidden;
    return (
      <label className={cx("projection-field", masked && "is-masked")}>
        <span className="projection-field__label"><BasisMark basis={basis} />{label}</span>
        <span className="projection-field__control">
          {/* The date opens IRIS's calendar and the number takes IRIS's
              stepper (owner, 10 Oct 2026); a masked amount is plain text. */}
          {type === "date" ? (
            <DateField ariaLabel={aria ?? label} onChange={onChange} value={value} />
          ) : masked ? (
            <input aria-label={aria ?? label} onChange={(event) => onChange(event.target.value)} type="text" value={value} />
          ) : (
            <NumberInput
              aria-label={aria ?? label}
              inputMode="decimal"
              max={max}
              min={min}
              onChange={(event) => onChange(event.target.value)}
              step={step}
              value={value}
            />
          )}
          {unit ? <span className="projection-field__unit">{unit}</span> : null}
        </span>
        {hint ? <small className="projection-field__hint">{hint}</small> : null}
      </label>
    );
  };

  return (
    <div className="management-view projections-view view-enter" data-tour="projections">
      <header className="view-header" data-tour="projections-header">
        <div>
          <p className="eyebrow">{text("Scenario ipotetico · nessuna modifica ai dati", "Hypothetical scenario · no changes to your data")}</p>
          <h1>{text("Proiezioni", "Projections")}</h1>
          <p>{text("Confronta due traiettorie matematiche basate sulle condizioni che imposti. I risultati sono simulazioni, non previsioni.", "Compare two mathematical trajectories built from the conditions you set. The results are simulations, not forecasts.")}</p>
        </div>
        <div className="projections-header__side">
          <div aria-label={text("Legenda origine dati", "Data basis legend")} className="goal-basis-legend" role="group">
            <span><BasisMark basis="observed" />{text("Osservato", "Observed")}</span>
            <span><BasisMark basis="defined" />{text("Definito da te", "Set by you")}</span>
            <span><i aria-hidden="true" className="basis-mark basis-mark--simulated" />{text("Simulato", "Simulated")}</span>
          </div>
          <Button onClick={reset}><RotateCcw aria-hidden="true" size={15} /> {text("Ripristina scenario", "Reset scenario")}</Button>
        </div>
      </header>

      <div className="projection-layout">
        {/* 1 · Assumptions, grouped by what they change. */}
        <section aria-labelledby="scenario-assumptions-title" className="projection-assumptions">
          <div className="projection-panel-heading">
            <p className="eyebrow">{text("Scenario", "Scenario")}</p>
            <h2 id="scenario-assumptions-title">{text("Assunzioni", "Assumptions")}</h2>
          </div>

          <fieldset className="projection-group projection-group--baseline">
            <legend className="baseline-definition"><strong>{text("Baseline — senza decisione", "Baseline — without decision")}</strong></legend>
            <p className="projection-group__desc">{text("Nessun impatto una tantum e il contributo mensile che scegli qui. Il ritmo storico osservato non viene mai proiettato automaticamente.", "No one-time impact and the monthly contribution you choose here. Observed historical pace is never projected automatically.")}</p>
            {field({
              label: text("Patrimonio iniziale", "Starting wealth"),
              value: startingWealth,
              onChange: setStartingWealth,
              unit: "€",
              min: "0",
              basis: startEdited ? "defined" : "observed",
              hint: startNegative
                ? text("Il patrimonio iniziale non può essere negativo: la simulazione parte da 0 €.", "Starting wealth cannot be negative: the simulation starts from 0 €.")
                : startEdited
                  ? <>{text("Modificato da te. Patrimonio osservato: ", "Edited by you. Observed wealth: ")}<Sensitive>{formatCurrency(currentWealth)}</Sensitive></>
                  : text("Precompilato dal patrimonio osservato. Puoi modificarlo.", "Prefilled from your observed wealth. You can edit it."),
            })}
            {field({
              label: text("Contributo mensile", "Monthly contribution"),
              aria: text("Contributo mensile baseline", "Baseline monthly contribution"),
              value: baselineMonthlyContribution,
              onChange: (value) => { setBaselineMonthlyContribution(value); if (!decisionPaceCustomized) setDecisionMonthlyContribution(value); },
              unit: text("€ / mese", "€ / month"),
              basis: "defined",
            })}
          </fieldset>

          <fieldset className="projection-group projection-group--decision">
            <legend>{text("Decisione — cosa cambia", "Decision — what changes")}</legend>
            {field({
              label: text("Impatto una tantum", "One-time impact"),
              aria: text("Impatto una tantum della decisione", "Decision one-time adjustment"),
              value: decisionOneTimeAdjustment,
              onChange: setDecisionOneTimeAdjustment,
              unit: "€",
              basis: "defined",
              hint: text("Applicato oggi. Positivo aggiunge, negativo toglie.", "Applied today. Positive adds, negative subtracts."),
            })}
            {field({
              label: text("Nuovo contributo mensile", "New monthly contribution"),
              value: decisionMonthlyContribution,
              onChange: (value) => { setDecisionPaceCustomized(true); setDecisionMonthlyContribution(value); },
              unit: text("€ / mese", "€ / month"),
              basis: "defined",
              hint: decisionPaceCustomized
                ? text("Diverso dalla baseline solo se lo cambi: ora lo hai impostato tu.", "Differs from the baseline only if you change it: you have now set it.")
                : text("Segue la baseline finché non lo modifichi.", "Follows the baseline until you edit it."),
            })}
          </fieldset>

          <div className="projection-group-row">
            <fieldset className="projection-group">
              <legend>{text("Orizzonte", "Horizon")}</legend>
              {field({
                label: text("Orizzonte in mesi", "Horizon months"),
                value: horizonMonths,
                onChange: setHorizonMonths,
                unit: text("mesi", "months"),
                min: "0",
                max: String(maximumHorizonMonths),
                step: "1",
                basis: "defined",
                sensitive: false,
                hint: text(`Da 0 a ${maximumHorizonMonths} mesi, calcolati mese per mese da oggi.`, `From 0 to ${maximumHorizonMonths} months, calculated month by month from today.`),
              })}
            </fieldset>

            <fieldset className="projection-group">
              <legend>{text("Obiettivo · opzionale", "Target · optional")}</legend>
              {field({
                label: text("Obiettivo opzionale", "Optional target"),
                value: targetAmount,
                onChange: setTargetAmount,
                unit: "€",
                min: "0.01",
                basis: "defined",
                hint: targetFromGoal ? text("Precompilato dal tuo obiettivo.", "Prefilled from your goal.") : text("Lascia vuoto per non confrontare un obiettivo.", "Leave empty to skip the target comparison."),
              })}
              {field({
                label: text("Data obiettivo opzionale", "Optional target date"),
                value: targetDate,
                onChange: setTargetDate,
                type: "date",
                basis: "defined",
                sensitive: false,
                hint: text("Serve solo a calcolare il contributo mensile necessario.", "Used only to calculate the required monthly contribution."),
              })}
            </fieldset>
          </div>
        </section>

        {/* 2 · The result: the difference the decision makes. */}
        <div className="projection-results">
          <section aria-label={text("Impatto della decisione", "Decision impact")} className={cx("projection-result", identical && "projection-result--same")}>
            {/* Keyed branches: switching between "no difference" and a result replays the swap. */}
            {identical ? (
              <Fragment key="same">
                <Entering as="p" className="projection-result__label" variant="state"><i aria-hidden="true" className="basis-mark basis-mark--simulated" />{text("Nessuna differenza tra gli scenari", "No difference between the scenarios")}</Entering>
                <Entering as="h2" className="projection-result__same" variant="state">{text("Le condizioni della decisione coincidono con la baseline.", "The decision's conditions match the baseline.")}</Entering>
                <Entering as="p" className="projection-result__context">
                  {text(`Modifica l'impatto una tantum o il nuovo contributo mensile per vedere come cambia la traiettoria. Intanto, la baseline dopo ${months(horizon)}: `, `Change the one-time impact or the new monthly contribution to see how the trajectory changes. Meanwhile, the baseline after ${months(horizon)}: `)}
                  <strong><Sensitive>{formatCurrency(comparison.baseline.wealthAtHorizon)}</Sensitive></strong>
                </Entering>
              </Fragment>
            ) : (
              <Fragment key="impact">
                <Entering as="p" className="projection-result__label" variant="state"><i aria-hidden="true" className="basis-mark basis-mark--simulated" />{text("Impatto della decisione", "Decision impact")}</Entering>
                <Entering as="h2" variant="state">
                  <strong className="projection-result__delta" data-testid="decision-horizon-impact"><Sensitive>{signed(impact)}</Sensitive></strong>
                  <span className="projection-result__basis">{impact === 0
                    ? text(`dopo ${months(horizon)}: stesso patrimonio della baseline`, `after ${months(horizon)}: the same wealth as the baseline`)
                    : text(`dopo ${months(horizon)} rispetto alla baseline`, `after ${months(horizon)} compared with the baseline`)}</span>
                </Entering>
                <Entering as="dl" className="projection-result__changes">
                  <div>
                    <dt>{text("Impatto una tantum", "One-time impact")}</dt>
                    <dd><Sensitive>{signed(adjustment)}</Sensitive></dd>
                  </div>
                  <div>
                    <dt>{text("Contributo mensile", "Monthly contribution")}</dt>
                    <dd>{baselinePace === decisionPace
                      ? <><Sensitive>{formatCurrency(decisionPace)}</Sensitive> <span className="projection-muted">{text("invariato", "unchanged")}</span></>
                      : <><Sensitive>{formatCurrency(baselinePace)}</Sensitive> → <Sensitive>{formatCurrency(decisionPace)}</Sensitive></>}</dd>
                  </div>
                </Entering>
              </Fragment>
            )}
          </section>

          <section aria-label={text("Confronto baseline e decisione", "Baseline versus decision comparison")} className="projection-compare">
            <div className={cx("projection-compare__head", identical && "is-single")}>
              <span />
              {identical ? <strong>{text("Entrambi gli scenari", "Both scenarios")}</strong> : <><strong className="projection-compare__baseline">Baseline</strong><strong className="projection-compare__decision">{text("Decisione", "Decision")}</strong></>}
            </div>
            <div className={cx("projection-compare__row", identical && "is-single")}>
              <span>{text(`Patrimonio dopo ${months(horizon)}`, `Wealth after ${months(horizon)}`)}</span>
              <strong data-testid="baseline-horizon-wealth"><Sensitive>{formatCurrency(comparison.baseline.wealthAtHorizon)}</Sensitive></strong>
              {identical ? null : <strong data-testid="decision-horizon-wealth"><Sensitive>{formatCurrency(comparison.decision.wealthAtHorizon)}</Sensitive></strong>}
            </div>
            {target !== undefined && !bothUnreachable ? (
              <div className={cx("projection-compare__row", identical && "is-single")}>
                <span>{text("Obiettivo raggiunto", "Target reached")} <small><Sensitive>{formatCurrency(target)}</Sensitive></small></span>
                <strong>{reach(comparison.baseline)}</strong>
                {identical ? null : <strong>{reach(comparison.decision)}</strong>}
              </div>
            ) : null}
            {showRequired && !bothUnreachable ? (
              <div className={cx("projection-compare__row", identical && "is-single")}>
                <span>{text("Contributo necessario entro la data", "Contribution needed by the date")} <small>{formatDate(`${targetDate}T12:00:00.000Z`, { timeZone: "UTC", locale })}</small></span>
                <strong>{required(comparison.baseline)}</strong>
                {identical ? null : <strong>{required(comparison.decision)}</strong>}
              </div>
            ) : null}
            {bothUnreachable ? (
              <p className="projection-compare__note">
                {text("Obiettivo di ", "Target of ")}<Sensitive>{formatCurrency(target ?? 0)}</Sensitive>
                {text(": nessuno dei due scenari lo raggiunge con questi contributi.", ": neither scenario reaches it with these contributions.")}
              </p>
            ) : null}
            {target !== undefined ? <p className="projection-compare__footnote">{text("Le date sono simulate: valgono solo con queste assunzioni.", "Dates are simulated: they hold only under these assumptions.")}</p> : null}
          </section>
        </div>
      </div>

      {/* 3 · The trajectory: the anchor of the results. */}
      <section aria-labelledby="scenario-chart-title" className="projection-trajectory">
        <div className="projection-panel-heading">
          <p className="eyebrow">{text("Traiettoria simulata", "Simulated trajectory")}</p>
          <h2 id="scenario-chart-title">{text("Baseline e decisione", "Baseline and decision")}</h2>
        </div>
        <ScenarioChart baselinePoints={comparison.baseline.points} decisionPoints={comparison.decision.points} targetAmount={target} />
        <p className="projection-trajectory__note">
          {identical
            ? text("Gli scenari coincidono con le condizioni attuali: la linea è una sola.", "The scenarios coincide under the current conditions: there is a single line.")
            : text("Valori calcolati mese per mese. Sono traiettorie matematiche, non rilevazioni.", "Values calculated month by month. These are mathematical paths, not saved updates.")}
        </p>
      </section>

      {/* 4 · Consequences: only the ones that apply. */}
      {consequences.length > 0 ? (
        <section aria-labelledby="projection-consequences-title" className="projection-consequences">
          <h2 className="goal-section-title" id="projection-consequences-title"><i aria-hidden="true" className="basis-mark basis-mark--simulated" />{text("Conseguenze della decisione", "What the decision changes")}</h2>
          <div className="projection-consequence-grid">{consequences}</div>
        </section>
      ) : null}

      {/* 5 · What the model assumes, and nothing it does not. */}
      <aside aria-label={text("Assunzioni del modello", "Model assumptions")} className="projection-method">
        <Info aria-hidden="true" size={17} />
        <div>
          <strong>{text("Assunzioni del modello", "Model assumptions")}</strong>
          <ul className="scenario-zero-return">
            <li>{text("Rendimento di mercato ipotizzato: ", "Assumed market return: ")}<strong>0%</strong>{text(". Nessun interesse, capitalizzazione, inflazione, P&L o variazione di prezzo.", ". No interest, compounding, inflation, P&L or price change.")}</li>
            <li>{text("Crescita lineare: patrimonio iniziale, più l'eventuale impatto una tantum oggi, più il contributo mensile per ogni mese.", "Linear growth: starting wealth, plus any one-time impact today, plus the monthly contribution for each month.")}</li>
            <li>{text("Il patrimonio simulato non scende sotto 0 €. Il ritmo storico osservato non viene usato.", "Simulated wealth never goes below €0. Observed historical pace is not used.")}</li>
          </ul>
        </div>
      </aside>
    </div>
  );
}
