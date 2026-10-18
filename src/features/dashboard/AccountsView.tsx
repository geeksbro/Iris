import { useState, type ComponentType } from "react";

import { Banknote, ChevronRight, CircleDashed, Hourglass, LockKeyhole, MapPin, Plus, SlidersHorizontal, Timer, Zap } from "lucide-react";

import { calculateAccessAggregation, calculateAccountShare, type AccessBucket } from "@/domain/calculations";
import type { Account, AccountAccess, WealthSnapshot } from "@/domain/types";
import { useLanguage } from "@/features/i18n/language";
import { accountGroups } from "@/features/settings/preferences";

import { AccessRing } from "./AccessRing";
import { ShareRing, TrendLine, VolatilityGlyph } from "./LedgerGlyphs";
import { PageFacts } from "./PageFacts";
import { AccountName, Percent, usePrivacy } from "./privacy";

import { AccountMark, accountDialogFocusId, Button, CategoryMark, Money, Panel, cx, formatDate, formatPercent } from "./ui";

const accessOrder: AccessBucket[] = ["immediate", "days", "locked", "unclassified"];
const classifiedAccess: AccountAccess[] = ["immediate", "days", "locked"];
/** Each access timing's glyph, in the overview's icon tile. */
const accessIcon: Record<AccessBucket, ComponentType<{ size?: number; strokeWidth?: number }>> = {
  immediate: Zap,
  days: Hourglass,
  locked: LockKeyhole,
  unclassified: CircleDashed,
};

export function AccountsView({ accounts, snapshots = [], totalWealth, onAdd, onOpen, onToggleIncluded, onOpenCash }: {
  accounts: Account[];
  /** Oldest first: each account's course in the ledger is read from these. */
  snapshots?: WealthSnapshot[];
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
  // The ring and the rows light each other up: the bucket under the pointer.
  const [activeAccess, setActiveAccess] = useState<AccessBucket | null>(null);
  // Each group opens and closes; what was chosen by hand is kept on this device.
  const groupChoices = accountGroups.use();
  // Each account's balance at every saved update, oldest first.
  const balancesOf = (accountId: string) => snapshots
    .map((snapshot) => snapshot.accountBalances.find((balance) => balance.accountId === accountId)?.balance)
    .filter((balance): balance is number => balance !== undefined);
  // A group's total at every update, of the accounts in it today, counted as each update counted them.
  const groupBalances = (ids: string[]) => snapshots
    .map((snapshot) => snapshot.accountBalances.filter((balance) => ids.includes(balance.accountId)))
    .filter((balances) => balances.length > 0)
    .map((balances) => balances.reduce((sum, balance) => sum + (balance.includedInWealth ? balance.balance : 0), 0));
  const trendCell = (values: number[], access: AccessBucket) => {
    const change = values.length > 1 ? values[values.length - 1] - values[values.length - 2] : null;
    return (
      <span className="account-row__trend">
        <TrendLine access={access} values={values} />
        {change === null ? (
          <small className="account-row__change">{text("Un solo aggiornamento", "One update so far")}</small>
        ) : (
          <small className={cx("account-row__change", change > 0.004 && "is-up", change < -0.004 && "is-down")}>
            {Math.abs(change) < 0.005
              ? text("Invariato", "Unchanged")
              : <>{change > 0 ? "+" : "−"}<Money amount={Math.abs(change)} /></>}
          </small>
        )}
      </span>
    );
  };
  const accountsIn = (access: AccessBucket) => activeAccounts.filter((account) => (account.access ?? "unclassified") === access).length;

  return (
    <div className="management-view accounts-view view-enter" data-tour="accounts">
      <header className="view-header view-header--facts">
        <div>
          <p className="eyebrow">{text("Gestione patrimoniale", "Wealth management")}</p>
          <h1>{text("Conti", "Accounts")}</h1>
        </div>
        <PageFacts
          facts={[
            { icon: MapPin, text: text("Dove si trova il tuo patrimonio", "Where your wealth sits") },
            { icon: Timer, text: text("In quanto tempo puoi usarlo", "How quickly you can reach it") },
            { icon: SlidersHorizontal, text: text("I tempi di accesso li decidi tu: nessuna classificazione è automatica", "You set the access timing: nothing is classified automatically") },
          ]}
        />
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

        <div className="access-profile__body">
          <AccessRing
            active={activeAccess}
            onActive={setActiveAccess}
            shares={accessOrder.map((access) => ({ access, percentage: accessAggregation[access].percentage }))}
          />
          <div className="access-profile__buckets" onPointerLeave={() => setActiveAccess(null)}>
            {classifiedAccess.map((access) => {
              const metric = accessAggregation[access];
              const Icon = accessIcon[access];
              return (
                <article
                  className={cx("access-bucket", metric.amount === 0 && "access-bucket--empty", activeAccess === access && "is-active")}
                  data-testid={`access-summary-${access}`}
                  key={access}
                  onPointerEnter={() => setActiveAccess(access)}
                >
                  <span aria-hidden="true" className="wealth-context__icon access-bucket__icon"><Icon size={20} strokeWidth={2} /></span>
                  <span className="access-bucket__label"><span aria-hidden="true" className={`access-swatch access-swatch--${access}`} />{accessLabel(access)}</span>
                  <small className="access-bucket__count">{accountCount(accountsIn(access))}</small>
                  <Money amount={metric.amount} />
                  <small className="access-bucket__share">{shareOfWealth(metric.percentage)}</small>
                </article>
              );
            })}
          </div>

          {unclassifiedCount > 0 ? (
            <article
              className={cx("access-pending", activeAccess === "unclassified" && "is-active")}
              data-testid="access-summary-unclassified"
              onPointerEnter={() => setActiveAccess("unclassified")}
              onPointerLeave={() => setActiveAccess(null)}
            >
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
              <span className="account-ledger__head-category">{text("Categoria e volatilità", "Category and volatility")}</span>
              <span className="account-ledger__head-trend">{text("Andamento", "Course")}</span>
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
              const GroupIcon = accessIcon[access];
              // A group nobody closed by hand is open.
              const open = groupChoices[access] ?? true;
              const bodyId = `account-group-body-${access}`;
              return (
                <section aria-labelledby={`account-group-${access}`} className={cx("account-group", `account-group--${access}`, open && "is-open")} data-testid={`access-group-${access}`} key={access}>
                  {/* The whole heading opens and closes the group (owner, 17 Oct
                      2026, like the Cash Flow years); closed, its course and total
                      still say what is inside. The ring above answers only to its
                      own card (owner, same day): nothing here lights it. */}
                  {/* Named by the group alone: the figures inside are read where they stand. */}
                  <h3 aria-labelledby={`account-group-${access}`} className="account-group__heading-wrap">
                    <button
                      aria-controls={bodyId}
                      aria-labelledby={`account-group-${access} account-group-count-${access}`}
                      aria-expanded={open}
                      className="account-group__heading"
                      onClick={() => accountGroups.set({ ...groupChoices, [access]: !open })}
                      type="button"
                    >
                      <span className="account-group__title">
                        <span aria-hidden="true" className="wealth-context__icon account-group__icon"><GroupIcon size={18} strokeWidth={2} /></span>
                        <span className="account-group__name" id={`account-group-${access}`}>{bucketTitle(access)}</span>
                        <span className="account-group__count" id={`account-group-count-${access}`}>{accountCount(groupAccounts.length)}</span>
                      </span>
                      {trendCell(groupBalances(groupAccounts.map((account) => account.id)), access)}
                      <span className="account-group__total">
                        <span className="account-group__figures"><Money amount={groupMetric.amount} /><small>{shareOfWealth(groupMetric.percentage)}</small></span>
                      </span>
                      <ChevronRight aria-hidden="true" className="account-group__chevron" size={17} strokeWidth={2.25} />
                    </button>
                  </h3>

                  {/* Closed, the rows stay mounted (the height can ease) but inert. */}
                  <div className="account-group__body" id={bodyId} inert={!open}>
                    <div className="account-group__rows">
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
                            <span className={`profile-badge profile-badge--${account.volatility}`}><VolatilityGlyph volatility={account.volatility} />{volatilityLabel(account.volatility)}</span>
                          ) : (
                            <span className="profile-badge profile-badge--unclassified"><VolatilityGlyph />{volatilityLabel()}</span>
                          )}
                        </div>
                      </div>
                      {trendCell(balancesOf(account.id), access)}
                      <div className="account-row__value">
                        <Money amount={account.balance} />
                        <span className="account-row__share">
                          <ShareRing access={access} excluded={!account.includedInWealth} percentage={account.includedInWealth ? calculateAccountShare(account, totalWealth) : 0} />
                          {account.includedInWealth ? <Percent>{formatPercent(calculateAccountShare(account, totalWealth), 2, locale)}</Percent> : text("Escluso", "Excluded")}
                        </span>
                      </div>
                      <label className="inclusion-switch">
                        <input aria-label={text(`Includi ${account.name} nel Patrimonio totale`, `Include ${account.name} in Total Wealth`)} checked={account.includedInWealth} onChange={(event) => void onToggleIncluded(account, event.target.checked)} type="checkbox" />
                        <span aria-hidden="true" className="inclusion-switch__track" />
                        <span aria-hidden="true" className="inclusion-switch__text">{text("Nel patrimonio", "In total wealth")}</span>
                      </label>
                      <button aria-label={text(`Apri dettagli ${account.name}`, `Open ${account.name} details`)} className="icon-button account-row__detail" id={accountDialogFocusId(account.id)} onClick={() => onOpen(account)} type="button"><ChevronRight aria-hidden="true" size={17} /></button>
                    </article>
                  ))}
                    </div>
                  </div>
                </section>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
