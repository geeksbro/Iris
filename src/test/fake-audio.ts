import { vi } from "vitest";

/**
 * A stand-in AudioContext for jsdom, which has none. It records every sound
 * sent to the speakers (one output gain connected to the destination per
 * sound) and every oscillator started. With `failing`, creating a context
 * throws, as it does where audio is unavailable. With `slowResume`, a resume
 * completes a moment later, as in a browser, instead of at once.
 */
export function installFakeAudio({ failing = false, slowResume = false }: { failing?: boolean; slowResume?: boolean } = {}) {
  const contexts: FakeAudioContext[] = [];
  const sounds: { at: number; volume: number }[] = [];
  const oscillators: { frequency: number; start: number; stop: number }[] = [];

  const param = () => ({
    value: 0,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  });

  class FakeAudioContext {
    state: "suspended" | "running" | "closed" = "suspended";
    currentTime = 0;
    readonly destination = {};

    constructor() {
      if (failing) {
        throw new Error("Audio is unavailable");
      }
      contexts.push(this);
    }

    resume() {
      const wake = () => { if (this.state !== "closed") this.state = "running"; };
      if (slowResume) {
        return Promise.resolve().then(wake);
      }
      wake();
      return Promise.resolve();
    }

    suspend() {
      if (this.state !== "closed") this.state = "suspended";
      return Promise.resolve();
    }

    close() {
      this.state = "closed";
      return Promise.resolve();
    }

    createGain() {
      const node = {
        gain: param(),
        connect: (target: unknown) => {
          if (target === this.destination) {
            sounds.push({ at: performance.now(), volume: node.gain.value });
          }
          return target;
        },
        disconnect: vi.fn(),
      };
      return node;
    }

    createOscillator() {
      const record = { frequency: 0, start: -1, stop: -1 };
      const node = {
        type: "sine",
        frequency: param(),
        connect: (target: unknown) => target,
        start: (at: number) => {
          record.frequency = node.frequency.value;
          record.start = at;
          oscillators.push(record);
        },
        stop: (at: number) => { record.stop = at; },
      };
      return node;
    }
  }

  vi.stubGlobal("AudioContext", FakeAudioContext);
  return { contexts, sounds, oscillators };
}
