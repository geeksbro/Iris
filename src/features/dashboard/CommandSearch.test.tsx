import "fake-indexeddb/auto";

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { deleteAccount, resetDatabaseForTests } from "@/data/repository";

import { WealthDashboard } from "./WealthDashboard";
import { initializeWithDemoArchive } from "@/test/demo-archive";

const searchName = "Search accounts, views or actions…";

const optionLabels = (group: HTMLElement) =>
  within(group).getAllByRole("option").map((option) => option.querySelector(".command-option__label")?.textContent);

async function renderDashboard() {
  render(<WealthDashboard />);
  await screen.findByTestId("wealth-hero");
  const trigger = screen.getByRole("button", { name: searchName });
  // jsdom lays nothing out; the trigger is visible in every desktop layout.
  vi.spyOn(trigger, "getClientRects").mockReturnValue([{}] as unknown as DOMRectList);
  return trigger;
}

describe("CommandSearch", () => {
  beforeEach(async () => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    window.localStorage.removeItem("wealth-amounts-hidden");
    window.localStorage.setItem("wealth-language", "en");
    await resetDatabaseForTests();
    await initializeWithDemoArchive();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    window.localStorage.removeItem("wealth-amounts-hidden");
    window.localStorage.removeItem("wealth-language");
    await resetDatabaseForTests();
  });

  it("lists only real views, active accounts and existing actions, grouped as the dashboard groups them", async () => {
    await deleteAccount("lira-invest");
    const trigger = await renderDashboard();
    expect(trigger).toHaveAttribute("aria-keyshortcuts", "Control+K");
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(trigger);
    const input = await screen.findByRole("combobox", { name: searchName });
    expect(input).toHaveFocus();
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    const listbox = screen.getByRole("listbox", { name: "Results" });
    expect(optionLabels(within(listbox).getByRole("group", { name: "Views" }))).toEqual([
      "Overview", "Investments", "Trading", "Accounts", "Cash Flow", "Trend", "Goals", "Projections", "Settings",
    ]);
    // Archived accounts are gone from every view, so they are not offered here either.
    expect(optionLabels(within(listbox).getByRole("group", { name: "Accounts" }))).toEqual([
      "Banca Aurora", "Cash", "Conto Vela", "Broker Orione", "Crypto Delta", "Trading Nord",
    ]);
    expect(optionLabels(within(listbox).getByRole("group", { name: "Actions" }))).toEqual([
      "Update balances", "Add account", "Cash Counter", "Add paycheck", "Edit goal",
      "Export data", "Import data", "Switch to Italian", "Take the tour again", "Hide amounts",
    ]);
    // The first result is the one Enter would open, and it says so to assistive tech.
    const [first] = within(listbox).getAllByRole("option");
    expect(first).toHaveAttribute("aria-selected", "true");
    expect(input).toHaveAttribute("aria-activedescendant", first.id);
    expect(first).toHaveTextContent("Current view");
  });

  it("opens a child view from the keyboard and leaves focus on the search", async () => {
    const trigger = await renderDashboard();
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "t" });

    const input = await screen.findByRole("combobox", { name: searchName });
    expect(input).toHaveValue("t");
    fireEvent.change(input, { target: { value: "trad" } });

    const listbox = screen.getByRole("listbox");
    expect(optionLabels(within(listbox).getByRole("group", { name: "Views" }))).toEqual(["Trading"]);
    // Matched on the name and on the visible category alike.
    expect(optionLabels(within(listbox).getByRole("group", { name: "Accounts" }))).toEqual(["Trading Nord"]);
    expect(within(screen.getByRole("dialog", { name: "Search the dashboard" })).getByRole("status")).toHaveTextContent("2 results");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(await screen.findByRole("heading", { level: 1, name: "Trading" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back to Overview" })).toBeInTheDocument();
    expect(trigger).toHaveFocus();
    await waitFor(() => expect(screen.queryByRole("combobox", { name: searchName })).not.toBeInTheDocument());
  });

  it("opens with Ctrl K, reports no results honestly, and closes with Escape back to the trigger", async () => {
    const trigger = await renderDashboard();

    const shortcut = new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(shortcut);
    expect(shortcut.defaultPrevented).toBe(true);

    const input = await screen.findByRole("combobox", { name: searchName });
    fireEvent.change(input, { target: { value: "transactions" } });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("No results for “transactions”.")).toBeInTheDocument();
    expect(within(screen.getByRole("dialog", { name: "Search the dashboard" })).getByRole("status")).toHaveTextContent("No results");

    fireEvent.keyDown(input, { key: "Escape" });
    expect(trigger).toHaveFocus();
    await waitFor(() => expect(screen.queryByRole("combobox", { name: searchName })).not.toBeInTheDocument());
  });

  it("opens an account in its own window, keeps Ctrl K out of that window, and returns to the trigger after it", async () => {
    const trigger = await renderDashboard();
    fireEvent.click(trigger);
    fireEvent.change(await screen.findByRole("combobox", { name: searchName }), { target: { value: "vela" } });
    fireEvent.click(screen.getByRole("option", { name: /Conto Vela/ }));

    const detail = await screen.findByRole("dialog", { name: "Conto Vela" });
    const shortcut = new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(shortcut);
    expect(shortcut.defaultPrevented).toBe(false);
    expect(screen.queryByRole("combobox", { name: searchName })).not.toBeInTheDocument();

    fireEvent.click(within(detail).getByRole("button", { name: "Close dialog" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Conto Vela" })).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it("closes at once under reduced motion, with no closing phase left behind", async () => {
    const trigger = await renderDashboard();
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce"), media: query }));
    try {
      fireEvent.click(trigger);
      const input = await screen.findByRole("combobox", { name: searchName });
      fireEvent.keyDown(input, { key: "Escape" });
      expect(screen.queryByRole("dialog", { name: "Search the dashboard" })).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("names the search, its groups and its no-result state in Italian", async () => {
    window.localStorage.setItem("wealth-language", "it");
    render(<WealthDashboard />);
    await screen.findByTestId("wealth-hero");

    fireEvent.click(screen.getByRole("button", { name: "Cerca conti, viste o azioni…" }));
    const input = await screen.findByRole("combobox", { name: "Cerca conti, viste o azioni…" });
    const listbox = screen.getByRole("listbox", { name: "Risultati" });
    expect(within(listbox).getByRole("group", { name: "Viste" })).toBeInTheDocument();
    expect(within(listbox).getByRole("group", { name: "Conti" })).toBeInTheDocument();
    expect(within(listbox).getByRole("group", { name: "Azioni" })).toBeInTheDocument();

    // Accent-insensitive: "liquidita" finds the Liquidità accounts.
    fireEvent.change(input, { target: { value: "liquidita" } });
    expect(optionLabels(within(screen.getByRole("listbox")).getByRole("group", { name: "Conti" }))).toEqual(["Banca Aurora", "Cash", "Conto Vela"]);

    fireEvent.change(input, { target: { value: "zzz" } });
    expect(screen.getByText("Nessun risultato per “zzz”.")).toBeInTheDocument();
  });
});
