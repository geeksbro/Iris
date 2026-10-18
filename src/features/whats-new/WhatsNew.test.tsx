import "fake-indexeddb/auto";

import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import packageInfo from "../../../package.json";
import { resetDatabaseForTests } from "@/data/repository";
import { WealthDashboard } from "@/features/dashboard/WealthDashboard";
import { initializeWithDemoArchive } from "@/test/demo-archive";

import { latestRelease, releases } from "./releases";

const topBar = () => document.querySelector<HTMLElement>(".topbar")!;

describe("What's new", () => {
  beforeEach(async () => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    window.localStorage.setItem("wealth-language", "en");
    await resetDatabaseForTests();
    await initializeWithDemoArchive();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    ["wealth-language", "wealth-seen-release"].forEach((key) => window.localStorage.removeItem(key));
    await resetDatabaseForTests();
  });

  it("keeps the newest notes on the version IRIS carries, newest first, in both languages", () => {
    expect(latestRelease.version).toBe(packageInfo.version);
    const dates = releases.map((release) => release.date);
    expect([...dates].sort().reverse()).toEqual(dates);
    for (const release of releases) {
      for (const note of release.notes) {
        expect(note.text[0].length).toBeGreaterThan(0);
        expect(note.text[1].length).toBeGreaterThan(0);
      }
    }
  });

  it("shows a dot until the newest release has been seen, and opening the panel is seeing it", async () => {
    render(<WealthDashboard />);
    await screen.findByTestId("wealth-hero");
    const button = within(topBar()).getByRole("button", { name: "What's new: there is a new version" });
    expect(button.querySelector(".whats-new__dot")).not.toBeNull();

    fireEvent.click(button);
    const panel = await screen.findByRole("dialog", { name: "What's new" });
    expect(within(panel).getByRole("heading", { level: 3, name: new RegExp(`^${latestRelease.version}`) })).toBeInTheDocument();
    expect(window.localStorage.getItem("wealth-seen-release")).toBe(latestRelease.version);
    expect(within(topBar()).getByRole("button", { name: "What's new" }).querySelector(".whats-new__dot")).toBeNull();

    fireEvent.keyDown(panel, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "What's new" })).not.toBeInTheDocument();
  });

  it("shows no dot on a device that has seen the newest release", async () => {
    window.localStorage.setItem("wealth-seen-release", latestRelease.version);
    render(<WealthDashboard />);
    await screen.findByTestId("wealth-hero");
    expect(within(topBar()).getByRole("button", { name: "What's new" }).querySelector(".whats-new__dot")).toBeNull();
  });

  it("takes a note's “Try it” to its row in Settings, marked, and Settings › System opens the same notes", async () => {
    render(<WealthDashboard />);
    await screen.findByTestId("wealth-hero");
    fireEvent.click(within(topBar()).getByRole("button", { name: /^What's new/ }));
    const panel = await screen.findByRole("dialog", { name: "What's new" });
    const note = within(panel).getByText("Three ways to change page: fade, cascade or cinematic.").closest("li")!;
    fireEvent.click(within(note).getByRole("button", { name: "Try it" }));

    await screen.findByRole("heading", { level: 1, name: "Settings" });
    expect(screen.getByRole("heading", { level: 2, name: "Experience" })).toBeInTheDocument();
    const row = document.querySelector<HTMLElement>('.settings-view [data-setting="page-transition"]')!;
    expect(row).toHaveAttribute("data-linked", "");
    expect(row).toContainElement(document.activeElement as HTMLElement);

    // From Settings › System, the same panel.
    const index = screen.getByRole("navigation", { name: "Settings groups" });
    fireEvent.click(within(index).getByRole("button", { name: /^System/ }));
    await screen.findByRole("heading", { level: 2, name: "System" });
    fireEvent.click(screen.getByRole("button", { name: "See what's new" }));
    expect(await screen.findByRole("dialog", { name: "What's new" })).toBeInTheDocument();
  });
});
