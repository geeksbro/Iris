import "fake-indexeddb/auto";

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getPinCredentials, resetPinForTests, setupPin } from "@/data/pin";
import { initializeDatabase, resetDatabaseForTests, wealthDb } from "@/data/repository";
import { LoginGate, verifiedHoldMs } from "@/features/auth/LoginGate";
import { markSessionUnlocked } from "@/features/auth/session";
import { WealthDashboard } from "@/features/dashboard/WealthDashboard";
import { resetUISoundsForTests } from "@/features/sound/ui-sound";
import { installFakeAudio } from "@/test/fake-audio";
import { onboarding, onboardingTourVersion, parseOnboardingRecord } from "@/features/settings/preferences";

import { placePanel, spotlightBox, spotlightRadius, unionBox, visibleShare } from "./geometry";
import { markOnboardingFirstRun, settleOnboarding, shouldStartOnboarding } from "./onboarding";
import { tourSteps } from "./steps";

const recordKey = "wealth-onboarding";
const pastUnlock = { timeout: verifiedHoldMs + 3_000 };
const tourAppears = { timeout: 3_000 };
/* PIN hashing (PBKDF2, slow by design) and the unlock's 1.2s hold, twice
   over: under a full parallel run these flows outlast the default 5s. */
const slowFlow = 20_000;

const storedRecord = () => {
  const raw = window.localStorage.getItem(recordKey);
  return raw === null ? null : JSON.parse(raw);
};

const firstRun = (at = "2026-10-12T09:00:00.000Z") =>
  window.localStorage.setItem(recordKey, JSON.stringify({ version: 1, status: "not-started", firstRunAt: at }));

/** Everything the ledger holds, for proving the tour changed none of it. */
async function ledger() {
  const [accounts, snapshots, paychecks, goals, cash] = await Promise.all([
    wealthDb.accounts.toArray(),
    wealthDb.snapshots.toArray(),
    wealthDb.paychecks.toArray(),
    wealthDb.goals.toArray(),
    wealthDb.cashDenominations.toArray(),
  ]);
  return JSON.stringify({ accounts, snapshots, paychecks, goals, cash });
}

/** Every device preference but the tour's own record. */
function preferences() {
  return JSON.stringify(Object.keys(window.localStorage).filter((key) => key !== recordKey).sort()
    .map((key) => [key, window.localStorage.getItem(key)]));
}

const tourDialog = () => screen.queryByRole("dialog");
const heading = (name: string) => screen.getByRole("heading", { hidden: true, level: 1, name });

function renderApp() {
  return render(<LoginGate><WealthDashboard /></LoginGate>);
}

describe("the onboarding record", () => {
  afterEach(() => window.localStorage.removeItem(recordKey));

  it("reads only well-formed records, so a damaged value is no record at all", () => {
    expect(parseOnboardingRecord('{"version":1,"status":"not-started","firstRunAt":"2026-10-12T09:00:00.000Z"}'))
      .toEqual({ version: 1, status: "not-started", firstRunAt: "2026-10-12T09:00:00.000Z" });
    expect(parseOnboardingRecord('{"version":1,"status":"completed","decidedAt":"2026-10-12T09:05:00.000Z"}'))
      .toEqual({ version: 1, status: "completed", decidedAt: "2026-10-12T09:05:00.000Z" });
    for (const damaged of [
      "true",
      "not json",
      '{"version":1,"status":"done","decidedAt":"2026-10-12T09:05:00.000Z"}',
      '{"version":0,"status":"skipped","decidedAt":"2026-10-12T09:05:00.000Z"}',
      // Only a first run writes "not-started", and it never has a decision date.
      '{"version":1,"status":"not-started"}',
      '{"version":1,"status":"not-started","firstRunAt":"2026-10-12T09:00:00.000Z","decidedAt":"2026-10-12T09:05:00.000Z"}',
      // A decision always carries its date.
      '{"version":1,"status":"skipped","firstRunAt":"2026-10-12T09:00:00.000Z"}',
      '{"version":1,"status":"completed","decidedAt":"yesterday"}',
    ]) {
      expect(parseOnboardingRecord(damaged)).toBeUndefined();
    }
    window.localStorage.setItem(recordKey, "{broken");
    expect(onboarding.get()).toBeNull();
  });

  it("marks a first run once and never over a decision already made on this device", () => {
    markOnboardingFirstRun(new Date("2026-10-12T09:00:00.000Z"));
    expect(storedRecord()).toEqual({ version: onboardingTourVersion, status: "not-started", firstRunAt: "2026-10-12T09:00:00.000Z" });
    expect(shouldStartOnboarding(onboarding.get())).toBe(true);

    settleOnboarding("completed", new Date("2026-10-12T09:04:00.000Z"));
    markOnboardingFirstRun(new Date("2026-10-13T10:00:00.000Z"));
    expect(storedRecord()).toEqual({
      version: onboardingTourVersion,
      status: "completed",
      firstRunAt: "2026-10-12T09:00:00.000Z",
      decidedAt: "2026-10-12T09:04:00.000Z",
    });
    expect(shouldStartOnboarding(onboarding.get())).toBe(false);
  });

  it("never lets a skipped re-run undo a completion, and records a skip on its own", () => {
    settleOnboarding("completed", new Date("2026-10-12T09:04:00.000Z"));
    settleOnboarding("skipped", new Date("2026-10-14T09:00:00.000Z"));
    expect(storedRecord()).toEqual({ version: onboardingTourVersion, status: "completed", decidedAt: "2026-10-12T09:04:00.000Z" });

    window.localStorage.removeItem(recordKey);
    settleOnboarding("skipped", new Date("2026-10-14T09:00:00.000Z"));
    expect(storedRecord()).toEqual({ version: onboardingTourVersion, status: "skipped", decidedAt: "2026-10-14T09:00:00.000Z" });
  });

  it("does not offer the tour again to a device that decided under an earlier version", () => {
    window.localStorage.setItem(recordKey, JSON.stringify({ version: 1, status: "skipped", decidedAt: "2026-01-01T00:00:00.000Z" }));
    expect(shouldStartOnboarding(onboarding.get())).toBe(false);
    expect(shouldStartOnboarding(null)).toBe(false);
  });
});

describe("the tour's geometry", () => {
  const screenSize = { width: 1440, height: 900 };

  it("opens around its targets, inside the screen, with a corner concentric with theirs", () => {
    expect(unionBox([{ left: 10, top: 20, width: 100, height: 40 }, { left: 10, top: 66, width: 100, height: 40 }]))
      .toEqual({ left: 10, top: 20, width: 100, height: 86 });
    expect(spotlightBox({ left: 2, top: 100, width: 50, height: 50 }, screenSize, 8)).toEqual({ left: 4, top: 92, width: 56, height: 66 });
    // A 44px card grown by 8px opens with a 52px corner; a pill stays a pill.
    expect(spotlightRadius(44, 8, { width: 600, height: 300 })).toBe(52);
    expect(spotlightRadius(999, 8, { width: 104, height: 104 })).toBe(52);
  });

  it("places the panel beside the opening, on the first side with room, or centred, or as a sheet on a phone", () => {
    const panel = { width: 380, height: 220 };
    expect(placePanel(null, panel, screenSize).placement).toBe("center");
    expect(placePanel({ left: 400, top: 120, width: 600, height: 200 }, panel, screenSize)).toMatchObject({ placement: "bottom", top: 336 });
    // The round button at the bottom left: no room below, so above it.
    expect(placePanel({ left: 56, top: 760, width: 103, height: 103 }, panel, screenSize, ["top", "right"]))
      .toMatchObject({ placement: "top", left: 16, top: 524 });
    expect(placePanel({ left: 20, top: 300, width: 220, height: 50 }, panel, screenSize, ["right", "top"]).placement).toBe("right");
    expect(placePanel({ left: 0, top: 700, width: 375, height: 80 }, panel, { width: 375, height: 812 }).placement).toBe("sheet-top");
    expect(placePanel({ left: 0, top: 100, width: 375, height: 80 }, panel, { width: 375, height: 812 }).placement).toBe("sheet-bottom");
  });

  it("measures how much of a target shows below the bar", () => {
    expect(visibleShare({ left: 0, top: 100, width: 10, height: 100 }, screenSize, 80)).toBe(1);
    expect(visibleShare({ left: 0, top: 850, width: 10, height: 100 }, screenSize, 80)).toBe(0.5);
  });
});

describe("the guided tour in IRIS", () => {
  beforeEach(async () => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    vi.spyOn(window, "scrollBy").mockImplementation(() => undefined);
    await resetDatabaseForTests();
    await initializeDatabase();
    await resetPinForTests();
    window.sessionStorage.clear();
    window.localStorage.clear();
    window.localStorage.setItem("wealth-language", "en");
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    resetUISoundsForTests();
    document.querySelectorAll(".is-exit-ghost").forEach((node) => node.remove());
    delete document.documentElement.dataset.arrival;
    await resetPinForTests();
    await resetDatabaseForTests();
    window.sessionStorage.clear();
    window.localStorage.clear();
  });

  it("offers the tour to a new device once its PIN is created, and a skip is final", async () => {
    renderApp();
    expect(await screen.findByRole("heading", { name: "Create your PIN" })).toBeInTheDocument();
    expect(storedRecord()).toBeNull();
    fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "2026" } });
    fireEvent.change(screen.getByLabelText("Confirm PIN"), { target: { value: "2026" } });
    fireEvent.click(screen.getByRole("button", { name: /create pin/i }));

    const welcome = await screen.findByRole("dialog", { name: "Welcome to IRIS" }, pastUnlock);
    expect(storedRecord()).toMatchObject({ version: 1, status: "not-started" });
    // What the welcome says about where the data lives and what the PIN is.
    expect(within(welcome).getByText("Your data stays here")).toBeInTheDocument();
    expect(within(welcome).getByText("The PIN is not an account and does not encrypt")).toBeInTheDocument();
    expect(within(welcome).getByRole("button", { name: /start the tour/i })).toHaveFocus();

    fireEvent.click(within(welcome).getByRole("button", { name: "Skip" }));
    await waitFor(() => expect(tourDialog()).toBeNull());
    expect(storedRecord()).toMatchObject({ status: "skipped" });
    expect(screen.getByTestId("wealth-overview")).toBeInTheDocument();

    // Locked and opened again with the PIN: no tour.
    fireEvent.click(screen.getByRole("button", { name: "Lock now" }));
    expect(await screen.findByLabelText("PIN")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "2026" } });
    fireEvent.click(screen.getByRole("button", { name: /unlock dashboard/i }));
    expect(await screen.findByTestId("wealth-overview", {}, pastUnlock)).toBeInTheDocument();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 800)); });
    expect(tourDialog()).toBeNull();
  }, slowFlow);

  it("never interrupts an owner who set IRIS up before the tour existed", async () => {
    await setupPin("2026");
    markSessionUnlocked();
    renderApp();

    expect(await screen.findByTestId("wealth-overview")).toBeInTheDocument();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 900)); });
    expect(tourDialog()).toBeNull();
    expect(storedRecord()).toBeNull();
  });

  it("walks the real views forwards and back, changes nothing, and records its completion", async () => {
    firstRun();
    await setupPin("2026");
    markSessionUnlocked();
    window.localStorage.setItem("wealth-amounts-hidden", "0");
    renderApp();
    expect(await screen.findByRole("dialog", { name: "Welcome to IRIS" }, tourAppears)).toBeInTheDocument();
    const dataBefore = await ledger();
    const preferencesBefore = preferences();
    const credentialsBefore = JSON.stringify(await getPinCredentials());

    fireEvent.click(screen.getByRole("button", { name: /start the tour/i }));

    // Each step: its view on screen, its title, its real targets in the page.
    const views: Record<string, string> = { overview: "", accounts: "Accounts", goals: "Goals", scenario: "Projections", settings: "Settings" };
    const guided = tourSteps.filter((step) => step.targets);
    for (const [position, step] of guided.entries()) {
      const dialog = await screen.findByRole("dialog", { name: step.title[1] });
      expect(within(dialog).getByText(`Step ${position + 1} of ${guided.length}`)).toBeInTheDocument();
      if (step.view === "overview") expect(screen.getByTestId("wealth-overview")).toBeInTheDocument();
      else if (step.view) expect(heading(views[step.view])).toBeInTheDocument();
      for (const target of step.targets!) {
        expect(document.querySelector(`[data-tour="${target}"]`), `${step.id} → ${target}`).not.toBeNull();
      }
      // Once, half way: back to the previous view, and forward again by keyboard.
      if (step.id === "accounts-nav") {
        fireEvent.click(within(dialog).getByRole("button", { name: "Previous step" }));
        expect(await screen.findByRole("dialog", { name: guided[position - 1].title[1] })).toBeInTheDocument();
        expect(screen.getByTestId("wealth-overview")).toBeInTheDocument();
        fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowRight" });
        expect(await screen.findByRole("dialog", { name: step.title[1] })).toBeInTheDocument();
        expect(heading("Accounts")).toBeInTheDocument();
      }
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /^next/i }));
    }

    const done = await screen.findByRole("dialog", { name: "You're all set" });
    fireEvent.click(within(done).getByRole("button", { name: "Start using IRIS" }));
    await waitFor(() => expect(tourDialog()).toBeNull());

    // Back where it started, nothing changed but the record.
    expect(screen.getByTestId("wealth-overview")).toBeInTheDocument();
    expect(storedRecord()).toMatchObject({ version: 1, status: "completed", firstRunAt: "2026-10-12T09:00:00.000Z" });
    expect(await ledger()).toBe(dataBefore);
    expect(preferences()).toBe(preferencesBefore);
    expect(JSON.stringify(await getPinCredentials())).toBe(credentialsBefore);
    expect(document.querySelector(".tour-scrim")).toBeNull();
  });

  it("leaves nothing behind when the app locks mid-tour, and offers the first run again after the PIN", async () => {
    firstRun();
    await setupPin("2026");
    markSessionUnlocked();
    renderApp();
    fireEvent.click(await screen.findByRole("button", { name: /start the tour/i }, tourAppears));
    fireEvent.click(await screen.findByRole("button", { name: /^next/i }));
    fireEvent.click(await screen.findByRole("button", { name: /^next/i }));
    fireEvent.click(await screen.findByRole("button", { name: /^next/i }));
    await waitFor(() => expect(heading("Accounts")).toBeInTheDocument());

    // The padlock in the bar is the same transition the idle lock makes.
    fireEvent.click(document.querySelector<HTMLButtonElement>(".lock-now")!);
    expect(await screen.findByLabelText("PIN")).toBeInTheDocument();
    expect(tourDialog()).toBeNull();
    expect(document.querySelector(".tour-scrim, .tour-panel")).toBeNull();
    expect(document.body.style.pointerEvents).toBe("");
    expect(storedRecord()).toMatchObject({ status: "not-started" });

    fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "2026" } });
    fireEvent.click(screen.getByRole("button", { name: /unlock dashboard/i }));
    expect(await screen.findByRole("dialog", { name: "Welcome to IRIS" }, { timeout: verifiedHoldMs + 4_000 })).toBeInTheDocument();
  }, slowFlow);

  it("starts again from Settings without touching data, PIN or preferences, and puts the page back", async () => {
    window.localStorage.setItem(recordKey, JSON.stringify({ version: 1, status: "completed", decidedAt: "2026-10-01T10:00:00.000Z" }));
    await setupPin("2026");
    markSessionUnlocked();
    renderApp();
    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    const again = await screen.findByRole("button", { name: "Take the tour again" });
    const dataBefore = await ledger();
    const preferencesBefore = preferences();
    fireEvent.click(again);

    expect(await screen.findByRole("dialog", { name: "Welcome to IRIS" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /start the tour/i }));
    expect(await screen.findByRole("dialog", { name: "Your wealth at a glance" })).toBeInTheDocument();
    expect(screen.getByTestId("wealth-overview")).toBeInTheDocument();

    // Escape leaves: Settings again, focus on the control that started it,
    // and the earlier completion still on record.
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(tourDialog()).toBeNull());
    expect(heading("Settings")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Take the tour again" })).toHaveFocus());
    expect(storedRecord()).toEqual({ version: 1, status: "completed", decidedAt: "2026-10-01T10:00:00.000Z" });
    expect(await ledger()).toBe(dataBefore);
    expect(preferences()).toBe(preferencesBefore);
  });

  it("sounds its own steps — forward, back, the end, a skip — and stays silent when sounds are off", async () => {
    const audio = installFakeAudio();
    const firstNotes = () => audio.oscillators.map((note) => Math.round(note.frequency));
    firstRun();
    await setupPin("2026");
    markSessionUnlocked();
    renderApp();
    const welcome = await screen.findByRole("dialog", { name: "Welcome to IRIS" }, tourAppears);
    // Appeared on its own, with no gesture: no sound.
    expect(audio.sounds).toHaveLength(0);

    // A press with the mouse: the tour's glide, not the generic tap on top.
    const start = within(welcome).getByRole("button", { name: /start the tour/i });
    fireEvent.pointerDown(start, { pointerType: "mouse", button: 0 });
    fireEvent.click(start);
    expect(firstNotes()).toEqual([523, 1047]);
    await screen.findByRole("dialog", { name: "Your wealth at a glance" });

    audio.oscillators.length = 0;
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 200)); });
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowLeft" });
    expect(firstNotes()[0]).toBe(698);

    // To the end card: the closing chord.
    await screen.findByRole("dialog", { name: "Welcome to IRIS" });
    fireEvent.click(screen.getByRole("button", { name: /start the tour/i }));
    for (const step of tourSteps.filter((candidate) => candidate.targets)) {
      await screen.findByRole("dialog", { name: step.title[1] });
      audio.oscillators.length = 0;
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 160)); });
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /^next/i }));
    }
    await screen.findByRole("dialog", { name: "You're all set" });
    expect(firstNotes().filter((_, index) => index % 2 === 0)).toEqual([698, 880, 1047, 1397]);

    // Sounds off: a skip from Settings is silent.
    fireEvent.click(screen.getByRole("button", { name: "Start using IRIS" }));
    await waitFor(() => expect(tourDialog()).toBeNull());
    window.localStorage.setItem("wealth-ui-sounds", "0");
    const heard = audio.sounds.length;
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(await screen.findByRole("button", { name: "Take the tour again" }));
    fireEvent.click(await screen.findByRole("button", { name: "Skip" }));
    await waitFor(() => expect(tourDialog()).toBeNull());
    expect(audio.sounds).toHaveLength(heard);
  });

  it("speaks Italian", async () => {
    window.localStorage.setItem("wealth-language", "it");
    firstRun();
    await setupPin("2026");
    markSessionUnlocked();
    renderApp();

    const welcome = await screen.findByRole("dialog", { name: "Benvenuto in IRIS" }, tourAppears);
    expect(within(welcome).getByText("Il PIN non è un account e non cifra")).toBeInTheDocument();
    fireEvent.click(within(welcome).getByRole("button", { name: /inizia il tour/i }));
    expect(await screen.findByRole("dialog", { name: "Il patrimonio, a colpo d'occhio" })).toBeInTheDocument();
    expect(screen.getByText("Passo 1 di 9")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Salta tour" }));
    await waitFor(() => expect(tourDialog()).toBeNull());
    expect(storedRecord()).toMatchObject({ status: "skipped" });
  });
});
