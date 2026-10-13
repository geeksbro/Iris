"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowDownToLine, ArrowUpFromLine, ChevronDown, Compass, FileCheck2, FlaskConical, HardDrive, KeyRound, Lock, Trash2 } from "lucide-react";

import packageInfo from "../../../package.json";
import { backupFormatVersion, getLastBackupExport } from "@/data/backup";
import { getBackupHealth } from "@/data/backup-health";
import { getPersistRequest, requestPersistentStorage } from "@/data/storage-persistence";
import { parseWealthBackup } from "@/domain/schemas";
import { wealthDb } from "@/data/db";
import { canLoadDemoData, clearDemoData, hasDemoData, loadDemoData } from "@/data/repository";
import { getPageVisits, resetPageVisits } from "@/data/page-visits";
import { changePin, getPinSetAt } from "@/data/pin";
import { idleTimeoutChoices, setIdleTimeoutMs, type IdleTimeout } from "@/data/security";
import { formatCurrency } from "@/domain/formatters";
import { formatIdleLimit, useIdleTimeoutMs, useSessionLock } from "@/features/auth/LoginGate";
import { ChangePinDialog, ConfirmDialog } from "@/features/dashboard/Dialogs";
import { usePrivacy } from "@/features/dashboard/privacy";
import { Button, cx, formatDate } from "@/features/dashboard/ui";
import { useLanguage } from "@/features/i18n/language";
import { setUISoundsEnabled, useUISoundsEnabled } from "@/features/sound/ui-sound";

import { greetingFor } from "@/features/auth/lock-clock";

import { displayName, displayNameMaxLength, interfaceFont, lockBackground, lockBackgrounds, sidebarCollapsed, startPage, startPages, theme, type LockBackground, type StartPage } from "./preferences";
import { SettingsIndex, SettingsPane } from "./SettingsPane";

/*
 * Settings: the terms under which this device holds the ledger — who opens
 * it, how long it stays open, what it shows, what it keeps. Each row states
 * the term in force in words, with its control beside it. Lightweight
 * preferences apply the moment they change and show no confirmation; the
 * PIN and the replacement of data go through a window that asks first.
 * Every control drives the existing authoritative state (language, privacy,
 * sounds, backup, the gate's lock); this view keeps none of its own beyond
 * drafts and which group is in view.
 */

type SectionId = "security" | "data" | "experience" | "general" | "system";

const reducedMotionQuery = "(prefers-reduced-motion: reduce)";

function subscribeToMotion(onChange: () => void) {
  const query = window.matchMedia?.(reducedMotionQuery);
  query?.addEventListener?.("change", onChange);
  return () => query?.removeEventListener?.("change", onChange);
}

/** The system's reduced-motion preference, live; null where it cannot be read. */
function useSystemReducedMotion(): boolean | null {
  return useSyncExternalStore(
    subscribeToMotion,
    () => (typeof window.matchMedia === "function" ? window.matchMedia(reducedMotionQuery).matches : null),
    () => null,
  );
}

type StorageState =
  | { status: "reading" }
  | { status: "unavailable" }
  | { status: "known"; persisted: boolean | null; usage: number | null; quota: number | null };

/** What the browser reports about this origin's storage; nothing is guessed. */
function useStorageState() {
  const [state, setState] = useState<StorageState>({ status: "reading" });

  const read = useCallback(async () => {
    const storage = typeof navigator === "undefined" ? undefined : navigator.storage;
    if (!storage?.estimate && !storage?.persisted) {
      setState({ status: "unavailable" });
      return;
    }
    try {
      const [persisted, estimate] = await Promise.all([
        storage.persisted ? storage.persisted() : Promise.resolve(null),
        storage.estimate ? storage.estimate() : Promise.resolve(null),
      ]);
      setState({ status: "known", persisted, usage: estimate?.usage ?? null, quota: estimate?.quota ?? null });
    } catch {
      setState({ status: "unavailable" });
    }
  }, []);

  useEffect(() => {
    // The browser answers asynchronously; the state is set once it has.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void read();
  }, [read]);

  const requestPersistence = async (): Promise<boolean> => {
    // Through the same request the dashboard makes, so its answer is recorded.
    const outcome = await requestPersistentStorage();
    await read();
    return outcome === "granted";
  };

  return { state, requestPersistence };
}

/** The control that starts the tour again; focus returns to it when the tour ends. */
export const settingsTourButtonId = "settings-tour-button";

export function SettingsView({ back, onExport, onImport, onNotify, onStartTour }: {
  /** The way back to the view Settings was opened from, placed before the title. */
  back?: ReactNode;
  onExport: () => void;
  onImport: () => void;
  onNotify: (message: string) => void;
  /** Starts the guided tour; absent where there is no dashboard to tour. */
  onStartTour?: (focusId: string) => void;
}) {
  const { language, locale, text, toggleLanguage } = useLanguage();
  const { accountNamesHidden, amountsHidden, percentagesHidden, setAccountNamesHidden, setPercentagesHidden, toggleAmounts } = usePrivacy();
  const lockSession = useSessionLock();
  const idleLimitMs = useIdleTimeoutMs();
  const soundsOn = useUISoundsEnabled();
  const background = lockBackground.use();
  const name = displayName.use();
  const compactRail = sidebarCollapsed.use();
  const openingPage = startPage.use();
  const currentTheme = theme.use();
  const currentFont = interfaceFont.use();
  const reducedMotion = useSystemReducedMotion();
  const storage = useStorageState();
  const pinSetAt = useLiveQuery(() => getPinSetAt(), [], undefined);
  const records = useLiveQuery(async () => {
    const [accounts, archived, snapshots, paychecks, goals, denominations] = await Promise.all([
      wealthDb.accounts.count(),
      wealthDb.accounts.filter((account) => Boolean(account.archivedAt)).count(),
      wealthDb.snapshots.count(),
      wealthDb.paychecks.count(),
      wealthDb.goals.count(),
      wealthDb.cashDenominations.count(),
    ]);
    return { accounts, archived, snapshots, paychecks, goals, denominations };
  }, []);
  const visits = useLiveQuery(() => getPageVisits(), [], undefined);
  // The example archive: offered only to an empty archive, removable only while it is there.
  const example = useLiveQuery(async () => ({ canLoad: await canLoadDemoData(), loaded: await hasDemoData() }), [], undefined);
  const [exampleAction, setExampleAction] = useState<"load" | "clear" | null>(null);
  const lastExport = useLiveQuery(() => getLastBackupExport(), [], undefined);
  const totalVisits = visits ? startPages.reduce((sum, page) => sum + visits[page], 0) : 0;
  const [resettingVisits, setResettingVisits] = useState(false);
  const [changingPin, setChangingPin] = useState(false);
  const [lockError, setLockError] = useState<string | null>(null);
  const [persistNote, setPersistNote] = useState<string | null>(null);
  const health = useLiveQuery(() => getBackupHealth(), [], undefined);
  const persistAsked = useLiveQuery(() => getPersistRequest(), [], undefined);
  /* Checking a backup file without importing it: read, validated as an
     import would validate it, and described; nothing is replaced. */
  const verifyInputRef = useRef<HTMLInputElement>(null);
  const [verification, setVerification] = useState<{ ok: boolean; message: string } | null>(null);
  const verifyFile = async (file?: File) => {
    if (!file) return;
    try {
      const backup = parseWealthBackup(await file.text());
      const active = backup.accounts.filter((account) => !account.archivedAt).length;
      setVerification({
        ok: true,
        message: text(
          `«${file.name}» è un backup valido del ${formatDate(backup.exportedAt, { locale })}: ${count(active, "conto", "conti")}, ${count(backup.snapshots.length, "rilevazione", "rilevazioni")}, ${count(backup.paychecks.length, "stipendio", "stipendi")}, ${count(backup.goals.length, "obiettivo", "obiettivi")}. Si può ripristinare; nulla è stato importato.`,
          `“${file.name}” is a valid backup from ${formatDate(backup.exportedAt, { locale })}: ${count(active, "account", "accounts")}, ${count(backup.snapshots.length, "snapshot", "snapshots")}, ${count(backup.paychecks.length, "paycheck", "paychecks")}, ${count(backup.goals.length, "goal", "goals")}. It can be restored; nothing was imported.`,
        ),
      });
    } catch (reason) {
      setVerification({
        ok: false,
        message: text(
          `«${file.name}» non si può ripristinare: ${reason instanceof Error ? reason.message : "file non valido"}.`,
          `“${file.name}” cannot be restored: ${reason instanceof Error ? reason.message : "invalid file"}.`,
        ),
      });
    } finally {
      if (verifyInputRef.current) verifyInputRef.current.value = "";
    }
  };
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [active, setActive] = useState<SectionId>("security");
  /** A group chosen in the index, waiting for its heading to exist. */
  const pendingFocusRef = useRef<SectionId | null>(null);
  const baseId = useId();
  const rowId = (row: string) => `${baseId}-${row}`;

  const hiddenTerms = [amountsHidden, percentagesHidden, accountNamesHidden].filter(Boolean).length;
  const count = (value: number, one: string, many: string) => `${value} ${value === 1 ? one : many}`;
  const idleLimit = formatIdleLimit(idleLimitMs, locale);
  /* The rail's own names for its six pages, so Settings never invents a
     second vocabulary for the same destinations. */
  const startPageLabels: Record<StartPage, string> = {
    overview: text("Panoramica", "Overview"),
    accounts: text("Conti", "Accounts"),
    "cash-flow": text("Flussi di cassa", "Cash flow"),
    progress: text("Andamento", "Progress"),
    goals: text("Obiettivi", "Goals"),
    scenario: text("Proiezioni", "Projections"),
  };
  const backgroundLabels: Record<LockBackground, string> = {
    aurora: text("Aurora", "Aurora"),
    sky: text("Cielo animato", "Moving sky"),
    "still-sky": text("Cielo fermo", "Still sky"),
    none: text("Nessuno", "None"),
  };
  const environment = process.env.NODE_ENV === "production" ? text("Produzione", "Production") : text("Sviluppo", "Development");
  const storageSummary = storage.state.status === "known" && storage.state.persisted !== null
    ? storage.state.persisted ? text("archiviazione persistente", "persistent storage") : text("archiviazione non persistente", "storage not persistent")
    : text("archiviazione non riportata", "storage not reported");

  const sections: Array<{ id: SectionId; title: string; summary: string }> = [
    {
      id: "security",
      title: text("Privacy e sicurezza", "Privacy & security"),
      summary: `${text(`Blocco dopo ${idleLimit}`, `Locks after ${idleLimit}`)} · ${hiddenTerms === 0
        ? text("nulla nascosto", "nothing hidden")
        : text(`${hiddenTerms} di 3 nascosti`, `${hiddenTerms} of 3 hidden`)}`,
    },
    {
      id: "data",
      title: text("Dati", "Data"),
      summary: `${records ? count(records.accounts, text("conto", "account"), text("conti", "accounts")) : "…"} · ${storageSummary}`,
    },
    {
      id: "experience",
      title: text("Esperienza", "Experience"),
      summary: `${startPageLabels[openingPage]} · ${currentTheme === "dark" ? text("tema scuro", "dark theme") : text("tema chiaro", "light theme")} · ${soundsOn ? text("suoni attivi", "sounds on") : text("suoni disattivati", "sounds off")}`,
    },
    {
      id: "general",
      title: text("Generale", "General"),
      summary: `${language === "it" ? "Italiano" : "English"} · ${text("euro", "euro")}`,
    },
    {
      id: "system",
      title: text("Sistema", "System"),
      summary: `${text("Versione", "Version")} ${packageInfo.version} · ${environment.toLowerCase()}`,
    },
  ];

  /*
   * One group is shown at a time, so choosing one in the index is a change of
   * what the pane holds rather than a journey down the page. Focus has to
   * follow, or a reader who chose a group with the keyboard would be left
   * behind in the index: it is asked for here and given in the layout effect
   * below, once the group it belongs to actually exists.
   */
  const goTo = (id: SectionId) => {
    pendingFocusRef.current = id;
    setActive(id);
  };

  useLayoutEffect(() => {
    const wanted = pendingFocusRef.current;
    if (!wanted) return;
    pendingFocusRef.current = null;
    document.getElementById(`${baseId}-${wanted}`)?.focus({ preventScroll: true });
  }, [active, baseId]);

  const chooseIdleLimit = async (value: IdleTimeout) => {
    setLockError(null);
    try {
      await setIdleTimeoutMs(value);
    } catch {
      setLockError(text("Impossibile salvare il blocco automatico: resta quello di prima.", "Auto-lock could not be saved: the previous one still applies."));
    }
  };

  const commitName = () => {
    if (nameDraft === null) return;
    displayName.set(nameDraft);
    setNameDraft(null);
  };

  const requestPersistence = async () => {
    setPersistNote(null);
    try {
      const granted = await storage.requestPersistence();
      if (!granted) {
        setPersistNote(text("Il browser non l'ha concessa per ora. I dati restano dove sono.", "The browser has not granted it for now. Your data stays where it is."));
      }
    } catch {
      setPersistNote(text("Il browser non ha risposto alla richiesta.", "The browser did not answer the request."));
    }
  };

  // The lock screen greets by the hour (lock-clock.tsx), the same for anyone.
  const greeting = greetingFor(new Date(), name, text);
  const sampleDate = formatDate(new Date().toISOString(), { locale });

  return (
    <div className="management-view settings-view view-enter">
      <header className="view-header">
        <div>
          {back}
          <p className="eyebrow">{text("Questo dispositivo", "This device")}</p>
          <h1>{text("Impostazioni", "Settings")}</h1>
          <p>{text(
            "Come questo dispositivo custodisce e mostra i tuoi dati. Le preferenze valgono appena le cambi; PIN e ripristino chiedono sempre conferma.",
            "How this device keeps and shows your data. Preferences apply as soon as you change them; the PIN and a restore always ask first.",
          )}</p>
        </div>
        {/* The tour, whichever group is open: it reads nothing and changes
            nothing here, so it sits with the page rather than in a group. */}
        {onStartTour ? (
          <div className="view-header__actions">
            <Button data-tour="settings-tour" id={settingsTourButtonId} onClick={() => onStartTour(settingsTourButtonId)}>
              <Compass aria-hidden="true" size={16} /> {text("Ripeti tutorial", "Take the tour again")}
            </Button>
          </div>
        ) : null}
      </header>

      <div className="settings-layout">
        <SettingsIndex
          active={active}
          entries={sections}
          label={text("Gruppi di impostazioni", "Settings groups")}
          onSelect={(id) => goTo(id as SectionId)}
        />

        <SettingsPane active={active}>
          {/* ── Privacy and security ───────────────────────────────────── */}
          <SettingsSection active={active} id="security" headingId={`${baseId}-security`} title={sections[0].title}>
            <SettingRow
              labelId={rowId("pin")}
              label="PIN"
              description={pinSetAt === undefined
                ? text("Lettura del PIN…", "Reading the PIN…")
                : pinSetAt
                  ? text(`Blocca l'apertura della dashboard su questo dispositivo; non cifra i dati, che restano leggibili con strumenti tecnici da chi usa questo computer. Quello attuale è stato impostato il ${formatDate(pinSetAt, { locale })}.`, `Locks opening the dashboard on this device; it does not encrypt the data, which stays readable with technical tools by anyone using this computer. The current one was set on ${formatDate(pinSetAt, { locale })}.`)
                  : text("Nessun PIN è configurato su questo dispositivo.", "No PIN is configured on this device.")}
            >
              {pinSetAt ? (
                <Button aria-describedby={rowId("pin")} onClick={() => setChangingPin(true)} type="button">
                  <KeyRound aria-hidden="true" size={16} /> {text("Cambia PIN", "Change PIN")}
                </Button>
              ) : null}
            </SettingRow>

            <SettingRow
              labelId={rowId("idle")}
              label={text("Blocco automatico", "Auto-lock")}
              description={text(
                `Dopo ${idleLimit} senza usare la dashboard, si blocca e chiede il PIN. Chiudere la scheda o il browser la blocca sempre.`,
                `After ${idleLimit} without using the dashboard, it locks and asks for the PIN. Closing the tab or the browser always locks it.`,
              )}
              wide
            >
              <Choice
                labelledBy={rowId("idle")}
                name={rowId("idle-choice")}
                onChange={(value) => void chooseIdleLimit(value)}
                options={idleTimeoutChoices.map((choice) => ({ value: choice, label: formatIdleLimit(choice, locale, "short") }))}
                value={idleLimitMs as IdleTimeout}
              />
              {lockError ? <p className="form-error" role="alert">{lockError}</p> : null}
            </SettingRow>

            {lockSession ? (
              <SettingRow
                labelId={rowId("lock")}
                label={text("Blocca ora", "Lock now")}
                description={text("Chiude la sessione subito; per riaprirla serve il PIN.", "Ends the session at once; reopening it takes the PIN.")}
              >
                <Button aria-describedby={rowId("lock")} onClick={lockSession} type="button">
                  <Lock aria-hidden="true" size={16} /> {text("Blocca", "Lock")}
                </Button>
              </SettingRow>
            ) : null}

            <SettingRow
              labelId={rowId("amounts")}
              label={text("Nascondi importi", "Hide amounts")}
              description={text(
                "Sostituisce le cifre con asterischi in ogni vista, grafici e avanzamenti compresi. Vale anche dopo la chiusura.",
                "Replaces figures with asterisks in every view, charts and progress included. It stays on after closing.",
              )}
            >
              <Switch checked={amountsHidden} labelledBy={rowId("amounts")} onChange={toggleAmounts} state={amountsHidden ? text("Nascosti", "Hidden") : text("Visibili", "Visible")} />
            </SettingRow>

            {/* Three terms, not one "private mode": someone showing the
                dashboard may want the sums gone and the names kept, or the
                reverse. Each changes what is drawn and nothing that is kept. */}
            <SettingRow
              labelId={rowId("percentages")}
              label={text("Nascondi percentuali", "Hide percentages")}
              description={text(
                "Maschera quote, variazioni e avanzamenti in percentuale, lasciando visibili gli importi. Vale anche dopo la chiusura.",
                "Masks shares, changes and progress shown as percentages, leaving amounts visible. It stays on after closing.",
              )}
            >
              <Switch
                checked={percentagesHidden}
                labelledBy={rowId("percentages")}
                onChange={() => setPercentagesHidden(!percentagesHidden)}
                state={percentagesHidden ? text("Nascoste", "Hidden") : text("Visibili", "Visible")}
              />
            </SettingRow>

            <SettingRow
              labelId={rowId("account-names")}
              label={text("Nascondi nomi dei conti", "Hide account names")}
              description={text(
                "Sostituisce i nomi che hai dato ai conti con dei punti negli elenchi. Categorie, saldi ed etichette restano leggibili.",
                "Replaces the names you gave your accounts with dots in the lists. Categories, balances and labels stay readable.",
              )}
            >
              <Switch
                checked={accountNamesHidden}
                labelledBy={rowId("account-names")}
                onChange={() => setAccountNamesHidden(!accountNamesHidden)}
                state={accountNamesHidden ? text("Nascosti", "Hidden") : text("Visibili", "Visible")}
              />
            </SettingRow>
          </SettingsSection>

          {/* ── Data ───────────────────────────────────────────────────── */}
          <SettingsSection active={active} id="data" headingId={`${baseId}-data`} title={sections[1].title}>
            <SettingRow
              labelId={rowId("backup")}
              label={text("Backup", "Backup")}
              description={records
                ? text(
                    `Una copia completa in JSON non cifrato: ${count(records.accounts, "conto", "conti")}${records.archived ? ` (${records.archived} archiviati)` : ""}, ${count(records.snapshots, "rilevazione", "rilevazioni")}, ${count(records.paychecks, "stipendio", "stipendi")}, ${count(records.goals, "obiettivo", "obiettivi")} e il conteggio dei contanti. Conservala in un luogo privato.`,
                    `A complete copy in unencrypted JSON: ${count(records.accounts, "account", "accounts")}${records.archived ? ` (${records.archived} archived)` : ""}, ${count(records.snapshots, "snapshot", "snapshots")}, ${count(records.paychecks, "paycheck", "paychecks")}, ${count(records.goals, "goal", "goals")} and the cash count. Keep it somewhere private.`,
                  ) + (health ? ` ${backupStatus(health, text, locale)}` : "")
                : text("Lettura dei dati locali…", "Reading local data…")}
            >
              <Button aria-describedby={rowId("backup")} onClick={onExport} type="button">
                <ArrowDownToLine aria-hidden="true" size={16} /> {text("Esporta backup", "Export backup")}
              </Button>
            </SettingRow>

            <SettingRow
              labelId={rowId("storage")}
              label={text("Archiviazione", "Storage")}
              description={storageDescription(storage.state, text, locale) + (persistAsked?.outcome === "denied" && !(storage.state.status === "known" && storage.state.persisted)
                ? ` ${text(`Richiesta rifiutata dal browser il ${formatDate(persistAsked.at, { locale })}.`, `The browser refused the request on ${formatDate(persistAsked.at, { locale })}.`)}`
                : "")}
            >
              {storage.state.status === "known" && storage.state.persisted === false && typeof navigator.storage?.persist === "function" ? (
                <Button aria-describedby={rowId("storage")} onClick={() => void requestPersistence()} type="button">
                  <HardDrive aria-hidden="true" size={16} /> {text("Rendi persistente", "Make persistent")}
                </Button>
              ) : null}
              {persistNote ? <p className="setting-row__note" role="status">{persistNote}</p> : null}
            </SettingRow>

            <SettingRow
              labelId={rowId("verify")}
              label={text("Verifica un backup", "Check a backup")}
              description={text(
                "Controlla che un file di backup sia completo e ripristinabile, senza importarlo e senza toccare i dati di questo dispositivo.",
                "Checks that a backup file is complete and can be restored, without importing it or touching this device's data.",
              )}
            >
              <Button aria-describedby={rowId("verify")} onClick={() => verifyInputRef.current?.click()} type="button">
                <FileCheck2 aria-hidden="true" size={16} /> {text("Verifica un file…", "Check a file…")}
              </Button>
              <input
                accept="application/json,.json"
                aria-hidden="true"
                aria-label={text("Scegli il backup da verificare", "Choose the backup to check")}
                className="visually-hidden"
                onChange={(event) => void verifyFile(event.target.files?.[0])}
                ref={verifyInputRef}
                tabIndex={-1}
                type="file"
              />
              {verification ? (
                <p className={cx("setting-row__note", !verification.ok && "is-error")} role="status">{verification.message}</p>
              ) : null}
            </SettingRow>

            {example?.canLoad || example?.loaded ? (
              <SettingRow
                labelId={rowId("example")}
                label={text("Archivio di esempio", "Example archive")}
                description={example.loaded
                  ? text(
                      "Stai guardando dati inventati: conti, saldi, stipendi e obiettivo di nessuno. Rimuoverli riporta l'archivio vuoto, comprese le modifiche fatte dopo. PIN e preferenze restano.",
                      "You are looking at invented data: no one's accounts, balances, paychecks or goal. Removing it empties the archive again, changes made since included. The PIN and preferences stay.",
                    )
                  : text(
                      "Per provare IRIS prima di inserire i tuoi dati: carica conti, saldi e stipendi interamente inventati. Si carica solo con l'archivio vuoto e si rimuove da qui.",
                      "To try IRIS before entering your own data: load entirely invented accounts, balances and paychecks. It loads only into an empty archive and is removed from here.",
                    )}
              >
                {example.loaded ? (
                  <Button aria-describedby={rowId("example")} onClick={() => setExampleAction("clear")} type="button" variant="danger">
                    <Trash2 aria-hidden="true" size={16} /> {text("Rimuovi esempio", "Remove example")}
                  </Button>
                ) : (
                  <Button aria-describedby={rowId("example")} onClick={() => setExampleAction("load")} type="button">
                    <FlaskConical aria-hidden="true" size={16} /> {text("Carica esempio", "Load example")}
                  </Button>
                )}
              </SettingRow>
            ) : null}

            {/* Set apart: the one operation here that removes what is stored. */}
            <section aria-labelledby={rowId("restore")} className="settings-consequence">
              <div className="setting-row__text">
                <h3 id={rowId("restore")}>{text("Ripristina da un backup", "Restore from a backup")}</h3>
                <p>{text(
                  "Sostituisce tutti i dati di questo dispositivo con quelli del file. Il file viene verificato prima e i dati attuali vengono cancellati solo dopo la tua conferma. Esporta prima un backup se vuoi poter tornare indietro.",
                  "Replaces all the data on this device with the file's. The file is checked first, and the current data is erased only after you confirm. Export a backup first if you may want to go back.",
                )}</p>
              </div>
              <Button aria-describedby={rowId("restore")} onClick={onImport} type="button" variant="danger">
                <ArrowUpFromLine aria-hidden="true" size={16} /> {text("Scegli un file…", "Choose a file…")}
              </Button>
            </section>
          </SettingsSection>

          {/* ── Experience ─────────────────────────────────────────────── */}
          <SettingsSection active={active} id="experience" headingId={`${baseId}-experience`} title={sections[2].title}>
            {/* Six choices is past what a radio row can hold without wrapping
                into a wall, so this one takes the project's own select — the
                same control the charts use for their range. */}
            <SettingRow
              labelId={rowId("start-page")}
              label={text("Pagina iniziale", "Start page")}
              description={text(
                "La pagina su cui la dashboard si apre su questo dispositivo. Le altre restano raggiungibili come sempre.",
                "The page the dashboard opens on for this device. Every other page stays reachable as always.",
              )}
            >
              <span className="range-select">
                <select
                  aria-labelledby={rowId("start-page")}
                  className="range-select__control"
                  id={rowId("start-page-control")}
                  onChange={(event) => startPage.set(event.target.value as StartPage)}
                  value={openingPage}
                >
                  {startPages.map((page) => (
                    <option key={page} value={page}>{startPageLabels[page]}</option>
                  ))}
                </select>
                <ChevronDown aria-hidden="true" className="range-select__chevron" size={15} strokeWidth={2.25} />
              </span>
            </SettingRow>

            <SettingRow
              labelId={rowId("theme")}
              label={text("Tema", "Theme")}
              description={text(
                "Chiaro, com'è sempre stato, o scuro. Vale per tutta la dashboard e per la schermata di blocco. Si cambia anche dall'icona in alto.",
                "Light, as it has always been, or dark. It applies to the whole dashboard and to the lock screen. It can also be changed from the icon at the top.",
              )}
              wide
            >
              <Choice
                labelledBy={rowId("theme")}
                name={rowId("theme-choice")}
                onChange={(value) => theme.set(value)}
                options={[
                  { value: "light", label: text("Chiaro", "Light") },
                  { value: "dark", label: text("Scuro", "Dark") },
                ]}
                value={currentTheme}
              />
            </SettingRow>

            <SettingRow
              labelId={rowId("font")}
              label={text("Carattere", "Typeface")}
              description={text(
                "Il carattere di tutta l'interfaccia, schermata di blocco compresa. Il logo Iris resta com'è.",
                "The typeface of the whole interface, the lock screen included. The Iris wordmark stays as it is.",
              )}
              wide
            >
              <Choice
                labelledBy={rowId("font")}
                name={rowId("font-choice")}
                onChange={(value) => interfaceFont.set(value)}
                options={[
                  { value: "geist", label: "Geist" },
                  { value: "poppins", label: "Poppins" },
                ]}
                value={currentFont}
              />
            </SettingRow>

            <SettingRow
              labelId={rowId("background")}
              label={text("Sfondo della schermata di blocco", "Lock screen background")}
              description={text(
                `Cosa si vede dietro la finestra del PIN. ${reducedMotion ? "Con «Riduci movimento» attivo nel sistema, il cielo resta comunque fermo." : "Non cambia né il PIN né il blocco."}`,
                `What stands behind the PIN window. ${reducedMotion ? "With the system's Reduce motion on, the sky stays still anyway." : "It changes neither the PIN nor the lock."}`,
              )}
              wide
            >
              <Choice
                labelledBy={rowId("background")}
                name={rowId("background-choice")}
                onChange={(value) => lockBackground.set(value)}
                options={lockBackgrounds.map((value) => ({ value, label: backgroundLabels[value] }))}
                value={background}
              />
            </SettingRow>

            <SettingRow
              labelId={rowId("name")}
              label={text("Nome nel saluto", "Name in the greeting")}
              description={text(`La schermata di blocco ti saluta secondo l'ora, ora «${greeting}». Lascia vuoto per un saluto senza nome.`, `The lock screen greets you by the hour, now “${greeting}”. Leave it empty for a greeting without a name.`)}
            >
              <input
                aria-labelledby={rowId("name")}
                autoComplete="given-name"
                className="setting-input"
                maxLength={displayNameMaxLength}
                onBlur={commitName}
                onChange={(event) => setNameDraft(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter") commitName(); }}
                type="text"
                value={nameDraft ?? name}
              />
            </SettingRow>

            <SettingRow
              labelId={rowId("sounds")}
              label={text("Suoni dell'interfaccia", "Interface sounds")}
              description={text(
                "Sblocco riuscito, PIN rifiutato e un tocco quando premi un controllo col mouse. Ogni suono accompagna qualcosa che si vede anche.",
                "A successful unlock, a refused PIN, and a tap when you press a control with the mouse. Every sound goes with something you can also see.",
              )}
            >
              {/* Silent itself, like the profile's speaker. */}
              <Switch checked={soundsOn} labelledBy={rowId("sounds")} onChange={() => setUISoundsEnabled(!soundsOn)} quiet state={soundsOn ? text("Attivi", "On") : text("Disattivati", "Off")} />
            </SettingRow>

            <SettingRow
              labelId={rowId("motion")}
              label={text("Movimento", "Motion")}
              description={reducedMotion === null
                ? text("Il browser non riporta la preferenza di movimento del sistema.", "The browser does not report the system's motion preference.")
                : reducedMotion
                  ? text("Il sistema chiede di ridurre il movimento: animazioni e cielo restano fermi. Si cambia dalle impostazioni del sistema operativo.", "The system asks for reduced motion: animations and the sky stay still. It is changed in your operating system's settings.")
                  : text("Animazioni complete. Segue «Riduci movimento» del sistema operativo, che si cambia da lì.", "Full animations. It follows your operating system's Reduce motion setting, changed there.")}
            >
              <span className="setting-value">{reducedMotion === null ? text("Non riportato", "Not reported") : reducedMotion ? text("Ridotto", "Reduced") : text("Completo", "Full")}</span>
            </SettingRow>

            <SettingRow
              labelId={rowId("rail")}
              label={text("Barra laterale", "Sidebar")}
              description={text("Estesa con i nomi delle pagine, o compatta con le sole icone. Si cambia anche dal fondo della barra.", "Expanded with page names, or compact with icons only. It can also be changed from the foot of the sidebar.")}
              wide
            >
              <Choice
                labelledBy={rowId("rail")}
                name={rowId("rail-choice")}
                onChange={(value) => sidebarCollapsed.set(value === "compact")}
                options={[
                  { value: "expanded", label: text("Estesa", "Expanded") },
                  { value: "compact", label: text("Compatta", "Compact") },
                ]}
                value={compactRail ? "compact" : "expanded"}
              />
            </SettingRow>
          </SettingsSection>

          {/* ── General ────────────────────────────────────────────────── */}
          <SettingsSection active={active} id="general" headingId={`${baseId}-general`} title={sections[3].title}>
            <SettingRow labelId={rowId("language")} label={text("Lingua", "Language")} description={text("Testi, date e nomi dei mesi.", "Text, dates and month names.")} wide>
              <Choice
                labelledBy={rowId("language")}
                name={rowId("language-choice")}
                onChange={(value) => { if (value !== language) toggleLanguage(); }}
                options={[
                  { value: "it", label: "Italiano", lang: "it" },
                  { value: "en", label: "English", lang: "en" },
                ]}
                value={language}
              />
            </SettingRow>

            <SettingRow
              labelId={rowId("formats")}
              label={text("Formati", "Formats")}
              description={text(
                "Le date seguono la lingua; gli importi usano sempre il formato euro italiano, in ogni lingua.",
                "Dates follow the language; amounts always use the Italian euro format, in every language.",
              )}
            >
              <span className="setting-value">{sampleDate} · {formatCurrency(1234.56)}</span>
            </SettingRow>

            <SettingRow
              labelId={rowId("currency")}
              label={text("Valuta", "Currency")}
              description={text(
                "Ogni saldo è registrato in euro. La dashboard non gestisce altre valute né conversioni.",
                "Every balance is recorded in euro. The dashboard handles no other currency and no conversion.",
              )}
            >
              <span className="setting-value">{text("Euro (€)", "Euro (€)")}</span>
            </SettingRow>
          </SettingsSection>

          {/* ── System ─────────────────────────────────────────────────── */}
          <SettingsSection
            active={active}
            id="system"
            headingId={`${baseId}-system`}
           
            lede={text(
              "Nessun account, nessun cloud, nessuna statistica d'uso: i dati restano in questo browser, non cifrati. Escono solo nei backup che esporti tu, anch'essi non cifrati.",
              "No account, no cloud, no usage analytics: the data stays in this browser, unencrypted. It leaves only in the backups you export, which are unencrypted too.",
            )}
            title={sections[4].title}
          >
            <SettingRow labelId={rowId("version")} label={text("Versione", "Version")} description={text(`Personal Wealth Dashboard, ambiente di ${environment.toLowerCase()}.`, `Personal Wealth Dashboard, ${environment.toLowerCase()} environment.`)}>
              <span className="setting-value">{packageInfo.version}</span>
            </SettingRow>

            <details className="settings-diagnostics">
              <summary>{text("Diagnostica", "Diagnostics")}</summary>
              <dl>
                <div><dt>{text("Ambiente", "Environment")}</dt><dd>{environment}</dd></div>
                <div><dt>{text("Origine", "Origin")}</dt><dd>{typeof window === "undefined" ? "—" : window.location.origin}</dd></div>
                <div><dt>{text("Database", "Database")}</dt><dd>IndexedDB «{wealthDb.name}», schema {wealthDb.verno}</dd></div>
                <div><dt>{text("Formato backup", "Backup format")}</dt><dd>{text("versione", "version")} {backupFormatVersion}</dd></div>
                <div>
                  <dt>{text("Record", "Records")}</dt>
                  <dd>{records
                    ? text(
                        `${records.accounts} conti (${records.archived} archiviati), ${records.snapshots} rilevazioni, ${records.paychecks} stipendi, ${records.goals} obiettivi, ${records.denominations} tagli di contanti`,
                        `${records.accounts} accounts (${records.archived} archived), ${records.snapshots} snapshots, ${records.paychecks} paychecks, ${records.goals} goals, ${records.denominations} cash denominations`,
                      )
                    : "…"}</dd>
                </div>
                <div><dt>{text("Archiviazione", "Storage")}</dt><dd>{storageDiagnostics(storage.state, text, locale)}</dd></div>
                <div><dt>{text("Blocco automatico", "Auto-lock")}</dt><dd>{idleLimit} ({idleLimitMs} ms)</dd></div>
                <div>
                  <dt>{text("Ultima esportazione", "Last export")}</dt>
                  <dd>{lastExport === undefined
                    ? "…"
                    : lastExport === null
                      ? text("mai da questo dispositivo", "never from this device")
                      : formatDate(lastExport, { locale })}</dd>
                </div>
              </dl>

              {/* Counted on this device, in the same table as the rest of the
                  device's own state. Nothing is sent anywhere: there is no
                  request to send it with. */}
              <h4 className="settings-diagnostics__subtitle">{text("Visite per pagina", "Visits per page")}</h4>
              <dl>
                {startPages.map((page) => (
                  <div key={page}>
                    <dt>{startPageLabels[page]}</dt>
                    <dd>{visits === undefined ? "…" : count(visits[page], text("visita", "visit"), text("visite", "visits"))}</dd>
                  </div>
                ))}
              </dl>

              <div className="settings-diagnostics__action">
                <Button
                  disabled={visits === undefined || totalVisits === 0}
                  onClick={() => setResettingVisits(true)}
                  variant="ghost"
                >
                  {text("Azzera statistiche di utilizzo", "Reset usage statistics")}
                </Button>
                <p>{text(
                  "Azzera solo questi contatori. Conti, saldi, rilevazioni, stipendi, obiettivi e preferenze restano come sono.",
                  "Clears these counters only. Accounts, balances, snapshots, paychecks, goals and preferences are left as they are.",
                )}</p>
              </div>
            </details>
          </SettingsSection>
        </SettingsPane>
      </div>

      {resettingVisits ? (
        <ConfirmDialog
          confirmFocusId={rowId("start-page-control")}
          confirmLabel={text("Azzera statistiche", "Reset statistics")}
          description={text(
            "I contatori delle visite tornano a zero su questo dispositivo. Nessun conto, saldo, rilevazione, stipendio, obiettivo o preferenza viene toccato. Non si può annullare.",
            "The visit counters go back to zero on this device. No account, balance, snapshot, paycheck, goal or preference is touched. This cannot be undone.",
          )}
          onConfirm={async () => {
            await resetPageVisits();
            onNotify(text("Statistiche di utilizzo azzerate.", "Usage statistics cleared."));
          }}
          onOpenChange={(open) => { if (!open) setResettingVisits(false); }}
          open
          title={text("Azzerare le statistiche di utilizzo?", "Reset usage statistics?")}
        />
      ) : null}

      {exampleAction === "load" ? (
        <ConfirmDialog
          confirmLabel={text("Carica esempio", "Load example")}
          description={text(
            "Nell'archivio vuoto entrano sette conti, un aggiornamento, otto stipendi e un obiettivo, tutti inventati. Potrai rimuoverli da qui in qualsiasi momento.",
            "Seven accounts, one update, eight paychecks and a goal, all invented, go into the empty archive. You can remove them from here at any time.",
          )}
          onConfirm={async () => {
            await loadDemoData();
            onNotify(text("Archivio di esempio caricato: i dati sono inventati.", "Example archive loaded: the data is invented."));
          }}
          onOpenChange={(open) => { if (!open) setExampleAction(null); }}
          open
          title={text("Caricare l'archivio di esempio?", "Load the example archive?")}
          tone="primary"
        />
      ) : null}

      {exampleAction === "clear" ? (
        <ConfirmDialog
          confirmLabel={text("Rimuovi esempio", "Remove example")}
          description={text(
            "Conti, aggiornamenti, stipendi e obiettivo spariscono, compreso ciò che hai aggiunto o cambiato dopo aver caricato l'esempio. Resta il solo conto Contanti a zero. PIN, blocco automatico e preferenze non cambiano. Non si può annullare.",
            "Accounts, updates, paychecks and the goal go, including whatever you added or changed after loading the example. Only the Cash account remains, at zero. The PIN, auto-lock and preferences do not change. This cannot be undone.",
          )}
          onConfirm={async () => {
            await clearDemoData();
            onNotify(text("Archivio di esempio rimosso: l'archivio è vuoto.", "Example archive removed: the archive is empty."));
          }}
          onOpenChange={(open) => { if (!open) setExampleAction(null); }}
          open
          title={text("Rimuovere l'archivio di esempio?", "Remove the example archive?")}
        />
      ) : null}

      {changingPin ? (
        <ChangePinDialog
          onChange={async (current, next) => {
            const changed = await changePin(current, next);
            if (changed) {
              onNotify(text("PIN cambiato. Da ora serve il nuovo PIN per sbloccare.", "PIN changed. The new PIN now unlocks the dashboard."));
            }
            return changed;
          }}
          onOpenChange={setChangingPin}
          open
        />
      ) : null}
    </div>
  );
}

function formatBytes(bytes: number, locale: string): string {
  const units = ["byte", "kilobyte", "megabyte", "gigabyte"] as const;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return new Intl.NumberFormat(locale, { style: "unit", unit: units[unit], unitDisplay: "short", maximumFractionDigits: 1 }).format(value);
}

type Text = (italian: string, english: string) => string;

/** Where the last backup stands against the data stored now. */
function backupStatus(health: { lastExportAt: string | null; upToDate: boolean }, text: Text, locale: string): string {
  if (!health.lastExportAt) {
    return health.upToDate
      ? text("Nessun backup esportato da qui; i dati attuali vengono da un backup ripristinato.", "No backup exported from here; the current data comes from a restored backup.")
      : text("Nessun backup esportato da questo dispositivo.", "No backup exported from this device yet.");
  }
  const when = formatDate(health.lastExportAt, { locale });
  return health.upToDate
    ? text(`Ultimo backup: ${when}, con i dati attuali.`, `Last backup: ${when}, with the current data.`)
    : text(`Ultimo backup: ${when}; da allora i dati sono cambiati.`, `Last backup: ${when}; the data has changed since.`)
}

function storageDescription(state: StorageState, text: Text, locale: string): string {
  const where = text("I dati vivono solo in questo browser (IndexedDB).", "The data lives only in this browser (IndexedDB).");
  if (state.status === "reading") return `${where} ${text("Lettura dello stato…", "Reading its state…")}`;
  if (state.status === "unavailable" || state.persisted === null) {
    return `${where} ${text("Il browser non riporta se l'archiviazione è persistente.", "The browser does not report whether storage is persistent.")}`;
  }
  const used = state.usage !== null ? ` ${text(`Occupa ${formatBytes(state.usage, locale)}.`, `It takes ${formatBytes(state.usage, locale)}.`)}` : "";
  return state.persisted
    ? `${where} ${text("Archiviazione persistente: il browser non la cancella per fare spazio. Non la protegge però da una cancellazione dei dati del sito, da un reset del browser o dalla perdita del dispositivo: per quello serve il backup.", "Persistent storage: the browser will not clear it to free space. It does not protect it from the site's data being cleared, a browser reset or a lost device: that is what the backup is for.")}${used}`
    : `${where} ${text("Non persistente: se lo spazio scarseggia, il browser potrebbe cancellarla. Un backup recente la protegge.", "Not persistent: if space runs low, the browser may clear it. A recent backup protects it.")}${used}`;
}

function storageDiagnostics(state: StorageState, text: Text, locale: string): string {
  if (state.status === "reading") return "…";
  if (state.status === "unavailable") return text("non riportata dal browser", "not reported by the browser");
  const persisted = state.persisted === null ? text("persistenza non riportata", "persistence not reported") : state.persisted ? text("persistente", "persistent") : text("non persistente", "not persistent");
  const usage = state.usage !== null && state.quota !== null ? `, ${formatBytes(state.usage, locale)} / ${formatBytes(state.quota, locale)}` : "";
  return `${persisted}${usage}`;
}

/* ── Structure ─────────────────────────────────────────────────────────── */

/*
 * One group. Only the group being read is mounted: the others are not hidden
 * but absent, so nothing off-screen is reachable by Tab, announced by a
 * screen reader, or found by the browser's own find-in-page in a place the
 * reader cannot see.
 */
function SettingsSection({ id, active, headingId, title, lede, children }: {
  id: SectionId;
  active: SectionId;
  headingId: string;
  title: string;
  lede?: string;
  children: ReactNode;
}) {
  if (id !== active) return null;
  return (
    <section aria-labelledby={headingId} className="settings-section" data-section={id}>
      {/* The index already names the group on screen and says what is in force
          in it, so repeating either here would only say it twice. The name
          stays in the page all the same: it is this section's accessible
          name, the rung between the view's title and the terms below it for
          anyone moving by heading, and where focus lands when a group is
          chosen from the index. */}
      <h2 className="visually-hidden" id={headingId} tabIndex={-1}>{title}</h2>
      {lede ? (
        <header className="settings-section__header">
          <p>{lede}</p>
        </header>
      ) : null}
      <div className="settings-section__rows">{children}</div>
    </section>
  );
}

/** One term: its name and what is true now on the left, its control on the right. */
function SettingRow({ labelId, label, description, children, wide = false }: {
  labelId: string;
  label: string;
  description: ReactNode;
  children?: ReactNode;
  /** A control with several choices takes the row's full width on narrow screens. */
  wide?: boolean;
}) {
  return (
    <div className={cx("setting-row", wide && "setting-row--wide")}>
      <div className="setting-row__text">
        <h3 id={labelId}>{label}</h3>
        <p>{description}</p>
      </div>
      {children ? <div className="setting-row__control">{children}</div> : null}
    </div>
  );
}

/**
 * One choice among a few, all visible: native radios, so arrow keys move the
 * choice and the group has one tab stop. It shows the value in force.
 */
function Choice<T extends string | number>({ labelledBy, name, value, options, onChange }: {
  labelledBy: string;
  name: string;
  value: T;
  options: Array<{ value: T; label: string; lang?: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div aria-labelledby={labelledBy} className="setting-choice" role="radiogroup">
      {options.map((option) => (
        <label key={String(option.value)} lang={option.lang}>
          <input checked={option.value === value} name={name} onChange={() => onChange(option.value)} type="radio" value={String(option.value)} />
          <span>{option.label}</span>
        </label>
      ))}
    </div>
  );
}

/** A genuinely binary term: the app's switch, with its state also in words. */
function Switch({ checked, labelledBy, onChange, state, quiet = false }: {
  checked: boolean;
  labelledBy: string;
  onChange: () => void;
  state: string;
  /** Makes no interface sound of its own (the sounds switch). */
  quiet?: boolean;
}) {
  return (
    <span className="setting-switch">
      <span aria-hidden="true" className="setting-switch__state">{state}</span>
      <label className="toggle-control" data-ui-sound={quiet ? "off" : undefined}>
        <input aria-labelledby={labelledBy} checked={checked} onChange={onChange} role="switch" type="checkbox" />
        <span aria-hidden="true" />
      </label>
    </span>
  );
}
