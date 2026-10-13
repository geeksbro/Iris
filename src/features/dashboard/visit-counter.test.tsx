import "fake-indexeddb/auto";

import { StrictMode } from "react";
import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { wealthDb } from "@/data/db";
import * as pageVisits from "@/data/page-visits";
import { getPageVisits } from "@/data/page-visits";
import { resetDatabaseForTests, updateAccount } from "@/data/repository";

import { usePageVisitCounter } from "./visit-counter";
import { WealthDashboard } from "./WealthDashboard";
import { initializeWithDemoArchive } from "@/test/demo-archive";

/*
 * The counter through the real dashboard: an entry into a page counts once,
 * nothing else does. Every write is also observed as a call, so "no
 * increment" is proven by the absence of a call, not by waiting.
 */

const none = { overview: 0, accounts: 0, "cash-flow": 0, progress: 0, goals: 0, scenario: 0 };

function rail() {
  return within(screen.getByRole("navigation", { name: "Primary navigation" }));
}

async function expectVisits(expected: Partial<typeof none>) {
  await waitFor(async () => expect(await getPageVisits()).toEqual({ ...none, ...expected }));
}

// Lets any write already started settle before a count is read.
async function settle() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
}

describe("page visit counter", () => {
  beforeEach(async () => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    window.localStorage.setItem("wealth-language", "en");
    await resetDatabaseForTests();
    await initializeWithDemoArchive();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    window.localStorage.removeItem("wealth-language");
    window.localStorage.removeItem("wealth-amounts-hidden");
    await resetDatabaseForTests();
  });

  it("counts Overview once when the dashboard opens on it", async () => {
    const record = vi.spyOn(pageVisits, "recordPageVisit");
    render(<WealthDashboard />);
    await screen.findByTestId("wealth-hero");

    await expectVisits({ overview: 1 });
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith("overview");
  });

  it("does not count a re-render, a state change inside the page, or a live data refresh", async () => {
    const record = vi.spyOn(pageVisits, "recordPageVisit");
    const { rerender } = render(<WealthDashboard />);
    await screen.findByTestId("wealth-hero");
    await expectVisits({ overview: 1 });

    // A re-render from the root.
    rerender(<WealthDashboard />);
    // State inside the page: a window opened and closed, the rail folded.
    fireEvent.click(screen.getByRole("button", { name: "Update balances" }));
    fireEvent.click(await screen.findByRole("button", { name: "Close dialog" }));
    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    fireEvent.click(screen.getByRole("button", { name: "Expand sidebar" }));
    // A child refresh: the live query re-renders the ledger with new data.
    await act(async () => { await updateAccount("banca-aurora", { balance: 6000 }); });
    await screen.findByRole("heading", { level: 1, name: /10\.600,05/ });
    await settle();

    expect(record).toHaveBeenCalledTimes(1);
    expect(await getPageVisits()).toEqual({ ...none, overview: 1 });
  });

  it("counts each navigation into a page: Overview → Accounts → Overview", async () => {
    render(<WealthDashboard />);
    await screen.findByTestId("wealth-hero");
    await expectVisits({ overview: 1 });

    fireEvent.click(rail().getByRole("button", { name: "Accounts" }));
    await screen.findByRole("heading", { level: 1, name: "Accounts" });
    await expectVisits({ overview: 1, accounts: 1 });

    // Pressing the page already open is not an entry.
    fireEvent.click(rail().getByRole("button", { name: "Accounts" }));
    await settle();
    expect(await getPageVisits()).toEqual({ ...none, overview: 1, accounts: 1 });

    fireEvent.click(rail().getByRole("button", { name: "Overview" }));
    await screen.findByTestId("wealth-hero");
    await expectVisits({ overview: 2, accounts: 1 });
  });

  it("counts a return from a child view or Settings as a new visit, and never counts those views", async () => {
    render(<WealthDashboard />);
    await screen.findByTestId("wealth-hero");
    await expectVisits({ overview: 1 });

    fireEvent.click(screen.getByRole("button", { name: "Open Investments detail" }));
    fireEvent.click(await screen.findByRole("button", { name: "Back to Overview" }));
    await screen.findByTestId("wealth-hero");
    await expectVisits({ overview: 2 });

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(await screen.findByRole("button", { name: "Back to Overview" }));
    await screen.findByTestId("wealth-hero");
    await expectVisits({ overview: 3 });
  });

  it("keeps the counts through a reload: storage reopened, dashboard mounted again", async () => {
    const { unmount } = render(<WealthDashboard />);
    await screen.findByTestId("wealth-hero");
    fireEvent.click(rail().getByRole("button", { name: "Goals" }));
    await screen.findByRole("heading", { level: 1, name: "Goals" });
    await expectVisits({ overview: 1, goals: 1 });
    unmount();

    wealthDb.close();
    await wealthDb.open();
    expect(await getPageVisits()).toEqual({ ...none, overview: 1, goals: 1 });

    // The new page load opens on Overview again: that is one more visit to it.
    render(<WealthDashboard />);
    await screen.findByTestId("wealth-hero");
    await expectVisits({ overview: 2, goals: 1 });
  });

  it("counts once, not twice, under React Strict Mode in development", async () => {
    const record = vi.spyOn(pageVisits, "recordPageVisit");
    render(<StrictMode><WealthDashboard /></StrictMode>);
    await screen.findByTestId("wealth-hero");
    await expectVisits({ overview: 1 });

    fireEvent.click(rail().getByRole("button", { name: "Cash Flow" }));
    await screen.findByRole("heading", { level: 1, name: "Cash Flow" });
    await expectVisits({ overview: 1, "cash-flow": 1 });
    await settle();

    expect(record).toHaveBeenCalledTimes(2);
    expect(await getPageVisits()).toEqual({ ...none, overview: 1, "cash-flow": 1 });
  });

  // In the dashboard the page is first shown after its data loads, past Strict
  // Mode's mount rehearsal. The hook must hold on its own when shown at once.
  it("holds on its own under Strict Mode when the page is shown from the first render", async () => {
    const record = vi.spyOn(pageVisits, "recordPageVisit");
    const { rerender } = renderHook(({ view }) => usePageVisitCounter(view, true), {
      initialProps: { view: "overview" },
      wrapper: StrictMode,
    });
    await expectVisits({ overview: 1 });

    rerender({ view: "overview" });
    rerender({ view: "accounts" });
    rerender({ view: "settings" });
    rerender({ view: "overview" });
    await expectVisits({ overview: 2, accounts: 1 });
    await settle();

    expect(record.mock.calls).toEqual([["overview"], ["accounts"], ["overview"]]);
  });

  it("counts nothing while the ledger is not on screen", async () => {
    const record = vi.spyOn(pageVisits, "recordPageVisit");
    const { rerender } = renderHook(({ shown }) => usePageVisitCounter("overview", shown), {
      initialProps: { shown: false },
    });
    await settle();
    expect(record).not.toHaveBeenCalled();

    rerender({ shown: true });
    await expectVisits({ overview: 1 });
    expect(record).toHaveBeenCalledTimes(1);
  });
});
