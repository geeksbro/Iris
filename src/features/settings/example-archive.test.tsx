import "fake-indexeddb/auto";

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAccount, initializeDatabase, resetDatabaseForTests, wealthDb } from "@/data/repository";
import { WealthDashboard } from "@/features/dashboard/WealthDashboard";

async function openDataSettings() {
  fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
  fireEvent.click(await screen.findByRole("button", { name: /^Data/ }));
}

describe("the example archive", () => {
  beforeEach(async () => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    window.localStorage.setItem("wealth-language", "en");
    await resetDatabaseForTests();
    await initializeDatabase();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    await resetDatabaseForTests();
  });

  it("starts a new device empty, loads the invented archive on request, marks it, and removes it", async () => {
    render(<WealthDashboard />);
    const hero = await screen.findByTestId("wealth-hero");
    expect(within(hero).getByRole("heading", { level: 1 })).toHaveTextContent(/0,00/);
    expect(screen.queryByText("Example archive")).not.toBeInTheDocument();

    await openDataSettings();
    fireEvent.click(await screen.findByRole("button", { name: "Load example" }));
    const confirm = await screen.findByRole("alertdialog", { name: "Load the example archive?" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Load example" }));

    await waitFor(async () => expect(await wealthDb.accounts.count()).toBe(7));
    expect(await screen.findByText("Example archive", { selector: ".example-archive-badge" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Example archive loaded: the data is invented.");

    fireEvent.click(await screen.findByRole("button", { name: "Remove example" }));
    const remove = await screen.findByRole("alertdialog", { name: "Remove the example archive?" });
    fireEvent.click(within(remove).getByRole("button", { name: "Remove example" }));
    await waitFor(async () => expect(await wealthDb.accounts.count()).toBe(1));
    await waitFor(() => expect(document.querySelector(".example-archive-badge")).toBeNull());
    expect(await wealthDb.snapshots.count()).toBe(0);
    expect(await screen.findByRole("button", { name: "Load example" })).toBeInTheDocument();
  });

  it("is never offered over the owner's own records", async () => {
    await createAccount({ id: "mine", name: "Mine", category: "liquidity", currency: "EUR", balance: 100, includedInWealth: true });
    render(<WealthDashboard />);
    await screen.findByTestId("wealth-hero");
    await openDataSettings();

    expect(await screen.findByRole("button", { name: "Export backup" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load example" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove example" })).not.toBeInTheDocument();
  });
});
