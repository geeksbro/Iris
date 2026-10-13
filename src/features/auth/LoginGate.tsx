"use client";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useState, type ReactNode } from "react";

import { useLiveQuery } from "dexie-react-hooks";

import { getPinCredentials, getPinLength, setupPin, verifyPin } from "@/data/pin";
import { defaultIdleTimeoutMs, getIdleTimeoutMs } from "@/data/security";
import { ErrorState } from "@/features/dashboard/ui";
import { LanguageProvider, useLanguage } from "@/features/i18n/language";
import { markOnboardingFirstRun } from "@/features/onboarding/onboarding";
import { playUISound } from "@/features/sound/ui-sound";

import { recordAccess, recordWrongPin } from "./access-record";
import { LoginPage } from "./LoginPage";
import { clearSessionUnlock, isSessionUnlocked, markSessionUnlocked } from "./session";

/*
 * "verified": the PIN has been accepted and the session is already marked
 * unlocked, but the lock screen stays for verifiedHoldMs while its padlocks
 * open and the card sinks away, before the ledger is rendered. The hold is
 * presentation only; it starts after authentication, never in its place.
 */
type GateStatus = "checking" | "setup" | "locked" | "verified" | "unlocked" | "error";

/** The auto-lock when the device has no policy of its own: the original two minutes. */
export const idleTimeoutMs = defaultIdleTimeoutMs;

/**
 * The auto-lock in force, live: a change made in Settings reaches the gate's
 * watcher at once. The default stands until the stored policy has been read.
 */
export function useIdleTimeoutMs(): number {
  return useLiveQuery(() => getIdleTimeoutMs(), [], defaultIdleTimeoutMs);
}

/** "30 secondi", "2 minuti", "1 minute" (or "30 sec", "2 min" short): an auto-lock duration. */
export function formatIdleLimit(ms: number, locale: string, display: "long" | "short" = "long"): string {
  const [value, unit] = ms < 60_000 ? [ms / 1000, "second"] : [ms / 60_000, "minute"];
  return new Intl.NumberFormat(locale, { style: "unit", unit, unitDisplay: display }).format(value);
}
/**
 * How long the lock screen stays after a verified PIN: the padlocks open
 * (300ms), then the card, the squares and the pills sink and fade (900ms).
 * Must match --iris-unlock-sink in globals.css (IRIS LOCK SCREEN).
 */
export const verifiedHoldMs = 1_200;
/** The same hold under reduced motion: no sinking, a quick change. */
const verifiedHoldReducedMs = 160;
/** How long the dashboard's window rises from below (--iris-unlock-rise). */
const riseMs = 1_100;

const idleCheckIntervalMs = 1_000;
const activityEvents = ["mousemove", "pointerdown", "keydown", "wheel", "touchstart"] as const;

const prefersReducedMotion = () => Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);

/*
 * After the lock screen has sunk away, the dashboard's window rises from below
 * the screen's edge and settles, its own entrance playing inside it (the
 * Trading OS unlock, owner 10 Oct 2026). The flag is on <html>, set just
 * before the swap so the shell's first frame already has it, and dropped once
 * the rise is over, so nothing later rises again.
 */
function riseIntoDashboard() {
  if (prefersReducedMotion()) {
    return;
  }
  const root = document.documentElement;
  root.dataset.arrival = "unlock";
  window.setTimeout(() => {
    delete root.dataset.arrival;
  }, riseMs + 200);
}

const SessionLockContext = createContext<(() => void) | null>(null);

/**
 * Locks the session now: the same transition the idle watcher makes, so the
 * PIN is required to reopen. Null outside the gate, where there is no session
 * to lock and no lock action to offer.
 */
export function useSessionLock(): (() => void) | null {
  return useContext(SessionLockContext);
}

export function LoginGate({ children }: { children: ReactNode }) {
  return <LanguageProvider><LoginGateContent>{children}</LoginGateContent></LanguageProvider>;
}

function LoginGateContent({ children }: { children: ReactNode }) {
  const { text } = useLanguage();
  const [status, setStatus] = useState<GateStatus>("checking");
  const [attempt, setAttempt] = useState(0);
  const [idleLocked, setIdleLocked] = useState(false);
  const [verifiedFrom, setVerifiedFrom] = useState<"setup" | "locked">("locked");
  const idleLimitMs = useIdleTimeoutMs();
  // Live, so a length learned at an unlock is there at the next lock.
  const pinLength = useLiveQuery(() => getPinLength(), [], null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        if (isSessionUnlocked()) {
          if (active) {
            setStatus("unlocked");
          }
          return;
        }
        const credentials = await getPinCredentials();
        if (active) {
          setStatus(credentials ? "locked" : "setup");
        }
      } catch {
        if (active) {
          setStatus("error");
        }
      }
    })();
    return () => { active = false; };
  }, [attempt]);

  useEffect(() => {
    if (status !== "unlocked") {
      return;
    }

    let lastActivityAt = Date.now();
    const recordActivity = () => {
      lastActivityAt = Date.now();
    };
    for (const event of activityEvents) {
      window.addEventListener(event, recordActivity, { passive: true });
    }

    const watcher = window.setInterval(() => {
      if (Date.now() - lastActivityAt >= idleLimitMs) {
        clearSessionUnlock();
        setIdleLocked(true);
        setStatus("locked");
      }
    }, idleCheckIntervalMs);

    return () => {
      window.clearInterval(watcher);
      for (const event of activityEvents) {
        window.removeEventListener(event, recordActivity);
      }
    };
    // A new limit restarts the count from now: the change itself is activity.
  }, [status, idleLimitMs]);

  // Locking removes the ledger at once. A window that was open over it closes
  // without its exit copy, so no figure stays on screen above the lock window;
  // an earlier copy of the lock window still closing goes too, so it never
  // doubles the real one. Runs before paint, right after the dashboard left
  // the DOM.
  useLayoutEffect(() => {
    if (status !== "locked" && status !== "setup") {
      return;
    }
    document.querySelectorAll(".is-exit-ghost").forEach((ghost) => ghost.remove());
  }, [status]);

  // A verified PIN opens the padlocks and lets the lock screen sink before
  // the ledger exists. The timer only ends that presentation: authentication
  // is already done. Started at commit, the same frame the padlocks open.
  useLayoutEffect(() => {
    if (status !== "verified") {
      return;
    }
    const timer = window.setTimeout(() => {
      // The access is stamped as the screen leaves, so the leaf it shows
      // never changes under the eye while the padlocks open.
      recordAccess();
      riseIntoDashboard();
      setIdleLocked(false);
      setStatus("unlocked");
    }, prefersReducedMotion() ? verifiedHoldReducedMs : verifiedHoldMs);
    return () => window.clearTimeout(timer);
  }, [status]);

  // The unlock sound means a protected session reopened: it follows only a
  // PIN that verifyPin accepted (verifiedFrom "locked"), never a PIN just
  // created. Same commit as the check, once per verification, never awaited.
  useLayoutEffect(() => {
    if (status === "verified" && verifiedFrom === "locked") {
      playUISound("unlock-success");
    }
  }, [status, verifiedFrom]);

  const lockNow = useCallback(() => {
    clearSessionUnlock();
    setIdleLocked(false);
    setStatus("locked");
  }, []);

  const handleSetup = useCallback(async (pin: string) => {
    await setupPin(pin);
    // The one moment a device is known to be new to IRIS: the guided tour is
    // offered once the dashboard is ready (features/onboarding).
    markOnboardingFirstRun();
    markSessionUnlocked();
    setVerifiedFrom("setup");
    setStatus("verified");
  }, []);

  const handleUnlock = useCallback(async (pin: string) => {
    const verified = await verifyPin(pin);
    if (verified) {
      markSessionUnlocked();
      setVerifiedFrom("locked");
      setStatus("verified");
    } else {
      recordWrongPin();
    }
    return verified;
  }, []);

  if (status === "error") {
    return (
      <ErrorState
        message={text("Impossibile leggere lo stato di accesso locale.", "The local access state could not be read.")}
        onRetry={() => {
          setStatus("checking");
          setAttempt((value) => value + 1);
        }}
      />
    );
  }

  if (status === "checking") {
    return (
      <main aria-label={text("Verifica accesso locale", "Checking local access")} className="iris-lock iris-lock--checking">
        <div className="iris-lock__checking">
          <span aria-hidden="true" className="iris-lock__wordmark">Iris</span>
          <span>{text("Verifica accesso locale…", "Checking local access…")}</span>
        </div>
      </main>
    );
  }

  if (status === "setup" || status === "locked" || status === "verified") {
    // The same window stays mounted through "verified": nothing else changes.
    const mode = status === "verified" ? verifiedFrom : status;
    return (
      <LoginPage
        mode={mode}
        note={mode === "locked" && idleLocked
          ? text(
              `La sessione è stata interrotta dopo ${formatIdleLimit(idleLimitMs, "it-IT")} di inattività.`,
              `Your session was interrupted after ${formatIdleLimit(idleLimitMs, "en-GB")} of inactivity.`,
            )
          : undefined}
        onSetup={handleSetup}
        onUnlock={handleUnlock}
        pinLength={pinLength}
        verified={status === "verified"}
      />
    );
  }

  return <SessionLockContext.Provider value={lockNow}>{children}</SessionLockContext.Provider>;
}
