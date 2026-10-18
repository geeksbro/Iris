"use client";

import { useSyncExternalStore } from "react";

import { appBackgroundStorageKey, fontStorageKey, surfacesStorageKey, themeStorageKey, zoomLevels, zoomStorageKey } from "./theme-script";

/*
 * Device preferences: how this dashboard looks and greets on this device.
 * Not security state (the PIN and the auto-lock live in IndexedDB beside
 * each other) and not financial data (never in a backup).
 *
 * They are kept in localStorage because the lock screen reads them before
 * anything is unlocked, synchronously, on its first render. Each preference
 * has one key, one parser and an explicit default: a key that is missing or
 * holds something unexpected reads as the default, so no existing device
 * needs a migration. Language and interface sounds keep their own
 * long-standing stores (language.tsx, ui-sound.ts).
 *
 * What is NOT here: anything that must stay out of a backup and may be read
 * asynchronously — the PIN, the auto-lock policy and the page visit counts
 * live in the metadata table in IndexedDB (data/page-visits.ts, data/pin.ts).
 */

const changeEvent = "wealth-preferences-change";

type Preference<T> = {
  get: () => T;
  set: (value: T) => void;
  use: () => T;
};

function createPreference<T extends string | boolean>(
  key: string,
  fallback: T,
  parse: (stored: string) => T | undefined,
  serialize: (value: T) => string,
): Preference<T> {
  const get = (): T => {
    try {
      const stored = window.localStorage.getItem(key);
      return stored === null ? fallback : parse(stored) ?? fallback;
    } catch {
      return fallback;
    }
  };
  const set = (value: T) => {
    try {
      window.localStorage.setItem(key, serialize(value));
    } catch {
      // Kept for nothing: without storage the default returns on reload.
    }
    window.dispatchEvent(new Event(changeEvent));
  };
  const subscribe = (onChange: () => void) => {
    window.addEventListener("storage", onChange);
    window.addEventListener(changeEvent, onChange);
    return () => {
      window.removeEventListener("storage", onChange);
      window.removeEventListener(changeEvent, onChange);
    };
  };
  const use = () => useSyncExternalStore(subscribe, get, () => fallback);
  return { get, set, use };
}

/*
 * The same store for a preference that is a shape rather than a word — the
 * Overview's arrangement, for one.
 *
 * It cannot simply parse on every read. useSyncExternalStore compares what
 * the getter returns by identity, and a fresh object each call would read as
 * a fresh value each call, forever. So the parsed value is kept beside the
 * exact text it was parsed from, and re-parsed only when that text changes —
 * which also covers another tab writing the key under us.
 *
 * `parse` is the whole guard on what comes back: it is handed text this
 * device may have written under an older version of the app, and returning
 * undefined for anything it does not recognise is what makes a missing,
 * damaged or outdated value read as the default instead of breaking a view.
 */
function createStoredValue<T>(
  key: string,
  fallback: T,
  parse: (stored: string) => T | undefined,
  serialize: (value: T) => string,
): Preference<T> {
  let cachedText: string | null | undefined;
  let cachedValue: T = fallback;

  const get = (): T => {
    let stored: string | null;
    try {
      stored = window.localStorage.getItem(key);
    } catch {
      return fallback;
    }
    if (stored === cachedText) return cachedValue;
    cachedText = stored;
    cachedValue = stored === null ? fallback : parse(stored) ?? fallback;
    return cachedValue;
  };

  const set = (value: T) => {
    try {
      const text = serialize(value);
      window.localStorage.setItem(key, text);
      // Adopt what was written, so the next read is this value by identity.
      cachedText = text;
      cachedValue = value;
    } catch {
      // Kept for nothing: without storage the default returns on reload.
    }
    window.dispatchEvent(new Event(changeEvent));
  };

  const subscribe = (onChange: () => void) => {
    window.addEventListener("storage", onChange);
    window.addEventListener(changeEvent, onChange);
    return () => {
      window.removeEventListener("storage", onChange);
      window.removeEventListener(changeEvent, onChange);
    };
  };

  return { get, set, use: () => useSyncExternalStore(subscribe, get, () => fallback) };
}

export { createStoredValue };

/**
 * What stands behind the lock window. Each choice is a real rendering, none a
 * placeholder. The aurora (owner, 10 Oct 2026) is the default since the lock
 * screen took the Trading OS layout; the clouds stay, moving or still.
 */
export const lockBackgrounds = ["aurora", "sky", "still-sky", "none"] as const;
export type LockBackground = (typeof lockBackgrounds)[number];
/** What the shuffle draws from (owner, 18 Oct 2026): every real background, never "none". */
export const randomLockBackgrounds = ["aurora", "sky", "still-sky"] as const;

export const lockBackground = createPreference<LockBackground>(
  "wealth-lock-background",
  "aurora",
  (stored) => (lockBackgrounds as readonly string[]).includes(stored) ? stored as LockBackground : undefined,
  (value) => value,
);

/*
 * A different background at every lock (owner, 18 Oct 2026): its own switch,
 * an icon beside the choice rather than one of its options, so the choice
 * underneath is kept and comes back when the shuffle is turned off.
 */
export const lockBackgroundShuffle = createPreference<boolean>(
  "wealth-lock-shuffle",
  false,
  (stored) => (stored === "on" ? true : stored === "off" ? false : undefined),
  (value) => (value ? "on" : "off"),
);

/** The name the lock screen greets; empty means a greeting without a name. */
export const displayNameMaxLength = 40;

/*
 * A device that never chose a name is greeted without one. A private build
 * may give its owner's name as the default through NEXT_PUBLIC_IRIS_GREETING_NAME
 * (in a git-ignored .env.local), so a device that relied on the old built-in
 * default keeps its greeting without the name being part of the code.
 */
const defaultDisplayName = (process.env.NEXT_PUBLIC_IRIS_GREETING_NAME ?? "").trim().slice(0, displayNameMaxLength);

export const displayName = createPreference<string>(
  "wealth-display-name",
  defaultDisplayName,
  (stored) => stored.slice(0, displayNameMaxLength),
  (value) => value.trim().slice(0, displayNameMaxLength),
);

/*
 * The picture in the profile's circle in the top bar (owner, 12 Oct 2026, as
 * in Trading OS): the square the crop editor cut, as a data URL, or empty
 * for none — the circle then shows the greeting name's initial. A device
 * preference like the name beside it: never in a backup. Anything stored
 * that is not a small PNG, JPEG or WebP data URL reads as no picture.
 */
export const profileImageSize = 256;
export const profileImageMaxLength = 600_000;
const profileImagePattern = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;

export const profileImage = createPreference<string>(
  "wealth-profile-image",
  "",
  (stored) => stored === "" || (stored.length <= profileImageMaxLength && profileImagePattern.test(stored)) ? stored : undefined,
  (value) => value,
);

/*
 * The theme: light (the dashboard as it has always been) or dark. It is
 * applied as data-theme on <html>, which globals.css reads. The layout sets
 * it before the first paint (themeScript), so a dark device never flashes
 * light on load; choosing a theme sets it at once, with no React render.
 */
export const themes = ["light", "dark"] as const;
export type Theme = (typeof themes)[number];

const themePreference = createPreference<Theme>(
  themeStorageKey,
  "light",
  (stored) => (themes as readonly string[]).includes(stored) ? stored as Theme : undefined,
  (value) => value,
);

function applyTheme(value: Theme) {
  if (value === "dark") document.documentElement.dataset.theme = "dark";
  else delete document.documentElement.dataset.theme;
}

export const theme: Preference<Theme> = {
  get: themePreference.get,
  use: themePreference.use,
  set: (value) => {
    applyTheme(value);
    themePreference.set(value);
  },
};

/*
 * The interface typeface (owner, 10 Oct 2026): Geist, as since 27 Sep, or
 * Poppins. Only these two — Inter was tried and left out. Applied as
 * data-font on <html> (globals.css swaps --font-sans), set before the first
 * paint by themeScript like the theme, and at once when chosen. The Iris
 * wordmark keeps its own face either way.
 */
export const interfaceFonts = ["geist", "poppins"] as const;
export type InterfaceFont = (typeof interfaceFonts)[number];

const fontPreference = createPreference<InterfaceFont>(
  fontStorageKey,
  "geist",
  (stored) => (interfaceFonts as readonly string[]).includes(stored) ? stored as InterfaceFont : undefined,
  (value) => value,
);

function applyFont(value: InterfaceFont) {
  if (value === "poppins") document.documentElement.dataset.font = "poppins";
  else delete document.documentElement.dataset.font;
}

export const interfaceFont: Preference<InterfaceFont> = {
  get: fontPreference.get,
  use: fontPreference.use,
  set: (value) => {
    applyFont(value);
    fontPreference.set(value);
  },
};

/*
 * The cards' surfaces (owner, 17 Oct 2026): frosted glass over the moving
 * background, or opaque — more contrast, less work for the graphics. Applied
 * as data-surfaces on <html>, before the first paint like the theme. When
 * the system asks for reduced transparency, the cards are opaque whatever
 * this says (globals.css, "Surfaces and app background").
 */
export const surfaceStyles = ["glass", "opaque"] as const;
export type SurfaceStyle = (typeof surfaceStyles)[number];

const surfacesPreference = createPreference<SurfaceStyle>(
  surfacesStorageKey,
  "glass",
  (stored) => (surfaceStyles as readonly string[]).includes(stored) ? stored as SurfaceStyle : undefined,
  (value) => value,
);

export const surfaces: Preference<SurfaceStyle> = {
  get: surfacesPreference.get,
  use: surfacesPreference.use,
  set: (value) => {
    if (value === "opaque") document.documentElement.dataset.surfaces = "opaque";
    else delete document.documentElement.dataset.surfaces;
    surfacesPreference.set(value);
  },
};

/*
 * The page zoom (owner, 18 Oct 2026): Chrome's own steps, 25% to 200%,
 * applied as --ui-zoom on <html> (globals.css, "Zoom"), before the first
 * paint like the theme. 100 is the default and sets nothing.
 */
export type ZoomLevel = (typeof zoomLevels)[number];
export { zoomLevels };

const zoomPreference = createPreference<string>(
  zoomStorageKey,
  "100",
  (stored) => (zoomLevels as readonly number[]).includes(Number(stored)) ? stored : undefined,
  (value) => value,
);

export const pageZoom: Preference<ZoomLevel> = {
  get: () => Number(zoomPreference.get()) as ZoomLevel,
  use: () => Number(zoomPreference.use()) as ZoomLevel,
  set: (value) => {
    if (value === 100) document.documentElement.style.removeProperty("--ui-zoom");
    else document.documentElement.style.setProperty("--ui-zoom", String(value / 100));
    zoomPreference.set(String(value));
  },
};

/*
 * The app's background (owner, 17 Oct 2026): the veils drifting, or held
 * still — without stopping every other animation the way the system's
 * Reduce motion does. Applied as data-ambient on <html>.
 */
export const appBackgrounds = ["animated", "still"] as const;
export type AppBackground = (typeof appBackgrounds)[number];

const appBackgroundPreference = createPreference<AppBackground>(
  appBackgroundStorageKey,
  "animated",
  (stored) => (appBackgrounds as readonly string[]).includes(stored) ? stored as AppBackground : undefined,
  (value) => value,
);

export const appBackground: Preference<AppBackground> = {
  get: appBackgroundPreference.get,
  use: appBackgroundPreference.use,
  set: (value) => {
    if (value === "still") document.documentElement.dataset.ambient = "still";
    else delete document.documentElement.dataset.ambient;
    appBackgroundPreference.set(value);
  },
};

/** The rail folded to its icons (the key predates this store; its values are unchanged). */
export const sidebarCollapsed = createPreference<boolean>(
  "wealth-sidebar-collapsed",
  false,
  (stored) => stored === "1",
  (value) => (value ? "1" : "0"),
);

/*
 * The page the dashboard opens on. The rail's six views, under the ids the
 * dashboard already routes by, so nothing has to translate between a stored
 * name and a view. An unknown or missing value reads as "overview", which is
 * what every device did before this preference existed.
 */
export const startPages = ["overview", "accounts", "cash-flow", "progress", "goals", "scenario"] as const;
export type StartPage = (typeof startPages)[number];

export const startPage = createPreference<StartPage>(
  "wealth-start-page",
  "overview",
  (stored) => (startPages as readonly string[]).includes(stored) ? stored as StartPage : undefined,
  (value) => value,
);

/*
 * Privacy: three independent terms, not one "private mode". Each says what
 * the dashboard shows, never what it stores — the records are untouched and a
 * backup carries them in full whatever these say.
 *
 * `amountsHidden` keeps the key and the "1"/"0" values it has always had, so
 * a device that hid its amounts still finds them hidden after this change; it
 * moved here from privacy.tsx only so the three sit together in the one
 * device-preference store.
 */
const hiddenPreference = (key: string) => createPreference<boolean>(
  key,
  false,
  (stored) => stored === "1",
  (value) => (value ? "1" : "0"),
);

/*
 * Which years of the Cash Flow ledger were opened or closed by hand on this
 * device (owner, 26 Sep 2026). Only explicit choices are kept, year → open;
 * a year never touched follows the rule in CashFlowView (the most recent one
 * open, the others closed), so a new year arrives open without any migration.
 */
export type PaycheckYearChoices = Readonly<Record<string, boolean>>;

export const paycheckYears = createStoredValue<PaycheckYearChoices>(
  "wealth-paycheck-years",
  {},
  (stored) => {
    try {
      const parsed: unknown = JSON.parse(stored);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
      const entries = Object.entries(parsed).filter(([year, open]) => /^\d{4}$/.test(year) && typeof open === "boolean");
      return Object.fromEntries(entries) as PaycheckYearChoices;
    } catch {
      return undefined;
    }
  },
  (value) => JSON.stringify(value),
);

/*
 * Which access groups of the Accounts ledger were closed or opened by hand
 * on this device (owner, 17 Oct 2026, like the Cash Flow years). Only
 * explicit choices are kept, group → open; a group never touched is open.
 */
export type AccountGroupChoices = Readonly<Record<string, boolean>>;

const accountGroupKeys = ["immediate", "days", "locked", "unclassified"];

export const accountGroups = createStoredValue<AccountGroupChoices>(
  "wealth-account-groups",
  {},
  (stored) => {
    try {
      const parsed: unknown = JSON.parse(stored);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
      const entries = Object.entries(parsed).filter(([group, open]) => accountGroupKeys.includes(group) && typeof open === "boolean");
      return Object.fromEntries(entries) as AccountGroupChoices;
    } catch {
      return undefined;
    }
  },
  (value) => JSON.stringify(value),
);

/*
 * The Goals page (owner, 17 Oct 2026). Which goal is shown, and how far each
 * goal had come when this device last showed it: the next visit starts its
 * bar from there and says how much it moved in between. A goal id → percent.
 */
export const selectedGoal = createPreference<string>(
  "wealth-goal-selected",
  "",
  (stored) => stored,
  (value) => value,
);

export type GoalSeenProgress = Readonly<Record<string, number>>;

export const goalSeen = createStoredValue<GoalSeenProgress>(
  "wealth-goal-seen",
  {},
  (stored) => {
    try {
      const parsed: unknown = JSON.parse(stored);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
      const entries = Object.entries(parsed).filter(([, value]) => typeof value === "number" && Number.isFinite(value));
      return Object.fromEntries(entries) as GoalSeenProgress;
    } catch {
      return undefined;
    }
  },
  (value) => JSON.stringify(value),
);

/*
 * The Projections page's saved choices (owner, 17 Oct 2026): "a car of
 * 10.000 € once", kept on this device and answered again on the balances of
 * the day. A choice is words and figures only, never an account.
 */
export type ScenarioKind = "spend" | "add";
export type ScenarioFrequency = "once" | "monthly";
export type SavedScenario = Readonly<{
  id: string;
  name: string;
  kind: ScenarioKind;
  amount: number;
  frequency: ScenarioFrequency;
  /** The monthly saving the choice was weighed against. */
  monthly: number;
}>;

export const savedScenarios = createStoredValue<readonly SavedScenario[]>(
  "wealth-saved-scenarios",
  [],
  (stored) => {
    try {
      const parsed: unknown = JSON.parse(stored);
      if (!Array.isArray(parsed)) return undefined;
      return parsed.filter((item): item is SavedScenario => (
        typeof item === "object" && item !== null
        && typeof item.id === "string" && typeof item.name === "string"
        && (item.kind === "spend" || item.kind === "add")
        && (item.frequency === "once" || item.frequency === "monthly")
        && typeof item.amount === "number" && Number.isFinite(item.amount) && item.amount >= 0
        && typeof item.monthly === "number" && Number.isFinite(item.monthly) && item.monthly >= 0
      )).slice(0, 12);
    } catch {
      return undefined;
    }
  },
  (value) => JSON.stringify(value),
);

export const amountsHidden = hiddenPreference("wealth-amounts-hidden");
export const percentagesHidden = hiddenPreference("wealth-percentages-hidden");
export const accountNamesHidden = hiddenPreference("wealth-account-names-hidden");

/*
 * The guided tour (First-Run Onboarding). A device record, like the rest of
 * this store: it survives locking and a browser restart on the same origin,
 * is never in a backup and is never synced anywhere — there is no account to
 * sync it with. Clearing the site's data clears it with the PIN and the
 * ledger, so a device wiped that way is a new device and is offered the tour
 * again: a deliberate limit of a local-only app.
 *
 * Who is offered the tour is NOT decided by this key being absent. Absent is
 * what every device that was set up before the tour existed looks like, and
 * those owners must not be interrupted by it after an update. The record is
 * written as "not-started" at one moment only — when the first PIN is created
 * on this device (LoginGate) — and only that state starts the tour by itself.
 * A device with no record never sees it unasked; Settings can always start it.
 *
 * `version` is the version of the tour the status refers to. A later tour
 * (onboardingTourVersion + 1) does not reset a choice: a completed or skipped
 * record stays decided, and what a new version deserves — a "what's new" — is
 * for that version to decide by reading the old number here.
 */
export const onboardingTourVersion = 1;
export const onboardingStatuses = ["not-started", "completed", "skipped"] as const;
export type OnboardingStatus = (typeof onboardingStatuses)[number];

export type OnboardingRecord = {
  readonly version: number;
  readonly status: OnboardingStatus;
  /**
   * When this device's first PIN was created, with the tour available.
   * Absent on a device set up before the tour existed that later ran it
   * from Settings.
   */
  readonly firstRunAt?: string;
  /** When the tour was completed or skipped; absent while not started. */
  readonly decidedAt?: string;
};

const isIsoDate = (value: unknown): value is string => typeof value === "string" && !Number.isNaN(Date.parse(value));

export function parseOnboardingRecord(stored: string): OnboardingRecord | undefined {
  try {
    const parsed: unknown = JSON.parse(stored);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
    const { version, status, firstRunAt, decidedAt } = parsed as Record<string, unknown>;
    if (typeof version !== "number" || !Number.isInteger(version) || version < 1) return undefined;
    if (!(onboardingStatuses as readonly unknown[]).includes(status)) return undefined;
    if (firstRunAt !== undefined && !isIsoDate(firstRunAt)) return undefined;
    if (decidedAt !== undefined && !isIsoDate(decidedAt)) return undefined;
    // A decided status carries its date; "not-started" never does, and only
    // a first run writes it.
    if (status === "not-started" ? decidedAt !== undefined || firstRunAt === undefined : decidedAt === undefined) return undefined;
    return {
      version,
      status: status as OnboardingStatus,
      ...(firstRunAt === undefined ? {} : { firstRunAt }),
      ...(decidedAt === undefined ? {} : { decidedAt }),
    };
  } catch {
    return undefined;
  }
}

/** Null: no record — a device set up before the tour existed, or a damaged value. */
export const onboarding = createStoredValue<OnboardingRecord | null>(
  "wealth-onboarding",
  null,
  parseOnboardingRecord,
  (value) => JSON.stringify(value),
);

/*
 * "Later" on the backup reminder (BackupGuard): until when it stays quiet on
 * this device. An ISO date, or empty for never put off.
 */
export const backupReminderSnooze = createPreference<string>(
  "wealth-backup-snooze",
  "",
  (stored) => (stored === "" || !Number.isNaN(Date.parse(stored)) ? stored : undefined),
  (value) => value,
);

/*
 * How a page changes when another is chosen (owner, 18 Oct 2026). "fade" is
 * the view's own short slide, as it always was; "cascade" lets the cards
 * arrive top to bottom, in place, in about a third of a second; "cinematic"
 * follows the reference video: the old page empties in bands from the bottom
 * up, then the new one is built card by card from the top. The rail's pill
 * answers the click at once in every mode, and the system's Reduce motion
 * keeps the plain change whatever is chosen.
 */
export const pageTransitions = ["fade", "cascade", "cinematic"] as const;
export type PageTransition = (typeof pageTransitions)[number];

export const pageTransition = createPreference<PageTransition>(
  "wealth-page-transition",
  "fade",
  (stored) => (pageTransitions as readonly string[]).includes(stored) ? stored as PageTransition : undefined,
  (value) => value,
);

/*
 * The newest release this device has seen in the "Novità" panel (owner,
 * 18 Oct 2026): the button carries a dot until the panel has shown the
 * latest one. Empty on a device that never opened it.
 */
export const seenRelease = createPreference<string>(
  "wealth-seen-release",
  "",
  (stored) => (stored.length <= 32 ? stored : undefined),
  (value) => value,
);
