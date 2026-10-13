"use client";

import { useSyncExternalStore } from "react";

/*
 * Interface sounds: the one place the dashboard makes a sound.
 *
 * - One global preference, on unless turned off, kept on this device
 *   (localStorage, like the language and the privacy eye). Off means silent:
 *   no context is created and nothing plays.
 * - One shared AudioContext, created or resumed only from the user's own
 *   gesture (primeUISounds, called in an event handler), never on page load.
 *   A sound asked for on a context that is not running is skipped, not
 *   queued: a late sound would acknowledge a moment that has passed. The one
 *   exception is a context that the same gesture is waking: its clock stands
 *   still until it runs, so a sound scheduled on it plays the moment it wakes,
 *   milliseconds later (a PIN refused on the very first press).
 * - The context is suspended again once a sound has finished, or soon after
 *   a gesture readied it for a sound that never came, so no audio thread
 *   stays awake between sounds.
 * - Sound is supplemental. Every call is fire-and-forget and swallows its
 *   own failures: nothing the caller does may wait for it or depend on it.
 * - A sound never stacks on itself: asked again while it plays, it is
 *   ignored.
 */

export type UISound =
  | "unlock-success"
  | "pin-rejected"
  | "tap"
  | "tour-open"
  | "tour-next"
  | "tour-back"
  | "tour-complete"
  | "tour-close";

const preferenceStorageKey = "wealth-ui-sounds";
/** Every recipe is authored against this output level. */
const masterVolume = 0.5;
/** Past a sound's end, the context is left running this long before it sleeps. */
const suspendAfterMs = 250;
/** A readied context that no sound follows (a PIN just created, a device error) sleeps after this. */
const primedForMs = 3_000;

type Recipe = {
  /** Seconds, from the first note to the end of the last tail. */
  duration: number;
  render: (context: AudioContext, output: AudioNode, at: number) => void;
};

type Note = { frequency: number; offset: number; peak: number; decay: number };

/*
 * PROTOTYPE, replaceable: synthesized here, no asset and so no licence. A
 * rising fifth (D5, then A5 85ms later), each note a sine with a faint
 * octave for a light digital edge, an 8ms attack and an exponential decay.
 * About half a second in all.
 */
function renderUnlockSuccess(context: AudioContext, output: AudioNode, at: number) {
  const notes: Note[] = [
    { frequency: 587.33, offset: 0, peak: 0.16, decay: 0.34 },
    { frequency: 880, offset: 0.085, peak: 0.13, decay: 0.42 },
  ];
  const partials = [
    { ratio: 1, level: 1 },
    { ratio: 2, level: 0.12 },
  ];
  for (const note of notes) {
    const start = at + note.offset;
    for (const partial of partials) {
      const oscillator = context.createOscillator();
      const envelope = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = note.frequency * partial.ratio;
      envelope.gain.setValueAtTime(0, start);
      envelope.gain.linearRampToValueAtTime(note.peak * partial.level, start + 0.008);
      envelope.gain.exponentialRampToValueAtTime(0.0001, start + note.decay);
      oscillator.connect(envelope).connect(output);
      oscillator.start(start);
      oscillator.stop(start + note.decay + 0.02);
    }
  }
}

/*
 * PROTOTYPE, replaceable, synthesized the same way: the unlock sound's
 * counterpart. Where that one rises and rings, this falls and stays muted.
 * Two short, low notes, G4 then E-flat4 110ms later (a falling major third),
 * each a sine with a faint third harmonic for a soft, hollow edge (the
 * unlock sound's octave reads bright), a 6ms attack, a quick exponential
 * decay, and a slight fall in pitch as it fades. Quieter than the unlock
 * sound, and shorter: about 0.4 seconds.
 */
function renderPinRejected(context: AudioContext, output: AudioNode, at: number) {
  const notes: Note[] = [
    { frequency: 392, offset: 0, peak: 0.15, decay: 0.16 },
    { frequency: 311.13, offset: 0.11, peak: 0.13, decay: 0.26 },
  ];
  const partials = [
    { ratio: 1, level: 1 },
    { ratio: 3, level: 0.08 },
  ];
  for (const note of notes) {
    const start = at + note.offset;
    for (const partial of partials) {
      const oscillator = context.createOscillator();
      const envelope = context.createGain();
      const frequency = note.frequency * partial.ratio;
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      oscillator.frequency.setValueAtTime(frequency, start);
      oscillator.frequency.exponentialRampToValueAtTime(frequency * 0.97, start + note.decay);
      envelope.gain.setValueAtTime(0, start);
      envelope.gain.linearRampToValueAtTime(note.peak * partial.level, start + 0.006);
      envelope.gain.exponentialRampToValueAtTime(0.0001, start + note.decay);
      oscillator.connect(envelope).connect(output);
      oscillator.start(start);
      oscillator.stop(start + note.decay + 0.02);
    }
  }
}

/*
 * PROTOTYPE, replaceable, synthesized the same way: the press of any control
 * in the dashboard (see click-sounds.ts). It is heard the most, so it is the
 * quietest and shortest: a soft, woody tap. A sine that starts at 1.1kHz and
 * falls to 700Hz within 30ms (the fall is what reads as a tap, not a beep),
 * over a faint body an octave below, a 2ms attack, gone in about 60ms.
 */
function renderTap(context: AudioContext, output: AudioNode, at: number) {
  const voices = [
    { from: 1100, to: 700, peak: 0.075, decay: 0.055 },
    { from: 550, to: 350, peak: 0.03, decay: 0.04 },
  ];
  for (const voice of voices) {
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = voice.from;
    oscillator.frequency.setValueAtTime(voice.from, at);
    oscillator.frequency.exponentialRampToValueAtTime(voice.to, at + 0.03);
    envelope.gain.setValueAtTime(0, at);
    envelope.gain.linearRampToValueAtTime(voice.peak, at + 0.002);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + voice.decay);
    oscillator.connect(envelope).connect(output);
    oscillator.start(at);
    oscillator.stop(at + voice.decay + 0.01);
  }
}

/*
 * The guided tour's sounds (owner, 13 Oct 2026: "create new sounds for the
 * tutorial"). PROTOTYPES, replaceable, synthesized like the rest: sines with
 * a faint partial, no asset. One family, kept below the unlock sound, in F
 * major so they agree with each other wherever the tour is cut:
 *
 * - open: the welcome appears — F5, A5, C6 rising 60ms apart, airy, ~0.55s;
 * - next: a step forward — one short sine gliding up a fourth (C5 → F5),
 *   the tap's opposite motion, ~0.15s;
 * - back: the same glide downwards (F5 → C5);
 * - complete: the end card — F5, A5, C6 then a held F6 with a slow, gentle
 *   decay, the open chord resolved an octave up, ~1s;
 * - close: the tour skipped — C6 falling to F5, quiet and short, ~0.3s.
 */
function renderChord(notes: Note[], partials: Array<{ ratio: number; level: number }>, attack: number) {
  return (context: AudioContext, output: AudioNode, at: number) => {
    for (const note of notes) {
      const start = at + note.offset;
      for (const partial of partials) {
        const oscillator = context.createOscillator();
        const envelope = context.createGain();
        oscillator.type = "sine";
        oscillator.frequency.value = note.frequency * partial.ratio;
        envelope.gain.setValueAtTime(0, start);
        envelope.gain.linearRampToValueAtTime(note.peak * partial.level, start + attack);
        envelope.gain.exponentialRampToValueAtTime(0.0001, start + note.decay);
        oscillator.connect(envelope).connect(output);
        oscillator.start(start);
        oscillator.stop(start + note.decay + 0.02);
      }
    }
  };
}

function renderGlide(from: number, to: number) {
  return (context: AudioContext, output: AudioNode, at: number) => {
    const voices = [
      { ratio: 1, peak: 0.07, decay: 0.13 },
      { ratio: 2, peak: 0.012, decay: 0.09 },
    ];
    for (const voice of voices) {
      const oscillator = context.createOscillator();
      const envelope = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = from * voice.ratio;
      oscillator.frequency.setValueAtTime(from * voice.ratio, at);
      oscillator.frequency.exponentialRampToValueAtTime(to * voice.ratio, at + 0.07);
      envelope.gain.setValueAtTime(0, at);
      envelope.gain.linearRampToValueAtTime(voice.peak, at + 0.012);
      envelope.gain.exponentialRampToValueAtTime(0.0001, at + voice.decay);
      oscillator.connect(envelope).connect(output);
      oscillator.start(at);
      oscillator.stop(at + voice.decay + 0.02);
    }
  };
}

const F5 = 698.46;
const A5 = 880;
const C5 = 523.25;
const C6 = 1046.5;
const F6 = 1396.91;
const airy = [
  { ratio: 1, level: 1 },
  { ratio: 2, level: 0.08 },
];

const renderTourOpen = renderChord([
  { frequency: F5, offset: 0, peak: 0.09, decay: 0.38 },
  { frequency: A5, offset: 0.06, peak: 0.08, decay: 0.42 },
  { frequency: C6, offset: 0.12, peak: 0.07, decay: 0.42 },
], airy, 0.02);

const renderTourComplete = renderChord([
  { frequency: F5, offset: 0, peak: 0.1, decay: 0.4 },
  { frequency: A5, offset: 0.08, peak: 0.09, decay: 0.42 },
  { frequency: C6, offset: 0.16, peak: 0.085, decay: 0.48 },
  { frequency: F6, offset: 0.26, peak: 0.075, decay: 0.74 },
], airy, 0.012);

const renderTourClose = renderChord([
  { frequency: C6, offset: 0, peak: 0.06, decay: 0.16 },
  { frequency: F5, offset: 0.08, peak: 0.055, decay: 0.22 },
], [{ ratio: 1, level: 1 }], 0.008);

const recipes: Record<UISound, Recipe> = {
  "tour-open": { duration: 0.56, render: renderTourOpen },
  "tour-next": { duration: 0.15, render: renderGlide(C5, F5) },
  "tour-back": { duration: 0.15, render: renderGlide(F5, C5) },
  "tour-complete": { duration: 1.02, render: renderTourComplete },
  "tour-close": { duration: 0.32, render: renderTourClose },
  "unlock-success": { duration: 0.525, render: renderUnlockSuccess },
  "pin-rejected": { duration: 0.39, render: renderPinRejected },
  tap: { duration: 0.065, render: renderTap },
};

let context: AudioContext | null = null;
/** A resume that a gesture asked for is under way. */
let waking = false;
let suspendTimer: number | undefined;
const playingUntil = new Map<UISound, number>();
const listeners = new Set<() => void>();

export function isUISoundsEnabled(): boolean {
  try {
    return window.localStorage.getItem(preferenceStorageKey) !== "0";
  } catch {
    return true;
  }
}

export function setUISoundsEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(preferenceStorageKey, enabled ? "1" : "0");
  } catch {
    // Kept for this page only; the default returns on reload.
  }
  if (!enabled) {
    release();
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useUISoundsEnabled(): boolean {
  return useSyncExternalStore(subscribe, isUISoundsEnabled, () => true);
}

function sharedContext(): AudioContext | null {
  if (context && context.state !== "closed") {
    return context;
  }
  const Context = typeof window === "undefined"
    ? undefined
    : window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Context) {
    return null;
  }
  try {
    context = new Context({ latencyHint: "interactive" });
  } catch {
    context = null;
  }
  return context;
}

/**
 * Readies audio for a sound that will follow this gesture. Call it from the
 * event handler itself: browsers let audio start only from a user's
 * interaction. Makes no sound.
 */
export function primeUISounds(): void {
  try {
    if (!isUISoundsEnabled()) {
      return;
    }
    const shared = sharedContext();
    if (!shared) {
      return;
    }
    if (shared.state === "suspended") {
      waking = true;
      void shared.resume().catch(() => undefined).finally(() => { waking = false; });
    }
    suspendLater(primedForMs);
  } catch {
    // Audio is optional.
  }
}

/** Plays a sound now, if sounds are on and a gesture has readied audio. */
export function playUISound(sound: UISound): void {
  try {
    const recipe = recipes[sound];
    // Running, or being woken by this very gesture: never a context left asleep.
    const ready = context?.state === "running" || (context?.state === "suspended" && waking);
    if (!isUISoundsEnabled() || !context || !ready) {
      return;
    }
    const now = performance.now();
    if ((playingUntil.get(sound) ?? 0) > now) {
      return;
    }
    playingUntil.set(sound, now + recipe.duration * 1000);

    const output = context.createGain();
    output.gain.value = masterVolume;
    output.connect(context.destination);
    recipe.render(context, output, context.currentTime);
    suspendLater(recipe.duration * 1000 + suspendAfterMs, () => output.disconnect());
  } catch {
    // Audio is optional.
  }
}

// One timer at most: each call replaces the last.
function suspendLater(delayMs: number, then?: () => void) {
  window.clearTimeout(suspendTimer);
  suspendTimer = window.setTimeout(() => {
    suspendTimer = undefined;
    // Going to sleep ends any waking: from here only a new gesture wakes it.
    waking = false;
    then?.();
    void context?.suspend().catch(() => undefined);
  }, delayMs);
}

function release() {
  window.clearTimeout(suspendTimer);
  suspendTimer = undefined;
  playingUntil.clear();
  waking = false;
  const closing = context;
  context = null;
  void closing?.close().catch(() => undefined);
}

export function resetUISoundsForTests(): void {
  release();
}
