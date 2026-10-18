"use client";

import { startTransition, useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  ArrowLeftRight,
  ArrowDownToLine,
  ArrowUpFromLine,
  Banknote,
  ChartCandlestick,
  ChartNoAxesCombined,
  ChartSpline,
  Compass,
  Eye,
  EyeOff,
  Goal,
  FlaskConical,
  Languages,
  Lock,
  PanelLeftClose,
  PanelLeftOpen,
  Pen,
  PencilLine,
  Plus,
  Route,
  RefreshCw,
  Settings,
  WalletCards,
} from "lucide-react";

import { createBackup, recordBackupExport, replaceDatabaseFromBackup } from "@/data/backup";
import type { TrackedPage } from "@/data/page-visits";
import {
  createAccount,
  createGoal,
  deleteGoal,
  createPaycheck,
  deleteAccount,
  deletePaycheck,
  deleteSnapshot,
  hasDemoData,
  initializeDatabase,
  saveBalanceSnapshot,
  setCashDenominations,
  updateAccount,
  updateGoal,
  updatePaycheck,
  wealthDb,
} from "@/data/repository";
import { calculateTotalWealth } from "@/domain/calculations";
import { parseWealthBackup } from "@/domain/schemas";
import { accountCategories, type Account, type Paycheck, type WealthGoal } from "@/domain/types";
import { useSessionLock } from "@/features/auth/LoginGate";
import { AmbientBackground } from "@/features/ambient/AmbientBackground";
import { BackupGuard } from "@/features/backup/BackupGuard";
import { isBeta } from "@/features/beta/beta";
import { LanguageProvider, LanguageToggle, useLanguage } from "@/features/i18n/language";
import { settleOnboarding, shouldStartOnboarding, type TourOutcome } from "@/features/onboarding/onboarding";
import { OnboardingTour } from "@/features/onboarding/OnboardingTour";
import type { TourView } from "@/features/onboarding/steps";
import { onboarding, pageTransition, sidebarCollapsed, startPage } from "@/features/settings/preferences";
import { SettingsView } from "@/features/settings/SettingsView";
import { ThemeToggle } from "@/features/settings/ThemeToggle";
import { useClickSounds } from "@/features/sound/click-sounds";
import { SoundToggle } from "@/features/sound/SoundToggle";
import { requestSetting } from "@/features/settings/setting-link";
import { WhatsNew } from "@/features/whats-new/WhatsNew";

import { AccountsView } from "./AccountsView";
import { CashFlowView } from "./CashFlowView";
import { CommandSearch, type CommandItem } from "./CommandSearch";
import { EntranceShell, useEntranceRunning } from "./entrance";
import { usePageTransition } from "./page-transition";
import { useHoverFill } from "./hover-fill";
import {
  AccountDetailDialog,
  AccountFormDialog,
  CashCounterDialog,
  ConfirmDialog,
  GoalDialog,
  PaycheckFormDialog,
  UpdateBalancesDialog,
  buildAccountDraft,
  type AccountFormValue,
  type PaycheckFormValue,
} from "./Dialogs";
import { GoalsView } from "./GoalsView";
import { InvestmentsView } from "./InvestmentsView";
import { OverviewView } from "./OverviewView";
import { ProgressView } from "./ProgressView";
import { ScenarioView } from "./ScenarioView";
import { TradingView } from "./TradingView";
import { ProfileMenu } from "./ProfileMenu";
import { PrivacyProvider, PrivacyToggle, usePrivacy } from "./privacy";
import { usePageVisitCounter } from "./visit-counter";
import {
  AccountMark,
  accountDialogFocusId,
  BackControl,
  categoryDetailFocusId,
  ErrorState,
  LoadingState,
  MotionScope,
  globalDialogFocusFallbackId,
  cx,
  formatDate,
  paycheckRowFocusId,
} from "./ui";

type View = "overview" | "progress" | "accounts" | "cash-flow" | "investments" | "trading" | "goals" | "scenario" | "settings";

/*
 * Child views and the view each belongs to. A child is opened from its
 * parent, not from the sidebar; only views listed here get a back control,
 * and it always returns to this parent, never to browser history.
 */
const parentView: Partial<Record<View, "overview">> = {
  investments: "overview",
  trading: "overview",
};

// The rail's views are exactly the pages whose visits are counted (data/page-visits.ts).
const navigation: Array<{ id: TrackedPage; italian: string; english: string; icon: typeof ChartNoAxesCombined }> = [
  { id: "overview", italian: "Panoramica", english: "Overview", icon: ChartNoAxesCombined },
  { id: "accounts", italian: "Conti", english: "Accounts", icon: WalletCards },
  { id: "cash-flow", italian: "Flussi di cassa", english: "Cash Flow", icon: ArrowLeftRight },
  { id: "progress", italian: "Andamento", english: "Trend", icon: Route },
  { id: "goals", italian: "Obiettivi", english: "Goals", icon: Goal },
  { id: "scenario", italian: "Proiezioni", english: "Projections", icon: FlaskConical },
];

/* Settings is a full view, reached from the top bar's gear (owner, 15 Sep
   2026), the profile panel and search; the rail keeps the financial views. */
const settingsDestination = { id: "settings" as const, italian: "Impostazioni", english: "Settings", icon: Settings };

// The gear: where focus returns when Settings is left through its back control.
const settingsTriggerId = "rail-settings";

// The child views, marked as on the Overview cards that open them.
const childViews = ["investments", "trading"] as const;
const childViewIcons: Record<(typeof childViews)[number], typeof ChartNoAxesCombined> = {
  investments: ChartSpline,
  trading: ChartCandlestick,
};

export function WealthDashboard() {
  return <LanguageProvider><WealthDashboardContent /></LanguageProvider>;
}

/*
 * The rail: brand, the root views, the fold control, the local-only note.
 * The fold is a device preference (settings/preferences.ts), shared with
 * Settings; only the rail subscribes to it, so folding re-renders the rail
 * alone and the page beside it follows through CSS
 * (.app-shell:has(> .sidebar--collapsed)).
 */
function Sidebar({ view, onNavigate, onOpenSettings }: { view: View; onNavigate: (view: View) => void; onOpenSettings: () => void }) {
  const { text } = useLanguage();
  const collapsed = sidebarCollapsed.use();
  const toggleLabel = collapsed
    ? text("Espandi barra laterale", "Expand sidebar")
    : text("Riduci barra laterale", "Collapse sidebar");
  const settingsLabel = text(settingsDestination.italian, settingsDestination.english);

  const toggle = () => sidebarCollapsed.set(!collapsed);

  /*
   * THE CURRENT PILL IS ONE OBJECT (owner, 12 Oct 2026, from Trading OS's
   * top bar). The white pill behind the current view is a single element
   * that lives as long as the rail; choosing a view only changes its target,
   * measured from that view's item, and the CSS transition carries it there
   * from wherever it is — a second click mid-flight sends it straight on.
   * Folding the rail, fonts arriving or the phone's bottom bar move the
   * items: it follows them. With no root view current (a child view,
   * Settings) it is not drawn. Before the first measure the current item
   * paints its own pill (CSS, nav:not([data-measured])).
   */
  const navRef = useRef<HTMLElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);
  const [pill, setPill] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  // The first placement is not animated: the pill starts where it belongs.
  const [pillReady, setPillReady] = useState(false);

  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const measure = () => {
      const item = nav.querySelector<HTMLElement>(".nav-item.is-active");
      setPill(item ? { x: item.offsetLeft, y: item.offsetTop, width: item.offsetWidth, height: item.offsetHeight } : null);
    };
    measure();
    const frame = requestAnimationFrame(() => setPillReady(true));
    /* The items change size while the rail folds, every frame for a third of
       a second. The pill follows them 1:1 — written straight to its style,
       its transition off, no render — rather than chasing each new size on
       its 150ms curve, which left it trailing (owner: "it lags, above all
       when the rail folds"). The transition is back once they stop. */
    let settle: number | undefined;
    const follow = () => {
      const travelling = pillRef.current;
      const item = nav.querySelector<HTMLElement>(".nav-item.is-active");
      if (!travelling || !item) return;
      travelling.dataset.tracking = "";
      travelling.style.transform = `translate(${item.offsetLeft}px, ${item.offsetTop}px)`;
      travelling.style.width = `${item.offsetWidth}px`;
      travelling.style.height = `${item.offsetHeight}px`;
      window.clearTimeout(settle);
      settle = window.setTimeout(() => { delete travelling.dataset.tracking; }, 120);
    };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(follow);
    nav.querySelectorAll(".nav-item").forEach((item) => observer?.observe(item));
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(settle);
      observer?.disconnect();
    };
  }, [view]);

  /*
   * No lag between the click and the pill (owner, 12 Oct 2026): drawing the
   * new page takes a long task (~60ms), and a pill that waited for it froze
   * first and moved after. So the pill is sent on at once, written straight
   * to its style (the render that follows writes the same numbers), and the
   * view changes in a transition, which React renders in slices that leave
   * the browser its frames: the pill travels while the page is drawn.
   */
  const go = (id: View, item: HTMLElement) => {
    const travelling = pillRef.current;
    if (travelling && pillReady) {
      travelling.style.transform = `translate(${item.offsetLeft}px, ${item.offsetTop}px)`;
      travelling.style.width = `${item.offsetWidth}px`;
      travelling.style.height = `${item.offsetHeight}px`;
    }
    startTransition(() => onNavigate(id));
  };

  return (
    <aside className={cx("sidebar", collapsed && "sidebar--collapsed")}>
      <div className="brand">
        {/* The product's name as its wordmark, alone: the "PW" mark was
            removed (owner, 27 Sep 2026). */}
        <span className="brand__wordmark">Iris</span>
      </div>

      <nav aria-label={text("Navigazione principale", "Primary navigation")} data-measured={pill ? "" : undefined} ref={navRef}>
        {pill ? (
          <span
            aria-hidden="true"
            className="nav-pill"
            data-ready={pillReady ? "true" : undefined}
            ref={pillRef}
            style={{ height: pill.height, transform: `translate(${pill.x}px, ${pill.y}px)`, width: pill.width }}
          />
        ) : null}
        {navigation.map((item) => {
          const Icon = item.icon;
          const label = text(item.italian, item.english);
          return (
            <button
              aria-current={view === item.id ? "page" : undefined}
              className={cx("nav-item", view === item.id && "is-active")}
              data-tour={`nav-${item.id}`}
              key={item.id}
              onClick={(event) => go(item.id, event.currentTarget)}
              // Folded, the name shows on hover; it stays the button's name throughout.
              title={collapsed ? label : undefined}
              type="button"
            >
              <Icon aria-hidden="true" size={17} />
              <span>{label}</span>
            </button>
          );
        })}
      </nav>

      {/* Folds the rail to its icons and back. Its name is the action it
          offers now, so it carries no expanded state (like the privacy eye). */}
      <button
        className="nav-item sidebar__toggle"
        onClick={toggle}
        title={collapsed ? toggleLabel : undefined}
        type="button"
      >
        {collapsed ? <PanelLeftOpen aria-hidden="true" size={17} /> : <PanelLeftClose aria-hidden="true" size={17} />}
        <span>{toggleLabel}</span>
      </button>

      {/* Settings at the foot of the rail, where the "Solo locale" note was;
          the bar no longer carries the gear (owner, 18 Oct 2026). Current, it
          is a white pill of its own: the travelling pill stays in the nav. */}
      <button
        aria-current={view === "settings" ? "page" : undefined}
        className={cx("nav-item sidebar__settings", view === "settings" && "is-active")}
        data-tour="settings"
        id={settingsTriggerId}
        onClick={onOpenSettings}
        title={collapsed ? settingsLabel : undefined}
        type="button"
      >
        <Settings aria-hidden="true" size={17} />
        <span>{settingsLabel}</span>
      </button>
    </aside>
  );
}

/* The privacy state lives inside PrivacyProvider, so its action joins the list here. */
function DashboardSearch({ items, shortcutEnabled }: { items: CommandItem[]; shortcutEnabled: boolean }) {
  const { amountsHidden, toggleAmounts } = usePrivacy();
  const { text } = useLanguage();
  const privacy: CommandItem = {
    id: "action-privacy",
    group: "actions",
    label: amountsHidden ? text("Mostra importi", "Show amounts") : text("Nascondi importi", "Hide amounts"),
    icon: amountsHidden ? <Eye size={16} /> : <EyeOff size={16} />,
    run: toggleAmounts,
  };
  return <CommandSearch items={[...items, privacy]} shortcutEnabled={shortcutEnabled} />;
}

/*
 * The tour opens by itself once, on a device whose first PIN was just
 * created (onboarding.ts), and only when the page is ready for it: the data
 * read, the arrival choreography over, no window open. It is rendered inside
 * the shell, where the choreography's state can be read.
 */
const tourStartDelayMs = 400;

function OnboardingAutoStart({ blocked, onStart }: { blocked: boolean; onStart: () => void }) {
  const record = onboarding.use();
  const entranceRunning = useEntranceRunning();
  const due = shouldStartOnboarding(record) && !entranceRunning && !blocked;
  const start = useEffectEvent(onStart);
  useEffect(() => {
    if (!due) return;
    const timer = window.setTimeout(() => start(), tourStartDelayMs);
    return () => window.clearTimeout(timer);
  }, [due]);
  return null;
}

/** Where the page stood when the tour began: it is put back exactly there when the tour ends. */
type TourRun = {
  key: number;
  origin: { view: View; settingsOrigin: { view: View; scrollY: number } | null; scrollY: number; focusId: string };
};

function WealthDashboardContent() {
  const { categoryLabel, language, locale, text, toggleLanguage } = useLanguage();
  const lockSession = useSessionLock();
  // Every control pressed with the mouse taps, while the dashboard is open.
  useClickSounds();
  // Rows and cards fill from where the pointer comes in (hover-fill.ts).
  useHoverFill();
  /*
   * The page this device opens on (Settings > Experience). Read once, on the
   * first render, as the initial value of the view the dashboard already
   * routes by — it is a starting point, not a redirect, so nothing can bounce
   * between two views and every other way into a page still works. An unset
   * or unrecognised preference reads as "overview", the behaviour every
   * device had before the preference existed.
   */
  const [view, setView] = useState<View>(() => startPage.get());
  /** Whether the Overview is being arranged. The way in is the bar's control. */
  const [overviewEditing, setOverviewEditing] = useState(false);
  const [initializationError, setInitializationError] = useState<string | null>(null);
  const [initializationAttempt, setInitializationAttempt] = useState(0);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [accountForm, setAccountForm] = useState<Account | "new" | null>(null);
  const [accountDetail, setAccountDetail] = useState<Account | null>(null);
  const [accountDelete, setAccountDelete] = useState<Account | null>(null);
  const [cashOpen, setCashOpen] = useState(false);
  const [paycheckForm, setPaycheckForm] = useState<Paycheck | "new" | null>(null);
  const [paycheckDelete, setPaycheckDelete] = useState<Paycheck | null>(null);
  // The goal being edited, "new" while one is created, null when closed.
  const [goalForm, setGoalForm] = useState<WealthGoal | "new" | null>(null);
  const [goalDelete, setGoalDelete] = useState<WealthGoal | null>(null);
  const [importPayload, setImportPayload] = useState<string | null>(null);
  const [tour, setTour] = useState<TourRun | null>(null);
  // The page the content shows: it trails `view` while the old page leaves,
  // in the change chosen in Settings (page-transition.tsx). The tour, which
  // measures the page as it goes, keeps the plain change.
  const chosenPageTransition = pageTransition.use();
  const { contentView, contentRef, mode: pageTransitionMode } = usePageTransition(view, chosenPageTransition, tour === null);
  const [notice, setNotice] = useState<string | null>(null);
  // The toast keeps its last message while it closes, so it never fades out empty.
  const [toastText, setToastText] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Where the Overview stood when a child view was opened from it, so the back
  // control can return to exactly that place. In-app state, not browser history.
  const overviewReturnRef = useRef<{ child: View; scrollY: number } | null>(null);
  // The view Settings was opened from, and where it stood: Settings' back
  // control names it, so it is state, not a ref.
  const [settingsOrigin, setSettingsOrigin] = useState<{ view: View; scrollY: number } | null>(null);
  // A scroll position (and focus) to apply once the next view has rendered.
  const pendingViewRestoreRef = useRef<{ scrollY: number; focusId?: string } | null>(null);

  // Runs after the new view is in the DOM and before it is painted, so the page
  // never shows a frame at the wrong position. Focus is moved without scrolling,
  // so it cannot disturb the position just restored. Only child-view entries and
  // the back control set a pending restore; root navigation is left as it was.
  useLayoutEffect(() => {
    const pending = pendingViewRestoreRef.current;
    if (!pending) {
      return;
    }
    pendingViewRestoreRef.current = null;
    window.scrollTo({ top: pending.scrollY, left: 0, behavior: "instant" });
    if (pending.focusId) {
      document.getElementById(pending.focusId)?.focus({ preventScroll: true });
    }
  }, [contentView]);

  useEffect(() => {
    let active = true;
    void initializeDatabase()
      .catch((reason: unknown) => {
        if (active) {
          setInitializationError(reason instanceof Error ? reason.message : language === "it" ? "Impossibile inizializzare IndexedDB." : "IndexedDB could not be initialized.");
        }
      });
    return () => { active = false; };
  }, [initializationAttempt, language]);

  const liveData = useLiveQuery(async () => {
    const [allAccounts, snapshots, cashDenominations, paychecks, goals] = await Promise.all([
      wealthDb.accounts.toArray(),
      wealthDb.snapshots.toArray(),
      wealthDb.cashDenominations.orderBy("denomination").toArray(),
      wealthDb.paychecks.orderBy("paymentDate").toArray(),
      wealthDb.goals.toArray(),
    ]);
    return {
      accounts: allAccounts.filter((account) => !account.archivedAt),
      snapshots: snapshots.sort(
        (first, second) => new Date(first.createdAt).getTime() - new Date(second.createdAt).getTime(),
      ),
      cashDenominations,
      paychecks,
      goals,
    };
  }, []);

  // The example archive is marked in the bar for as long as it is loaded:
  // invented figures must never pass for the owner's.
  const exampleArchive = useLiveQuery(() => hasDemoData(), [], false);

  // One visit per entry into a page, counted once the ledger is on screen.
  usePageVisitCounter(view, liveData !== undefined && initializationError === null);

  if (initializationError) {
    return <ErrorState message={initializationError} onRetry={() => {
      setInitializationError(null);
      setInitializationAttempt((attempt) => attempt + 1);
    }} />;
  }

  if (!liveData) {
    return <LoadingState />;
  }

  const { accounts, snapshots, cashDenominations, paychecks, goals } = liveData;
  const totalWealth = calculateTotalWealth(accounts);
  // The main goal first (the one the other pages follow), then the others in
  // the order they were created.
  const orderedGoals = [...goals].sort((first, second) => (
    first.id === "wealth-goal" ? -1 : second.id === "wealth-goal" ? 1 : first.id.localeCompare(second.id)
  ));
  const goal = orderedGoals[0];
  // Investments and Trading are reached from the Overview category cards, not
  // from the sidebar, so they take their section name from the category label.
  const viewLabel = (target: View) => {
    const section = [...navigation, settingsDestination].find((item) => item.id === target);
    return section
      ? text(section.italian, section.english)
      : categoryLabel(target === "trading" ? "trading" : "investments");
  };
  const sectionLabel = viewLabel(view);

  // A child view remembers where its parent stood when opened from it, and
  // opens at its top; a root view is simply shown, as from the sidebar.
  // Settings, open from anywhere, remembers the view it was opened from.
  const openView = (target: View) => {
    const targetParent = parentView[target];
    if (targetParent) {
      overviewReturnRef.current = view === targetParent ? { child: target, scrollY: window.scrollY } : null;
      pendingViewRestoreRef.current = { scrollY: 0 };
    }
    if (target === "settings" && view !== "settings") {
      setSettingsOrigin({ view, scrollY: window.scrollY });
    }
    setView(target);
  };

  const parent = parentView[view];
  const parentSection = parent ? navigation.find((item) => item.id === parent) : undefined;
  const backControl = parent && parentSection ? (
    <BackControl
      onBack={() => {
        const origin = overviewReturnRef.current;
        overviewReturnRef.current = null;
        // Back to where the Overview was left; the child unmounts with the
        // focused control, so focus goes to the card that opened it.
        pendingViewRestoreRef.current = {
          scrollY: origin?.child === view ? origin.scrollY : 0,
          focusId: view === "investments" || view === "trading" ? categoryDetailFocusId(view) : undefined,
        };
        setView(parent);
      }}
      parentLabel={text(parentSection.italian, parentSection.english)}
    />
  ) : null;

  // Settings has no parent of its own: its back control returns to the view
  // it was opened from, where that view stood (the Overview if none), and
  // focus goes to the gear, which stays in the bar. In-app, never history.
  const settingsBack = (
    <BackControl
      onBack={() => {
        pendingViewRestoreRef.current = { scrollY: settingsOrigin?.scrollY ?? 0, focusId: settingsTriggerId };
        setSettingsOrigin(null);
        setView(settingsOrigin?.view ?? "overview");
      }}
      parentLabel={viewLabel(settingsOrigin?.view ?? "overview")}
    />
  );

  /*
   * The guided tour. It starts from wherever the owner is — by itself after a
   * first run, from Settings or from search — and moves through the views
   * with the dashboard's own navigation: the rail's for the root views,
   * openView for Settings. When it ends, however it ends, the page is put
   * back as it was: the view, Settings' way back, the scroll, the focus.
   */
  const startTour = (focusId: string = globalDialogFocusFallbackId) => {
    setOverviewEditing(false);
    setTour({ key: Date.now(), origin: { view, settingsOrigin, scrollY: window.scrollY, focusId } });
  };

  const tourNavigate = (target: TourView) => {
    if (target === "settings") openView("settings");
    else setView(target);
  };

  const endTour = (outcome: TourOutcome) => {
    settleOnboarding(outcome);
    const origin = tour?.origin;
    setTour(null);
    if (!origin) return;
    setSettingsOrigin(origin.settingsOrigin);
    if (origin.view !== view) {
      pendingViewRestoreRef.current = { scrollY: origin.scrollY, focusId: origin.focusId };
      setView(origin.view);
      return;
    }
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: origin.scrollY, left: 0, behavior: "instant" });
      document.getElementById(origin.focusId)?.focus({ preventScroll: true });
    });
  };

  const notify = (message: string) => {
    setNotice(message);
    setToastText(message);
    window.setTimeout(() => {
      setNotice(null);
      // Cleared once the close transition (--toast-close) has run.
      window.setTimeout(() => setToastText((current) => (current === message ? "" : current)), 400);
    }, 3600);
  };

  const handleExport = async () => {
    try {
      const serialized = await createBackup();
      const blob = new Blob([serialized], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `wealth-backup-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      // Recorded after the file has been handed over, and never allowed to
      // fail the export: the date is a diagnostic, the backup is the point.
      void recordBackupExport().catch(() => undefined);
      notify(text("Backup esportato come JSON. Conservalo in un luogo privato.", "Backup exported as plain JSON. Store it somewhere private."));
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : text("Esportazione non riuscita.", "Export failed."));
    }
  };

  const handleFile = async (file?: File) => {
    if (!file) {
      return;
    }
    try {
      const serialized = await file.text();
      parseWealthBackup(serialized);
      setImportPayload(serialized);
    } catch (reason) {
      notify(reason instanceof Error ? text(`Importazione rifiutata: ${reason.message}`, `Import rejected: ${reason.message}`) : text("Importazione rifiutata.", "Import rejected."));
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  /*
   * What the top-bar search can reach: the views in sidebar order, each child
   * right after its parent; the active accounts by category, as in the
   * ledger; and the actions the dashboard's own buttons run.
   */
  const viewItem = (id: View, label: string, Icon: typeof ChartNoAxesCombined, parentLabel?: string): CommandItem => ({
    id: `view-${id}`,
    group: "views",
    label,
    context: view === id ? text("Vista attuale", "Current view") : parentLabel ? text(`in ${parentLabel}`, `in ${parentLabel}`) : undefined,
    icon: <Icon size={16} />,
    run: () => openView(id),
  });
  const searchItems: CommandItem[] = [
    ...navigation.flatMap((item) => {
      const label = text(item.italian, item.english);
      const children = childViews.filter((child) => parentView[child] === item.id);
      return [
        viewItem(item.id, label, item.icon),
        ...children.map((child) => viewItem(child, categoryLabel(child), childViewIcons[child], label)),
      ];
    }),
    viewItem(settingsDestination.id, text(settingsDestination.italian, settingsDestination.english), settingsDestination.icon),
    ...[...accounts]
      .sort((first, second) => accountCategories.indexOf(first.category) - accountCategories.indexOf(second.category) || first.name.localeCompare(second.name, locale))
      .map((account): CommandItem => ({
        id: `account-${account.id}`,
        group: "accounts",
        label: account.name,
        context: categoryLabel(account.category),
        icon: <AccountMark account={account} />,
        run: () => setAccountDetail(account),
      })),
    { id: "action-update-balances", group: "actions", label: text("Aggiorna saldi", "Update balances"), icon: <RefreshCw size={16} />, run: () => setUpdateOpen(true) },
    { id: "action-add-account", group: "actions", label: text("Aggiungi conto", "Add account"), icon: <Plus size={16} />, run: () => setAccountForm("new") },
    { id: "action-cash-counter", group: "actions", label: text("Conta contanti", "Cash Counter"), icon: <Banknote size={16} />, run: () => setCashOpen(true) },
    { id: "action-add-paycheck", group: "actions", label: text("Aggiungi stipendio", "Add paycheck"), icon: <Plus size={16} />, run: () => setPaycheckForm("new") },
    {
      id: "action-goal",
      group: "actions",
      label: goal ? text("Modifica obiettivo", "Edit goal") : text("Aggiungi obiettivo", "Add goal"),
      icon: goal ? <PencilLine size={16} /> : <Plus size={16} />,
      run: () => setGoalForm(goal ?? "new"),
    },
    { id: "action-export", group: "actions", label: text("Esporta dati", "Export data"), icon: <ArrowDownToLine size={16} />, run: () => void handleExport() },
    { id: "action-import", group: "actions", label: text("Importa dati", "Import data"), icon: <ArrowUpFromLine size={16} />, run: () => fileInputRef.current?.click() },
    { id: "action-language", group: "actions", label: text("Passa all'inglese", "Switch to Italian"), icon: <Languages size={16} />, run: toggleLanguage },
    { id: "action-tour", group: "actions", label: text("Ripeti tutorial", "Take the tour again"), icon: <Compass size={16} />, run: () => startTour() },
    ...(lockSession ? [{ id: "action-lock", group: "actions" as const, label: text("Blocca ora", "Lock now"), icon: <Lock size={16} />, run: lockSession }] : []),
  ];
  const anyWindowOpen = updateOpen || accountForm !== null || accountDetail !== null || accountDelete !== null || cashOpen
    || paycheckForm !== null || paycheckDelete !== null || goalForm !== null || goalDelete !== null || importPayload !== null || tour !== null;

  const dashboard = (
    <PrivacyProvider>
      {/* The shell plays the arrival choreography once per page load (see entrance.tsx). */}
      <EntranceShell className="app-shell" contentKey={view}>
      {/* Behind everything, on <body>: only the content's ground shows it. */}
      <AmbientBackground />
      <Sidebar onNavigate={setView} onOpenSettings={() => openView("settings")} view={view} />

      <div className="app-main">
        <header className="topbar">
          <div className="topbar__context">
            <p className="eyebrow">{sectionLabel}</p>
            <span>
              {formatDate(new Date().toISOString(), { locale })}
              {isBeta ? <span className="beta-chip beta-chip--bar" title={text("Versione sperimentale: solo dati inventati", "Experimental version: invented data only")}>Beta</span> : null}
              {exampleArchive ? (
                <span className="example-archive-badge" title={text("Dati inventati, rimovibili da Impostazioni › Dati.", "Invented data, removable from Settings › Data.")}>
                  {text("Archivio di esempio", "Example archive")}
                </span>
              ) : null}
            </span>
          </div>
          <DashboardSearch items={searchItems} shortcutEnabled={!anyWindowOpen} />
          <div className="topbar__actions">
            {/* Language and the eye are back in the bar, before theme, Settings
                and the profile (owner, 15 Sep 2026); the profile panel keeps
                them too. Export and import live in the panel only. */}
            <LanguageToggle />
            <PrivacyToggle className="topbar-icon" tooltip />
            {/* The release notes, with a dot while the newest is unseen;
                "Prova" opens Settings on the row a note is about. */}
            <WhatsNew
              onTry={(target) => {
                requestSetting(target);
                openView("settings");
              }}
            />
            <ThemeToggle />
            {/* The sounds and the padlock left the profile panel for the bar,
                in Trading OS's order: theme, sounds, lock, Settings, profile
                (owner, 12 Oct 2026). */}
            <SoundToggle className="topbar-icon" tooltip />
            {lockSession ? (
              <button
                aria-label={text("Blocca ora", "Lock now")}
                className="button button--ghost topbar-icon lock-now"
                onClick={lockSession}
                title={text("Blocca ora", "Lock now")}
                type="button"
              >
                <Lock aria-hidden="true" size={19} strokeWidth={2} />
              </button>
            ) : null}
            <ProfileMenu />
            {/* The picker that Import opens: reached only through that action,
                never as a stop of its own in the tab order or the accessibility tree. */}
            <input
              accept="application/json,.json"
              aria-hidden="true"
              aria-label={text("Scegli il backup JSON da importare", "Choose JSON backup to import")}
              className="visually-hidden"
              onChange={(event) => void handleFile(event.target.files?.[0])}
              ref={fileInputRef}
              tabIndex={-1}
              type="file"
            />
          </div>
        </header>

        <main className="content" data-page-transition={pageTransitionMode ?? undefined} ref={contentRef}>
          {/* The archive's safety comes first: the backup reminder sits above every view. */}
          <BackupGuard blocked={overviewEditing || tour !== null} onExport={() => void handleExport()} />
          {/* Keyed by view: each page starts settled, so only later changes of state animate. */}
          <MotionScope key={contentView}>
          {contentView === "overview" ? (
            <OverviewView
              accounts={accounts}
              editing={overviewEditing}
              onStopEditing={() => setOverviewEditing(false)}
              cashDenominations={cashDenominations}
              goal={goal}
              onEditGoal={() => setGoalForm(goal ?? "new")}
              onOpenAccount={setAccountDetail}
              onShowCategory={(category) => {
                if (category === "liquidity") {
                  setView("accounts");
                  return;
                }
                openView(category);
              }}
              onShowAccounts={() => setView("accounts")}
              onShowGoals={() => setView("goals")}
              paychecks={paychecks}
              snapshots={snapshots}
              totalWealth={totalWealth}
            />
          ) : null}
          {contentView === "progress" ? (
            <ProgressView currentWealth={totalWealth} goal={goal} snapshots={snapshots} />
          ) : null}
          {contentView === "accounts" ? (
            <AccountsView
              accounts={accounts}
              onAdd={() => setAccountForm("new")}
              onOpen={setAccountDetail}
              onOpenCash={() => setCashOpen(true)}
              snapshots={snapshots}
              onToggleIncluded={async (account, included) => {
                try {
                  await updateAccount(account.id, { includedInWealth: included });
                  notify(text(`${account.name} ${included ? "incluso nel" : "escluso dal"} Patrimonio totale.`, `${account.name} ${included ? "included in" : "excluded from"} Total Wealth.`));
                } catch (reason) {
                  const message = reason instanceof Error ? reason.message : text("Aggiornamento non riuscito.", "The update failed.");
                  notify(text(`Impossibile aggiornare ${account.name}: ${message}`, `Could not update ${account.name}: ${message}`));
                }
              }}
              totalWealth={totalWealth}
            />
          ) : null}
          {contentView === "cash-flow" ? (
            <CashFlowView
              onAdd={() => setPaycheckForm("new")}
              onEdit={setPaycheckForm}
              paychecks={paychecks}
            />
          ) : null}
          {contentView === "investments" ? (
            <InvestmentsView
              accounts={accounts}
              back={backControl}
              onOpenAccount={setAccountDetail}
              onShowAccounts={() => setView("accounts")}
              totalWealth={totalWealth}
            />
          ) : null}
          {contentView === "trading" ? (
            <TradingView
              accounts={accounts}
              back={backControl}
              onOpenAccount={setAccountDetail}
              onShowAccounts={() => setView("accounts")}
              totalWealth={totalWealth}
            />
          ) : null}
          {contentView === "goals" ? (
            <GoalsView
              accounts={accounts}
              goals={orderedGoals}
              onAddGoal={() => setGoalForm("new")}
              onEditGoal={(target) => setGoalForm(target ?? "new")}
              onSetTargetDate={async (target, date) => {
                await updateGoal(target.id, { targetDate: date });
                notify(text(`Data obiettivo di «${target.name}» aggiornata.`, `“${target.name}” target date updated.`));
              }}
              snapshots={snapshots}
              totalWealth={totalWealth}
            />
          ) : null}
          {contentView === "scenario" ? <ScenarioView currentWealth={totalWealth} goals={orderedGoals} snapshots={snapshots} /> : null}
          {contentView === "settings" ? (
            <SettingsView
              back={settingsBack}
              onExport={() => void handleExport()}
              onImport={() => fileInputRef.current?.click()}
              onNotify={notify}
              onStartTour={(focusId) => startTour(focusId)}
            />
          ) : null}
          </MotionScope>
        </main>

        {/* Updating the balances: the round button at the bottom left, the
            pen's twin, out of the top bar (owner, 12 Oct 2026). On every page,
            and still where a closed window hands the focus back. */}
        <button
          aria-label={text("Aggiorna saldi", "Update balances")}
          className="dashboard-fab update-balances-fab"
          data-tour="update-balances"
          id={globalDialogFocusFallbackId}
          onClick={() => setUpdateOpen(true)}
          title={text("Aggiorna saldi", "Update balances")}
          type="button"
        >
          <RefreshCw aria-hidden="true" size={32} strokeWidth={2} />
        </button>

        {/* Arranging the Overview: a round button of its own at the bottom
            right, like the lock screen's switches, no longer in the top bar
            (owner, 12 Oct 2026). Only on the Overview, the one page there is
            anything to arrange; pressed while arranging. */}
        {view === "overview" ? (
          <button
            aria-label={text("Modifica panoramica", "Edit overview")}
            aria-pressed={overviewEditing}
            className="dashboard-fab overview-edit-fab"
            onClick={() => setOverviewEditing((editing) => !editing)}
            title={text("Modifica panoramica", "Edit overview")}
            type="button"
          >
            <Pen aria-hidden="true" size={32} strokeWidth={2} />
          </button>
        ) : null}
      </div>

      {updateOpen ? (
        <UpdateBalancesDialog
          accounts={accounts}
          snapshots={snapshots}
          onOpenChange={setUpdateOpen}
          onDeleteSnapshot={async (snapshotId) => {
            await deleteSnapshot(snapshotId);
            notify(text("Rilevazione rimossa dallo storico.", "Snapshot removed from history."));
          }}
          onSave={async (updates) => {
            await saveBalanceSnapshot(updates);
            notify(text("Saldi aggiornati e nuova rilevazione salvata.", "Balances updated and a new snapshot was saved."));
          }}
          open={updateOpen}
        />
      ) : null}

      {accountForm ? (
        <AccountFormDialog
          account={accountForm === "new" ? undefined : accountForm}
          focusFallbackId={accountForm === "new" ? undefined : accountDialogFocusId(accountForm.id)}
          key={accountForm === "new" ? "new-account" : accountForm.id}
          onOpenChange={(open) => { if (!open) setAccountForm(null); }}
          onSave={async (value: AccountFormValue) => {
            if (accountForm === "new") {
              await createAccount(buildAccountDraft(value));
              notify(text(`${value.name} aggiunto.`, `${value.name} was added.`));
            } else {
              await updateAccount(accountForm.id, value);
              notify(text(`${value.name} aggiornato.`, `${value.name} was updated.`));
            }
          }}
          open
        />
      ) : null}

      {accountDetail ? (
        <AccountDetailDialog
          account={accountDetail}
          key={accountDetail.id}
          onDelete={() => {
            setAccountDetail(null);
            setAccountDelete(accountDetail);
          }}
          onEdit={() => {
            setAccountDetail(null);
            setAccountForm(accountDetail);
          }}
          onOpenChange={(open) => { if (!open) setAccountDetail(null); }}
          open
          snapshots={snapshots}
          totalWealth={totalWealth}
        />
      ) : null}

      {accountDelete ? (
        <ConfirmDialog
          cancelFocusId={accountDialogFocusId(accountDelete.id)}
          confirmLabel={text("Elimina conto", "Delete account")}
          confirmFocusId={globalDialogFocusFallbackId}
          description={text(`${accountDelete.name} scomparirà dalle viste attive. Le voci negli snapshot storici resteranno conservate.`, `${accountDelete.name} will disappear from active views. Its historical snapshot entries remain preserved.`)}
          onConfirm={async () => {
            await deleteAccount(accountDelete.id);
            notify(text(`${accountDelete.name} archiviato.`, `${accountDelete.name} was archived.`));
          }}
          onOpenChange={(open) => { if (!open) setAccountDelete(null); }}
          open
          title={text(`Eliminare ${accountDelete.name}?`, `Delete ${accountDelete.name}?`)}
        />
      ) : null}

      {cashOpen ? (
        <CashCounterDialog
          denominations={cashDenominations}
          onOpenChange={setCashOpen}
          onSave={async (values) => {
            await setCashDenominations(values);
            notify(text("Conteggio contanti e saldo Contanti ora sono sincronizzati.", "Cash Counter and Cash balance are now in sync."));
          }}
          open
        />
      ) : null}

      {paycheckForm ? (
        <PaycheckFormDialog
          key={paycheckForm === "new" ? "new-paycheck" : paycheckForm.id}
          onDelete={paycheckForm === "new" ? undefined : () => {
            setPaycheckForm(null);
            setPaycheckDelete(paycheckForm);
          }}
          onOpenChange={(open) => { if (!open) setPaycheckForm(null); }}
          onSave={async (value: PaycheckFormValue) => {
            if (paycheckForm === "new") {
              const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`;
              await createPaycheck({ id, ...value });
              notify(text("Stipendio aggiunto come record distinto.", "Paycheck added as a distinct record."));
            } else {
              await updatePaycheck(paycheckForm.id, value);
              notify(text("Stipendio aggiornato.", "Paycheck updated."));
            }
          }}
          open
          paycheck={paycheckForm === "new" ? undefined : paycheckForm}
        />
      ) : null}

      {paycheckDelete ? (
        <ConfirmDialog
          cancelFocusId={paycheckRowFocusId(paycheckDelete.id)}
          confirmLabel={text("Elimina stipendio", "Delete paycheck")}
          confirmFocusId={globalDialogFocusFallbackId}
          description={text(`${formatDate(paycheckDelete.paymentDate, { timeZone: "UTC" })} verrà rimosso. Gli altri pagamenti dello stesso mese resteranno invariati.`, `${formatDate(paycheckDelete.paymentDate, { timeZone: "UTC" })} will be removed. Other payments in the same month remain untouched.`)}
          onConfirm={async () => {
            await deletePaycheck(paycheckDelete.id);
            notify(text("Stipendio eliminato.", "Paycheck deleted."));
          }}
          onOpenChange={(open) => { if (!open) setPaycheckDelete(null); }}
          open
          title={text("Eliminare questo stipendio?", "Delete this paycheck?")}
        />
      ) : null}

      {goalForm !== null ? (
        <GoalDialog
          creating={goalForm === "new"}
          key={goalForm === "new" ? "new-goal" : goalForm.id}
          name={goalForm === "new" ? "" : goalForm.name}
          type={goalForm === "new" ? undefined : goalForm.type}
          onDelete={goalForm !== "new" && orderedGoals.length > 1 ? () => { setGoalDelete(goalForm); setGoalForm(null); } : undefined}
          onOpenChange={(open) => { if (!open) setGoalForm(null); }}
          onSave={async (value) => {
            if (goalForm !== "new") {
              await updateGoal(goalForm.id, value);
              notify(text("Obiettivo aggiornato.", "Goal updated."));
            } else {
              // The first goal keeps the id the other pages have always read.
              await createGoal({ id: goals.length === 0 ? "wealth-goal" : `goal-${Date.now().toString(36)}`, ...value });
              notify(text("Obiettivo creato.", "Goal created."));
            }
          }}
          open
          targetAmount={goalForm === "new" ? 0 : goalForm.targetAmount}
          targetDate={goalForm === "new" ? undefined : goalForm.targetDate}
        />
      ) : null}

      {goalDelete ? (
        <ConfirmDialog
          confirmLabel={text("Elimina obiettivo", "Delete goal")}
          confirmFocusId={globalDialogFocusFallbackId}
          description={text(`«${goalDelete.name}» verrà rimosso. Conti, saldi e gli altri obiettivi restano invariati.`, `“${goalDelete.name}” will be removed. Accounts, balances and the other goals remain untouched.`)}
          onConfirm={async () => {
            await deleteGoal(goalDelete.id);
            notify(text("Obiettivo eliminato.", "Goal deleted."));
          }}
          onOpenChange={(open) => { if (!open) setGoalDelete(null); }}
          open
          title={text("Eliminare questo obiettivo?", "Delete this goal?")}
        />
      ) : null}

      {importPayload ? (
        <ConfirmDialog
          confirmLabel={text("Sostituisci dati locali", "Replace local data")}
          description={text("Il backup è valido. L'importazione sostituirà ogni conto, snapshot, stipendio, conteggio contanti e obiettivo locale su questo dispositivo.", "The backup is valid. Importing it will replace every local account, snapshot, paycheck, cash count, and goal on this device.")}
          onConfirm={async () => {
            await replaceDatabaseFromBackup(importPayload);
            setImportPayload(null);
            notify(text("Backup importato. Tutte le viste riflettono ora i dati sostitutivi.", "Backup imported. All views now reflect the replacement data."));
          }}
          onOpenChange={(open) => { if (!open) setImportPayload(null); }}
          open
          title={text("Importare questo backup?", "Import this backup?")}
          tone="primary"
        />
      ) : null}

      <OnboardingAutoStart blocked={anyWindowOpen} onStart={() => startTour()} />
      {tour ? <OnboardingTour key={tour.key} onEnd={endTour} onNavigate={tourNavigate} /> : null}

      <div aria-live="polite" aria-atomic="true" className={cx("toast", notice && "is-visible")} role="status">
        {toastText}
      </div>
      </EntranceShell>
    </PrivacyProvider>
  );

  return dashboard;
}
