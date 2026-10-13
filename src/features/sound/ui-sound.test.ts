import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installFakeAudio } from "@/test/fake-audio";
import {
  isUISoundsEnabled,
  playUISound,
  primeUISounds,
  resetUISoundsForTests,
  setUISoundsEnabled,
} from "./ui-sound";

describe("interface sounds", () => {
  beforeEach(() => {
    window.localStorage.removeItem("wealth-ui-sounds");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  });

  afterEach(() => {
    resetUISoundsForTests();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    window.localStorage.removeItem("wealth-ui-sounds");
  });

  it("is on by default and remembers being turned off on this device", () => {
    expect(isUISoundsEnabled()).toBe(true);
    setUISoundsEnabled(false);
    expect(window.localStorage.getItem("wealth-ui-sounds")).toBe("0");
    expect(isUISoundsEnabled()).toBe(false);
    setUISoundsEnabled(true);
    expect(window.localStorage.getItem("wealth-ui-sounds")).toBe("1");
    expect(isUISoundsEnabled()).toBe(true);
  });

  it("never starts audio on its own: without a gesture having readied it, nothing plays", () => {
    const audio = installFakeAudio();
    playUISound("unlock-success");
    expect(audio.contexts).toHaveLength(0);
    expect(audio.sounds).toHaveLength(0);
  });

  it("plays the unlock sound once, quietly and briefly, after a gesture readied audio", () => {
    const audio = installFakeAudio();
    primeUISounds();
    expect(audio.contexts).toHaveLength(1);
    // Readying makes no sound.
    expect(audio.sounds).toHaveLength(0);

    playUISound("unlock-success");
    expect(audio.sounds).toEqual([expect.objectContaining({ volume: 0.5 })]);
    // A rising fifth: two notes, each with its faint octave.
    expect(audio.oscillators.map((note) => Math.round(note.frequency))).toEqual([587, 1175, 880, 1760]);
    const end = Math.max(...audio.oscillators.map((note) => note.stop));
    expect(end).toBeGreaterThanOrEqual(0.25);
    expect(end).toBeLessThanOrEqual(0.6);
  });

  it("plays the refusal as the unlock sound's counterpart: falling, low, shorter", () => {
    const audio = installFakeAudio();
    primeUISounds();

    playUISound("pin-rejected");
    expect(audio.sounds).toEqual([expect.objectContaining({ volume: 0.5 })]);
    // A falling major third, G4 to E-flat4, each with its faint third harmonic.
    expect(audio.oscillators.map((note) => Math.round(note.frequency))).toEqual([392, 1176, 311, 933]);
    const end = Math.max(...audio.oscillators.map((note) => note.stop));
    expect(end).toBeGreaterThanOrEqual(0.25);
    expect(end).toBeLessThanOrEqual(0.45);
  });

  it("is heard on the very gesture that wakes audio, but never on a context left asleep", async () => {
    const audio = installFakeAudio({ slowResume: true });
    // The first press: the context is created and still waking when the PIN is refused.
    primeUISounds();
    expect(audio.contexts[0].state).toBe("suspended");
    playUISound("pin-rejected");
    expect(audio.sounds).toHaveLength(1);
    await Promise.resolve();
    expect(audio.contexts[0].state).toBe("running");

    // Asleep again, with no gesture waking it: skipped, not played late.
    vi.advanceTimersByTime(3_000);
    await Promise.resolve();
    expect(audio.contexts[0].state).toBe("suspended");
    playUISound("pin-rejected");
    expect(audio.sounds).toHaveLength(1);
  });

  it("does not stack: asked again while it plays, the sound is ignored", () => {
    const audio = installFakeAudio();
    primeUISounds();
    playUISound("unlock-success");
    vi.advanceTimersByTime(100);
    playUISound("unlock-success");
    playUISound("unlock-success");
    expect(audio.sounds).toHaveLength(1);

    // Only a later verification plays it again.
    vi.advanceTimersByTime(600);
    primeUISounds();
    playUISound("unlock-success");
    expect(audio.sounds).toHaveLength(2);
  });

  it("puts audio back to sleep after a sound, and after a gesture no sound followed", () => {
    const audio = installFakeAudio();
    primeUISounds();
    const [context] = audio.contexts;
    expect(context.state).toBe("running");

    // A rejected PIN: readied, then nothing.
    vi.advanceTimersByTime(3_000);
    expect(context.state).toBe("suspended");

    primeUISounds();
    playUISound("unlock-success");
    vi.advanceTimersByTime(800);
    expect(context.state).toBe("suspended");
    // One shared context for every sound.
    expect(audio.contexts).toHaveLength(1);
  });

  it("skips a sound on a context that is not running rather than playing it late", () => {
    const audio = installFakeAudio();
    primeUISounds();
    vi.advanceTimersByTime(3_000);
    playUISound("unlock-success");
    expect(audio.sounds).toHaveLength(0);
  });

  it("is silent when turned off, and releases the context it had", () => {
    const audio = installFakeAudio();
    primeUISounds();
    setUISoundsEnabled(false);
    expect(audio.contexts[0].state).toBe("closed");

    primeUISounds();
    playUISound("unlock-success");
    expect(audio.contexts).toHaveLength(1);
    expect(audio.sounds).toHaveLength(0);
  });

  it("gives the guided tour a family of its own: quiet, in one key, each with its own shape", () => {
    const audio = installFakeAudio();
    const heardFor = (sound: Parameters<typeof playUISound>[0]) => {
      audio.oscillators.length = 0;
      primeUISounds();
      playUISound(sound);
      const end = Math.max(...audio.oscillators.map((note) => note.stop));
      return { notes: audio.oscillators.filter((_, index) => index % 2 === 0).map((note) => Math.round(note.frequency)), end };
    };
    // The welcome rises through F major; the end resolves it an octave up.
    expect(heardFor("tour-open")).toMatchObject({ notes: [698, 880, 1047] });
    expect(heardFor("tour-complete").notes).toEqual([698, 880, 1047, 1397]);
    // A step forward glides up from C5, a step back down from F5: one voice each.
    expect(heardFor("tour-next").notes).toEqual([523]);
    expect(heardFor("tour-back").notes).toEqual([698]);
    expect(heardFor("tour-close").notes).toEqual([1047]);
    expect(heardFor("tour-next").end).toBeLessThanOrEqual(0.2);
    expect(heardFor("tour-complete").end).toBeLessThanOrEqual(1.1);
    // Every one at the shared level.
    expect(new Set(audio.sounds.map((sound) => sound.volume))).toEqual(new Set([0.5]));
  });

  it("never throws where audio is unavailable", () => {
    installFakeAudio({ failing: true });
    expect(() => primeUISounds()).not.toThrow();
    expect(() => playUISound("unlock-success")).not.toThrow();
  });
});
