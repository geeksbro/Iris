import type { CSSProperties } from "react";

import { Banknote, ChevronRight, CircleDashed, Plus } from "lucide-react";

import { calculateAccessAggregation, calculateAccountShare, type AccessBucket } from "@/domain/calculations";
import type { Account, AccountAccess } from "@/domain/types";
import { useLanguage } from "@/features/i18n/language";

import { AccountName, Percent, usePrivacy } from "./privacy";

import { AccountMark, accountDialogFocusId, Button, CategoryMark, Money, Panel, cx, formatDate, formatPercent } from "./ui";

const accessOrder: AccessBucket[] = ["immediate", "days", "locked", "unclassified"];
const classifiedAccess: AccountAccess[] = ["immediate", "days", "locked"];

export function AccountsView({ accounts, totalWealth, onAdd, onOpen, onToggleIncluded, onOpenCash }: {
  accounts: Account[];
  totalWealth: number;
  onAdd: () => void;
  onOpen: (account: Account) => void;
  onToggleIncluded: (account: Account, included: boolean) => Promise<void>;
  onOpenCash: () => void;
}) {
  const { accessLabel, locale, text, volatilityLabel } = useLanguage();
  const { accountNamesHidden } = usePrivacy();
  const activeAccounts = accounts.filter((account) => !account.archivedAt);
  const accessAggregation = calculateAccessAggregation(activeAccounts);
  const populatedAccessGroups = accessOrder.filter((access) => activeAccounts.some((account) => (account.access ?? "unclassified") === access));
  const unclassifiedCount = activeAccounts.filter((account) => !account.access).length;
  const accountCount = (count: number) => text(`${count} ${count === 1 ? "conto" : "conti"}`, `${count} ${count === 1 ? "account" : "accounts"}`);
  const shareOfWealth = (percentage: number) => <><Percent>{formatPercent(percentage, 2, locale)}</Percent> {text("del patrimonio", "of total wealth")}</>;
  const bucketTitle = (access: AccessBucket) => access === "unclassified" ? text("Da classificare", "Not yet classified") : accessLabel(access);
  // The bar only draws what is really there: a bucket at 0% has no segment.
  const barSegments = accessOrder.filter((access) => accessAggregation[access].percentage > 0);

  return (
    <div className="management-view accounts-view view-enter" data-tour="accounts">
      <header className="view-header">
        <div>
          <p className="eyebrow">{text("Gestione patrimoniale", "Wealth management")}</p>
          <h1>{text("Conti", "Accounts")}</h1>
          <p>{text("Dove si trova il tuo patrimonio e in quanto tempo puoi usarlo. I tempi di accesso li decidi tu: nessuna classificazione è automatica.", "Where your wealth sits and how quickly you can reach it. You set the access timing: nothing is classified automatically.")}</p>
        </div>
        <div className="view-header__actions" data-tour="accounts-actions">
          <Button onClick={onOpenCash}><Banknote aria-hidden="true" size={16} /> {text("Conta contanti", "Cash Counter")}</Button>
          <Button onClick={onAdd} variant="primary"><Plus aria-hidden="true" size={16} /> {text("Aggiungi conto", "Add account")}</Button>
        </div>
      </header>

      <section aria-labelledby="access-summary-title" className={cx("access-profile", unclassifiedCount > 0 && "access-profile--with-pending")}>
        <div className="access-profile__heading">
          <div>
            <p className="eyebrow">{text("Profilo di accesso", "Access profile")}</p>
            <h2 id="access-summary-title">{text("Accesso al patrimonio", "Wealth access")}</h2>
          </div>
          <div className="access-profile__reference">
            <span className="access-profile__total" data-testid="access-summary-total"><small>{text("Patrimonio totale", "Total Wealth")}</small><Money amount={totalWealth} /></span>
            <span className="access-profile__count">{text(`${activeAccounts.length} conti attivi`, `${activeAccounts.length} active accounts`)}</span>
          </div>
        </div>

        <div aria-hidden="true" className="access-bar">
          {barSegments.map((access) => (
            <span
              className={`access-bar__segment access-bar__segment--${access}`}
              key={access}
              style={{ flexGrow: accessAggregation[access].percentage } as CSSProperties}
            />
          ))}
        </div>

        <div className="access-profile__body">
          <div className="access-profile__buckets">
            {classifiedAccess.map((access) => {
              const metric = accessAggregation[access];
              return (
                <article className={cx("access-bucket", metric.amount === 0 && "access-bucket--empty")} data-testid={`access-summary-${access}`} key={access}>
                  <span className="access-bucket__label"><span aria-hidden="true" className={`access-swatch access-swatch--${access}`} />{accessLabel(access)}</span>
                  <Money amount={metric.amount} />
                  <small>{shareOfWealth(metric.percentage)}</small>
                </article>
              );
            })}
          </div>

          {unclassifiedCount > 0 ? (
            <article className="access-pending" data-testid="access-summary-unclassified">
              <span className="access-pending__label"><CircleDashed aria-hidden="true" size={15} />{text("Da classificare", "Not yet classified")}</span>
              <strong className="access-pending__count">{accountCount(unclassifiedCount)}</strong>
              <div className="access-pending__figures">
                <Money amount={accessAggregation.unclassified.amount} />
                <small>{shareOfWealth(accessAggregation.unclassified.percentage)}</small>
              </div>
              <p className="access-pending__note">
                {text(
                  "Non hanno ancora un tempo di accesso. Puoi assegnarlo dal dettaglio di ciascun conto, quando vuoi.",
                  "No access timing assigned yet. You can set it from each account's details whenever you are ready.",
                )}
              </p>
            </article>
          ) : null}
        </div>
      </section>

      {activeAccounts.length === 0 ? (
        <Panel className="inline-empty">{text("Nessun conto attivo. Aggiungine uno per iniziare a monitorare il patrimonio.", "No active accounts. Add one to begin tracking wealth.")}</Panel>
      ) : (
        <section aria-labelledby="account-ledger-title" className="account-ledger-section">
          <div className="account-ledger-section__heading">
            <h2 id="account-ledger-title">{text("Conti per tempo di accesso", "Accounts by access timing")}</h2>
            <span>{text("Ordinati per saldo in ogni gruppo", "Sorted by balance within each group")}</span>
          </div>

          <div className="account-ledger">
            <div className="account-ledger__head" aria-hidden="true">
              <span>{text("Conto", "Account")}</span>
              <span className="account-ledger__head-category">{text("Categoria", "Category")}</span>
              <span className="account-ledger__head-volatility">{text("Volatilità", "Volatility")}</span>
              <span className="account-ledger__head-value">{text("Saldo e quota", "Balance and share")}</span>
              <span className="account-ledger__head-included">{text("Nel patrimonio", "In total wealth")}</span>
              <span />
            </div>

            {populatedAccessGroups.map((access) => {
              const groupAccounts = activeAccounts
                .filter((account) => (account.access ?? "unclassified") === access)
                .sort((left, right) => {
                  const balanceDifference = right.balance - left.balance;
                  return balanceDifference || left.name.localeCompare(right.name, locale);
                });
              const groupMetric = accessAggregation[access];
              return (
                <section aria-labelledby={`account-group-${access}`} className={cx("account-group", `account-group--${access}`)} data-testid={`access-group-${access}`} key={access}>
                  <div className="account-group__heading">
                    <div className="account-group__title">
                      <span aria-hidden="true" className={`access-swatch access-swatch--${access}`} />
                      <h3 id={`account-group-${access}`}>{bucketTitle(access)}</h3>
                      <span className="account-group__count">{accountCount(groupAccounts.length)}</span>
                    </div>
                    <div className="account-group__total"><Money amount={groupMetric.amount} /><small>{shareOfWealth(groupMetric.percentage)}</small></div>
                  </div>

                  {groupAccounts.map((account) => (
                    <article className={cx("ledger-row", "account-row", !account.includedInWealth && "is-excluded")} data-testid={`account-${account.id}`} key={account.id}>
                      <button className="account-row__open" onClick={() => onOpen(account)} type="button">
                        <AccountMark account={account} />
                        <span className="account-row__identity">
                          <strong title={accountNamesHidden ? undefined : account.name}><AccountName name={account.name} /></strong>
                          <small>{text("Aggiornato", "Updated")} {formatDate(account.lastUpdated, { locale })}</small>
                        </span>
                      </button>
                      <div className="account-row__class">
                        <div className="account-row__category"><CategoryMark category={account.category} /></div>
                        <div className="account-row__volatility">
                          {account.volatility ? (
                            <span className={`profile-badge profile-badge--${account.volatility}`}>{volatilityLabel(account.volatility)}</span>
                          ) : (
                            <span className="profile-badge profile-badge--unclassified">{volatilityLabel()}</span>
                          )}
                        </div>
                      </div>
                      <div className="account-row__value">
                        <Money amount={account.balance} />
                        <span className="account-row__share">{account.includedInWealth ? <Percent>{formatPercent(calculateAccountShare(account, totalWealth), 2, locale)}</Percent> : text("Escluso", "Excluded")}</span>
                      </div>
                      <label className="inclusion-switch">
                        <input aria-label={text(`Includi ${account.name} nel Patrimonio totale`, `Include ${account.name} in Total Wealth`)} checked={account.includedInWealth} onChange={(event) => void onToggleIncluded(account, event.target.checked)} type="checkbox" />
                        <span aria-hidden="true" className="inclusion-switch__track" />
                        <span aria-hidden="true" className="inclusion-switch__text">{text("Nel patrimonio", "In total wealth")}</span>
                      </label>
                      <button aria-label={text(`Apri dettagli ${account.name}`, `Open ${account.name} details`)} className="icon-button account-row__detail" id={accountDialogFocusId(account.id)} onClick={() => onOpen(account)} type="button"><ChevronRight aria-hidden="true" size={17} /></button>
                    </article>
                  ))}
                </section>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
