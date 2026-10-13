import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";

import { calculateAccountShare, calculateCategoryPercentages, calculateCategoryTotals } from "@/domain/calculations";
import type { Account } from "@/domain/types";
import { useLanguage } from "@/features/i18n/language";

import { AccountName } from "./privacy";

import { AccountMark, accountDialogFocusId, Button, Money, formatDate, formatPercent } from "./ui";

export function TradingView({
  accounts,
  back,
  totalWealth,
  onOpenAccount,
  onShowAccounts,
}: {
  accounts: Account[];
  /** The way back to the parent view, placed before the title. */
  back?: ReactNode;
  totalWealth: number;
  onOpenAccount: (account: Account) => void;
  onShowAccounts: () => void;
}) {
  const { locale, text } = useLanguage();
  const tradingAccounts = accounts.filter((account) => account.category === "trading");
  const categoryTotals = calculateCategoryTotals(accounts);
  const tradingCapital = categoryTotals.trading;
  const allocation = calculateCategoryPercentages(categoryTotals, totalWealth).trading;

  return (
    <div className="management-view domain-view view-enter">
      <header className="view-header">
        <div>
          {back}
          <p className="eyebrow">{text("Capitale e performance", "Capital and performance")}</p>
          <h1>Trading</h1>
          <p>{text("Il capitale di trading è monitorato. Profitti e perdite restano non disponibili finché depositi, prelievi e operazioni non sono distinguibili.", "Trading capital is tracked. Profit and loss remain unavailable until deposits, withdrawals and trades are distinguishable.")}</p>
        </div>
        <Button onClick={onShowAccounts}>{text("Gestisci conti", "Manage accounts")}</Button>
      </header>

      <section className="system-metric-row" aria-label={text("Riepilogo trading", "Trading summary")}>
        <SummaryMetric label={text("Capitale di trading", "Trading capital")} value={<Money amount={tradingCapital} />} detail={text("Conti trading inclusi", "Included trading accounts")} />
        <SummaryMetric label={text("Allocazione patrimoniale", "Wealth allocation")} value={formatPercent(allocation)} detail={text("Quota del Patrimonio totale", "Share of Total Wealth")} />
        <SummaryMetric label={text("P&L netto", "Net P&L")} value="—" detail={text("Flussi di capitale non disponibili", "Capital flows unavailable")} />
        <SummaryMetric label={text("Rendimento", "Return")} value="—" detail={text("Non ancora calcolabile", "Not yet calculable")} />
      </section>

      <div className="domain-layout">
        <section className="domain-ledger" aria-labelledby="trading-accounts-title">
          <div className="domain-section-heading">
            <div><p className="eyebrow">{text("Dove si trova il capitale", "Capital locations")}</p><h2 id="trading-accounts-title">{text("Conti trading", "Trading accounts")}</h2></div>
            <span>{text(`${tradingAccounts.length} attivi`, `${tradingAccounts.length} active`)}</span>
          </div>
          {tradingAccounts.length === 0 ? (
            <p className="inline-empty">{text("Nessun conto trading. Assegna un conto alla categoria Trading per mostrarlo qui.", "No trading accounts yet. Categorize an account as Trading to show it here.")}</p>
          ) : tradingAccounts.map((account) => (
            <button className="domain-row" id={accountDialogFocusId(account.id)} key={account.id} onClick={() => onOpenAccount(account)} type="button">
              <AccountMark account={account} />
              <span className="domain-row__identity"><strong><AccountName name={account.name} /></strong><small>{text("Conto trading · Aggiornato", "Trading account · Updated")} {formatDate(account.lastUpdated, { locale })}</small></span>
              <span className="domain-row__metric"><Money amount={account.balance} /><small>{account.includedInWealth ? formatPercent(calculateAccountShare(account, totalWealth)) : text("Escluso", "Excluded")}</small></span>
              <ChevronRight aria-hidden="true" size={17} />
            </button>
          ))}
        </section>

        <aside className="data-gap" aria-labelledby="trading-performance-title">
          <p className="eyebrow">Performance</p>
          <h2 id="trading-performance-title">{text("Performance non ancora calcolabile", "Performance not yet calculable")}</h2>
          <p>{text("Una variazione del saldo può essere un deposito, un prelievo, una rettifica manuale o un risultato di trading. Trattarla come P&L sarebbe finanziariamente scorretto.", "A change in account balance may be a deposit, withdrawal, manual adjustment or trading result. Treating it as P&L would be financially incorrect.")}</p>
          <span className="data-gap__status">{text("È necessario un modello per operazioni e flussi di capitale", "Trade and capital-flow model required")}</span>
        </aside>
      </div>
    </div>
  );
}

function SummaryMetric({ label, value, detail }: { label: string; value: React.ReactNode; detail: string }) {
  return <article><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}
