import type { ReactNode } from "react";

import { Check, CircleDashed, Info, Trophy } from "lucide-react";

import { calculateSnapshotDelta } from "@/domain/calculations";
import { formatCurrency } from "@/domain/formatters";
import {
  analyzeWealthTrajectory,
  analyzeMilestones,
  buildMonthlyReview,
  type Metric,
  type ObservedPeriodChange,
  type PaceValue,
  type WealthMilestone,
} from "@/domain/wealth-progress";
import type { WealthGoal, WealthSnapshot } from "@/domain/types";
import { useLanguage } from "@/features/i18n/language";

import { WealthHistoryChart } from "./Charts";
import { Sensitive, usePrivacy } from "./privacy";
import { BasisMark, Entering, cx, formatDate, formatPercent } from "./ui";

const defaultMilestones = [5000, 7500, 10000, 15000, 20000, 25000, 50000, 100000];

type Insight = {
  key: string;
  label: string;
  /** What the rule already in wealth-progress needs, in plain words. */
  requirement: string;
  content: ReactNode | null;
};

export function ProgressView({
  currentWealth,
  goal,
  snapshots,
}: {
  currentWealth: number;
  goal?: WealthGoal;
  snapshots: WealthSnapshot[];
}) {
  const { locale, reason, text } = useLanguage();
  const { amountsHidden } = usePrivacy();
  const ordered = [...snapshots].sort((first, second) => new Date(first.createdAt).getTime() - new Date(second.createdAt).getTime());
  const latest = ordered.at(-1);
  const previous = ordered.at(-2);
  const referenceDate = latest?.createdAt ?? new Date().toISOString();
  const trajectory = analyzeWealthTrajectory(snapshots, referenceDate);
  const milestoneAnalysis = analyzeMilestones(snapshots, currentWealth, defaultMilestones);
  const reviewMonth = latest?.createdAt.slice(0, 7) ?? new Date().toISOString().slice(0, 7);
  const monthlyReview = buildMonthlyReview(snapshots, reviewMonth, goal, defaultMilestones);
  const high = trajectory.allTimeHigh.status === "AVAILABLE" ? trajectory.allTimeHigh.value : null;
  const lastChange = calculateSnapshotDelta(latest, previous);
  const date = (value: string) => formatDate(value, { locale });
  const signedCurrency = (amount: number) => `${amount >= 0 ? "+" : ""}${formatCurrency(amount)}`;
  const signedPercent = (value: number | null) => value === null ? null : `${value >= 0 ? "+" : ""}${formatPercent(value, 2, locale)}`;
  const tone = (amount: number) => amount > 0 ? "positive" : amount < 0 ? "negative" : "neutral";

  // Best and worst only mean something when they are two different periods.
  // With a single interval (two snapshots) the same change would carry both
  // labels, so it is held back until a second comparable period exists.
  const extremaDistinct = trajectory.bestPeriod.status === "AVAILABLE" &&
    trajectory.worstPeriod.status === "AVAILABLE" &&
    trajectory.bestPeriod.value.from !== trajectory.worstPeriod.value.from;

  const change = (metric: Metric<ObservedPeriodChange>) => metric.status === "AVAILABLE" ? (
    <>
      <strong className={`trend-insight__value is-${tone(metric.value.amount)}`}><Sensitive>{signedCurrency(metric.value.amount)}</Sensitive></strong>
      <small>
        {metric.value.percentage !== null ? <><Sensitive>{signedPercent(metric.value.percentage)}</Sensitive>{" · "}</> : null}
        {text(`dal ${date(metric.value.from)}`, `since ${date(metric.value.from)}`)}
      </small>
    </>
  ) : null;

  const pace = (metric: Metric<PaceValue>) => metric.status === "AVAILABLE" ? (
    <>
      <strong className={`trend-insight__value is-${tone(metric.value.amountPerMonth)}`}><Sensitive>{`${signedCurrency(metric.value.amountPerMonth)} / ${text("mese", "month")}`}</Sensitive></strong>
      <small>{text(`Su ${metric.value.elapsedDays} giorni osservati, dal ${date(metric.value.from)}`, `Over ${metric.value.elapsedDays} observed days, since ${date(metric.value.from)}`)}</small>
    </>
  ) : null;

  const acceleration = trajectory.acceleration.status === "AVAILABLE" ? trajectory.acceleration.value : null;

  const insights: Insight[] = [
    { key: "days30", label: text("30 giorni", "30 days"), requirement: text("Una rilevazione di circa 30 giorni prima dell'ultima", "An update from about 30 days before the latest"), content: change(trajectory.changes.days30) },
    { key: "days90", label: text("90 giorni", "90 days"), requirement: text("Una rilevazione di circa 90 giorni prima", "An update from about 90 days before"), content: change(trajectory.changes.days90) },
    { key: "days180", label: text("180 giorni", "180 days"), requirement: text("Una rilevazione di circa 180 giorni prima", "An update from about 180 days before"), content: change(trajectory.changes.days180) },
    { key: "ytd", label: text("Da inizio anno", "Year to date"), requirement: text("Una rilevazione vicina al 1° gennaio", "An update close to 1 January"), content: change(trajectory.changes.ytd) },
    { key: "average-pace", label: text("Ritmo mensile medio", "Average monthly pace"), requirement: text("Almeno 3 rilevazioni distribuite su 60 giorni", "At least 3 updates spread over 60 days"), content: pace(trajectory.averageMonthlyPace) },
    { key: "recent-pace", label: text("Ritmo mensile recente", "Recent monthly pace"), requirement: text("Una rilevazione di circa 90 giorni prima, a 60 o più giorni di distanza", "An update from about 90 days before, at least 60 days apart"), content: pace(trajectory.recentMonthlyPace) },
    {
      key: "pace-change",
      label: text("Variazione del ritmo", "Pace change"),
      requirement: text("Due periodi non sovrapposti di almeno 60 giorni", "Two non-overlapping periods of at least 60 days"),
      content: acceleration ? (
        <>
          <strong className={`trend-insight__value is-${tone(acceleration.differencePerMonth)}`}>
            {acceleration.direction === "ACCELERATING" ? text("In accelerazione", "Accelerating") : acceleration.direction === "DECELERATING" ? text("In rallentamento", "Decelerating") : text("Stabile", "Steady")}
          </strong>
          <small><Sensitive>{`${signedCurrency(acceleration.differencePerMonth)} / ${text("mese", "month")}`}</Sensitive>{" · "}{text("ritmo recente rispetto al precedente", "recent pace vs the previous one")}</small>
        </>
      ) : null,
    },
    {
      key: "extrema",
      label: text("Periodi migliore e peggiore", "Best and worst periods"),
      requirement: text("Almeno due periodi confrontabili tra rilevazioni", "At least two comparable periods between updates"),
      content: extremaDistinct && trajectory.bestPeriod.status === "AVAILABLE" && trajectory.worstPeriod.status === "AVAILABLE" ? (
        <dl className="trend-extrema">
          {[{ name: text("Migliore", "Best"), period: trajectory.bestPeriod.value }, { name: text("Peggiore", "Worst"), period: trajectory.worstPeriod.value }].map(({ name, period }) => (
            <div key={name}>
              <dt>{name}</dt>
              <dd className={`is-${tone(period.amount)}`}><Sensitive>{signedCurrency(period.amount)}</Sensitive></dd>
              <dd className="trend-extrema__period">{date(period.from)} → {date(period.to)}</dd>
            </div>
          ))}
        </dl>
      ) : null,
    },
  ];
  const availableInsights = insights.filter((insight) => insight.content !== null);
  const pendingInsights = insights.filter((insight) => insight.content === null);

  const reviewComparable = monthlyReview.opening.status === "AVAILABLE" && monthlyReview.closing.status === "AVAILABLE" && monthlyReview.change.status === "AVAILABLE";
  const reviewEvents: ReactNode[] = [];
  if (monthlyReview.allTimeHighReached.status === "AVAILABLE") {
    reviewEvents.push(
      <li key="ath"><Trophy aria-hidden="true" size={15} /><span>{text("Nuovo massimo storico osservato", "New all-time high observed")}</span><strong><Sensitive>{formatCurrency(monthlyReview.allTimeHighReached.value.amount)}</Sensitive></strong><small>{date(monthlyReview.allTimeHighReached.value.date)}</small></li>,
    );
  }
  if (monthlyReview.milestonesFirstReached.length > 0) {
    reviewEvents.push(
      <li key="milestones"><Check aria-hidden="true" size={15} /><span>{text("Milestone osservate per la prima volta", "Milestones first observed")}</span><strong><Sensitive>{monthlyReview.milestonesFirstReached.map((item) => formatCurrency(item.amount)).join(", ")}</Sensitive></strong></li>,
    );
  }
  const monthName = (() => {
    const [year, month] = reviewMonth.split("-").map(Number);
    const label = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, 1)));
    return label.charAt(0).toLocaleUpperCase(locale) + label.slice(1);
  })();

  return (
    <div className="management-view progress-view view-enter">
      <header className="view-header progress-header">
        <div>
          <p className="eyebrow">{text("Evoluzione patrimoniale", "Wealth over time")}</p>
          <h1>{text("Andamento", "Trend")}</h1>
          <p>{text("Come è cambiato il patrimonio nel tempo, sulla base delle rilevazioni che hai salvato. Nessuna causa e nessun rendimento vengono attribuiti.", "How your wealth has changed over time, based on the updates you saved. No cause and no return is attributed.")}</p>
        </div>
        <BasisLegend />
      </header>

      {/* 1 · Current state: what is known now. */}
      <section className="trend-summary" aria-labelledby="progress-current-title">
        <article className="trend-summary__cell trend-summary__cell--current">
          <span className="trend-summary__label" id="progress-current-title"><BasisMark basis="observed" />{text("Patrimonio corrente", "Current wealth")}</span>
          <strong className="trend-summary__value" data-testid="progress-current-wealth"><Sensitive>{formatCurrency(currentWealth)}</Sensitive></strong>
          <small className="trend-summary__detail">
            {text("Saldi attuali dei conti inclusi", "Current balances of included accounts")}
            {latest ? <>{" · "}{text(`ultima rilevazione ${date(latest.createdAt)}`, `last update ${date(latest.createdAt)}`)}</> : null}
          </small>
        </article>
        <article className="trend-summary__cell trend-summary__cell--ath">
          <span className="trend-summary__label"><BasisMark basis="observed" />{text("Massimo storico", "All-time high")}</span>
          {high ? (
            <>
              <strong className="trend-summary__value"><Sensitive>{formatCurrency(high.amount)}</Sensitive></strong>
              <small className="trend-summary__detail">
                {text(`Prima osservazione ${date(high.date)}`, `First observed ${date(high.date)}`)}
                {" · "}
                {high.distanceAmount === 0
                  ? text("al massimo ora", "at the high now")
                  : <Sensitive>{text(`${formatCurrency(high.distanceAmount)} sotto`, `${formatCurrency(high.distanceAmount)} below`)}</Sensitive>}
              </small>
            </>
          ) : (
            <>
              <strong className="trend-summary__value trend-summary__value--absent">—</strong>
              <small className="trend-summary__detail">{text("Nessuna rilevazione salvata", "No saved update yet")}</small>
            </>
          )}
        </article>
        <article className="trend-summary__cell">
          <span className="trend-summary__label"><BasisMark basis="derived" />{text("Ultima variazione osservata", "Latest observed change")}</span>
          {lastChange && latest && previous ? (
            <>
              <strong className={`trend-summary__value is-${tone(lastChange.amount)}`}><Sensitive>{signedCurrency(lastChange.amount)}</Sensitive></strong>
              <small className="trend-summary__detail">
                {lastChange.percentage !== null ? <><Sensitive>{signedPercent(lastChange.percentage)}</Sensitive>{" · "}</> : null}
                {text(`tra ${date(previous.createdAt)} e ${date(latest.createdAt)}`, `between ${date(previous.createdAt)} and ${date(latest.createdAt)}`)}
              </small>
            </>
          ) : (
            <>
              <strong className="trend-summary__value trend-summary__value--absent">—</strong>
              <small className="trend-summary__detail">{text("Disponibile dalla seconda rilevazione", "Available from the second update")}</small>
            </>
          )}
        </article>
      </section>

      {/* 2 · The observed trajectory: the anchor of the page. */}
      <section className="trend-panel trend-chart" aria-label={text("Traiettoria osservata", "Observed trajectory")}>
        <WealthHistoryChart
          allTimeHigh={high && ordered.length >= 2 ? high.amount : undefined}
          curve="linear"
          goalTarget={goal?.type === "liquidity" ? undefined : goal?.targetAmount}
          header={(
            <div className="trend-panel__heading">
              <p className="eyebrow">{text("Traiettoria osservata", "Observed trajectory")}</p>
              <h2>{text("Andamento del patrimonio", "Wealth over time")}</h2>
            </div>
          )}
          markerRadius={4.5}
          snapshots={snapshots}
        />
        {ordered.length >= 2 ? (
          <ul className="trend-chart__key">
            <li><span aria-hidden="true" className="trend-chart__key-dot" />{text("Rilevazione salvata", "Saved update")}</li>
            <li><span aria-hidden="true" className="trend-chart__key-line" />{text("Collegamento tra rilevazioni: i punti intermedi non sono osservati", "Link between updates: points in between are not observed")}</li>
            {high ? <li><span aria-hidden="true" className="trend-chart__key-ath" />{text("Massimo storico", "All-time high")}</li> : null}
          </ul>
        ) : null}
      </section>

      {/* 3 · Derived insights: what the history already supports, and what it is building towards. */}
      <section className="trend-insights" aria-labelledby="trend-insights-title">
        <div className="trend-section-heading">
          <h2 id="trend-insights-title"><BasisMark basis="derived" />{text("Insight derivati", "Derived insights")}</h2>
          <Entering as="span" key={availableInsights.length} variant="state">{text(`${availableInsights.length} di ${insights.length} disponibili`, `${availableInsights.length} of ${insights.length} available`)}</Entering>
        </div>

        {availableInsights.length > 0 ? (
          <div className="trend-insight-grid" aria-label={text("Metriche di traiettoria", "Trajectory metrics")} role="group">
            {availableInsights.map((insight) => (
              <Entering as="article" className={cx("trend-insight", insight.key === "extrema" && "trend-insight--wide")} key={insight.key}>
                <span className="trend-insight__label">{insight.label}</span>
                {insight.content}
              </Entering>
            ))}
          </div>
        ) : null}

        {pendingInsights.length > 0 ? (
          <section aria-label={text("Storico in costruzione", "History in progress")} className="history-readiness">
            <div className="history-readiness__heading">
              <CircleDashed aria-hidden="true" size={17} />
              <div>
                <strong>{text("Storico in costruzione", "History in progress")}</strong>
                <span>{text(
                  `${ordered.length} ${ordered.length === 1 ? "rilevazione salvata" : "rilevazioni salvate"}. Questi insight si aggiungono man mano che lo storico cresce.`,
                  `${ordered.length} saved ${ordered.length === 1 ? "update" : "updates"}. These insights appear as the history grows.`,
                )}</span>
              </div>
            </div>
            <ul className="history-readiness__list">
              {pendingInsights.map((insight) => (
                <li className="history-readiness__item" key={insight.key}>
                  <strong>{insight.label}</strong>
                  <span className="history-readiness__status">{text("In attesa", "Waiting")}</span>
                  <small>{insight.requirement}</small>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </section>

      {/* 4 · Milestones: first observed crossings, never an exact crossing time. */}
      <section aria-labelledby="milestones-title" className="trend-panel trend-milestones">
        <div className="trend-section-heading trend-section-heading--in-panel">
          <div className="trend-panel__heading">
            <p className="eyebrow">{text("Primi superamenti osservati", "First observed crossings")}</p>
            <h2 id="milestones-title">{text("Milestone patrimoniali", "Wealth milestones")}</h2>
          </div>
          <span><BasisMark basis="derived" />{text("Derivato", "Derived")}</span>
        </div>

        {milestoneAnalysis.nextMilestone.status === "AVAILABLE" ? (
          <div className="milestone-next">
            <div className="milestone-next__figure">
              <span>{text("Prossima milestone", "Next milestone")}</span>
              <strong className="milestone-next__amount"><Sensitive>{formatCurrency(milestoneAnalysis.nextMilestone.value.amount)}</Sensitive></strong>
            </div>
            <div className="milestone-next__progress">
              <div className="milestone-next__numbers">
                <strong><Sensitive>{formatPercent(milestoneAnalysis.nextMilestone.value.progressPercentage, 2, locale)}</Sensitive></strong>
                <span><Sensitive>{formatCurrency(milestoneAnalysis.nextMilestone.value.distance)}</Sensitive> {text("rimanenti", "remaining")}</span>
              </div>
              {/* Progress and a known threshold give the balance away, so both hide with amounts. */}
              <div
                aria-label={amountsHidden ? text("Avanzamento nascosto", "Progress hidden") : text(`${formatPercent(milestoneAnalysis.nextMilestone.value.progressPercentage, 2, locale)} verso la prossima milestone`, `${formatPercent(milestoneAnalysis.nextMilestone.value.progressPercentage, 2, locale)} toward the next milestone`)}
                aria-valuemax={100}
                aria-valuemin={0}
                aria-valuenow={amountsHidden ? undefined : milestoneAnalysis.nextMilestone.value.progressPercentage}
                aria-valuetext={amountsHidden ? text("Nascosto", "Hidden") : undefined}
                className="milestone-next__track"
                role="progressbar"
              >
                <span style={{ width: amountsHidden ? "0%" : `${milestoneAnalysis.nextMilestone.value.progressPercentage}%` }} />
              </div>
            </div>
          </div>
        ) : (
          <p className="milestone-next milestone-next--done"><Trophy aria-hidden="true" size={18} />{text("Tutte le milestone configurate sono state raggiunte.", "Every configured milestone has been reached.")}</p>
        )}

        <ol className="milestone-track">
          {milestoneAnalysis.milestones.map((milestone) => (
            <MilestoneStep
              isNext={milestoneAnalysis.nextMilestone.status === "AVAILABLE" && milestoneAnalysis.nextMilestone.value.amount === milestone.amount}
              key={milestone.amount}
              milestone={milestone}
            />
          ))}
        </ol>
      </section>

      {/* 5 · Monthly review: compact, and only what was observed. */}
      <section aria-label={text("Revisione patrimoniale mensile", "Monthly wealth review")} className="trend-panel trend-review">
        <div className="trend-section-heading trend-section-heading--in-panel">
          <div className="trend-panel__heading">
            <p className="eyebrow">{monthName}</p>
            <h2>{text("Revisione mensile", "Monthly review")}</h2>
          </div>
        </div>

        {reviewComparable && monthlyReview.opening.status === "AVAILABLE" && monthlyReview.closing.status === "AVAILABLE" && monthlyReview.change.status === "AVAILABLE" ? (
          <dl className="trend-review__stats">
            <div>
              <dt>{text("Patrimonio iniziale", "Opening wealth")}</dt>
              <dd className="trend-review__value"><Sensitive>{formatCurrency(monthlyReview.opening.value.amount)}</Sensitive></dd>
              <dd className="trend-review__meta"><BasisMark basis="observed" />{date(monthlyReview.opening.value.date)}</dd>
            </div>
            <div>
              <dt>{text("Patrimonio finale", "Closing wealth")}</dt>
              <dd className="trend-review__value"><Sensitive>{formatCurrency(monthlyReview.closing.value.amount)}</Sensitive></dd>
              <dd className="trend-review__meta"><BasisMark basis="observed" />{date(monthlyReview.closing.value.date)}</dd>
            </div>
            <div>
              <dt>{text("Variazione osservata", "Observed change")}</dt>
              <dd className={`trend-review__value is-${tone(monthlyReview.change.value.amount)}`}><Sensitive>{signedCurrency(monthlyReview.change.value.amount)}</Sensitive></dd>
              <dd className="trend-review__meta"><BasisMark basis="derived" />{text(`${monthlyReview.change.value.elapsedDays} giorni tra le rilevazioni`, `${monthlyReview.change.value.elapsedDays} days between updates`)}</dd>
            </div>
            {monthlyReview.goalProgressMovement.status === "AVAILABLE" ? (
              <div>
                <dt>{text("Variazione avanzamento obiettivo", "Goal progress movement")}</dt>
                <dd className="trend-review__value"><Sensitive>{signedPercent(monthlyReview.goalProgressMovement.value.differencePercentage)}</Sensitive></dd>
                <dd className="trend-review__meta"><BasisMark basis="derived" /><Sensitive>{`${formatPercent(monthlyReview.goalProgressMovement.value.fromPercentage, 2, locale)} → ${formatPercent(monthlyReview.goalProgressMovement.value.toPercentage, 2, locale)}`}</Sensitive></dd>
              </div>
            ) : null}
          </dl>
        ) : (
          <p className="trend-review__empty">{text("Dati insufficienti per confrontare apertura e chiusura del mese.", "Not enough data to compare the opening and close of the month.")}</p>
        )}

        {reviewEvents.length > 0 ? <ul className="trend-review__events">{reviewEvents}</ul> : null}

        <p className="trend-review__footnote">
          <strong>{text("Evoluzione allocazione", "Allocation evolution")}</strong>{" "}
          {monthlyReview.categoryAllocation.movement.status === "AVAILABLE"
            ? text("disponibile.", "available.")
            : <>{text("non applicabile", "not applicable")}: {reason(monthlyReview.categoryAllocation.movement.reason)}</>}
        </p>
      </section>

      {/* 6 · Integrity: visible, never dominant. */}
      <aside aria-label={text("Integrità finanziaria", "Financial integrity")} className="trend-integrity">
        <Info aria-hidden="true" size={17} />
        <p>
          <strong>{text("Direzione, non attribuzione.", "Direction, not attribution.")}</strong>{" "}
          {text("Le metriche descrivono come è cambiato il patrimonio osservato. Non separano contributi, spese, rendimento di mercato o P&L di trading.", "These metrics describe how observed wealth changed. They do not separate contributions, spending, market return, or trading P&L.")}
        </p>
      </aside>
    </div>
  );
}

function MilestoneStep({ milestone, isNext }: { milestone: WealthMilestone; isNext: boolean }) {
  const { locale, text } = useLanguage();
  const compact = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(milestone.amount / 1000);
  const state = milestone.status === "CURRENTLY_ABOVE" ? "reached" : milestone.status === "PREVIOUSLY_REACHED" ? "previous" : isNext ? "next" : "future";
  const status = state === "reached"
    ? text("Superata", "Reached")
    : state === "previous"
      ? text("Superata in passato, ora sotto", "Reached before, below now")
      : state === "next"
        ? text("Prossima", "Next")
        : text("Non ancora raggiunta", "Not yet reached");
  const detail = milestone.firstReachedDate
    ? text(`Prima osservazione ${formatDate(milestone.firstReachedDate, { locale })}`, `First observed ${formatDate(milestone.firstReachedDate, { locale })}`)
    : state === "reached"
      ? text("Sopra con i saldi attuali, non ancora in una rilevazione salvata", "Above on current balances, not yet in a saved update")
      : null;

  return (
    <li className={`milestone-track__step milestone-track__step--${state}`}>
      <span aria-hidden="true" className="milestone-track__node">{state === "reached" || state === "previous" ? <Check size={12} strokeWidth={3} /> : null}</span>
      <span className="milestone-track__amount">
        <span aria-hidden="true"><Sensitive>{`${compact}k`}</Sensitive></span>
        <span className="visually-hidden"><Sensitive>{formatCurrency(milestone.amount)}</Sensitive></span>
      </span>
      <span className="milestone-track__status">{status}</span>
      {detail ? <small className="milestone-track__detail">{detail}</small> : null}
    </li>
  );
}

function BasisLegend() {
  const { text } = useLanguage();
  return (
    <div className="basis-legend trend-basis-legend" aria-label={text("Legenda origine dati", "Data basis legend")} role="group">
      <span><BasisMark basis="observed" /><span><strong>{text("Osservato", "Observed")}</strong> {text("registrato nelle rilevazioni", "recorded in your updates")}</span></span>
      <span><BasisMark basis="derived" /><span><strong>{text("Derivato", "Derived")}</strong> {text("calcolato dalle rilevazioni", "calculated from them")}</span></span>
    </div>
  );
}
