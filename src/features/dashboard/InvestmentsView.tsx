import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";

import { calculateAccountShare, calculateCategoryPercentages, calculateCategoryTotals } from "@/domain/calculations";
import type { Account } from "@/domain/types";
import { useLanguage } from "@/features/i18n/language";

import { AccountName, Percent } from "./privacy";

import { AccountMark, accountDialogFocusId, Button, Money, formatDate, formatPercent } from "./ui";

export function InvestmentsView({
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
  const investmentAccounts = accounts.filter((account) => account.category === "investments");
  const categoryTotals = calculateCategoryTotals(accounts);
  const portfolioValue = categoryTotals.investments;
  const portfolioShare = calculateCategoryPercentages(categoryTotals, totalWealth).investments;

  return (
    <div className="management-view domain-view view-enter">
      <header className="view-header">
        <div>
          {back}
          <p className="eyebrow">{text("Livello investimenti", "Investment layer")}</p>
          <h1>{text("Investimenti", "Investments")}</h1>
          <p>{text("Qui sono visibili i conti d'investimento. Posizioni e performance sono concetti separati e non vengono dedotti dai saldi.", "Investment accounts are visible here. Holdings and performance are separate concepts and are not inferred from balances.")}</p>
        </div>
        <Button onClick={onShowAccounts}>{text("Gestisci conti", "Manage accounts")}</Button>
      </header>

      <section className="system-metric-row" aria-label={text("Riepilogo investimenti", "Investment summary")}>
        <SummaryMetric label={text("Valore portafoglio", "Portfolio value")} value={<Money amount={portfolioValue} />} detail={text("Conti d'investimento inclusi", "Included investment accounts")} />
        <SummaryMetric label={text("Conti", "Accounts")} value={investmentAccounts.length.toString().padStart(2, "0")} detail={text("Depositi e intermediari", "Custody locations")} />
        <SummaryMetric label={text("Allocazione patrimoniale", "Wealth allocation")} value={<Percent>{formatPercent(portfolioShare)}</Percent>} detail={text("Quota del Patrimonio totale", "Share of Total Wealth")} />
        <SummaryMetric label={text("Rendimento", "Return")} value="—" detail={text("Contributi non disponibili", "Contributions unavailable")} />
      </section>

      <div className="domain-layout">
        <section className="domain-ledger" aria-labelledby="investment-accounts-title">
          <div className="domain-section-heading">
            <div><p className="eyebrow">{text("Dove sono detenuti gli investimenti", "Where investments are held")}</p><h2 id="investment-accounts-title">{text("Conti d'investimento", "Investment accounts")}</h2></div>
            <span>{text(`${investmentAccounts.length} attivi`, `${investmentAccounts.length} active`)}</span>
          </div>
          {investmentAccounts.length === 0 ? (
            <p className="inline-empty">{text("Nessun conto d'investimento. Assegna un conto alla categoria Investimenti per mostrarlo qui.", "No investment accounts yet. Categorize an account as Investments to show it here.")}</p>
          ) : investmentAccounts.map((account) => (
            <button className="domain-row" id={accountDialogFocusId(account.id)} key={account.id} onClick={() => onOpenAccount(account)} type="button">
              <AccountMark account={account} />
              <span className="domain-row__identity"><strong><AccountName name={account.name} /></strong><small>{text("Conto d'investimento · Aggiornato", "Investment account · Updated")} {formatDate(account.lastUpdated, { locale })}</small></span>
              <span className="domain-row__metric"><Money amount={account.balance} /><small>{account.includedInWealth ? <Percent>{formatPercent(calculateAccountShare(account, totalWealth))}</Percent> : text("Escluso", "Excluded")}</small></span>
              <ChevronRight aria-hidden="true" size={17} />
            </button>
          ))}
        </section>

        <aside className="data-gap" aria-labelledby="holdings-title">
          <p className="eyebrow">{text("Posizioni", "Holdings")}</p>
          <h2 id="holdings-title">{text("Nessuna posizione ancora registrata", "No holdings recorded yet")}</h2>
          <p>{text("I saldi dei conti non rivelano ETF, azioni, obbligazioni, cripto-attività, quantità o prezzo di carico. La performance non viene quindi calcolata.", "Account balances do not reveal ETFs, stocks, bonds, crypto assets, quantities or cost basis. Performance is therefore not calculated.")}</p>
          <span className="data-gap__status">{text("Modello posizioni non disponibile", "Holdings model not available")}</span>
        </aside>
      </div>
    </div>
  );
}

function SummaryMetric({ label, value, detail }: { label: string; value: React.ReactNode; detail: string }) {
  return <article><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}
