import { useId, useState, type ReactNode } from "react";

import { ChartSpline, ChevronDown, ChevronRight, CircleAlert, CircleDashed, Coins, MoreHorizontal, Plus, ReceiptEuro, Repeat } from "lucide-react";

import { calculateIncomeTotal, calculateTypicalSalary, findMissingSalaryMonths, paycheckTypeOf } from "@/domain/calculations";
import type { Paycheck } from "@/domain/types";
import { useLanguage } from "@/features/i18n/language";
import { paycheckYears } from "@/features/settings/preferences";

import { IncomeChart, allIncomeYears, type IncomeScope } from "./Charts";
import { IncomeMix, MonthRing, SalaryLine, YearRing, type Hovered } from "./IncomeSummaryCharts";
import { IncomeYearsGlyph, SalaryTrendGlyph } from "./income-glyphs";
import { Percent } from "./privacy";
import { Button, Money, cx, formatDate, formatPercent, paycheckRowFocusId } from "./ui";
import { PageFacts } from "./PageFacts";

type PaycheckYear = { key: string; paychecks: Paycheck[] };

/*
 * The change in a year's recorded income on the year before, in percent — or
 * null wherever it would mislead (owner, 26 Sep 2026):
 *   - the current year is still running, so it is never compared;
 *   - the year before must be in the ledger and have income;
 *   - the first recorded year counts only if it starts in January: records
 *     begun mid-year make a short year, and "+80%" on it would be noise.
 * It compares recorded payments, nothing else: no salary growth is implied.
 */
export function yearOverYear(
  group: PaycheckYear,
  previous: PaycheckYear | undefined,
  first: PaycheckYear,
  currentYear: number,
): number | null {
  if (!previous || Number(group.key) >= currentYear || Number(previous.key) !== Number(group.key) - 1) return null;
  if (previous === first && !previous.paychecks.some((paycheck) => paycheck.paymentDate.slice(5, 7) === "01")) return null;
  const before = calculateIncomeTotal(previous.paychecks);
  if (before <= 0) return null;
  return ((calculateIncomeTotal(group.paychecks) - before) / before) * 100;
}

export function CashFlowView({
  paychecks,
  onAdd,
  onEdit,
}: {
  paychecks: Paycheck[];
  onAdd: () => void;
  onEdit: (paycheck: Paycheck) => void;
}) {
  const { locale, text } = useLanguage();
  const ordered = [...paychecks].sort((first, second) => second.paymentDate.localeCompare(first.paymentDate));
  const year = new Date().getFullYear();
  // Presentation only: the records of one calendar year share a heading. The
  // calendar tile on each row already carries its month.
  const years = ordered.reduce<PaycheckYear[]>((groups, paycheck) => {
    const key = paycheck.paymentDate.slice(0, 4);
    const current = groups[groups.length - 1];
    if (current?.key === key) current.paychecks.push(paycheck);
    else groups.push({ key, paychecks: [paycheck] });
    return groups;
  }, []);
  // The chart shows one year (the most recent to start) or all of them summed.
  // A chosen year that no longer has paychecks falls back to the most recent.
  const [scope, setScope] = useState<IncomeScope | null>(null);
  const scopeAvailable = scope !== null
    && (scope === allIncomeYears ? years.length > 1 : years.some((group) => group.key === scope));
  const chartScope: IncomeScope = scopeAvailable && scope !== null ? scope : (years[0]?.key ?? String(year));
  const allScope = chartScope === allIncomeYears;
  // Everything the summary shows is read from the chart's scope.
  const scoped = allScope ? ordered : ordered.filter((paycheck) => paycheck.paymentDate.startsWith(`${chartScope}-`));
  const earliestScoped = scoped[scoped.length - 1];
  const salaries = scoped.filter((paycheck) => paycheckTypeOf(paycheck) === "salary");
  const latestSalary = salaries[0];
  const salaryCount = salaries.length;
  const typicalSalary = calculateTypicalSalary(scoped);
  const scopedTotal = calculateIncomeTotal(scoped);
  const nonSalary = scopedTotal - calculateIncomeTotal(salaries);
  const nonSalaryShare = scopedTotal > 0 && nonSalary > 0.004 ? (nonSalary / scopedTotal) * 100 : null;
  // Months where a regular salary was not recorded, in the chart's scope.
  const missingMonths = findMissingSalaryMonths(paychecks)
    .filter((month) => allScope || month.startsWith(`${chartScope}-`));
  const monthList = new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(
    missingMonths.map((month) => {
      const name = new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(new Date(`${month}-01T12:00:00Z`));
      return allScope ? `${name} ${month.slice(0, 4)}` : name;
    }),
  );
  // Each year opens and closes; what was chosen by hand is kept on this device.
  const yearChoices = paycheckYears.use();
  const ledgerId = useId();
  const paymentCount = (count: number) => text(`${count} ${count === 1 ? "pagamento" : "pagamenti"}`, `${count} ${count === 1 ? "payment" : "payments"}`);
  const shortDate = (value: string) => formatDate(value, { timeZone: "UTC", locale });
  const singleMonth = new Set(paychecks.map((paycheck) => paycheck.paymentDate.slice(0, 7))).size === 1;
  // The last salary against the one before it, in the same scope.
  const previousSalary = salaries[1];
  const fromPrevious = latestSalary && previousSalary ? latestSalary.amount - previousSalary.amount : null;
  const trend = fromPrevious === null || Math.abs(fromPrevious) < 0.005 ? "level" : fromPrevious > 0 ? "up" : "down";
  // A picture's bar under the pointer takes over its metric's detail line.
  const [salaryHover, setSalaryHover] = useState<Hovered>(null);
  const [monthHover, setMonthHover] = useState<Hovered>(null);

  return (
    <div className="management-view cashflow-view view-enter">
      <header className="view-header view-header--facts">
        <div>
          <p className="eyebrow">{text("Entrate e uscite", "Money in and money out")}</p>
          <h1>{text("Flussi di cassa", "Cash Flow")}</h1>
        </div>
        <PageFacts
          facts={[
            { icon: Coins, text: text("Le entrate che registri: quanto è entrato e quando", "The income you record: how much came in and when") },
            { icon: Repeat, text: text("Con quale regolarità", "How regularly") },
            { icon: CircleDashed, text: text("Le uscite non sono ancora disponibili: flusso netto e tasso di risparmio non vengono calcolati", "Outflows are not available yet: net cash flow and savings rate are not calculated") },
          ]}
        />
        <Button onClick={onAdd} variant="primary"><Plus aria-hidden="true" size={16} /> {text("Aggiungi stipendio", "Add paycheck")}</Button>
      </header>

      {/* The summary reads the same scope as the chart below (owner, 26 Sep
          2026): one year, or all of them. */}
      <section className="income-summary" aria-label={text("Riepilogo entrate registrate", "Recorded income summary")}>
        <article className="income-summary__primary">
          {/* The tile sits inside the label, so the label stays the card's own child. */}
          <span className="income-summary__label income-summary__head">
            <span aria-hidden="true" className="wealth-context__icon income-summary__icon"><IncomeYearsGlyph scope={allScope ? "all" : "year"} /></span>
            {allScope ? text("Tutte le entrate", "All income") : text(`Entrate ${chartScope}`, `${chartScope} income`)}
          </span>
          <strong className="income-summary__value"><Money amount={calculateIncomeTotal(scoped)} /></strong>
          <small className="income-summary__detail">
            {scoped.length === 0
              ? text(`Nessun pagamento registrato nel ${chartScope}`, `No payment recorded in ${chartScope}`)
              : allScope
                ? text(`${paymentCount(scoped.length)} in ${years.length} anni`, `${paymentCount(scoped.length)} across ${years.length} years`)
                : chartScope === String(year)
                  ? text(`${paymentCount(scoped.length)} ${scoped.length === 1 ? "registrato" : "registrati"} quest'anno`, `${paymentCount(scoped.length)} recorded this year`)
                  : text(`${paymentCount(scoped.length)} ${scoped.length === 1 ? "registrato" : "registrati"} nel ${chartScope}`, `${paymentCount(scoped.length)} recorded in ${chartScope}`)}
          </small>
          <IncomeMix paychecks={scoped} />
          {/* What did not come from the salary, only when there is some. */}
          {nonSalaryShare !== null ? (
            <small className="income-summary__detail">
              {text("Fuori dallo stipendio", "Beyond the salary")} <Percent>{formatPercent(nonSalaryShare)}</Percent>
            </small>
          ) : null}
          {/* All-time income only earns a line when it differs from the year's. */}
          {!allScope && paychecks.length > scoped.length ? (
            <small className="income-summary__detail income-summary__detail--all-time">
              {text("Totale di tutte le entrate registrate", "Total of all recorded income")} <Money amount={calculateIncomeTotal(paychecks)} />
            </small>
          ) : null}
        </article>
        <div className="income-summary__secondary">
          <SummaryMetric
            detail={latestSalary ? shortDate(latestSalary.paymentDate) : text("Nessuno stipendio", "No salary")}
            icon={<SalaryTrendGlyph trend={trend} />}
            label={text("Ultimo stipendio", "Last salary")}
            value={latestSalary ? <Money amount={latestSalary.amount} /> : "—"}
          >
            {fromPrevious !== null ? (
              <span className={cx("income-summary__change", fromPrevious > 0.004 ? "is-up" : fromPrevious < -0.004 ? "is-down" : undefined)}>
                {Math.abs(fromPrevious) < 0.005
                  ? text("Uguale al precedente", "Same as the one before")
                  : <><span className="income-summary__change-figure">{fromPrevious > 0 ? "+" : "−"}<Money amount={Math.abs(fromPrevious)} /></span> {text("sul precedente", "on the one before")}</>}
              </span>
            ) : null}
          </SummaryMetric>
          <SummaryMetric
            detail={typicalSalary !== null
              ? text(`Mediana di ${salaryCount} ${salaryCount === 1 ? "stipendio" : "stipendi"}`, `Median of ${salaryCount} ${salaryCount === 1 ? "salary" : "salaries"}`)
              : text("Nessuno stipendio", "No salary")}
            hovered={salaryHover}
            icon={<ChartSpline size={20} strokeWidth={2} />}
            label={text("Stipendio tipico", "Typical salary")}
            value={typicalSalary !== null ? <Money amount={typicalSalary} /> : "—"}
          >
            <SalaryLine onHover={setSalaryHover} salaries={salaries} />
          </SummaryMetric>
          <SummaryMetric
            detail={earliestScoped ? text(`Dal ${shortDate(earliestScoped.paymentDate)}`, `Since ${shortDate(earliestScoped.paymentDate)}`) : text("Nessun pagamento", "No payments")}
            hovered={monthHover}
            icon={<ReceiptEuro size={20} strokeWidth={2} />}
            label={text("Pagamenti registrati", "Recorded payments")}
            value={<span className="income-summary__count">{scoped.length}</span>}
          >
            {allScope
              ? <YearRing onHover={setMonthHover} years={years} />
              : <MonthRing missingMonths={missingMonths} onHover={setMonthHover} paychecks={scoped} year={chartScope} />}
          </SummaryMetric>
        </div>
      </section>

      <section className="income-chart-panel" aria-labelledby="income-chart-title">
        <div className="income-chart-panel__heading">
          <div>
            <p className="eyebrow">{text("Andamento delle entrate", "Income over time")}</p>
            <h2 id="income-chart-title">{text("Entrate nel tempo", "Income by month")}</h2>
          </div>
          {paychecks.length > 0 ? (
            <div className="income-chart-panel__side">
              <p className="income-chart-panel__note">
                {singleMonth
                  ? text("Un solo mese registrato finora: l'andamento si costruisce con i prossimi stipendi.", "Only one month recorded so far: the trend builds with the next paychecks.")
                  : chartScope === allIncomeYears
                    ? text("Ogni mese somma le entrate di quel mese in tutti gli anni registrati.", "Each month adds up that month's income across every recorded year.")
                    : text("Totale per mese di pagamento. I mesi senza pagamenti restano vuoti.", "Total per payment month. Months without payments stay empty.")}
              </p>
              {/* One year, or every year summed month by month (owner, 26 Sep 2026). */}
              <span className="range-select">
                <select
                  aria-label={text("Anno delle entrate", "Income year")}
                  className="range-select__control"
                  onChange={(event) => setScope(event.target.value)}
                  value={chartScope}
                >
                  {years.map((group) => <option key={group.key} value={group.key}>{group.key}</option>)}
                  {years.length > 1 ? <option value={allIncomeYears}>{text("Tutti gli anni", "All years")}</option> : null}
                </select>
                <ChevronDown aria-hidden="true" className="range-select__chevron" size={15} strokeWidth={2.25} />
              </span>
            </div>
          ) : null}
        </div>
        <IncomeChart paychecks={paychecks} scope={chartScope} />
        {/* A regular salary with a month missing (owner, 26 Sep 2026). IRIS
            only knows what was recorded, so it names both readings. */}
        {missingMonths.length > 0 ? (
          <p className="income-missing">
            <CircleAlert aria-hidden="true" className="income-missing__icon" size={16} strokeWidth={2.25} />
            <span>
              <strong>{text(`Nessuno stipendio registrato per ${monthList}.`, `No salary recorded for ${monthList}.`)}</strong>{" "}
              {text("Se è arrivato, aggiungilo; se non è arrivato, è un mese da controllare.", "If it came in, add it; if it did not, that month is worth a look.")}
            </span>
          </p>
        ) : null}
      </section>


      <section className="paycheck-history" aria-labelledby="paycheck-history-title">
        <div className="paycheck-history__heading">
          <h2 id="paycheck-history-title">{text("Stipendi registrati", "Recorded paychecks")}</h2>
          <span className="paycheck-history__count">{text(`${paychecks.length} record`, `${paychecks.length} ${paychecks.length === 1 ? "record" : "records"}`)}</span>
          {paychecks.length > 1 ? <span className="paycheck-history__order">{text("Dal più recente", "Most recent first")}</span> : null}
        </div>
        {ordered.length === 0 ? (
          <p className="paycheck-history__empty">{text("Nessuno stipendio ancora registrato. Aggiungine uno per iniziare lo storico delle entrate.", "No paychecks recorded yet. Add one to begin the income history.")}</p>
        ) : (
          <div className="paycheck-ledger">
            {years.map((group, index) => {
              // A year nobody opened or closed by hand: the most recent is open.
              const open = yearChoices[group.key] ?? index === 0;
              const previous = years[index + 1];
              const change = yearOverYear(group, previous, years[years.length - 1], year);
              const bodyId = `${ledgerId}-${group.key}`;
              return (
                <section aria-label={group.key} className={cx("paycheck-year", open && "is-open")} key={group.key}>
                  <h3 className="paycheck-year__title">
                    <button
                      aria-controls={bodyId}
                      aria-expanded={open}
                      className="paycheck-year__heading"
                      onClick={() => paycheckYears.set({ ...yearChoices, [group.key]: !open })}
                      type="button"
                    >
                      <ChevronRight aria-hidden="true" className="paycheck-year__chevron" size={16} strokeWidth={2.25} />
                      <span className="paycheck-year__name">{group.key}</span>
                      {/* How it compares, then the year's total at the far right
                          (owner, 26 Sep 2026: no payment count, no summary line). */}
                      <span className="paycheck-year__total">
                        {change !== null ? (
                          <span className={cx("paycheck-year__change", change > 0 ? "is-up" : change < 0 ? "is-down" : undefined)}>
                            <span className="paycheck-year__change-value"><Percent>{`${change > 0 ? "+" : ""}${formatPercent(change)}`}</Percent></span>
                            {" "}{text(`sul ${previous?.key}`, `on ${previous?.key}`)}
                          </span>
                        ) : null}
                        <Money amount={calculateIncomeTotal(group.paychecks)} />
                      </span>
                    </button>
                  </h3>
                  {/* Closed, the rows stay mounted (the height can ease) but inert:
                      out of the tab order and the accessibility tree. */}
                  <div className="paycheck-year__body" id={bodyId} inert={!open}>
                    <div className="paycheck-year__rows">
                      {group.paychecks.map((paycheck) => (
                        <button className="paycheck-row" id={paycheckRowFocusId(paycheck.id)} key={paycheck.id} onClick={() => onEdit(paycheck)} type="button">
                          <span className="paycheck-date">
                            <strong>{new Intl.DateTimeFormat(locale, { day: "2-digit", timeZone: "UTC" }).format(new Date(paycheck.paymentDate))}</strong>
                            <small>{new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" }).format(new Date(paycheck.paymentDate))}</small>
                          </span>
                          <span className="paycheck-row__identity">
                            <strong>{paycheck.label || text("Stipendio", "Paycheck")}</strong>
                            <small>{paycheck.competencePeriod || shortDate(paycheck.paymentDate)}</small>
                          </span>
                          <Money amount={paycheck.amount} />
                          <span aria-hidden="true" className="paycheck-row__more"><MoreHorizontal size={17} /></span>
                        </button>
                      ))}
                    </div>
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function SummaryMetric({
  icon,
  label,
  value,
  detail,
  hovered = null,
  children,
}: {
  /** The metric's glyph, in the overview's icon tile. */
  icon: ReactNode;
  label: string;
  value: ReactNode;
  detail: string;
  /** What a picture's bar under the pointer says, in place of the detail. */
  hovered?: ReactNode;
  /** The metric's picture, under its figures. */
  children?: ReactNode;
}) {
  return (
    <article className="income-summary__metric">
      <span aria-hidden="true" className="wealth-context__icon income-summary__icon">{icon}</span>
      <span className="income-summary__label">{label}</span>
      <strong className="income-summary__value">{value}</strong>
      <small className={cx("income-summary__detail", hovered !== null && "is-hovered")}>{hovered ?? detail}</small>
      {children ? <div className="income-summary__visual">{children}</div> : null}
    </article>
  );
}
