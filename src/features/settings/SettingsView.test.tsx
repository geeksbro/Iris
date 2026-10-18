import "fake-indexeddb/auto";

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupPin, verifyPin } from "@/data/pin";
import { resetDatabaseForTests } from "@/data/repository";
import { getIdleTimeoutMs } from "@/data/security";
import { WealthDashboard } from "@/features/dashboard/WealthDashboard";
import { resetUISoundsForTests } from "@/features/sound/ui-sound";
import { installFakeAudio } from "@/test/fake-audio";
import { initializeWithDemoArchive } from "@/test/demo-archive";

const storedKeys = [
  "wealth-theme",
  "wealth-language",
  "wealth-amounts-hidden",
  "wealth-percentages-hidden",
  "wealth-account-names-hidden",
  "wealth-start-page",
  "wealth-ui-sounds",
  "wealth-sidebar-collapsed",
  "wealth-lock-background",
  "wealth-lock-shuffle",
  "wealth-page-transition",
  "wealth-display-name",
];

// The top bar (the Settings view has a header of its own).
const topBar = () => document.querySelector<HTMLElement>(".topbar")!;
const rail = () => document.querySelector<HTMLElement>(".sidebar")!;

async function openSettings() {
  render(<WealthDashboard />);
  await screen.findByTestId("wealth-hero");
  fireEvent.click(within(rail()).getByRole("button", { name: "Settings" }));
  return screen.findByRole("heading", { level: 1, name: "Settings" });
}

/*
 * Settings shows one group at a time, so a term is read in the group that
 * holds it: this is the reader choosing that group in the index, and the
 * groups not chosen are genuinely absent rather than merely out of sight.
 */
async function goToGroup(name: string) {
  const index = screen.getByRole("navigation", { name: "Settings groups" });
  fireEvent.click(within(index).getByRole("button", { name: new RegExp(`^${name}`) }));
  return screen.findByRole("heading", { level: 2, name });
}

describe("Settings", () => {
  beforeEach(async () => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    window.localStorage.setItem("wealth-language", "en");
    await resetDatabaseForTests();
    await initializeWithDemoArchive();
  });

  afterEach(async () => {
    delete document.documentElement.dataset.theme;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    resetUISoundsForTests();
    storedKeys.forEach((key) => window.localStorage.removeItem(key));
    await resetDatabaseForTests();
  });

  it("is a full view reached from the gear at the foot of the rail, with every group stating what is in force", async () => {
    await openSettings();

    // Not a view of the navigation: the list keeps the financial views; the
    // gear stands below it, at the rail's foot, where the "Solo locale" note
    // was, and the bar no longer has one (owner, 18 Oct 2026).
    const nav = screen.getByRole("navigation", { name: "Primary navigation" });
    expect(within(nav).queryByRole("button", { name: "Settings" })).not.toBeInTheDocument();
    expect(within(topBar()).queryByRole("button", { name: "Settings" })).not.toBeInTheDocument();
    expect(rail()).not.toHaveTextContent("Local only");
    const gear = within(rail()).getByRole("button", { name: "Settings" });
    expect(gear).toHaveAttribute("aria-current", "page");
    expect(gear).toHaveClass("is-active");

    const index = screen.getByRole("navigation", { name: "Settings groups" });
    // Experience first, and open by default (owner, 18 Oct 2026).
    const groups = ["Experience", "Data", "Privacy & security", "General", "System"];
    expect(within(index).getAllByRole("button").map((entry) => entry.querySelector(".settings-index__title")?.textContent)).toEqual(groups);
    expect(index).toHaveTextContent("Locks after 2 minutes · nothing hidden");

    // One group is shown at a time, and the index says which.
    expect(screen.getByRole("heading", { level: 2, name: "Experience" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 2, name: "Privacy & security" })).not.toBeInTheDocument();
    expect(within(index).getByRole("button", { name: /^Experience/ })).toHaveAttribute("aria-current", "true");

    // Every group is reachable, and reading it leaves the others absent.
    for (const name of groups) {
      await goToGroup(name);
      expect(screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)).toEqual([name]);
    }
  });

  it("switches between the light and the dark theme, from the top bar or from Settings, remembered on this device", async () => {
    await openSettings();
    await goToGroup("Experience");
    const theme = screen.getByRole("radiogroup", { name: "Theme" });
    expect(within(theme).getByRole("radio", { name: "Light" })).toBeChecked();
    expect(document.documentElement).not.toHaveAttribute("data-theme");

    fireEvent.click(screen.getByRole("button", { name: "Switch to dark theme" }));
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(window.localStorage.getItem("wealth-theme")).toBe("dark");
    expect(within(theme).getByRole("radio", { name: "Dark" })).toBeChecked();
    // The toggle now offers the way back, and names it.
    expect(screen.getByRole("button", { name: "Switch to light theme" })).toBeInTheDocument();

    fireEvent.click(within(theme).getByRole("radio", { name: "Light" }));
    expect(document.documentElement).not.toHaveAttribute("data-theme");
    expect(window.localStorage.getItem("wealth-theme")).toBe("light");
  });

  it("offers the auto-lock as bounded choices, shows the one in force, and saves a new one at once", async () => {
    await openSettings();
    await goToGroup("Privacy & security");
    const group = screen.getByRole("radiogroup", { name: "Auto-lock" });
    expect(within(group).getAllByRole("radio").map((radio) => radio.closest("label")?.textContent)).toEqual(["30 secs", "1 min", "2 mins", "5 mins", "15 mins"]);
    expect(within(group).queryByText(/never/i)).not.toBeInTheDocument();
    expect(within(group).getByRole("radio", { name: "2 mins" })).toBeChecked();

    fireEvent.click(within(group).getByRole("radio", { name: "5 mins" }));
    await waitFor(async () => expect(await getIdleTimeoutMs()).toBe(300_000));
    await waitFor(() => expect(within(group).getByRole("radio", { name: "5 mins" })).toBeChecked());
    expect(screen.getByRole("navigation", { name: "Settings groups" })).toHaveTextContent("Locks after 5 minutes");
  });

  it("drives the dashboard's own privacy, and says the state in words", async () => {
    await openSettings();
    await goToGroup("Privacy & security");
    const amounts = screen.getByRole("switch", { name: "Hide amounts" });
    expect(amounts).not.toBeChecked();

    fireEvent.click(amounts);
    expect(amounts).toBeChecked();
    expect(window.localStorage.getItem("wealth-amounts-hidden")).toBe("1");
    expect(amounts.closest(".setting-switch")).toHaveTextContent("Hidden");
    expect(screen.getByRole("navigation", { name: "Settings groups" })).toHaveTextContent("1 of 3 hidden");
  });

  // Three terms, each its own switch and its own key: turning one on must
  // leave the other two exactly as they were.
  it("hides percentages and account names independently of amounts", async () => {
    await openSettings();
    await goToGroup("Privacy & security");
    const amounts = screen.getByRole("switch", { name: "Hide amounts" });
    const percentages = screen.getByRole("switch", { name: "Hide percentages" });
    const names = screen.getByRole("switch", { name: "Hide account names" });
    expect([amounts, percentages, names].every((control) => !(control as HTMLInputElement).checked)).toBe(true);

    fireEvent.click(percentages);
    expect(percentages).toBeChecked();
    expect(amounts).not.toBeChecked();
    expect(names).not.toBeChecked();
    expect(window.localStorage.getItem("wealth-percentages-hidden")).toBe("1");
    expect(window.localStorage.getItem("wealth-amounts-hidden")).not.toBe("1");

    fireEvent.click(names);
    expect(names).toBeChecked();
    expect(window.localStorage.getItem("wealth-account-names-hidden")).toBe("1");
    expect(screen.getByRole("navigation", { name: "Settings groups" })).toHaveTextContent("2 of 3 hidden");

    fireEvent.click(percentages);
    expect(percentages).not.toBeChecked();
    expect(names).toBeChecked();
    expect(window.localStorage.getItem("wealth-percentages-hidden")).toBe("0");
  });

  it("opens on the page chosen as the start page, and keeps every other way in", async () => {
    await openSettings();
    await goToGroup("Experience");
    const chooser = screen.getByRole("combobox", { name: "Start page" });
    expect((chooser as HTMLSelectElement).value).toBe("overview");

    fireEvent.change(chooser, { target: { value: "goals" } });
    expect(window.localStorage.getItem("wealth-start-page")).toBe("goals");
    expect(screen.getByRole("navigation", { name: "Settings groups" })).toHaveTextContent("Goals");
  });

  it("turns interface sounds off with a switch that makes no sound of its own", async () => {
    const audio = installFakeAudio();
    await openSettings();
    await goToGroup("Experience");
    const sounds = screen.getByRole("switch", { name: "Interface sounds" });
    expect(sounds).toBeChecked();

    fireEvent.pointerDown(sounds, { pointerType: "mouse", button: 0 });
    fireEvent.click(sounds);
    expect(sounds).not.toBeChecked();
    expect(window.localStorage.getItem("wealth-ui-sounds")).toBe("0");
    expect(audio.sounds).toHaveLength(0);
  });

  it("sets the lock screen's background and greeting, and folds the rail, from the same stores as everywhere else", async () => {
    const { container } = render(<WealthDashboard />);
    await screen.findByTestId("wealth-hero");
    fireEvent.click(within(rail()).getByRole("button", { name: "Settings" }));
    await screen.findByRole("heading", { level: 1, name: "Settings" });

    await goToGroup("Experience");
    const background = screen.getByRole("radiogroup", { name: "Lock screen background" });
    expect(within(background).getAllByRole("radio").map((radio) => radio.closest("label")?.textContent)).toEqual(["Aurora", "Moving sky", "Still sky", "None"]);
    // The aurora is the default since the lock screen took the Trading OS layout.
    expect(within(background).getByRole("radio", { name: "Aurora" })).toBeChecked();
    fireEvent.click(within(background).getByRole("radio", { name: "Still sky" }));
    expect(window.localStorage.getItem("wealth-lock-background")).toBe("still-sky");
    expect(within(background).getByRole("radio", { name: "Still sky" })).toBeChecked();

    // The page change: a plain fade unless another is chosen.
    const pageChange = screen.getByRole("radiogroup", { name: "Page change" });
    expect(within(pageChange).getAllByRole("radio").map((radio) => radio.closest("label")?.textContent)).toEqual(["Fade", "Cascade", "Cinematic"]);
    expect(within(pageChange).getByRole("radio", { name: "Fade" })).toBeChecked();
    fireEvent.click(within(pageChange).getByRole("radio", { name: "Cinematic" }));
    expect(window.localStorage.getItem("wealth-page-transition")).toBe("cinematic");

    // The shuffle is an icon beside the choice, not one of its options:
    // pressed, no option is marked; picking one turns it off.
    const shuffle = screen.getByRole("button", { name: "A different background at every lock" });
    expect(shuffle).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(shuffle);
    expect(shuffle).toHaveAttribute("aria-pressed", "true");
    expect(window.localStorage.getItem("wealth-lock-shuffle")).toBe("on");
    expect(within(background).getAllByRole("radio").filter((radio) => (radio as HTMLInputElement).checked)).toHaveLength(0);
    fireEvent.click(shuffle);
    expect(within(background).getByRole("radio", { name: "Still sky" })).toBeChecked();
    fireEvent.click(shuffle);
    fireEvent.click(within(background).getByRole("radio", { name: "Aurora" }));
    expect(shuffle).toHaveAttribute("aria-pressed", "false");
    expect(window.localStorage.getItem("wealth-lock-background")).toBe("aurora");
    fireEvent.click(within(background).getByRole("radio", { name: "Still sky" }));

    const name = screen.getByRole("textbox", { name: "Name in the greeting" });
    // A device that never chose greets without a name.
    expect(name).toHaveValue("");
    fireEvent.change(name, { target: { value: "  Ada " } });
    // Saved when committed, not on every keystroke.
    expect(window.localStorage.getItem("wealth-display-name")).toBeNull();
    fireEvent.blur(name);
    expect(window.localStorage.getItem("wealth-display-name")).toBe("Ada");
    // Greeted by the hour, the same words for anyone.
    expect(screen.getByText(/The lock screen greets you by the hour, now “Good (morning|afternoon|evening), Ada”/)).toBeInTheDocument();

    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Sidebar" })).getByRole("radio", { name: "Compact" }));
    expect(container.querySelector(".sidebar")).toHaveClass("sidebar--collapsed");
    // The rail's own control reads the same state.
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeInTheDocument();
  });

  it("states the currency and formats as they are, with no control that would pretend otherwise", async () => {
    await openSettings();
    await goToGroup("General");
    const general = screen.getByRole("heading", { level: 2, name: "General" }).closest("section")!;
    expect(within(general).getByText("Euro (€)")).toBeInTheDocument();
    expect(within(general).getByText(/handles no other currency and no conversion/)).toBeInTheDocument();
    expect(within(general).queryByRole("combobox")).not.toBeInTheDocument();
    expect(within(general).getAllByRole("radiogroup")).toHaveLength(1);
  });

  it("changes the PIN only with the current one, and says what happened", async () => {
    await setupPin("2026");
    await openSettings();
    await goToGroup("Privacy & security");
    fireEvent.click(await screen.findByRole("button", { name: "Change PIN" }));
    const dialog = await screen.findByRole("dialog", { name: "Change PIN" });
    const fill = (label: RegExp, value: string) => fireEvent.change(within(dialog).getByLabelText(label), { target: { value } });

    fill(/^Current PIN/, "1111");
    fill(/^New PIN/, "4321");
    fill(/^Confirm new PIN/, "4321");
    fireEvent.click(within(dialog).getByRole("button", { name: "Change PIN" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("The current PIN is not correct. Nothing was changed.");
    expect(await verifyPin("2026")).toBe(true);

    fill(/^Current PIN/, "2026");
    fireEvent.click(within(dialog).getByRole("button", { name: "Change PIN" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Change PIN" })).not.toBeInTheDocument());
    expect(await screen.findByText("PIN changed. The new PIN now unlocks the dashboard.")).toBeInTheDocument();
    expect(await verifyPin("4321")).toBe(true);
    expect(await verifyPin("2026")).toBe(false);
  });

  it("checks the new PIN before asking the data layer anything", async () => {
    await setupPin("2026");
    await openSettings();
    await goToGroup("Privacy & security");
    fireEvent.click(await screen.findByRole("button", { name: "Change PIN" }));
    const dialog = await screen.findByRole("dialog", { name: "Change PIN" });
    fireEvent.change(within(dialog).getByLabelText("Current PIN"), { target: { value: "2026" } });
    fireEvent.change(within(dialog).getByLabelText(/^New PIN/), { target: { value: "4321" } });
    fireEvent.change(within(dialog).getByLabelText("Confirm new PIN"), { target: { value: "4322" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Change PIN" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("The two new PINs do not match.");
    expect(await verifyPin("2026")).toBe(true);
  });

  it("keeps the restore apart from the safe backup, and starts it through the existing checked import", async () => {
    await openSettings();
    await goToGroup("Data");
    const data = screen.getByRole("heading", { level: 2, name: "Data" }).closest("section")!;
    const restore = within(data).getByRole("region", { name: "Restore from a backup" });
    expect(restore).toHaveTextContent("the current data is erased only after you confirm");
    // The safe export is not inside the consequence zone.
    expect(within(restore).queryByRole("button", { name: "Export backup" })).not.toBeInTheDocument();
    expect(within(data).getByRole("button", { name: "Export backup" })).toBeInTheDocument();

    const picker = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => undefined);
    fireEvent.click(within(restore).getByRole("button", { name: "Choose a file…" }));
    expect(picker).toHaveBeenCalledTimes(1);
    expect(picker.mock.contexts[0]).toHaveAttribute("type", "file");
  });

  it("shows diagnostics only when asked, without anything secret", async () => {
    await setupPin("2026");
    await openSettings();
    await goToGroup("System");
    const details = screen.getByText("Diagnostics").closest("details")!;
    expect(details).not.toHaveAttribute("open");
    expect(details).toHaveTextContent("schema 2");
    expect(details.textContent).not.toMatch(/hash|salt|PBKDF2/i);
  });
});
