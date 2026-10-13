"use client";

import { Eye, EyeOff, Moon, Sun, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode, type RefObject } from "react";

import { isValidPinFormat } from "@/domain/pin";
import { isBeta } from "@/features/beta/beta";
import { useLanguage } from "@/features/i18n/language";
import { displayName, lockBackground, theme } from "@/features/settings/preferences";
import { playUISound, primeUISounds, setUISoundsEnabled, useUISoundsEnabled } from "@/features/sound/ui-sound";

import { accessRecord } from "./access-record";
import { AuroraShader } from "./AuroraShader";
import { CloudShader } from "./CloudShader";
import { AccessLeaf, LiveClock, TodayLeaf, useGreeting } from "./lock-clock";

/*
 * THE LOCK SCREEN, IN THE TRADING OS LAYOUT (owner, 10 Oct 2026: "una
 * versione del Trading OS, ma per Iris"). The window with its title bar, its
 * red control and the resting padlock it folded into are gone. In their
 * place, the Trading OS arrangement in IRIS's violets:
 *   - the name where the rail will draw it (the Fraunces wordmark), the time
 *     with its seconds centred on that line, the theme switch at its end;
 *   - the sound switch and the signature on the bottom corners;
 *   - today and the last access as two glass squares beside the card;
 *   - the card: the lit ring holding the padlock, the greeting by the hour,
 *     the field as one pill (padlock, floating label, eye), and the button
 *     whose violet disc fills it on submit.
 *
 * MOTION — quiet at rest, responsive on intent, expressive on transition.
 * Every visual derives from one phase, written on the card as `data-phase`:
 *
 *   resting   → (typing)  → editing   each digit sends a pulse through the ring
 *   editing   → (submit)  → verifying the button fills; the orbit runs the ring
 *   verifying → (refused) → editing   the field shakes, the ring flashes red,
 *                                     the fill closes again
 *   verifying → (granted) → unlocked  the shackles swing open, then the card,
 *                                     the squares and the pills sink and fade
 *                                     (LoginGate holds the ledger for that long,
 *                                     then the window rises from below)
 *
 * "Focused" is read from the DOM (`:has(input:focus)` in the CSS), not kept in
 * state. Pure visuals (pulses, the shake) never go through React state: WAAPI
 * on refs. The PIN itself is never written anywhere by this screen.
 */

/* A real daytime sky for the clouds choice: medium blue above, lighter blue
   below, white clouds drifting slowly. */
const lockSky = {
  speed: 0.2,
  count: 5,
  cloudColor: "#f6f8fc",
  skyTopColor: "#4f8fd9",
  skyBottomColor: "#72b0f7",
  sunGlow: 0,
} as const;

/* The background is a device preference (Settings). It is read here and
   nowhere near the PIN: the card, its form and its checks are the same
   whatever stands behind it. */
function LockBackground() {
  const background = lockBackground.use();
  if (background === "none") {
    return null;
  }
  if (background === "aurora") {
    return <AuroraShader className="lock-sky" />;
  }
  return <CloudShader className="lock-sky" still={background === "still-sky"} {...lockSky} />;
}

type Phase = "resting" | "editing" | "verifying" | "unlocked";

const motion = {
  shake: 340,
  errorAccent: 700,
  pulse: 220,
} as const;

const shakeFrames: Keyframe[] = [
  { transform: "translateX(0)" },
  { transform: "translateX(-5px)" },
  { transform: "translateX(4px)" },
  { transform: "translateX(-3px)" },
  { transform: "translateX(2px)" },
  { transform: "translateX(0)" },
];

const reducedMotion = () => Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);

/*
 * The theme changes under a cross-fade, as Trading OS's lock screen does
 * (its switchTheme, owner 12 Oct 2026): the browser keeps a picture of the
 * screen as it is, the theme is applied, and the two dissolve into each
 * other (the View Transitions API), so the whole window does not flip from
 * light to dark in one frame. Without the API, or with reduced motion, the
 * theme simply changes.
 */
function switchLockTheme(next: "light" | "dark") {
  const quiet = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  if (!quiet && typeof document.startViewTransition === "function") {
    document.startViewTransition(() => theme.set(next));
  } else {
    theme.set(next);
  }
}

export function LoginPage({
  mode,
  note,
  onSetup,
  onUnlock,
  pinLength = null,
  verified = false,
}: {
  mode: "setup" | "locked";
  note?: string;
  onSetup: (pin: string) => Promise<void>;
  onUnlock: (pin: string) => Promise<boolean>;
  /** The PIN's number of digits, when known (data/pin.ts): typing the last one sends it. */
  pinLength?: number | null;
  /** The PIN has been accepted: the padlocks open and the screen leaves. */
  verified?: boolean;
}) {
  const { text } = useLanguage();
  const name = displayName.use();
  const greeting = useGreeting(name);
  const currentTheme = theme.use();
  const soundsOn = useUISoundsEnabled();
  const access = accessRecord.use();
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const pinInputRef = useRef<HTMLInputElement>(null);
  const confirmInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const ringRef = useRef<HTMLSpanElement>(null);
  /* One check at a time, synchronously: the last digit sends the PIN on the
     next frame, and a press of the button in that same frame must not send it
     a second time (state would only say "pending" after a render). */
  const submittingRef = useRef(false);
  const isSetup = mode === "setup";
  const dark = currentTheme === "dark";

  const phase: Phase = verified ? "unlocked" : pending ? "verifying" : pin.length > 0 ? "editing" : "resting";

  /*
   * Type without clicking: the field does not take the focus on its own, so
   * "PIN" can rest large in it; a digit typed anywhere on the screen still
   * lands in it, the focus moving on that key before its character is written.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const field = pinInputRef.current;
      if (!field || field.disabled || document.activeElement === field) return;
      if (event.ctrlKey || event.metaKey || event.altKey || !/^[0-9]$/.test(event.key)) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable]")) return;
      field.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const pulse = () => {
    if (reducedMotion()) return;
    ringRef.current?.animate?.(
      [{ "--ring-pulse": 0 } as Keyframe, { "--ring-pulse": 1, offset: 0.35 } as Keyframe, { "--ring-pulse": 0 } as Keyframe],
      { duration: motion.pulse, easing: "ease-out" },
    );
  };

  // A refusal: the field that holds the refused value shakes, the ring flashes
  // the loss colour and the padlock in it shivers. Under reduced motion the
  // message alone carries it.
  const refuse = (field: HTMLInputElement | null) => {
    field?.focus();
    if (!field || reducedMotion()) return;
    (field.closest<HTMLElement>(".iris-lock__pin") ?? field).animate?.(shakeFrames, {
      duration: motion.shake,
      easing: "cubic-bezier(0.36, 0.07, 0.19, 0.97)",
    });
    ringRef.current?.animate?.(
      [{ "--ring-error": 1 } as Keyframe, { "--ring-error": 0 } as Keyframe],
      { duration: motion.errorAccent, easing: "ease-out" },
    );
    ringRef.current?.querySelector(".iris-lock__glyph")?.animate?.(
      [{ transform: "rotate(0deg)" }, { transform: "rotate(-6deg)" }, { transform: "rotate(4deg)" }, { transform: "rotate(0deg)" }],
      { duration: motion.shake, easing: "ease-out" },
    );
  };

  const digitsOnly = (value: string) => value.replace(/\D/g, "").slice(0, 8);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending || verified || submittingRef.current) {
      return;
    }
    setError(null);

    if (!isValidPinFormat(pin)) {
      setError(text("Il PIN deve contenere da 4 a 8 cifre.", "PIN must be 4 to 8 digits."));
      refuse(pinInputRef.current);
      // Unlocking only (not PIN creation): the refusal is heard as well, at
      // once. This same gesture readies audio, so even a first press is heard.
      if (!isSetup) {
        primeUISounds();
        playUISound("pin-rejected");
      }
      return;
    }
    if (isSetup && pin !== confirmPin) {
      setError(text("I due PIN non coincidono.", "The two PINs do not match."));
      refuse(confirmInputRef.current);
      return;
    }

    // Audio may start only from this gesture; the unlock sound itself waits
    // for a verified PIN (LoginGate), the refusal for a rejected one (below).
    primeUISounds();
    submittingRef.current = true;
    setPending(true);
    try {
      if (isSetup) {
        await onSetup(pin);
      } else {
        const accepted = await onUnlock(pin);
        if (!accepted) {
          setError(text("PIN errato. Riprova.", "Incorrect PIN. Try again."));
          setPin("");
          refuse(pinInputRef.current);
          playUISound("pin-rejected");
          return;
        }
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : text("Si è verificato un problema. Riprova.", "Something went wrong. Try again."));
    } finally {
      submittingRef.current = false;
      setPending(false);
    }
  };

  const revealLabel = revealed ? text("Nascondi il PIN", "Hide the PIN") : text("Mostra il PIN", "Show the PIN");
  const revealButton = (
    <button
      aria-label={revealLabel}
      aria-pressed={revealed}
      className="iris-lock__reveal"
      onClick={() => setRevealed((shown) => !shown)}
      title={revealLabel}
      type="button"
    >
      {revealed ? <Eye aria-hidden="true" size={22} strokeWidth={1.8} /> : <EyeOff aria-hidden="true" size={22} strokeWidth={1.8} />}
    </button>
  );

  const submitLabel = isSetup ? text("Crea PIN e continua", "Create PIN and continue") : text("Sblocca dashboard", "Unlock dashboard");

  return (
    <main aria-labelledby="login-title" className="iris-lock">
      {/* Background only: mounted with the lock screen, gone with it. */}
      <LockBackground />

      {/* The name where the rail draws it once the dashboard opens. */}
      <p aria-hidden="true" className="iris-lock__brand">
        <span className="iris-lock__wordmark">Iris</span>
      </p>

      <LiveClock className="iris-lock__clock" />

      <aside aria-label={text("Oggi", "Today")} className="iris-lock__square iris-lock__square--left">
        <TodayLeaf />
      </aside>
      {isSetup ? null : (
        <aside aria-label={text("Ultimo accesso", "Last access")} className="iris-lock__square iris-lock__square--right">
          <AccessLeaf at={access.at} wrongSince={access.wrongSince} />
        </aside>
      )}

      {/* Light or dark before unlocking: the Settings theme, at the end of the
          line where the profile stands once the dashboard opens. */}
      <button
        aria-label={text("Tema scuro", "Dark theme")}
        aria-pressed={dark}
        className="iris-lock__switch iris-lock__theme"
        onClick={() => switchLockTheme(dark ? "light" : "dark")}
        title={dark ? text("Passa al tema chiaro", "Switch to the light theme") : text("Passa al tema scuro", "Switch to the dark theme")}
        type="button"
      >
        {dark ? <Sun aria-hidden="true" size={22} strokeWidth={1.8} /> : <Moon aria-hidden="true" size={22} strokeWidth={1.8} />}
      </button>

      {/* Sounds on or off before unlocking, across the diagonal. It makes no
          sound of its own. */}
      <button
        aria-label={text("Suoni", "Sounds")}
        aria-pressed={soundsOn}
        className="iris-lock__switch iris-lock__sound"
        data-ui-sound="off"
        onClick={() => setUISoundsEnabled(!soundsOn)}
        title={soundsOn ? text("Suoni attivi", "Sounds on") : text("Suoni disattivati", "Sounds off")}
        type="button"
      >
        {soundsOn ? <Volume2 aria-hidden="true" size={22} strokeWidth={1.8} /> : <VolumeX aria-hidden="true" size={22} strokeWidth={1.8} />}
      </button>

      <p className="iris-lock__signature">
        Powered by <span>Stefano Flaccavento</span>
      </p>

      <section aria-busy={pending || undefined} className="iris-lock__card" data-phase={phase}>
        <div className="iris-lock__body">
          {/* The lit ring holding the padlock: the screen's state made visible. */}
          <span aria-hidden="true" className="iris-lock__mark" ref={ringRef}>
            <span className="iris-lock__ring" />
            <span className="iris-lock__orbit" />
            <PadlockGlyph className="iris-lock__glyph" size={30} />
          </span>

          <p className="iris-lock__step iris-lock__eyebrow" style={{ "--step": 0 } as CSSProperties}>
            {isSetup ? text("Primo accesso", "First access") : text("Solo locale", "Local only")}
          </p>

          <h1 className="iris-lock__step iris-lock__title" id="login-title" style={{ "--step": 1 } as CSSProperties}>
            {isSetup ? text("Crea il tuo PIN", "Create your PIN") : greeting ?? name}
          </h1>

          <p className="iris-lock__step iris-lock__lede" style={{ "--step": 2 } as CSSProperties}>
            {isSetup
              ? text("Scegli un PIN di 4–8 cifre: blocca l'accesso a IRIS su questo dispositivo e non lo lascia mai. Non cifra i dati, che restano leggibili con strumenti tecnici da chi usa questo computer.", "Choose a 4–8 digit PIN: it locks access to IRIS on this device and never leaves it. It does not encrypt the data, which stays readable with technical tools by anyone using this computer.")
              : text("Inserisci il PIN per sbloccare i dati conservati su questo dispositivo.", "Enter your PIN to unlock the ledger stored on this device.")}
          </p>

          {isBeta ? (
            <p className="iris-lock__step iris-lock__beta" role="note" style={{ "--step": 2 } as CSSProperties}>
              <strong>{text("Versione beta sperimentale.", "Experimental beta.")}</strong>{" "}
              {text(
                "Usa solo dati inventati: l'archivio resta in questo browser e non è cifrato.",
                "Use invented data only: the archive stays in this browser and is not encrypted.",
              )}
            </p>
          ) : null}

          {/* Announced rather than merely drawn: someone who steps away and
              comes back needs to be told why the screen changed. */}
          {note ? (
            <p className="iris-lock__step iris-lock__note" role="status" style={{ "--step": 2 } as CSSProperties}>
              {note}
            </p>
          ) : null}

          <form className="iris-lock__step iris-lock__form" onSubmit={handleSubmit} ref={formRef} style={{ "--step": 3 } as CSSProperties}>
            <PinField
              closed={verified}
              inputRef={pinInputRef}
              invalid={Boolean(error)}
              label="PIN"
              onChange={(value) => {
                const next = digitsOnly(value);
                if (next !== pin) pulse();
                setPin(next);
                /*
                 * UNLOCK ON THE LAST DIGIT (owner, 10 Oct 2026, as in the
                 * Trading OS): when the PIN's length is known, typing its last
                 * digit sends it, as the button would — the same check, the
                 * same fill, the same refusal. Sent on the next frame, once the
                 * field holds the new value. Never while choosing a PIN, which
                 * has its confirmation.
                 */
                if (!isSetup && pinLength !== null && next.length === pinLength && next !== pin && !pending && !verified) {
                  requestAnimationFrame(() => formRef.current?.requestSubmit());
                }
              }}
              reveal={revealButton}
              revealed={revealed}
              value={pin}
            />
            {isSetup ? (
              <PinField
                closed={verified}
                inputRef={confirmInputRef}
                invalid={Boolean(error)}
                label={text("Conferma PIN", "Confirm PIN")}
                onChange={(value) => setConfirmPin(digitsOnly(value))}
                reveal={revealButton}
                revealed={revealed}
                value={confirmPin}
              />
            ) : null}

            {error ? (
              <p className="iris-lock__refusal" role="alert">{error}</p>
            ) : null}

            {/* The violet disc at the button's left end is the start of a
                layer the width of the button, clipped to the disc; on submit
                the clip opens to the right end. The label is drawn twice, under
                the fill and inside it, so the edge recolours it as it passes. */}
            <button aria-busy={pending} className="iris-lock__button" disabled={pending || verified} type="submit">
              <span className="iris-lock__button-label">{submitLabel}</span>
              <span aria-hidden="true" className="iris-lock__button-fill">
                <span className="iris-lock__button-label">{submitLabel}</span>
              </span>
              <span aria-hidden="true" className="iris-lock__button-disc">
                <PadlockGlyph size={22} />
              </span>
            </button>
            <p className="visually-hidden" role="status">
              {verified ? text("Dashboard sbloccata.", "Dashboard unlocked.") : pending ? text("Verifica del PIN…", "Checking the PIN…") : ""}
            </p>
          </form>
        </div>
      </section>
    </main>
  );
}

/*
 * The field as one pill: the padlock, the label over the digits, the eye. At
 * rest (empty, not focused) the label sits large in the middle; the focus
 * lifts it over the digits (CSS, data-empty and :focus-within).
 */
function PinField({
  label,
  value,
  onChange,
  inputRef,
  revealed,
  reveal,
  invalid,
  closed,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  inputRef: RefObject<HTMLInputElement | null>;
  revealed: boolean;
  reveal: ReactNode;
  invalid: boolean;
  /** Closed once the PIN is accepted; open while it is checked, so a refusal
      can give the focus straight back. */
  closed: boolean;
}) {
  return (
    <div className="iris-lock__pin" data-empty={value === "" ? "" : undefined}>
      <label className="iris-lock__pin-label">
        <span aria-hidden="true" className="iris-lock__pin-disc">
          <PadlockGlyph />
        </span>
        <span className="iris-lock__pin-text">
          <span className="iris-lock__pin-name">{label}</span>
          <input
            aria-invalid={invalid ? true : undefined}
            autoComplete="off"
            className="iris-lock__pin-input"
            disabled={closed}
            inputMode="numeric"
            onChange={(event) => onChange(event.target.value)}
            ref={inputRef}
            type={revealed ? "text" : "password"}
            value={value}
          />
        </span>
      </label>
      {reveal}
    </div>
  );
}

/**
 * The padlock of this screen, drawn once: in the ring, in the field and in
 * the button. The shackle is its own path, so the unlocked phase can swing it
 * open on its left leg wherever the padlock stands.
 */
function PadlockGlyph({ className, size = 22 }: { className?: string; size?: number }) {
  return (
    <svg
      className={className}
      fill="none"
      focusable="false"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.6"
      viewBox="0 0 24 24"
      width={size}
    >
      <rect height="10" rx="2.6" width="14" x="5" y="10.5" />
      <path className="iris-lock__shackle" d="M8.2 10.5V7.8a3.8 3.8 0 0 1 7.6 0v2.7" />
    </svg>
  );
}
