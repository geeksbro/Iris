"use client";

import { useId, useState, type ComponentType } from "react";
import {
  Bookmark,
  Car,
  CircleHelp,
  Dumbbell,
  FlaskConical,
  Gift,
  MessageCircleQuestion,
  PiggyBank,
  Plane,
  RotateCcw,
  TrendingUp,
  Wallet,
  X,
} from "lucide-react";

import { formatCurrency } from "@/domain/formatters";
import { compareDecisionScenario } from "@/domain/scenarios";
import type { WealthGoal, WealthSnapshot } from "@/domain/types";
import { analyzeWealthTrajectory } from "@/domain/wealth-progress";
import { useLanguage } from "@/features/i18n/language";
import { savedScenarios, type SavedScenario, type ScenarioFrequency, type ScenarioKind } from "@/features/settings/preferences";

import { ScenarioChart } from "./Charts";
import { NumberInput } from "./NumberInput";
import { PageFacts } from "./PageFacts";
import { Sensitive } from "./privacy";
import { Button, Entering, Money, cx } from "./ui";

/*
 * PROJECTIONS: "CAN I AFFORD IT?" (owner, 17 Oct 2026: "simplify it, I am
 * the developer and I barely follow it"). One question in plain words — I
 * am thinking of spending / setting aside or receiving this much, once or
 * every month — and one answer: what it does to the main goal, what you
 * will have in a year with and without it, how long it takes to put back.
 *
 * The engine is the one the page always used (compareDecisionScenario):
 * "without this choice" is the monthly saving you set; "with this choice"
 * adds the choice to it. Nothing is projected from the history unless asked
 * ("Start from my observed pace"), and nothing here changes your data. The
 * choices you save are kept on this device and answered again on the
 * balances of the day you come back.
 */

const horizonMinimum = 12;
const horizonMaximum = 120;

type Preset = { id: string; icon: ComponentType<{ size?: number; strokeWidth?: number }>; name: [string, string]; kind: ScenarioKind; amount: number; frequency: ScenarioFrequency };

const presets: Preset[] = [
  { id: "holiday", icon: Plane, name: ["Una vacanza", "A holiday"], kind: "spend", amount: 1500, frequency: "once" },
  { id: "car", icon: Car, name: ["Un'auto", "A car"], kind: "spend", amount: 10000, frequency: "once" },
  { id: "gym", icon: Dumbbell, name: ["Un abbonamento", "A subscription"], kind: "spend", amount: 50, frequency: "monthly" },
  { id: "save", icon: PiggyBank, name: ["Risparmio di più", "I save more"], kind: "add", amount: 100, frequency: "monthly" },
  { id: "raise", icon: TrendingUp, name: ["Un aumento", "A raise"], kind: "add", amount: 200, frequency: "monthly" },
  { id: "gift", icon: Gift, name: ["Un regalo o un bonus", "A gift or a bonus"], kind: "add", amount: 1000, frequency: "once" },
];

function todayCalendarDate(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** A fresh id for a saved choice; called on save, never while rendering. */
function newScenarioId(): string {
  return `scenario-${Date.now().toString(36)}`;
}

/** A typed figure the engine can take: mid-edit or out of range, it reads as 0. */
function finiteAmount(value: string): number {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number < 1e12 ? number : 0;
}

export function ScenarioView({
  currentWealth,
  goal,
  goals,
  snapshots = [],
}: {
  currentWealth: number;
  /** The main goal (the tests pass it alone). */
  goal?: WealthGoal;
  goals?: WealthGoal[];
  snapshots?: WealthSnapshot[];
}) {
  const { locale, text } = useLanguage();
  const baseId = useId();
  const [kind, setKind] = useState<ScenarioKind>("spend");
  const [amountText, setAmountText] = useState("");
  const [frequency, setFrequency] = useState<ScenarioFrequency>("once");
  const [monthlyText, setMonthlyText] = useState("0");
  const [saveName, setSaveName] = useState("");
  const saved = savedScenarios.use();

  // The goal the answer speaks of: the main goal if it follows Total Wealth.
  const allGoals = goals ?? (goal ? [goal] : []);
  const wealthGoal = allGoals.find((item) => item.type !== "liquidity" && item.targetAmount > currentWealth) ?? null;

  // The observed pace, offered on request only.
  const trajectory = analyzeWealthTrajectory(snapshots, snapshots.at(-1)?.createdAt ?? new Date());
  const observedPace = trajectory.recentMonthlyPace.status === "AVAILABLE"
    ? trajectory.recentMonthlyPace.value.amountPerMonth
    : trajectory.averageMonthlyPace.status === "AVAILABLE"
      ? trajectory.averageMonthlyPace.value.amountPerMonth
      : null;

  const amount = finiteAmount(amountText);
  const monthly = finiteAmount(monthlyText);
  const signed = kind === "spend" ? -amount : amount;
  const once = frequency === "once" ? signed : 0;
  const decisionMonthly = frequency === "monthly" ? monthly + signed : monthly;
  const hasChoice = amount > 0;

  const comparison = compareDecisionScenario({
    startingWealth: Math.max(0, currentWealth),
    baselineMonthlyContribution: monthly,
    decisionOneTimeAdjustment: once,
    decisionMonthlyContribution: decisionMonthly,
    horizonMonths: horizonMaximum,
    startDate: todayCalendarDate(),
    targetAmount: wealthGoal?.targetAmount,
  });

  // The chart runs as far as the answer needs: past the later arrival, a year at least.
  const arrival = (result: typeof comparison.baseline) => result.targetEstimate.status === "AVAILABLE" ? result.targetEstimate.value.months : null;
  const horizon = Math.min(horizonMaximum, Math.max(horizonMinimum, (Math.max(arrival(comparison.baseline) ?? 0, arrival(comparison.decision) ?? 0) || 0) + 6));
  const at = (result: typeof comparison.baseline, month: number) => result.points[Math.min(month, result.points.length - 1)].wealth;
  const inAYear = { without: at(comparison.baseline, 12), with: at(comparison.decision, 12) };

  const monthLabel = (iso: string) => {
    const label = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00.000Z`));
    return label.charAt(0).toLocaleUpperCase(locale) + label.slice(1);
  };
  const months = (count: number) => {
    const years = Math.floor(count / 12);
    const rest = count % 12;
    const y = years > 0 ? text(`${years} ${years === 1 ? "anno" : "anni"}`, `${years} ${years === 1 ? "year" : "years"}`) : "";
    const m = rest > 0 ? text(`${rest} ${rest === 1 ? "mese" : "mesi"}`, `${rest} ${rest === 1 ? "month" : "months"}`) : "";
    return [y, m].filter(Boolean).join(text(" e ", " and ")) || text("0 mesi", "0 months");
  };

  // The answer, in one sentence.
  const goalName = wealthGoal ? (wealthGoal.name.trim() === "Total Wealth" ? text("il tuo obiettivo", "your goal") : `«${wealthGoal.name}»`) : "";
  const impact = comparison.targetImpact;
  let headline: string;
  let tone: "good" | "bad" | "neutral" = "neutral";
  if (!hasChoice) {
    headline = text("Scrivi un importo o scegli una delle idee qui sotto: la risposta arriva subito.", "Type an amount or pick one of the ideas below: the answer comes at once.");
  } else if (!wealthGoal) {
    const difference = inAYear.with - inAYear.without;
    tone = difference < 0 ? "bad" : difference > 0 ? "good" : "neutral";
    headline = difference === 0
      ? text("Tra un anno avresti lo stesso patrimonio.", "In a year you would have the same wealth.")
      : text(`Tra un anno avresti ${formatCurrency(Math.abs(difference))} ${difference < 0 ? "in meno" : "in più"}.`, `In a year you would have ${formatCurrency(Math.abs(difference))} ${difference < 0 ? "less" : "more"}.`);
  } else if (impact.status === "DELAYED" && impact.monthsDifference !== null) {
    tone = "bad";
    headline = text(`${goalName.charAt(0).toUpperCase() + goalName.slice(1)} slitta di ${months(impact.monthsDifference)}.`, `${goalName.charAt(0).toUpperCase() + goalName.slice(1)} moves ${months(impact.monthsDifference)} later.`);
  } else if (impact.status === "ACCELERATED" && impact.monthsDifference !== null) {
    tone = "good";
    headline = text(`Raggiungi ${goalName} ${months(Math.abs(impact.monthsDifference))} prima.`, `You reach ${goalName} ${months(Math.abs(impact.monthsDifference))} sooner.`);
  } else if (impact.status === "UNCHANGED") {
    headline = text(`${goalName.charAt(0).toUpperCase() + goalName.slice(1)} non cambia data.`, `${goalName.charAt(0).toUpperCase() + goalName.slice(1)} keeps its date.`);
  } else if (arrival(comparison.baseline) !== null && arrival(comparison.decision) === null) {
    tone = "bad";
    headline = text(`Con questa scelta ${goalName} non si raggiunge più, a questo ritmo.`, `With this choice ${goalName} is no longer reached at this pace.`);
  } else if (arrival(comparison.baseline) === null && arrival(comparison.decision) !== null) {
    tone = "good";
    headline = text(`Con questa scelta ${goalName} diventa raggiungibile.`, `With this choice ${goalName} becomes reachable.`);
  } else {
    headline = text("Per sapere quando arrivi all'obiettivo serve quanto metti da parte ogni mese.", "To know when you reach the goal, say how much you set aside each month.");
  }
  const datesLine = hasChoice && wealthGoal && arrival(comparison.baseline) !== null && arrival(comparison.decision) !== null && impact.status !== "UNCHANGED"
    ? text(`Da ${monthLabel(comparison.baseline.points[arrival(comparison.baseline)!]?.date ?? todayCalendarDate())} a ${monthLabel(comparison.decision.points[arrival(comparison.decision)!]?.date ?? todayCalendarDate())}.`, `From ${monthLabel(comparison.baseline.points[arrival(comparison.baseline)!]?.date ?? todayCalendarDate())} to ${monthLabel(comparison.decision.points[arrival(comparison.decision)!]?.date ?? todayCalendarDate())}.`)
    : null;

  // How long a one-time spend takes to put back, at the monthly saving set.
  const putBack = kind === "spend" && frequency === "once" && hasChoice
    ? monthly > 0 ? Math.ceil(amount / monthly) : null
    : undefined;
  const compensation = comparison.compensation;

  const load = (choice: Pick<SavedScenario, "kind" | "amount" | "frequency"> & { monthly?: number }) => {
    setKind(choice.kind);
    setAmountText(String(choice.amount));
    setFrequency(choice.frequency);
    if (choice.monthly !== undefined) setMonthlyText(String(choice.monthly));
  };
  const reset = () => {
    setKind("spend");
    setAmountText("");
    setFrequency("once");
    setMonthlyText("0");
  };
  const describeChoice = (choice: Pick<SavedScenario, "kind" | "amount" | "frequency">) => `${choice.kind === "spend" ? text("Spendo", "I spend") : text("Ricevo o risparmio", "I receive or save")} ${formatCurrency(choice.amount)}${choice.frequency === "monthly" ? text(" al mese", " a month") : text(" una volta", " once")}`;
  // A saved choice, answered again on today's balances.
  const savedAnswer = (choice: SavedScenario) => {
    const signedAmount = choice.kind === "spend" ? -choice.amount : choice.amount;
    const result = compareDecisionScenario({
      startingWealth: Math.max(0, currentWealth),
      baselineMonthlyContribution: choice.monthly,
      decisionOneTimeAdjustment: choice.frequency === "once" ? signedAmount : 0,
      decisionMonthlyContribution: choice.frequency === "monthly" ? choice.monthly + signedAmount : choice.monthly,
      horizonMonths: horizonMaximum,
      startDate: todayCalendarDate(),
      targetAmount: wealthGoal?.targetAmount,
    });
    const shift = result.targetImpact.monthsDifference;
    if (wealthGoal && shift !== null && result.targetImpact.status === "DELAYED") return { tone: "bad", label: text(`+${months(shift)} sull'obiettivo`, `+${months(shift)} on the goal`) };
    if (wealthGoal && shift !== null && result.targetImpact.status === "ACCELERATED") return { tone: "good", label: text(`−${months(Math.abs(shift))} sull'obiettivo`, `−${months(Math.abs(shift))} on the goal`) };
    if (wealthGoal && result.targetImpact.status === "UNCHANGED") return { tone: "neutral", label: text("Obiettivo invariato", "Goal unchanged") };
    const difference = result.decision.points[12].wealth - result.baseline.points[12].wealth;
    return { tone: difference < 0 ? "bad" : difference > 0 ? "good" : "neutral", label: `${difference < 0 ? "−" : "+"}${formatCurrency(Math.abs(difference))} ${text("tra un anno", "in a year")}` };
  };
  const saveCurrent = () => {
    const name = saveName.trim() || describeChoice({ kind, amount, frequency });
    savedScenarios.set([
      { id: newScenarioId(), name, kind, amount, frequency, monthly },
      ...saved,
    ].slice(0, 12));
    setSaveName("");
  };

  return (
    <div className="management-view projections-view view-enter" data-tour="projections">
      <header className="view-header view-header--facts" data-tour="projections-header">
        <div>
          <p className="eyebrow">{text("Simulazione · i tuoi dati non cambiano", "Simulation · your data does not change")}</p>
          <h1>{text("Proiezioni", "Projections")}</h1>
        </div>
        <PageFacts
          facts={[
            { icon: MessageCircleQuestion, text: text("Una scelta, una risposta: posso permettermelo?", "One choice, one answer: can I afford it?") },
            { icon: Wallet, text: text("Calcolata sul tuo patrimonio di oggi", "Worked out on your wealth today") },
            { icon: FlaskConical, text: text("È una simulazione: conti e saldi restano come sono", "It is a simulation: accounts and balances stay as they are") },
          ]}
        />
        <div className="view-header__actions">
          <Button onClick={reset}><RotateCcw aria-hidden="true" size={15} /> {text("Ricomincia", "Start over")}</Button>
        </div>
      </header>

      {/* 1 · The question. */}
      <section aria-labelledby={`${baseId}-question`} className="afford-question">
        <h2 id={`${baseId}-question`}>{text("Sto pensando di…", "I am thinking of…")}</h2>
        <div className="afford-question__row">
          <div aria-label={text("Tipo di scelta", "Kind of choice")} className="afford-toggle" role="radiogroup">
            {(["spend", "add"] as const).map((value) => (
              <button aria-checked={kind === value} className={cx("afford-toggle__option", kind === value && "is-on")} key={value} onClick={() => setKind(value)} role="radio" type="button">
                {value === "spend" ? text("Spendere", "Spending") : text("Ricevere o risparmiare", "Receiving or saving")}
              </button>
            ))}
          </div>
          <label className="afford-amount">
            <span className="visually-hidden">{text("Importo", "Amount")}</span>
            <NumberInput aria-label={text("Importo", "Amount")} min="0" onChange={(event) => setAmountText(event.target.value)} placeholder="0" step="50" value={amountText} />
            <span aria-hidden="true" className="afford-amount__unit">€</span>
          </label>
          <div aria-label={text("Quando", "When")} className="afford-toggle" role="radiogroup">
            {(["once", "monthly"] as const).map((value) => (
              <button aria-checked={frequency === value} className={cx("afford-toggle__option", frequency === value && "is-on")} key={value} onClick={() => setFrequency(value)} role="radio" type="button">
                {value === "once" ? text("una volta", "once") : text("ogni mese", "every month")}
              </button>
            ))}
          </div>
        </div>

        {/* Ready-made ideas: one tap fills the question. */}
        <div aria-label={text("Idee pronte", "Ready-made ideas")} className="afford-presets" role="group">
          {presets.map((preset) => {
            const Icon = preset.icon;
            return (
              <button className="afford-preset" key={preset.id} onClick={() => load(preset)} type="button">
                <span aria-hidden="true" className="wealth-context__icon"><Icon size={17} strokeWidth={2} /></span>
                <span className="afford-preset__text">
                  <strong>{text(preset.name[0], preset.name[1])}</strong>
                  <small><Sensitive>{`${formatCurrency(preset.amount)}${preset.frequency === "monthly" ? text(" al mese", " a month") : ""}`}</Sensitive></small>
                </span>
              </button>
            );
          })}
        </div>

        <div className="afford-monthly">
          <label htmlFor={`${baseId}-monthly`}>
            <strong>{text("Oggi metto da parte al mese", "Today I set aside each month")}</strong>
            <small>{text("Senza questo, la simulazione non sa quando arrivi all'obiettivo.", "Without it, the simulation cannot tell when you reach the goal.")}</small>
          </label>
          <span className="afford-amount afford-amount--small">
            <NumberInput aria-label={text("Risparmio mensile di oggi", "Today's monthly saving")} id={`${baseId}-monthly`} min="0" onChange={(event) => setMonthlyText(event.target.value)} step="10" value={monthlyText} />
            <span aria-hidden="true" className="afford-amount__unit">€</span>
          </span>
          {observedPace !== null && observedPace > 0 ? (
            <Button onClick={() => setMonthlyText(String(Math.round(observedPace)))}>
              <TrendingUp aria-hidden="true" size={15} /> {text("Parti dal mio ritmo osservato", "Start from my observed pace")}
              <span className="afford-monthly__pace"><Sensitive>{formatCurrency(observedPace)}</Sensitive></span>
            </Button>
          ) : null}
        </div>
      </section>

      {/* 2 · The answer. */}
      <section aria-labelledby={`${baseId}-answer`} className={cx("afford-answer", `is-${tone}`, !hasChoice && "is-empty")}>
        <p className="afford-answer__label"><CircleHelp aria-hidden="true" size={15} /> {text("La risposta", "The answer")}</p>
        <Entering as="h2" className="afford-answer__headline" id={`${baseId}-answer`} key={headline} variant="state">{headline}</Entering>
        {datesLine ? <p className="afford-answer__dates">{datesLine}</p> : null}

        {hasChoice ? (
          <div className="afford-facts">
            <div className="afford-fact">
              <span>{text("Tra un anno avrai", "In a year you will have")}</span>
              <strong data-testid="afford-year-with"><Money amount={inAYear.with} /></strong>
              <small>{text("senza questa scelta ", "without this choice ")}<Money amount={inAYear.without} /></small>
            </div>
            {putBack !== undefined ? (
              <div className="afford-fact">
                <span>{text("Lo rimetti da parte in", "You put it back in")}</span>
                <strong>{putBack === null ? text("—", "—") : months(putBack)}</strong>
                <small>{putBack === null ? text("Indica quanto metti da parte al mese.", "Say how much you set aside each month.") : <>{text("mettendo da parte ", "setting aside ")}<Money amount={monthly} />{text(" al mese", " a month")}</>}</small>
              </div>
            ) : null}
            {wealthGoal && compensation.status === "AVAILABLE" && compensation.value.increaseOverBaseline > 0.004 ? (
              <div className="afford-fact">
                <span>{text("Per non spostare l'obiettivo", "To keep the goal's date")}</span>
                <strong><Money amount={compensation.value.monthlyContribution} /><small>{text(" / mese", " / month")}</small></strong>
                <small>{text("cioè ", "that is ")}<Money amount={compensation.value.increaseOverBaseline} />{text(" in più al mese", " more a month")}</small>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      {/* 3 · The two paths. */}
      {hasChoice ? (
        <section aria-label={text("Senza e con questa scelta", "Without and with this choice")} className="afford-chart">
          <ScenarioChart
            baselinePoints={comparison.baseline.points.slice(0, horizon + 1)}
            decisionPoints={comparison.decision.points.slice(0, horizon + 1)}
            labels={{ baseline: text("Senza questa scelta", "Without this choice"), decision: text("Con questa scelta", "With this choice") }}
            targetAmount={wealthGoal?.targetAmount}
          />
        </section>
      ) : null}

      {/* 4 · Choices kept on this device, answered again on today's balances. */}
      <section aria-labelledby={`${baseId}-saved`} className="afford-saved">
        <div className="afford-saved__heading">
          <span aria-hidden="true" className="wealth-context__icon"><Bookmark size={18} strokeWidth={2} /></span>
          <div>
            <h2 id={`${baseId}-saved`}>{text("Le tue scelte salvate", "Your saved choices")}</h2>
            <p>{text("Ogni volta che torni, sono ricalcolate sul patrimonio di quel giorno.", "Every time you come back, they are worked out again on that day's wealth.")}</p>
          </div>
        </div>
        {hasChoice ? (
          <form className="afford-saved__form" onSubmit={(event) => { event.preventDefault(); saveCurrent(); }}>
            <input aria-label={text("Nome della scelta", "Name of the choice")} maxLength={40} onChange={(event) => setSaveName(event.target.value)} placeholder={describeChoice({ kind, amount, frequency })} value={saveName} />
            <Button type="submit" variant="primary"><Bookmark aria-hidden="true" size={15} /> {text("Salva questa scelta", "Save this choice")}</Button>
          </form>
        ) : null}
        {saved.length === 0 ? (
          <p className="afford-saved__empty">{text("Nessuna scelta salvata. Prova un'idea qui sopra e salvala per ritrovarla.", "No saved choice yet. Try an idea above and save it to find it again.")}</p>
        ) : (
          <ul className="afford-saved__list">
            {saved.map((choice) => {
              const answer = savedAnswer(choice);
              return (
                <li className="afford-saved__item" key={choice.id}>
                  <button className="afford-saved__open" onClick={() => load(choice)} type="button">
                    <strong>{choice.name}</strong>
                    <small><Sensitive>{describeChoice(choice)}</Sensitive></small>
                  </button>
                  <span className={cx("afford-saved__answer", `is-${answer.tone}`)}><Sensitive>{answer.label}</Sensitive></span>
                  <button aria-label={text(`Elimina «${choice.name}»`, `Delete “${choice.name}”`)} className="icon-button afford-saved__remove" onClick={() => savedScenarios.set(saved.filter((item) => item.id !== choice.id))} type="button">
                    <X aria-hidden="true" size={15} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
