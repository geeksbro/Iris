import "fake-indexeddb/auto";

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getPinCredentials, resetPinForTests, setupPin } from "@/data/pin";
import { resetDatabaseForTests } from "@/data/repository";
import { LoginGate } from "@/features/auth/LoginGate";
import { markSessionUnlocked } from "@/features/auth/session";
import { resetUISoundsForTests } from "@/features/sound/ui-sound";
import { installFakeAudio } from "@/test/fake-audio";

import { WealthDashboard } from "./WealthDashboard";
import { initializeWithDemoArchive } from "@/test/demo-archive";

const menuName = "Giulia's profile";
const searchName = "Search accounts, views or actions…";
const picture = "data:image/png;base64,iVBORw0KGgo=";

async function openProfile() {
  const trigger = await screen.findByRole("button", { name: "Profile" });
  expect(trigger).toHaveAttribute("aria-haspopup", "menu");
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  trigger.focus();
  fireEvent.click(trigger);
  const panel = await screen.findByRole("menu", { name: menuName });
  return { trigger, panel };
}

async function runSearchAction(label: string) {
  const trigger = screen.getByRole("button", { name: searchName });
  // jsdom lays nothing out; the trigger is visible in every desktop layout.
  vi.spyOn(trigger, "getClientRects").mockReturnValue([{}] as unknown as DOMRectList);
  fireEvent.click(trigger);
  const listbox = await screen.findByRole("listbox", { name: "Results" });
  const option = within(listbox).getAllByRole("option")
    .find((item) => item.querySelector(".command-option__label")?.textContent === label);
  expect(option).toBeDefined();
  fireEvent.click(option!);
}

describe("ProfileMenu", () => {
  beforeEach(async () => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    window.localStorage.removeItem("wealth-amounts-hidden");
    // A fictional owner's name, chosen in Settings.
    window.localStorage.setItem("wealth-display-name", "Giulia");
    window.localStorage.setItem("wealth-language", "en");
    window.sessionStorage.clear();
    await resetDatabaseForTests();
    await initializeWithDemoArchive();
    await resetPinForTests();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    resetUISoundsForTests();
    window.localStorage.removeItem("wealth-ui-sounds");
    window.localStorage.removeItem("wealth-amounts-hidden");
    window.localStorage.removeItem("wealth-language");
    window.localStorage.removeItem("wealth-profile-image");
    window.localStorage.removeItem("wealth-display-name");
    window.sessionStorage.clear();
    await resetDatabaseForTests();
  });

  it("opens Trading OS's picture menu under the circle: the head, a hairline, the picture's items", async () => {
    render(<WealthDashboard />);
    await screen.findByTestId("wealth-hero");
    const { trigger, panel } = await openProfile();

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(trigger).toHaveAttribute("aria-controls", panel.id);
    expect(within(panel).getByText("Giulia")).toBeInTheDocument();
    expect(within(panel).getByText("Change your profile picture?")).toBeInTheDocument();
    expect(within(panel).getByRole("separator")).toBeInTheDocument();
    const items = within(panel).getAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual(["Choose picture…"]);
    // The first item takes the focus, as in Trading OS.
    expect(items[0]).toHaveFocus();
    // Nothing else lives there any more (owner, 12 Oct 2026).
    for (const gone of [/Preferences/, /Security/, /Local data/, /Export backup/, /Import backup/, /All settings/, /Interface sounds/, /Language/]) {
      expect(within(panel).queryByText(gone)).not.toBeInTheDocument();
    }

    fireEvent.keyDown(panel, { key: "Escape" });
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole("menu", { name: menuName })).not.toBeInTheDocument();
  });

  it("puts language, the eye, theme, sounds and the profile in the bar, in Trading OS's order, and Settings at the foot of the rail", async () => {
    render(<WealthDashboard />);
    await screen.findByTestId("wealth-hero");
    const bar = screen.getByRole("banner");

    // Search, language, the eye, then Trading OS's order — theme, sounds,
    // (the padlock, only behind a PIN), the profile (owner, 12 Oct 2026).
    // "Update balances" left the bar for a round button of its own at the
    // bottom left; the Settings gear left it for the foot of the rail
    // (owner, 18 Oct 2026).
    expect(within(bar).getAllByRole("button").map((button) => button.getAttribute("aria-label") || button.textContent?.trim())).toEqual([
      "Search accounts, views or actions…Ctrl K",
      "Switch to Italian",
      "Hide amounts",
      // The release notes, between the eye and the theme (owner, 18 Oct 2026);
      // a new device has not seen the newest one yet.
      "What's new: there is a new version",
      "Switch to dark theme",
      "Disable interface sounds",
      "Profile",
    ]);
    const rail = document.querySelector<HTMLElement>(".sidebar")!;
    const railButtons = within(rail).getAllByRole("button").map((button) => button.textContent?.trim());
    expect(railButtons.at(-1)).toBe("Settings");
    expect(railButtons.at(-2)).toBe("Collapse sidebar");
    const update = screen.getByRole("button", { name: "Update balances" });
    expect(bar).not.toContainElement(update);
    expect(update).toHaveClass("update-balances-fab");
    expect(within(bar).getByRole("button", { name: "Switch to Italian" })).toHaveTextContent("IT");
    const barEye = within(bar).getByRole("button", { name: "Hide amounts" });
    expect(barEye).toHaveAttribute("title", "Hide amounts");
    const profile = within(bar).getByRole("button", { name: "Profile" });
    // The circle shows the greeting name's initial; the name for assistive tech stays "Profile".
    expect(profile.textContent).toBe("G");
    expect(profile).toHaveAttribute("title", "Profile");
    // The file input that Import opens is no stop of its own, for keys or assistive tech.
    const fileInput = screen.getByLabelText("Choose JSON backup to import");
    expect(fileInput).toHaveAttribute("tabindex", "-1");
    expect(fileInput).toHaveAttribute("aria-hidden", "true");

    fireEvent.click(barEye);
    expect(barEye).toHaveAccessibleName("Show amounts");
    expect(document.querySelectorAll(".money.is-masked").length).toBeGreaterThan(0);
  });

  it("switches the language from the top bar, and the switch then offers the way back", async () => {
    window.localStorage.setItem("wealth-language", "it");
    render(<WealthDashboard />);
    await screen.findByTestId("wealth-hero");
    const bar = screen.getByRole("banner");

    const toEnglish = within(bar).getByRole("button", { name: "Passa all'inglese" });
    expect(toEnglish).toHaveTextContent("EN");
    fireEvent.click(toEnglish);

    expect(await within(bar).findByRole("button", { name: "Switch to Italian" })).toHaveTextContent("IT");
    expect(screen.getByRole("navigation", { name: "Primary navigation" })).toHaveTextContent("Overview");
    expect(window.localStorage.getItem("wealth-language")).toBe("en");
  });

  it("names the menu and its question in Italian too", async () => {
    window.localStorage.setItem("wealth-language", "it");
    render(<WealthDashboard />);
    await screen.findByTestId("wealth-hero");
    fireEvent.click(await screen.findByRole("button", { name: "Profilo" }));
    const panel = await screen.findByRole("menu", { name: "Profilo di Giulia" });
    expect(within(panel).getByText("Vuoi cambiare l'immagine del profilo?")).toBeInTheDocument();
    expect(within(panel).getByRole("menuitem", { name: "Scegli immagine…" })).toBeInTheDocument();
  });

  it("turns interface sounds off and on with the bar's speaker, remembered on this device", async () => {
    window.localStorage.setItem("wealth-language", "it");
    const audio = installFakeAudio();
    const { unmount } = render(<WealthDashboard />);
    await screen.findByTestId("wealth-hero");

    // In the bar, beside the theme (owner, 12 Oct 2026); on by default.
    let bar = screen.getByRole("banner");
    const speaker = within(bar).getByRole("button", { name: "Disattiva suoni interfaccia" });
    expect(speaker).toHaveAttribute("title", "Disattiva suoni interfaccia");
    expect(speaker.querySelector(".icon-swap")).toHaveAttribute("data-state", "shown");
    expect(speaker).not.toHaveAttribute("aria-pressed");

    speaker.focus();
    fireEvent.click(speaker);
    expect(speaker).toHaveAccessibleName("Attiva suoni interfaccia");
    expect(speaker.querySelector(".icon-swap")).toHaveAttribute("data-state", "hidden");
    expect(speaker).toHaveFocus();
    expect(window.localStorage.getItem("wealth-ui-sounds")).toBe("0");

    // A reload keeps it off.
    unmount();
    render(<WealthDashboard />);
    await screen.findByTestId("wealth-hero");
    bar = screen.getByRole("banner");
    fireEvent.click(within(bar).getByRole("button", { name: "Attiva suoni interfaccia" }));
    expect(within(bar).getByRole("button", { name: "Disattiva suoni interfaccia" })).toBeInTheDocument();
    expect(window.localStorage.getItem("wealth-ui-sounds")).toBe("1");

    // The switch itself is silent, even to the dashboard's tap.
    const mouse = { pointerType: "mouse", button: 0 };
    fireEvent.pointerDown(within(bar).getByRole("button", { name: "Disattiva suoni interfaccia" }), mouse);
    expect(audio.sounds).toHaveLength(0);

    // Every other control of the dashboard taps when pressed with the mouse.
    fireEvent.pointerDown(screen.getByRole("button", { name: "Profilo" }), mouse);
    expect(audio.sounds).toHaveLength(1);
  });

  it("names the speaker's action in English too", async () => {
    render(<WealthDashboard />);
    await screen.findByTestId("wealth-hero");
    const bar = screen.getByRole("banner");

    fireEvent.click(within(bar).getByRole("button", { name: "Disable interface sounds" }));
    expect(within(bar).getByRole("button", { name: "Enable interface sounds" })).toBeInTheDocument();
  });

  it("exports through the search's action, now that the menu is the picture's alone", async () => {
    render(<WealthDashboard />);
    await screen.findByTestId("wealth-hero");
    // jsdom has no object URLs; the real handler runs against these stand-ins.
    const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
    const createObjectURL = vi.fn(() => "blob:backup");
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = vi.fn();
    const download = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    try {
      await runSearchAction("Export data");
      await waitFor(() => expect(download).toHaveBeenCalledTimes(1));
      expect(createObjectURL).toHaveBeenCalledTimes(1);
      expect(await screen.findByText("Backup exported as plain JSON. Store it somewhere private.")).toBeInTheDocument();
    } finally {
      URL.createObjectURL = original.create;
      URL.revokeObjectURL = original.revoke;
    }
  });

  it("imports through the search's action and the existing file input", async () => {
    render(<WealthDashboard />);
    await screen.findByTestId("wealth-hero");
    const fileInput = screen.getByLabelText("Choose JSON backup to import") as HTMLInputElement;
    const pick = vi.spyOn(fileInput, "click").mockImplementation(() => undefined);
    await runSearchAction("Import data");
    expect(pick).toHaveBeenCalledTimes(1);
  });

  it("locks the session from the bar's padlock, through the PIN gate itself, leaving the stored PIN untouched", async () => {
    await setupPin("2468");
    const before = await getPinCredentials();
    markSessionUnlocked();
    render(<LoginGate><WealthDashboard /></LoginGate>);
    await screen.findByTestId("wealth-hero");

    const bar = screen.getByRole("banner");
    const names = within(bar).getAllByRole("button").map((button) => button.getAttribute("aria-label"));
    // After the sounds, before the profile (owner, 12 Oct 2026; the gear
    // between them moved to the rail, 18 Oct 2026).
    expect(names.indexOf("Lock now")).toBe(names.indexOf("Disable interface sounds") + 1);
    expect(names.indexOf("Profile")).toBe(names.indexOf("Lock now") + 1);
    fireEvent.click(within(bar).getByRole("button", { name: "Lock now" }));

    expect(await screen.findByLabelText("PIN")).toBeInTheDocument();
    expect(screen.queryByTestId("wealth-hero")).not.toBeInTheDocument();
    expect(window.sessionStorage.getItem("wealth-unlocked")).toBeNull();
    // A deliberate lock is not an idle interruption.
    expect(screen.queryByText(/inactivity/)).not.toBeInTheDocument();
    expect(await getPinCredentials()).toEqual(before);
  });

  it("moves through its items with the arrows, and closes on Tab", async () => {
    window.localStorage.setItem("wealth-profile-image", picture);
    render(<WealthDashboard />);
    await screen.findByTestId("wealth-hero");
    const { panel } = await openProfile();
    const [change, remove] = within(panel).getAllByRole("menuitem");
    expect(change).toHaveFocus();
    fireEvent.keyDown(panel, { key: "ArrowDown" });
    expect(remove).toHaveFocus();
    fireEvent.keyDown(panel, { key: "ArrowDown" });
    expect(change).toHaveFocus();
    fireEvent.keyDown(panel, { key: "End" });
    expect(remove).toHaveFocus();
    fireEvent.keyDown(panel, { key: "Tab" });
    expect(screen.queryByRole("menu", { name: menuName })).not.toBeInTheDocument();
  });

  it("shows a chosen picture in the bar's circle and offers to change or remove it", async () => {
    window.localStorage.setItem("wealth-profile-image", picture);
    render(<WealthDashboard />);
    await screen.findByTestId("wealth-hero");
    const trigger = within(screen.getByRole("banner")).getByRole("button", { name: "Profile" });
    expect(trigger.querySelector("img")).toHaveAttribute("src", picture);

    const { panel } = await openProfile();
    expect(within(panel).getByRole("menuitem", { name: "Change picture…" })).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole("menuitem", { name: "Remove picture" }));
    expect(window.localStorage.getItem("wealth-profile-image")).toBe("");
    await waitFor(() => expect(trigger.querySelector("img")).toBeNull());
    expect(trigger).toHaveTextContent("G");
  });

  it("reads anything that is not a small image data URL as no picture", async () => {
    window.localStorage.setItem("wealth-profile-image", "javascript:alert(1)");
    render(<WealthDashboard />);
    await screen.findByTestId("wealth-hero");
    const trigger = within(screen.getByRole("banner")).getByRole("button", { name: "Profile" });
    expect(trigger.querySelector("img")).toBeNull();
  });
});
