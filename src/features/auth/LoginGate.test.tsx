import "fake-indexeddb/auto";

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getPinCredentials, resetPinForTests, setupPin } from "@/data/pin";
import { resetDatabaseForTests } from "@/data/repository";
import { setIdleTimeoutMs } from "@/data/security";
import { resetUISoundsForTests } from "@/features/sound/ui-sound";
import { installFakeAudio } from "@/test/fake-audio";

import { accessRecord } from "./access-record";
import { LoginGate, idleTimeoutMs, useSessionLock, verifiedHoldMs } from "./LoginGate";
import { markSessionUnlocked } from "./session";
import { initializeWithDemoArchive } from "@/test/demo-archive";

// A correct PIN reaches the dashboard only after the unlock motion.
const pastUnlock = { timeout: verifiedHoldMs + 2_000 };

// The lock screen greets by the hour (lock-clock.tsx): any of the three, with
// the chosen name or none.
const greeted = (name = "") =>
  new RegExp(`^(Good morning|Good afternoon|Good evening)${name ? `, ${name}` : ""}$`);

const unlockedCard = '.iris-lock__card[data-phase="unlocked"]';

function renderGate() {
  return render(
    <LoginGate>
      <div data-testid="protected-content">Dashboard content</div>
    </LoginGate>,
  );
}

// Records when the card first entered its unlocked phase (the padlocks
// opening), what the session said at that moment, how many times it did, and
// when the dashboard first appeared.
function watchForUnlock() {
  let entered = 0;
  let unlockedAt: number | null = null;
  let flagAtUnlock: string | null = null;
  let dashboardAt: number | null = null;
  const read = (records: MutationRecord[]) => {
    const now = performance.now();
    for (const record of records) {
      const target = record.target as Element;
      if (record.type === "attributes" && target.matches?.(unlockedCard)) {
        entered += 1;
        if (unlockedAt === null) {
          unlockedAt = now;
          flagAtUnlock = window.sessionStorage.getItem("wealth-unlocked");
        }
      }
      for (const node of record.addedNodes) {
        if (node instanceof Element && node.querySelector(unlockedCard)) {
          entered += 1;
          if (unlockedAt === null) {
            unlockedAt = now;
            flagAtUnlock = window.sessionStorage.getItem("wealth-unlocked");
          }
        }
        if (dashboardAt === null && node instanceof Element
          && (node.matches('[data-testid="protected-content"]') || node.querySelector('[data-testid="protected-content"]'))) {
          dashboardAt = now;
        }
      }
    }
  };
  const observer = new MutationObserver(read);
  observer.observe(document.body, { attributeFilter: ["data-phase"], attributes: true, childList: true, subtree: true });
  const flush = () => read(observer.takeRecords());
  return {
    entered: () => { flush(); return entered; },
    moments: () => { flush(); return { unlockedAt, flagAtUnlock, dashboardAt }; },
    stop: () => observer.disconnect(),
  };
}

// The sounds heard, in order, told apart by their first note: the unlock
// sound opens on D5, the refusal on G4.
function heard(audio: ReturnType<typeof installFakeAudio>) {
  return audio.oscillators
    .filter((note) => note.frequency === 587.33 || note.frequency === 392)
    .map((note) => (note.frequency === 392 ? "refusal" : "unlock"));
}

function stubReducedMotion() {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("prefers-reduced-motion: reduce"),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
}

describe("LoginGate", () => {
  beforeEach(async () => {
    await resetDatabaseForTests();
    await initializeWithDemoArchive();
    await resetPinForTests();
    window.sessionStorage.clear();
    window.localStorage.setItem("wealth-language", "en");
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    resetUISoundsForTests();
    window.localStorage.removeItem("wealth-ui-sounds");
    // Exit copies of windows live outside React's tree.
    document.querySelectorAll(".is-exit-ghost").forEach((node) => node.remove());
    delete document.documentElement.dataset.arrival;
    delete document.documentElement.dataset.theme;
    await resetPinForTests();
    window.sessionStorage.clear();
    for (const key of ["wealth-language", "wealth-lock-background", "wealth-display-name", "wealth-last-access", "wealth-theme"]) {
      window.localStorage.removeItem(key);
    }
  });

  it("locks after the auto-lock chosen in Settings, and says how long it waited", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await setIdleTimeoutMs(30_000);
    await setupPin("2026");
    markSessionUnlocked();
    renderGate();

    expect(await screen.findByTestId("protected-content")).toBeInTheDocument();
    // The stored policy is read before the count that matters starts.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    act(() => vi.advanceTimersByTime(28_000));
    expect(screen.getByTestId("protected-content")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(3_000));
    expect(await screen.findByRole("heading", { name: greeted() })).toBeInTheDocument();
    expect(screen.getByText(/interrupted after 30 seconds/i)).toHaveAttribute("role", "status");
  });

  it("puts the chosen background behind the lock screen and greets the chosen name, the PIN untouched", async () => {
    window.localStorage.setItem("wealth-lock-background", "none");
    window.localStorage.setItem("wealth-display-name", "Ada");
    await setupPin("2026");
    const { container } = renderGate();

    expect(await screen.findByRole("heading", { name: greeted("Ada") })).toBeInTheDocument();
    // No ground at all: the lock screen's own still gradient.
    expect(container.querySelector(".lock-sky")).toBeNull();
    // The card works exactly the same.
    fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "2026" } });
    fireEvent.click(screen.getByRole("button", { name: /unlock dashboard/i }));
    expect(await screen.findByTestId("protected-content", {}, pastUnlock)).toBeInTheDocument();
  });

  it("has no window chrome any more: no red control, no resting padlock", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await setupPin("2026");
    const { container } = renderGate();

    const input = await screen.findByLabelText("PIN");
    expect(container.querySelector(".window-control, .window-bar")).toBeNull();
    expect(screen.queryByRole("button", { name: "Back to lock" })).not.toBeInTheDocument();

    // Waiting changes nothing: the card never folds into a padlock.
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.queryByRole("button", { name: "Enter PIN" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("PIN")).toBe(input);
  });

  it("greets without a name when the name is left empty, and draws the clouds when chosen", async () => {
    window.localStorage.setItem("wealth-display-name", "");
    window.localStorage.setItem("wealth-lock-background", "still-sky");
    await setupPin("2026");
    const { container } = renderGate();

    expect(await screen.findByRole("heading", { name: greeted() })).toBeInTheDocument();
    expect(container.querySelector(".iris-lock > .lock-sky.cloud-shader")).not.toBeNull();
  });

  it("draws the aurora by default, behind everything and silent, and lets it go with the screen", async () => {
    await setupPin("2026");
    const { container } = renderGate();

    expect(await screen.findByRole("heading", { name: greeted() })).toBeInTheDocument();
    const grounds = container.querySelectorAll(".lock-sky");
    expect(grounds).toHaveLength(1);
    const ground = grounds[0];
    expect(ground).toHaveClass("aurora-shader");
    expect(ground.parentElement).toHaveClass("iris-lock");
    expect(ground).toHaveAttribute("aria-hidden", "true");

    fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "2026" } });
    fireEvent.click(screen.getByRole("button", { name: /unlock dashboard/i }));
    await waitFor(() => expect(container.querySelector(unlockedCard)).not.toBeNull());
    // Still there while the screen leaves, with nothing of the ledger under it.
    expect(container.querySelector(".lock-sky")).toBe(ground);
    expect(screen.queryByTestId("protected-content")).not.toBeInTheDocument();

    expect(await screen.findByTestId("protected-content", {}, pastUnlock)).toBeInTheDocument();
    expect(container.querySelector(".lock-sky")).toBeNull();
  });

  it("shows the first-access flow in Italian by default", async () => {
    window.localStorage.removeItem("wealth-language");
    renderGate();

    expect(await screen.findByRole("heading", { name: "Crea il tuo PIN" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Crea PIN e continua" })).toBeInTheDocument();
  });

  it("shows the setup flow when no PIN exists and unlocks after creation", async () => {
    renderGate();

    expect(await screen.findByRole("heading", { name: "Create your PIN" })).toBeInTheDocument();
    expect(screen.queryByTestId("protected-content")).not.toBeInTheDocument();
    // No last access to show before there is a PIN.
    expect(screen.queryByRole("complementary", { name: "Last access" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "2026" } });
    fireEvent.change(screen.getByLabelText("Confirm PIN"), { target: { value: "2026" } });
    fireEvent.click(screen.getByRole("button", { name: /create pin/i }));

    expect(await screen.findByTestId("protected-content", {}, pastUnlock)).toBeInTheDocument();
    expect(await getPinCredentials()).not.toBeNull();
  });

  it("requires matching confirmation during setup", async () => {
    renderGate();

    expect(await screen.findByRole("heading", { name: "Create your PIN" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "2026" } });
    fireEvent.change(screen.getByLabelText("Confirm PIN"), { target: { value: "9999" } });
    fireEvent.click(screen.getByRole("button", { name: /create pin/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/do not match/i);
    expect(screen.queryByTestId("protected-content")).not.toBeInTheDocument();
  });

  it("rejects an invalid PIN format before verification", async () => {
    renderGate();

    expect(await screen.findByRole("heading", { name: "Create your PIN" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "12" } });
    fireEvent.change(screen.getByLabelText("Confirm PIN"), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: /create pin/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/4 to 8 digits/i);
    expect(await getPinCredentials()).toBeNull();
  });

  it("blocks an incorrect PIN and unlocks with the correct one", async () => {
    await setupPin("2026");
    renderGate();

    expect(await screen.findByRole("heading", { name: greeted() })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "0000" } });
    fireEvent.click(screen.getByRole("button", { name: /unlock dashboard/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/incorrect pin/i);
    expect(screen.queryByTestId("protected-content")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "2026" } });
    fireEvent.click(screen.getByRole("button", { name: /unlock dashboard/i }));

    expect(await screen.findByTestId("protected-content", {}, pastUnlock)).toBeInTheDocument();
  });

  it("opens the padlocks for verifiedHoldMs before the dashboard, and never before verification", async () => {
    // Real time: the hold is measured, not simulated.
    await setupPin("2026");
    const unlocks = watchForUnlock();
    const { container } = renderGate();

    expect(await screen.findByRole("heading", { name: greeted() })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: /unlock dashboard/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/4 to 8 digits/i);

    fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "0000" } });
    fireEvent.click(screen.getByRole("button", { name: /unlock dashboard/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/incorrect pin/i);
    expect(unlocks.entered()).toBe(0);

    fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "2026" } });
    fireEvent.click(screen.getByRole("button", { name: /unlock dashboard/i }));
    await waitFor(() => expect(container.querySelector(unlockedCard)).not.toBeNull());

    // Verified: the session is authoritatively unlocked, yet only the lock
    // screen is there, its field and button closed.
    expect(window.sessionStorage.getItem("wealth-unlocked")).toBe("1");
    expect(screen.queryByTestId("protected-content")).not.toBeInTheDocument();
    const button = screen.getByRole("button", { name: /unlock dashboard/i });
    expect(button).toBeDisabled();
    expect(screen.getByLabelText("PIN")).toBeDisabled();

    // Pressing again changes nothing.
    fireEvent.click(button);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    expect(await screen.findByTestId("protected-content", {}, pastUnlock)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: greeted() })).not.toBeInTheDocument();
    // The dashboard rises into place: the flag is set for its rise.
    expect(document.documentElement.dataset.arrival).toBe("unlock");

    // The card entered its unlocked phase once, only after the session was
    // unlocked, and the dashboard followed it by the full hold.
    const { unlockedAt, flagAtUnlock, dashboardAt } = unlocks.moments();
    unlocks.stop();
    expect(unlocks.entered()).toBe(1);
    expect(flagAtUnlock).toBe("1");
    expect(dashboardAt! - unlockedAt!).toBeGreaterThanOrEqual(verifiedHoldMs - 1);
    expect(dashboardAt! - unlockedAt!).toBeLessThan(verifiedHoldMs + 400);
  });

  it("never opens the padlocks for a rejected setup", async () => {
    const unlocks = watchForUnlock();
    renderGate();

    expect(await screen.findByRole("heading", { name: "Create your PIN" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "12" } });
    fireEvent.change(screen.getByLabelText("Confirm PIN"), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: /create pin/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/4 to 8 digits/i);

    fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "2026" } });
    fireEvent.change(screen.getByLabelText("Confirm PIN"), { target: { value: "9999" } });
    fireEvent.click(screen.getByRole("button", { name: /create pin/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/do not match/i);
    expect(unlocks.entered()).toBe(0);
    unlocks.stop();
  });

  it("under reduced motion lets go at once, with no sinking and no rise", async () => {
    stubReducedMotion();
    await setupPin("2026");
    const unlocks = watchForUnlock();
    const { container } = renderGate();

    expect(await screen.findByRole("heading", { name: greeted() })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "2026" } });
    fireEvent.click(screen.getByRole("button", { name: /unlock dashboard/i }));
    await waitFor(() => expect(container.querySelector(unlockedCard)).not.toBeNull());

    expect(await screen.findByTestId("protected-content", {}, pastUnlock)).toBeInTheDocument();
    expect(document.documentElement.dataset.arrival).toBeUndefined();
    const { unlockedAt, dashboardAt } = unlocks.moments();
    unlocks.stop();
    expect(dashboardAt! - unlockedAt!).toBeLessThan(verifiedHoldMs);
  });

  it("records the last access and the wrong PINs since, and shows them beside the card", async () => {
    await setupPin("2026");
    renderGate();

    expect(await screen.findByRole("heading", { name: greeted() })).toBeInTheDocument();
    const leaf = screen.getByRole("complementary", { name: "Last access" });
    expect(leaf).toHaveTextContent(/none recorded/i);

    fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "0000" } });
    fireEvent.click(screen.getByRole("button", { name: /unlock dashboard/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/incorrect pin/i);
    expect(accessRecord.get().wrongSince).toBe(1);
    expect(leaf).toHaveTextContent(/1 wrong PIN since/i);

    fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "2026" } });
    fireEvent.click(screen.getByRole("button", { name: /unlock dashboard/i }));
    expect(await screen.findByTestId("protected-content", {}, pastUnlock)).toBeInTheDocument();
    // Stamped as the screen left: now, and the count starts again.
    const record = accessRecord.get();
    expect(record.wrongSince).toBe(0);
    expect(Date.now() - Date.parse(record.at!)).toBeLessThan(5_000);
  });

  it("unlocks on the PIN's last digit, without the button, as the Trading OS does", async () => {
    await setupPin("765271");
    renderGate();

    expect(await screen.findByRole("heading", { name: greeted() })).toBeInTheDocument();
    // Five digits of six: nothing is sent.
    fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "76527" } });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(window.sessionStorage.getItem("wealth-unlocked")).toBeNull();

    // The sixth sends it.
    fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "765271" } });
    expect(await screen.findByTestId("protected-content", {}, pastUnlock)).toBeInTheDocument();
  });

  it("refuses a wrong PIN on its last digit once, counted once", async () => {
    const audio = installFakeAudio();
    await setupPin("2026");
    renderGate();

    expect(await screen.findByRole("heading", { name: greeted() })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "0000" } });
    // Pressed in the same moment the last digit sends it: still one check.
    fireEvent.click(screen.getByRole("button", { name: /unlock dashboard/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/incorrect pin/i);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 100)); });
    expect(accessRecord.get().wrongSince).toBe(1);
    expect(heard(audio)).toEqual(["refusal"]);
  });

  it("waits for the button with a PIN whose length is not known yet, and learns it there", async () => {
    await setupPin("2026");
    const { getPinCredentials: read } = await import("@/data/pin");
    const { wealthDb } = await import("@/data/db");
    const { length: _length, ...older } = (await read())!;
    void _length;
    await wealthDb.metadata.put({ key: "pin-credentials", value: older });
    renderGate();

    expect(await screen.findByRole("heading", { name: greeted() })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "2026" } });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 100)); });
    expect(window.sessionStorage.getItem("wealth-unlocked")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /unlock dashboard/i }));
    expect(await screen.findByTestId("protected-content", {}, pastUnlock)).toBeInTheDocument();
    expect((await read())?.length).toBe(4);
  });

  it("switches the theme before unlocking, and sends a digit typed anywhere into the field", async () => {
    await setupPin("2026");
    renderGate();

    expect(await screen.findByRole("heading", { name: greeted() })).toBeInTheDocument();
    // The lock screen subscribes to the theme and to the keyboard in its mount
    // effects; under load they can run a moment after the heading shows, and a
    // click before them would be seen only a moment later (no user-facing
    // effect, but the assertions below are immediate).
    await act(async () => { await Promise.resolve(); });
    const themeSwitch = screen.getByRole("button", { name: "Dark theme" });
    expect(themeSwitch).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(themeSwitch);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(window.localStorage.getItem("wealth-theme")).toBe("dark");
    expect(themeSwitch).toHaveAttribute("aria-pressed", "true");

    const field = screen.getByLabelText("PIN");
    expect(field).not.toHaveFocus();
    fireEvent.keyDown(document.body, { key: "7" });
    expect(field).toHaveFocus();
  });

  it("plays the unlock sound once, as the padlocks open, and the refusal for a rejected PIN", async () => {
    const audio = installFakeAudio();
    await setupPin("2026");
    const { container } = renderGate();

    expect(await screen.findByRole("heading", { name: greeted() })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "0000" } });
    fireEvent.click(screen.getByRole("button", { name: /unlock dashboard/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/incorrect pin/i);
    // The refusal arrives with the message, once the PIN has been checked.
    expect(heard(audio)).toEqual(["refusal"]);

    fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "2026" } });
    fireEvent.click(screen.getByRole("button", { name: /unlock dashboard/i }));
    // Pressing the button is not success: nothing plays while the PIN is checked.
    expect(heard(audio)).toEqual(["refusal"]);
    await waitFor(() => expect(container.querySelector(unlockedCard)).not.toBeNull());
    // The padlocks and the sound arrive in the same commit, after verification.
    expect(heard(audio)).toEqual(["refusal", "unlock"]);
    expect(window.sessionStorage.getItem("wealth-unlocked")).toBe("1");

    // Pressing again while it leaves changes nothing, sound included.
    fireEvent.click(screen.getByRole("button", { name: /unlock dashboard/i }));
    fireEvent.submit(container.querySelector(".iris-lock__form")!);
    expect(await screen.findByTestId("protected-content", {}, pastUnlock)).toBeInTheDocument();
    expect(heard(audio)).toEqual(["refusal", "unlock"]);
  });

  it("refuses an empty or short PIN out loud at once, even on the first press", async () => {
    // As in a browser: the first press creates audio, which is still waking when the PIN is refused.
    const audio = installFakeAudio({ slowResume: true });
    await setupPin("2026");
    renderGate();

    expect(await screen.findByRole("heading", { name: greeted() })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /unlock dashboard/i }));
    expect(screen.getByRole("alert")).toHaveTextContent(/4 to 8 digits/i);
    expect(heard(audio)).toEqual(["refusal"]);

    // Another press while it still sounds does not stack on it.
    fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: /unlock dashboard/i }));
    expect(screen.getByRole("alert")).toHaveTextContent(/4 to 8 digits/i);
    expect(heard(audio)).toEqual(["refusal"]);
  });

  it("plays nothing for a PIN just created, and once when the session it protects is unlocked", async () => {
    const audio = installFakeAudio();
    function LockableContent() {
      const lock = useSessionLock();
      return <button onClick={() => lock?.()} type="button">Lock the session</button>;
    }
    const { container } = render(<LoginGate><LockableContent /></LoginGate>);

    // Creating the PIN: its refusals and its unlock, all in silence.
    expect(await screen.findByRole("heading", { name: "Create your PIN" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /create pin/i }));
    expect(screen.getByRole("alert")).toHaveTextContent(/4 to 8 digits/i);
    fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "2026" } });
    fireEvent.change(screen.getByLabelText("Confirm PIN"), { target: { value: "2027" } });
    fireEvent.click(screen.getByRole("button", { name: /create pin/i }));
    expect(screen.getByRole("alert")).toHaveTextContent(/do not match/i);
    fireEvent.change(screen.getByLabelText("Confirm PIN"), { target: { value: "2026" } });
    fireEvent.click(screen.getByRole("button", { name: /create pin/i }));
    await waitFor(() => expect(container.querySelector(unlockedCard)).not.toBeNull());
    fireEvent.submit(container.querySelector(".iris-lock__form")!);
    const lockButton = await screen.findByRole("button", { name: "Lock the session" }, pastUnlock);
    expect(audio.sounds).toHaveLength(0);

    // The session it now protects, locked, then reopened: a refusal, then one unlock sound.
    fireEvent.click(lockButton);
    expect(await screen.findByRole("heading", { name: greeted() })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "9999" } });
    fireEvent.click(screen.getByRole("button", { name: /unlock dashboard/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/incorrect pin/i);
    expect(heard(audio)).toEqual(["refusal"]);

    fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "2026" } });
    fireEvent.click(screen.getByRole("button", { name: /unlock dashboard/i }));
    await waitFor(() => expect(container.querySelector(unlockedCard)).not.toBeNull());
    expect(heard(audio)).toEqual(["refusal", "unlock"]);
    fireEvent.submit(container.querySelector(".iris-lock__form")!);
    fireEvent.click(screen.getByRole("button", { name: /unlock dashboard/i }));
    expect(await screen.findByRole("button", { name: "Lock the session" }, pastUnlock)).toBeInTheDocument();
    expect(heard(audio)).toEqual(["refusal", "unlock"]);
  });

  it("unlocks the same way, in silence, with interface sounds turned off", async () => {
    window.localStorage.setItem("wealth-ui-sounds", "0");
    const audio = installFakeAudio();
    await setupPin("2026");
    const { container } = renderGate();

    expect(await screen.findByRole("heading", { name: greeted() })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /unlock dashboard/i }));
    expect(screen.getByRole("alert")).toHaveTextContent(/4 to 8 digits/i);
    fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "2026" } });
    fireEvent.click(screen.getByRole("button", { name: /unlock dashboard/i }));
    await waitFor(() => expect(container.querySelector(unlockedCard)).not.toBeNull());
    expect(await screen.findByTestId("protected-content", {}, pastUnlock)).toBeInTheDocument();
    // Neither the refusal nor the unlock: not even a context was created.
    expect(audio.contexts).toHaveLength(0);
    expect(audio.sounds).toHaveLength(0);
  });

  it("unlocks normally where audio is unavailable", async () => {
    installFakeAudio({ failing: true });
    await setupPin("2026");
    const { container } = renderGate();

    expect(await screen.findByRole("heading", { name: greeted() })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "2026" } });
    fireEvent.click(screen.getByRole("button", { name: /unlock dashboard/i }));
    await waitFor(() => expect(container.querySelector(unlockedCard)).not.toBeNull());
    expect(await screen.findByTestId("protected-content", {}, pastUnlock)).toBeInTheDocument();
  });

  it("stays unlocked within the tab session", async () => {
    markSessionUnlocked();
    renderGate();

    expect(await screen.findByTestId("protected-content")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /PIN|Good (morning|afternoon|evening)/i })).not.toBeInTheDocument();
    // No ground runs behind an open ledger.
    expect(document.querySelector(".lock-sky")).toBeNull();
  });

  it("keeps the session open before 120 seconds and then requires the PIN again", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await setupPin("2026");
    markSessionUnlocked();
    renderGate();

    expect(await screen.findByTestId("protected-content")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(119_000));
    expect(screen.getByTestId("protected-content")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(1_000));

    expect(await screen.findByRole("heading", { name: greeted() })).toBeInTheDocument();
    expect(screen.getByText(/interrupted after 2 minutes/i)).toHaveAttribute("role", "status");
    expect(screen.queryByTestId("protected-content")).not.toBeInTheDocument();
    // The idle lock brings the ground back with the screen.
    expect(document.querySelectorAll(".iris-lock > .lock-sky")).toHaveLength(1);

    fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "2026" } });
    fireEvent.click(screen.getByRole("button", { name: /unlock dashboard/i }));

    // Unlocking again after the idle lock goes through the same motion.
    await waitFor(() => expect(document.querySelector(unlockedCard)).not.toBeNull());
    expect(screen.queryByTestId("protected-content")).not.toBeInTheDocument();
    expect(await screen.findByTestId("protected-content", {}, pastUnlock)).toBeInTheDocument();
  });

  it("keeps the session alive while the mouse keeps moving", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await setupPin("2026");
    markSessionUnlocked();
    renderGate();

    expect(await screen.findByTestId("protected-content")).toBeInTheDocument();

    for (let round = 0; round < 3; round += 1) {
      vi.advanceTimersByTime(idleTimeoutMs / 2);
      fireEvent.mouseMove(window, { clientX: round * 10, clientY: round * 10 });
    }

    expect(screen.queryByRole("heading", { name: greeted() })).not.toBeInTheDocument();
    expect(screen.getByTestId("protected-content")).toBeInTheDocument();

    vi.advanceTimersByTime(idleTimeoutMs);

    expect(await screen.findByRole("heading", { name: greeted() })).toBeInTheDocument();
    expect(screen.queryByTestId("protected-content")).not.toBeInTheDocument();
  });

  it("clears the session flag when locking for inactivity", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await setupPin("2026");
    markSessionUnlocked();
    renderGate();

    expect(await screen.findByTestId("protected-content")).toBeInTheDocument();
    expect(window.sessionStorage.getItem("wealth-unlocked")).toBe("1");

    vi.advanceTimersByTime(idleTimeoutMs);

    expect(await screen.findByRole("heading", { name: greeted() })).toBeInTheDocument();
    expect(window.sessionStorage.getItem("wealth-unlocked")).toBeNull();
  });
});
