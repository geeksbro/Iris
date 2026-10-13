"use client";

import { useId, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import * as Dialog from "@radix-ui/react-dialog";
import { Check, Landmark, Trash2 } from "lucide-react";

import { calculateAccountShare, calculateCashTotal, calculateSnapshotDelta, calculateTotalWealth, paycheckTypeOf } from "@/domain/calculations";
import { isValidPinFormat } from "@/domain/pin";
import { formatCurrency } from "@/domain/formatters";
import { accountCategories, paycheckTypes, type Account, type AccountCategory, type CashDenomination, type Paycheck, type PaycheckType, type WealthGoalType, type WealthSnapshot } from "@/domain/types";
import type { AccountDraft, BalanceUpdate } from "@/data/repository";
import { useLanguage } from "@/features/i18n/language";

import { AccountHistoryChart } from "./Charts";
import { DateField, isDatePickerOpen } from "./DateField";
import { NumberInput } from "./NumberInput";
import { AccountName, Percent, Sensitive } from "./privacy";
import {
  accountDialogFocusId,
  Button,
  paycheckTypeLabel,
  CategoryMark,
  globalDialogFocusFallbackId,
  Money,
  categoryLabels,
  formatDate,
  formatLocalCalendarDate,
  formatPercent,
  PendingLabel,
  WindowCloseControl,
} from "./ui";

function focusAfterDialog(
  captured: HTMLElement | null,
  fallbackFocusId?: string,
  preferFallback = false,
) {
  const fallback = fallbackFocusId ? document.getElementById(fallbackFocusId) : null;
  const capturedIsUsable = captured?.isConnected && captured !== document.body;
  const target = preferFallback
    ? fallback ?? document.getElementById(globalDialogFocusFallbackId)
    : capturedIsUsable
      ? captured
      : fallback ?? document.getElementById(globalDialogFocusFallbackId);
  target?.focus();
}

/*
 * Exit motion for windows that their parent unmounts. The dashboard mounts a
 * dialog only while it is open, so Radix never gets to play a closing
 * animation: every exit (red control, Cancel, Save, Escape, backdrop) removes
 * the tree at once. Just before removal the window leaves an inert copy of
 * itself, marked closed, which plays the closing keyframes and removes itself.
 * The copy carries no ids, no pointer events and no accessibility, and it is
 * skipped entirely under reduced motion.
 */
function useExitGhost(windowId: string) {
  useLayoutEffect(() => () => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    for (const node of document.querySelectorAll<HTMLElement>(`[data-window="${windowId}"][data-state="open"]`)) {
      const ghost = node.cloneNode(true) as HTMLElement;
      ghost.dataset.state = "closed";
      ghost.removeAttribute("data-window");
      ghost.removeAttribute("id");
      ghost.querySelectorAll("[id]").forEach((element) => element.removeAttribute("id"));
      ghost.setAttribute("aria-hidden", "true");
      ghost.setAttribute("inert", "");
      ghost.classList.add("is-exit-ghost");
      document.body.appendChild(ghost);
      const remove = () => ghost.remove();
      ghost.addEventListener("animationend", remove, { once: true });
      window.setTimeout(remove, 600);
    }
  }, [windowId]);
}

function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  size = "default",
  focusFallbackId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  children: ReactNode;
  size?: "default" | "wide";
  focusFallbackId?: string;
}) {
  const { text } = useLanguage();
  const windowId = useId();
  useExitGhost(windowId);
  const restoreFocusRef = useRef<HTMLElement | null>(
    typeof document !== "undefined" && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" data-window={windowId} />
        <Dialog.Content
          className={`dialog-content dialog-content--${size}`}
          data-window={windowId}
          // With a calendar open, Escape closes the calendar only (DateField).
          onEscapeKeyDown={(event) => {
            if (isDatePickerOpen()) event.preventDefault();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            focusAfterDialog(restoreFocusRef.current, focusFallbackId);
          }}
        >
          <div className="window-bar">
            <Dialog.Close asChild>
              <WindowCloseControl label={text("Chiudi finestra", "Close dialog")} />
            </Dialog.Close>
          </div>
          <div className="window-body">
            <header className="dialog-header">
              <div>
                <Dialog.Title>{title}</Dialog.Title>
                <Dialog.Description>{description}</Dialog.Description>
              </div>
            </header>
            {children}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function useSubmitState() {
  const { text } = useLanguage();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (operation: () => Promise<void>) => {
    setError(null);
    setSubmitting(true);
    try {
      await operation();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : text("Impossibile completare l'operazione.", "The operation could not be completed."));
    } finally {
      setSubmitting(false);
    }
  };

  return { submitting, error, setError, run };
}

export function UpdateBalancesDialog({
  accounts,
  snapshots,
  open,
  onOpenChange,
  onSave,
  onDeleteSnapshot,
}: {
  accounts: Account[];
  snapshots: WealthSnapshot[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (updates: BalanceUpdate[]) => Promise<void>;
  onDeleteSnapshot: (snapshotId: string) => Promise<void>;
}) {
  const { categoryLabel, language, locale, text } = useLanguage();
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(accounts.map((account) => [account.id, String(account.balance)])),
  );
  // Every field starts from the account's last saved balance: a proposal,
  // not a fresh reading. Saving confirms the untouched ones too (the
  // repository stamps lastUpdated on every active account), so the dialog
  // says which values were edited now and which are carried over.
  const isCarriedOver = (account: Account) =>
    values[account.id].trim() !== "" && Number(values[account.id]) === account.balance;
  const typedAccounts = accounts.filter((account) => account.id !== "cash");
  const editedCount = typedAccounts.filter((account) => !isCarriedOver(account)).length;
  const carriedCount = typedAccounts.length - editedCount;
  const [snapshotToDelete, setSnapshotToDelete] = useState<WealthSnapshot | null>(null);
  const { submitting, error, setError, run } = useSubmitState();
  const draftAccounts = accounts.map((account) => ({
    ...account,
    balance: account.id === "cash" ? account.balance : Number(values[account.id]),
  }));
  const calculatedTotal = draftAccounts.every((account) => Number.isFinite(account.balance) && account.balance >= 0)
    ? calculateTotalWealth(draftAccounts)
    : null;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const updates = accounts.map((account) => ({ accountId: account.id, balance: Number(values[account.id]) }));
    if (updates.some((update) => !Number.isFinite(update.balance) || update.balance < 0)) {
      setError(text("Inserisci per ogni conto un saldo finito e non negativo.", "Enter a finite, non-negative balance for every account."));
      return;
    }
    void run(async () => {
      await onSave(updates);
      onOpenChange(false);
    });
  };

  return (
    <Modal
      description={text("Ogni conto parte dal suo ultimo saldo salvato: cambia quelli che si sono mossi. Salvando confermi anche quelli invariati e crei un punto immutabile nello storico patrimoniale.", "Each account starts from its last saved balance: change the ones that moved. Saving also confirms the unchanged ones and creates an immutable point in your wealth history.")}
      onOpenChange={onOpenChange}
      open={open}
      size="wide"
      title={text("Aggiorna saldi", "Update balances")}
    >
      <form className="dialog-form" onSubmit={handleSubmit}>
        <div className="balance-list">
          {accountCategories.map((category) => {
            const categoryAccounts = accounts.filter((account) => account.category === category);
            if (categoryAccounts.length === 0) return null;
            return (
              <section aria-labelledby={`balance-group-${category}`} className="balance-group" key={category}>
                <h3 id={`balance-group-${category}`}>{categoryLabel(category)}</h3>
                {categoryAccounts.map((account) => (
                  <label className="balance-row" key={account.id}>
                    <span>
                      <strong><AccountName name={account.name} /></strong>
                      {account.id === "cash" ? (
                        <small>{text("Derivato dal conteggio contanti", "Derived from Cash Counter")}</small>
                      ) : isCarriedOver(account) ? (
                        <small className="balance-row__state">
                          {text(`Ultimo saldo salvato il ${formatDate(account.lastUpdated, { locale })}`, `Last saved balance, ${formatDate(account.lastUpdated, { locale })}`)}
                        </small>
                      ) : (
                        <small className="balance-row__state balance-row__state--edited">
                          {text("Modificato ora · era ", "Edited now · was ")}<Sensitive>{formatCurrency(account.balance)}</Sensitive>
                        </small>
                      )}
                    </span>
                    <span className="currency-input">
                      <span>€</span>
                      <NumberInput
                        aria-label={text(`Saldo ${account.name}`, `${account.name} balance`)}
                        disabled={account.id === "cash"}
                        inputMode="decimal"
                        min="0"
                        onChange={(event) => setValues((current) => ({ ...current, [account.id]: event.target.value }))}
                        required
                        step="0.01"
                        value={values[account.id]}
                      />
                    </span>
                  </label>
                ))}
              </section>
            );
          })}
        </div>
        <div className="calculated-total">
          <span>{text("Patrimonio totale calcolato", "Calculated Total Wealth")}</span>
          <strong>{calculatedTotal === null ? "—" : <Sensitive>{formatCurrency(calculatedTotal)}</Sensitive>}</strong>
        </div>
        <p aria-live="polite" className="balance-summary">
          {editedCount === 0
            ? text("Nessun saldo modificato: salvando confermi tutti i valori attuali.", "No balance edited: saving confirms every current value.")
            : text(
              `${editedCount} ${editedCount === 1 ? "saldo modificato" : "saldi modificati"} ora · ${carriedCount} ${carriedCount === 1 ? "invariato" : "invariati"}, che salvando confermi al valore attuale.`,
              `${editedCount} ${editedCount === 1 ? "balance" : "balances"} edited now · ${carriedCount} unchanged, which saving confirms at their current value.`,
            )}
        </p>
        <section aria-labelledby="snapshot-history-heading" className="snapshot-history">
          <div className="snapshot-history__heading">
            <div>
              <p className="eyebrow">{text("Rilevazioni salvate", "Stored snapshots")}</p>
              <h3 id="snapshot-history-heading" tabIndex={-1}>{text("Storico saldi", "Balance History")}</h3>
            </div>
            <p>{text(
              "Rimuovi una registrazione errata dallo storico. I saldi correnti non cambiano.",
              "Remove an incorrect entry from history. Current balances stay unchanged.",
            )}</p>
          </div>
          {snapshots.length > 0 ? (
            <div className="snapshot-list">
              {[...snapshots].reverse().map((snapshot) => {
                const snapshotDate = formatDate(snapshot.createdAt, {
                  includeTime: true,
                  locale: language === "it" ? "it-IT" : "en-GB",
                });
                return (
                  <div className="snapshot-row" key={snapshot.id}>
                    <div>
                      <strong>{snapshotDate}</strong>
                      <small>{text("Rilevazione salvata", "Stored snapshot")}</small>
                    </div>
                    <Money amount={snapshot.totalWealth} />
                    <Button
                      aria-label={text(
                        `Rimuovi la rilevazione del ${snapshotDate}`,
                        `Remove snapshot from ${snapshotDate}`,
                      )}
                      className="snapshot-delete-button"
                      onClick={() => setSnapshotToDelete(snapshot)}
                      type="button"
                      variant="ghost"
                    >
                      <Trash2 aria-hidden="true" size={15} />
                      <span>{text("Rimuovi", "Remove")}</span>
                    </Button>
                  </div>
                );
              })}
            </div>
          ) : <p className="inline-empty">{text("Nessuna rilevazione salvata.", "No snapshots stored yet.")}</p>}
        </section>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <footer className="dialog-actions">
          <Button onClick={() => onOpenChange(false)} type="button">{text("Annulla", "Cancel")}</Button>
          <Button aria-busy={submitting} disabled={submitting} type="submit" variant="primary">
            <PendingLabel pending={submitting}><Check aria-hidden="true" size={16} />{text("Salva rilevazione", "Save Snapshot")}</PendingLabel>
          </Button>
        </footer>
      </form>
      {snapshotToDelete ? (
        <ConfirmDialog
          cancelFocusId="snapshot-history-heading"
          confirmFocusId="snapshot-history-heading"
          confirmLabel={text("Rimuovi rilevazione", "Remove snapshot")}
          description={text(
            `La rilevazione del ${formatDate(snapshotToDelete.createdAt, { includeTime: true, locale: "it-IT" })} verrà rimossa dallo storico patrimoniale. I saldi correnti dei conti non cambieranno.`,
            `The snapshot from ${formatDate(snapshotToDelete.createdAt, { includeTime: true, locale: "en-GB" })} will be removed from Wealth History. Current account balances will not change.`,
          )}
          onConfirm={() => onDeleteSnapshot(snapshotToDelete.id)}
          onOpenChange={(nextOpen) => { if (!nextOpen) setSnapshotToDelete(null); }}
          open
          title={text("Rimuovere questa rilevazione?", "Remove this snapshot?")}
        />
      ) : null}
    </Modal>
  );
}

export type AccountFormValue = Pick<Account, "name" | "category" | "balance" | "includedInWealth"> & {
  access: Account["access"] | null;
  volatility: Account["volatility"] | null;
};

export function AccountFormDialog({
  account,
  focusFallbackId,
  open,
  onOpenChange,
  onSave,
}: {
  account?: Account;
  focusFallbackId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (value: AccountFormValue) => Promise<void>;
}) {
  const { accessLabel, categoryLabel, text, volatilityLabel } = useLanguage();
  const [name, setName] = useState(account?.name ?? "");
  const [category, setCategory] = useState<AccountCategory>(account?.category ?? "liquidity");
  const [balance, setBalance] = useState(String(account?.balance ?? 0));
  const [included, setIncluded] = useState(account?.includedInWealth ?? true);
  const [access, setAccess] = useState<Account["access"] | "">(account?.access ?? "");
  const [volatility, setVolatility] = useState<Account["volatility"] | "">(account?.volatility ?? "");
  const { submitting, error, setError, run } = useSubmitState();

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const amount = Number(balance);
    if (!name.trim() || !Number.isFinite(amount) || amount < 0) {
      setError(text("Aggiungi un nome e un saldo finito e non negativo.", "Add a name and a finite, non-negative balance."));
      return;
    }
    void run(async () => {
      await onSave({
        name: name.trim(),
        category,
        balance: amount,
        includedInWealth: included,
        access: access || null,
        volatility: volatility || null,
      });
      onOpenChange(false);
    });
  };

  return (
    <Modal
      description={account ? text("Modifica i dati correnti e il profilo di accesso scelto da te.", "Change current data and your user-defined access profile.") : text("Crea un conto in EUR e classificalo solo se conosci già il suo profilo.", "Create a EUR account and classify it only when you know its profile.")}
      focusFallbackId={focusFallbackId}
      onOpenChange={onOpenChange}
      open={open}
      title={account ? text(`Modifica ${account.name}`, `Edit ${account.name}`) : text("Aggiungi conto", "Add account")}
    >
      <form className="dialog-form form-grid" onSubmit={handleSubmit}>
        <label>
          <span>{text("Nome conto", "Account name")}</span>
          <input autoFocus name="name" onChange={(event) => setName(event.target.value)} required value={name} />
        </label>
        <label>
          <span>{text("Categoria", "Category")}</span>
          <select onChange={(event) => setCategory(event.target.value as AccountCategory)} value={category}>
            {(Object.keys(categoryLabels) as AccountCategory[]).map((item) => (
              <option key={item} value={item}>{categoryLabel(item)}</option>
            ))}
          </select>
        </label>
        <label>
          <span>{text("Saldo corrente", "Current balance")}</span>
          <NumberInput
            disabled={account?.id === "cash"}
            inputMode="decimal"
            min="0"
            onChange={(event) => setBalance(event.target.value)}
            required
            step="0.01"
            value={balance}
          />
          {account?.id === "cash" ? <small>{text("Gestito dal conteggio contanti.", "Managed by Cash Counter.")}</small> : null}
        </label>
        <label>
          <span>{text("Accesso", "Access")}</span>
          <select
            aria-label={text("Accesso", "Access")}
            onChange={(event) => setAccess(event.target.value as Account["access"] | "")}
            value={access}
          >
            <option value="">{accessLabel()}</option>
            <option value="immediate">{accessLabel("immediate")}</option>
            <option value="days">{accessLabel("days")}</option>
            <option value="locked">{accessLabel("locked")}</option>
          </select>
          <small>{text("Quanto rapidamente consideri accessibile questo saldo.", "How quickly you consider this balance accessible.")}</small>
        </label>
        <label>
          <span>{text("Volatilità", "Volatility")}</span>
          <select
            aria-label={text("Volatilità", "Volatility")}
            onChange={(event) => setVolatility(event.target.value as Account["volatility"] | "")}
            value={volatility}
          >
            <option value="">{volatilityLabel()}</option>
            <option value="stable">{volatilityLabel("stable")}</option>
            <option value="moderate">{volatilityLabel("moderate")}</option>
            <option value="volatile">{volatilityLabel("volatile")}</option>
          </select>
          <small>{text("Una descrizione qualitativa, non una stima di rischio.", "A qualitative description, not a risk estimate.")}</small>
        </label>
        <label className="check-field">
          <input checked={included} onChange={(event) => setIncluded(event.target.checked)} type="checkbox" />
          <span>{text("Includi nel Patrimonio totale", "Include in Total Wealth")}</span>
        </label>
        {error ? <p className="form-error form-span" role="alert">{error}</p> : null}
        <footer className="dialog-actions form-span">
          <Button onClick={() => onOpenChange(false)} type="button">{text("Annulla", "Cancel")}</Button>
          <Button aria-busy={submitting} disabled={submitting} type="submit" variant="primary"><PendingLabel pending={submitting}>{text("Salva conto", "Save account")}</PendingLabel></Button>
        </footer>
      </form>
    </Modal>
  );
}

export function AccountDetailDialog({
  account,
  snapshots,
  totalWealth,
  open,
  onOpenChange,
  onEdit,
  onDelete,
}: {
  account: Account;
  snapshots: WealthSnapshot[];
  totalWealth: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { accessLabel, locale, text, volatilityLabel } = useLanguage();
  const history = snapshots.flatMap((snapshot) => {
    const entry = snapshot.accountBalances.find((balance) => balance.accountId === account.id);
    return entry ? [{ totalWealth: entry.balance }] : [];
  });
  const change = calculateSnapshotDelta(history.at(-1), history.at(-2));
  const previousSnapshotBalance = [...snapshots]
    .reverse()
    .flatMap((snapshot) => snapshot.accountBalances.filter((balance) => balance.accountId === account.id))
    .at(0)?.balance;

  return (
    <Modal
      description={text("Lo storico del saldo riflette i saldi salvati, non la performance degli investimenti.", "Balance history reflects stored balances, not investment performance.")}
      focusFallbackId={accountDialogFocusId(account.id)}
      onOpenChange={onOpenChange}
      open={open}
      size="wide"
      title={account.name}
    >
      <div className="account-detail">
        <div className="detail-metrics">
          <div><span>{text("Saldo corrente", "Current Balance")}</span><Money amount={account.balance} /></div>
          <div><span>{text("Saldo all'ultima rilevazione", "Previous snapshot balance")}</span>{previousSnapshotBalance === undefined ? <strong>—</strong> : <Money amount={previousSnapshotBalance} />}</div>
          <div><span>{text("Quota del Patrimonio totale", "Share of Total Wealth")}</span><strong><Percent>{formatPercent(calculateAccountShare(account, totalWealth), 2, locale)}</Percent></strong></div>
          <div><span>{text("Categoria", "Category")}</span><CategoryMark category={account.category} /></div>
          <div><span>{text("Accesso", "Access")}</span><strong>{accessLabel(account.access)}</strong></div>
          <div><span>{text("Volatilità", "Volatility")}</span><strong>{volatilityLabel(account.volatility)}</strong></div>
          <div><span>{text("Ultimo aggiornamento", "Last Updated")}</span><strong>{formatDate(account.lastUpdated, { includeTime: true, locale })}</strong></div>
        </div>
        <div className="detail-history">
          <div className="detail-history__heading">
            <div><p className="eyebrow">{text("Rilevazioni salvate", "Stored snapshots")}</p><h3>{text("Storico saldo", "Balance History")}</h3></div>
            <span>{change ? <>{change.amount >= 0 ? "+" : ""}<Sensitive>{formatCurrency(change.amount)}</Sensitive> {text("variazione saldo", "balance change")}</> : "—"}</span>
          </div>
          <AccountHistoryChart accountId={account.id} snapshots={snapshots} />
        </div>
        <footer className="dialog-actions dialog-actions--split">
          {account.id === "cash" ? <span /> : (
            <Button onClick={onDelete} type="button" variant="danger"><Trash2 aria-hidden="true" size={15} /> {text("Elimina", "Delete")}</Button>
          )}
          <Button onClick={onEdit} type="button" variant="primary">{text("Modifica conto", "Edit account")}</Button>
        </footer>
      </div>
    </Modal>
  );
}

export function CashCounterDialog({
  denominations,
  open,
  onOpenChange,
  onSave,
}: {
  denominations: CashDenomination[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (values: CashDenomination[]) => Promise<void>;
}) {
  const { text } = useLanguage();
  const [quantities, setQuantities] = useState<Record<number, string>>(
    Object.fromEntries(denominations.map((item) => [item.denomination, String(item.quantity)])),
  );
  const { submitting, error, setError, run } = useSubmitState();
  const values = denominations.map((item) => ({ ...item, quantity: Number(quantities[item.denomination]) }));
  const valid = values.every((item) => Number.isInteger(item.quantity) && item.quantity >= 0);
  const total = valid ? calculateCashTotal(values) : null;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!valid) {
      setError(text("Le quantità devono essere numeri interi non negativi.", "Quantities must be non-negative whole numbers."));
      return;
    }
    void run(async () => {
      await onSave(values);
      onOpenChange(false);
    });
  };

  return (
    <Modal
      description={text("I tagli fisici sono l'unica fonte attendibile per il conto Contanti.", "Physical denominations are the single source of truth for the Cash account.")}
      onOpenChange={onOpenChange}
      open={open}
      title={text("Conteggio contanti", "Cash Counter")}
    >
      <form className="dialog-form" onSubmit={handleSubmit}>
        <div className="cash-table">
          <div className="cash-table__head"><span>{text("Taglio", "Denomination")}</span><span>{text("Quantità", "Quantity")}</span><span>{text("Subtotale", "Subtotal")}</span></div>
          {denominations.map((item) => {
            const quantity = Number(quantities[item.denomination]);
            return (
              <label className="cash-row" key={item.denomination}>
                <strong><Sensitive>{formatCurrency(item.denomination)}</Sensitive></strong>
                <NumberInput
                  aria-label={text(`Banconote da ${item.denomination} euro`, `${item.denomination} euro notes`)}
                  inputMode="numeric"
                  min="0"
                  onChange={(event) => setQuantities((current) => ({ ...current, [item.denomination]: event.target.value }))}
                  step="1"
                  value={quantities[item.denomination]}
                />
                <span>{Number.isFinite(quantity) ? <Sensitive>{formatCurrency(item.denomination * quantity)}</Sensitive> : "—"}</span>
              </label>
            );
          })}
        </div>
        <div className="calculated-total"><span>{text("Contanti fisici totali", "Total Physical Cash")}</span><strong>{total === null ? "—" : <Sensitive>{formatCurrency(total)}</Sensitive>}</strong></div>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <footer className="dialog-actions">
          <Button onClick={() => onOpenChange(false)} type="button">{text("Annulla", "Cancel")}</Button>
          <Button aria-busy={submitting} disabled={submitting} type="submit" variant="primary"><PendingLabel pending={submitting}>{text("Aggiorna contanti", "Update Cash")}</PendingLabel></Button>
        </footer>
      </form>
    </Modal>
  );
}

export type PaycheckFormValue = Omit<Paycheck, "id">;

export function PaycheckFormDialog({
  paycheck,
  open,
  onOpenChange,
  onSave,
  onDelete,
}: {
  paycheck?: Paycheck;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (value: PaycheckFormValue) => Promise<void>;
  onDelete?: () => void;
}) {
  const { text } = useLanguage();
  const [paymentDate, setPaymentDate] = useState(paycheck?.paymentDate ?? formatLocalCalendarDate());
  const [amount, setAmount] = useState(String(paycheck?.amount ?? ""));
  // A record saved before types existed opens as a salary, which is what it was.
  const [type, setType] = useState<PaycheckType>(paycheck ? paycheckTypeOf(paycheck) : "salary");
  const [label, setLabel] = useState(paycheck?.label ?? "");
  const [competencePeriod, setCompetencePeriod] = useState(paycheck?.competencePeriod ?? "");
  const [notes, setNotes] = useState(paycheck?.notes ?? "");
  const { submitting, error, setError, run } = useSubmitState();

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const numericAmount = Number(amount);
    if (!paymentDate || !Number.isFinite(numericAmount) || numericAmount < 0) {
      setError(text("Scegli una data reale e inserisci un importo finito e non negativo.", "Choose a real date and enter a finite, non-negative amount."));
      return;
    }
    void run(async () => {
      await onSave({
        paymentDate,
        amount: numericAmount,
        type,
        ...(label.trim() ? { label: label.trim() } : {}),
        ...(competencePeriod.trim() ? { competencePeriod: competencePeriod.trim() } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      });
      onOpenChange(false);
    });
  };

  return (
    <Modal
      description={text("Ogni pagamento resta un record distinto, anche quando ce ne sono più di uno nello stesso mese.", "Each payment remains a distinct record, including multiple payments in one month.")}
      onOpenChange={onOpenChange}
      open={open}
      title={paycheck ? text("Modifica stipendio", "Edit paycheck") : text("Aggiungi stipendio", "Add paycheck")}
    >
      <form className="dialog-form form-grid" onSubmit={handleSubmit}>
        <label><span>{text("Data pagamento", "Payment date")}</span><DateField onChange={setPaymentDate} required value={paymentDate} /></label>
        <label><span>{text("Importo", "Amount")}</span><NumberInput inputMode="decimal" min="0" onChange={(event) => setAmount(event.target.value)} required step="0.01" value={amount} /></label>
        <label>
          <span>{text("Tipo", "Type")}</span>
          <select onChange={(event) => setType(event.target.value as PaycheckType)} value={type}>
            {paycheckTypes.map((item) => <option key={item} value={item}>{paycheckTypeLabel(item, text)}</option>)}
          </select>
        </label>
        <label><span>{text("Etichetta", "Label")} <small>{text("Opzionale", "Optional")}</small></span><input onChange={(event) => setLabel(event.target.value)} value={label} /></label>
        <label><span>{text("Periodo di competenza", "Competence period")} <small>{text("Opzionale", "Optional")}</small></span><input onChange={(event) => setCompetencePeriod(event.target.value)} placeholder={text("es. luglio 2026", "e.g. July 2026")} value={competencePeriod} /></label>
        <label className="form-span"><span>{text("Note", "Notes")} <small>{text("Opzionale", "Optional")}</small></span><textarea onChange={(event) => setNotes(event.target.value)} rows={3} value={notes} /></label>
        {error ? <p className="form-error form-span" role="alert">{error}</p> : null}
        <footer className={`dialog-actions form-span ${onDelete ? "dialog-actions--split" : ""}`}>
          {onDelete ? <Button onClick={onDelete} type="button" variant="danger"><Trash2 aria-hidden="true" size={15} /> {text("Elimina", "Delete")}</Button> : <span />}
          <div className="dialog-actions__group">
            <Button onClick={() => onOpenChange(false)} type="button">{text("Annulla", "Cancel")}</Button>
            <Button aria-busy={submitting} disabled={submitting} type="submit" variant="primary"><PendingLabel pending={submitting}>{text("Salva stipendio", "Save paycheck")}</PendingLabel></Button>
          </div>
        </footer>
      </form>
    </Modal>
  );
}

export function GoalDialog({
  name,
  type = "total-wealth",
  targetAmount,
  targetDate,
  creating = false,
  open,
  onOpenChange,
  onSave,
}: {
  name: string;
  type?: WealthGoalType;
  targetAmount: number;
  targetDate?: string;
  creating?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (value: { name: string; type: WealthGoalType; targetAmount: number; targetDate?: string }) => Promise<void>;
}) {
  const { text } = useLanguage();
  const [goalName, setGoalName] = useState(name);
  const [goalType, setGoalType] = useState<WealthGoalType>(type);
  const [target, setTarget] = useState(targetAmount > 0 ? String(targetAmount) : "");
  const [date, setDate] = useState(targetDate ?? "");
  const { submitting, error, setError, run } = useSubmitState();

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const amount = Number(target);
    if (!goalName.trim() || !Number.isFinite(amount) || amount <= 0) {
      setError(text("Aggiungi un nome e un importo obiettivo positivo.", "Add a goal name and a positive target."));
      return;
    }
    void run(async () => {
      await onSave({
        name: goalName.trim(),
        type: goalType,
        targetAmount: amount,
        targetDate: date || undefined,
      });
      onOpenChange(false);
    });
  };

  return (
    <Modal
      description={text("Scegli la base di saldo osservata. Le date obiettivo alimentano confronti matematici sul ritmo, non garanzie.", "Choose the observed balance basis. Target dates power mathematical pace comparisons, not guarantees.")}
      onOpenChange={onOpenChange}
      open={open}
      title={creating ? text("Crea obiettivo patrimoniale", "Create wealth goal") : text("Modifica obiettivo patrimoniale", "Edit wealth goal")}
    >
      <form className="dialog-form form-grid" onSubmit={handleSubmit}>
        <label><span>{text("Nome obiettivo", "Goal name")}</span><input onChange={(event) => setGoalName(event.target.value)} required value={goalName} /></label>
        <label>
          <span>{text("Base obiettivo", "Goal basis")}</span>
          <select onChange={(event) => setGoalType(event.target.value as WealthGoalType)} value={goalType}>
            <option value="total-wealth">{text("Patrimonio totale", "Total Wealth")}</option>
            <option value="liquidity">{text("Liquidità", "Liquidity")}</option>
          </select>
        </label>
        <label><span>{text("Importo obiettivo", "Target amount")}</span><NumberInput min="0.01" onChange={(event) => setTarget(event.target.value)} required step="0.01" value={target} /></label>
        <label><span>{text("Data obiettivo", "Target date")}</span><DateField onChange={setDate} value={date} /></label>
        {error ? <p className="form-error form-span" role="alert">{error}</p> : null}
        <footer className="dialog-actions form-span">
          <Button onClick={() => onOpenChange(false)} type="button">{text("Annulla", "Cancel")}</Button>
          <Button aria-busy={submitting} disabled={submitting} type="submit" variant="primary">
            <PendingLabel pending={submitting}>{creating ? text("Crea obiettivo", "Create goal") : text("Salva obiettivo", "Save goal")}</PendingLabel>
          </Button>
        </footer>
      </form>
    </Modal>
  );
}

/**
 * Changes the PIN: the current PIN first, then the new one twice. Nothing is
 * written until the current PIN is verified; a wrong one leaves everything as
 * it was and says so. The fields hold digits only and are never prefilled.
 */
export function ChangePinDialog({
  open,
  onOpenChange,
  onChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Resolves false when the current PIN is wrong; nothing has changed then. */
  onChange: (currentPin: string, nextPin: string) => Promise<boolean>;
}) {
  const { text } = useLanguage();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const { submitting, error, setError, run } = useSubmitState();
  const digits = (value: string) => value.replace(/\D/g, "").slice(0, 8);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!isValidPinFormat(current)) {
      setError(text("Inserisci il PIN attuale.", "Enter your current PIN."));
      return;
    }
    if (!isValidPinFormat(next)) {
      setError(text("Il nuovo PIN deve contenere da 4 a 8 cifre.", "The new PIN must be 4 to 8 digits."));
      return;
    }
    if (next !== confirmation) {
      setError(text("I due nuovi PIN non coincidono.", "The two new PINs do not match."));
      return;
    }
    if (next === current) {
      setError(text("Il nuovo PIN è uguale a quello attuale.", "The new PIN is the same as the current one."));
      return;
    }
    void run(async () => {
      const changed = await onChange(current, next);
      if (!changed) {
        setCurrent("");
        throw new Error(text("Il PIN attuale non è corretto. Nulla è stato cambiato.", "The current PIN is not correct. Nothing was changed."));
      }
      onOpenChange(false);
    });
  };

  return (
    <Modal
      description={text(
        "Il nuovo PIN vale da subito, anche per sbloccare questa sessione quando si blocca. I tuoi dati non cambiano.",
        "The new PIN applies at once, including to unlock this session when it locks. Your data does not change.",
      )}
      onOpenChange={onOpenChange}
      open={open}
      title={text("Cambia PIN", "Change PIN")}
    >
      <form className="dialog-form form-grid change-pin-form" onSubmit={handleSubmit}>
        <label className="form-span">
          <span>{text("PIN attuale", "Current PIN")}</span>
          <input autoComplete="current-password" autoFocus inputMode="numeric" onChange={(event) => setCurrent(digits(event.target.value))} type="password" value={current} />
        </label>
        <label>
          <span>{text("Nuovo PIN", "New PIN")} <small>{text("4–8 cifre", "4–8 digits")}</small></span>
          <input autoComplete="new-password" inputMode="numeric" onChange={(event) => setNext(digits(event.target.value))} type="password" value={next} />
        </label>
        <label>
          <span>{text("Conferma nuovo PIN", "Confirm new PIN")}</span>
          <input autoComplete="new-password" inputMode="numeric" onChange={(event) => setConfirmation(digits(event.target.value))} type="password" value={confirmation} />
        </label>
        {error ? <p className="form-error form-span" role="alert">{error}</p> : null}
        <footer className="dialog-actions form-span">
          <Button onClick={() => onOpenChange(false)} type="button">{text("Annulla", "Cancel")}</Button>
          <Button aria-busy={submitting} disabled={submitting} type="submit" variant="primary">
            <PendingLabel pending={submitting}>{text("Cambia PIN", "Change PIN")}</PendingLabel>
          </Button>
        </footer>
      </form>
    </Modal>
  );
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  tone = "danger",
  cancelFocusId,
  confirmFocusId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
  tone?: "danger" | "primary";
  cancelFocusId?: string;
  confirmFocusId?: string;
}) {
  const { text } = useLanguage();
  const { submitting, error, run } = useSubmitState();
  const windowId = useId();
  useExitGhost(windowId);
  const restoreFocusRef = useRef<HTMLElement | null>(
    typeof document !== "undefined" && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  const confirmedRef = useRef(false);

  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="dialog-overlay" data-window={windowId} />
        <AlertDialog.Content
          className="dialog-content alert-content"
          data-window={windowId}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            focusAfterDialog(
              restoreFocusRef.current,
              confirmedRef.current ? confirmFocusId : cancelFocusId,
              confirmedRef.current,
            );
          }}
        >
          {/* The red control closes without confirming, exactly like Escape and Cancel. */}
          <div className="window-bar">
            <WindowCloseControl label={text("Chiudi finestra", "Close dialog")} onClick={() => onOpenChange(false)} />
          </div>
          <div className="window-body">
            <div className="alert-icon"><Landmark aria-hidden="true" size={18} /></div>
            <AlertDialog.Title>{title}</AlertDialog.Title>
            <AlertDialog.Description>{description}</AlertDialog.Description>
            {error ? <p className="form-error" role="alert">{error}</p> : null}
            <footer className="dialog-actions">
              <AlertDialog.Cancel asChild><Button type="button">{text("Annulla", "Cancel")}</Button></AlertDialog.Cancel>
              <Button
                aria-busy={submitting}
                disabled={submitting}
                onClick={() => void run(async () => {
                  await onConfirm();
                  confirmedRef.current = true;
                  onOpenChange(false);
                })}
                type="button"
                variant={tone}
              >
                <PendingLabel pending={submitting}>{confirmLabel}</PendingLabel>
              </Button>
            </footer>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

export function buildAccountDraft(value: AccountFormValue): AccountDraft {
  const base = value.name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "account";
  const suffix = globalThis.crypto?.randomUUID?.().slice(0, 8) ?? Date.now().toString(36);
  const { access, volatility, ...required } = value;
  return {
    id: `${base}-${suffix}`,
    currency: "EUR",
    ...required,
    ...(access ? { access } : {}),
    ...(volatility ? { volatility } : {}),
  };
}
