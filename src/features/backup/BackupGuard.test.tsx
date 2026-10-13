import "fake-indexeddb/auto";

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAccount, initializeDatabase, resetDatabaseForTests, wealthDb } from "@/data/repository";
import { WealthDashboard } from "@/features/dashboard/WealthDashboard";

describe("the backup reminder in the dashboard", () => {
  beforeEach(async () => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    // jsdom cannot download: the export's file hand-over is a no-op here.
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:test", revokeObjectURL: () => undefined }));
    // A browser that refuses persistent storage.
    Object.defineProperty(window.navigator, "storage", { configurable: true, value: { persisted: async () => false, persist: async () => false } });
    window.localStorage.setItem("wealth-language", "en");
    await resetDatabaseForTests();
    await initializeDatabase();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(window.navigator, "storage");
    window.localStorage.clear();
    await resetDatabaseForTests();
  });

  it("stays away from an empty archive", async () => {
    render(<WealthDashboard />);
    await screen.findByTestId("wealth-hero");
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 200)); });
    expect(screen.queryByRole("region", { name: /backup/i })).not.toBeInTheDocument();
  });

  it("asks for a first backup once there is real data, asks for persistent storage once, and goes when the backup is made", async () => {
    await createAccount({ id: "mine", name: "Mine", category: "liquidity", currency: "EUR", balance: 100, includedInWealth: true });
    render(<WealthDashboard />);

    const reminder = await screen.findByRole("region", { name: "Make your first backup" });
    expect(reminder).toHaveTextContent(/only copy that survives/);
    await waitFor(async () => expect(await wealthDb.metadata.get("storage-persist-request")).toBeDefined());
    // The refusal is said plainly.
    expect(await screen.findByText(/has not granted persistent storage/)).toBeInTheDocument();

    fireEvent.click(within(reminder).getByRole("button", { name: "Export backup" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Make your first backup" })).not.toBeInTheDocument());
  });

  it("can be put off for a few days", async () => {
    await createAccount({ id: "mine", name: "Mine", category: "liquidity", currency: "EUR", balance: 100, includedInWealth: true });
    render(<WealthDashboard />);
    const reminder = await screen.findByRole("region", { name: "Make your first backup" });
    fireEvent.click(within(reminder).getByRole("button", { name: "Later" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Make your first backup" })).not.toBeInTheDocument());
    const until = Date.parse(window.localStorage.getItem("wealth-backup-snooze") ?? "");
    expect(until - Date.now()).toBeGreaterThan(2.9 * 86_400_000);
  });
});
