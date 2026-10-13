import "fake-indexeddb/auto";

import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetDatabaseForTests } from "@/data/repository";
import { WealthDashboard } from "@/features/dashboard/WealthDashboard";

import { defaultLayout, parseLayout } from "./layout";
import { initializeWithDemoArchive } from "@/test/demo-archive";

/*
 * What a test in jsdom can honestly say about this: which panels are on the
 * page, in what order, how wide each asks to be, and what editing commits or
 * discards. It cannot say anything about the motion — jsdom has no layout, so
 * there are no boxes to measure and FLIP has nothing to invert. The reflow,
 * the drag and the spans as they actually resolve belong to a browser.
 */

const layoutKey = "wealth-overview-layout";

const panelIdsOnPage = () =>
  [...document.querySelectorAll("[data-panel-id]")].map((panel) => panel.getAttribute("data-panel-id"));

const spansOnPage = () =>
  [...document.querySelectorAll<HTMLElement>("[data-panel-id]")].map((panel) => panel.style.getPropertyValue("--panel-span"));

async function openOverview() {
  render(<WealthDashboard />);
  // The view's own marker, not the total's: an arrangement may leave the
  // total off the page, and the Overview is still on screen.
  await screen.findByTestId("wealth-overview");
}

const editButton = () => screen.getByRole("button", { name: "Edit overview" });
const workspace = () => screen.getByRole("region", { name: "Customisable overview" });

describe("Overview workspace", () => {
  beforeEach(async () => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    window.localStorage.setItem("wealth-language", "en");
    window.localStorage.removeItem(layoutKey);
    await resetDatabaseForTests();
    await initializeWithDemoArchive();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    window.localStorage.removeItem(layoutKey);
    window.localStorage.removeItem("wealth-language");
    await resetDatabaseForTests();
  });

  it("opens on the arrangement the Overview has always had, with no editing controls in sight", async () => {
    await openOverview();

    expect(panelIdsOnPage()).toEqual(defaultLayout.map((panel) => panel.id));
    // The page it has always been: the total beside its metrics at 4 + 2, the
    // three category cards, then the trend beside the composition and the rest.
    expect(spansOnPage()).toEqual(["4", "2", "2", "2", "2", "4", "2", "2", "2", "2"]);
    // Reading is not arranging: nothing offers to move, resize or remove.
    expect(within(workspace()).queryByRole("button", { name: /^Move / })).not.toBeInTheDocument();
    expect(within(workspace()).queryByRole("button", { name: /^Remove / })).not.toBeInTheDocument();
    expect(within(workspace()).queryByRole("button", { name: "Add panel" })).not.toBeInTheDocument();
  });

  it("shows the controls only while editing, and leaves them behind on the way out", async () => {
    await openOverview();
    fireEvent.click(editButton());

    expect(within(workspace()).getAllByRole("button", { name: /^Move / })).toHaveLength(defaultLayout.length);
    expect(screen.getByRole("button", { name: "Add panel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(within(workspace()).queryByRole("button", { name: /^Move / })).not.toBeInTheDocument();
  });

  it("removes a panel and keeps it removed, on this device, once the edit is finished", async () => {
    await openOverview();
    fireEvent.click(editButton());
    fireEvent.click(screen.getByRole("button", { name: "Remove What changed" }));

    expect(panelIdsOnPage()).not.toContain("movement");
    expect(panelIdsOnPage()).toHaveLength(defaultLayout.length - 1);
    // Nothing is stored until the edit is finished: that is what makes
    // discarding possible at all.
    expect(window.localStorage.getItem(layoutKey)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(parseLayout(window.localStorage.getItem(layoutKey)!))
      .toEqual(defaultLayout.filter((panel) => panel.id !== "movement"));
  });

  it("puts everything back when the changes are discarded, and stores nothing", async () => {
    await openOverview();
    fireEvent.click(editButton());
    fireEvent.click(screen.getByRole("button", { name: "Remove Accounts" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove Goal" }));
    expect(panelIdsOnPage()).toHaveLength(defaultLayout.length - 2);

    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(panelIdsOnPage()).toEqual(defaultLayout.map((panel) => panel.id));
    expect(window.localStorage.getItem(layoutKey)).toBeNull();
  });

  it("reorders from the keyboard, so arranging never requires dragging", async () => {
    await openOverview();
    fireEvent.click(editButton());

    const grip = screen.getByRole("button", { name: /^Move Wealth trend/ });
    grip.focus();
    fireEvent.keyDown(grip, { key: "ArrowRight" });

    expect(panelIdsOnPage().slice(5, 7)).toEqual(["allocation", "history"]);
    // Focus follows the panel rather than staying with the place it left.
    expect(screen.getByRole("button", { name: /^Move Wealth trend/ })).toHaveFocus();
  });

  it("changes how wide a panel asks to be, in sixths", async () => {
    await openOverview();
    fireEvent.click(editButton());

    const width = screen.getByRole("radiogroup", { name: "Width of Wealth composition" });
    fireEvent.click(within(width).getByRole("radio", { name: "Half" }));

    // Only the composition changed; every other panel kept the width it asked for.
    expect(spansOnPage()).toEqual(["4", "2", "2", "2", "2", "4", "3", "2", "2", "2"]);
    expect(within(width).getByRole("radio", { name: "Half" })).toHaveAttribute("aria-checked", "true");
  });

  it("offers in the catalogue only what is not on the page, and says why the rest cannot be added", async () => {
    await openOverview();
    fireEvent.click(editButton());
    fireEvent.click(screen.getByRole("button", { name: "Add panel" }));

    let catalogue = screen.getByRole("group", { name: "Panel catalogue" });
    // The five placed panels are not offered again.
    expect(within(catalogue).queryByText("Wealth trend")).not.toBeInTheDocument();

    /* A reading that cannot be shown yet is listed with the reason, not
       hidden: "there is no such panel" and "there is nothing in it yet" are
       different answers. This device has one update, and comparing needs two. */
    fireEvent.click(screen.getByRole("button", { name: "Close the catalogue" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove What changed" }));
    fireEvent.click(screen.getByRole("button", { name: "Add panel" }));
    catalogue = screen.getByRole("group", { name: "Panel catalogue" });
    const movement = within(catalogue).getByText("What changed").closest("button")!;
    expect(movement).toBeDisabled();
    expect(within(movement).getByText("Needs at least two updates.")).toBeInTheDocument();

    // One that can be added, is.
    const access = within(catalogue).getByText("Access to capital").closest("button")!;
    expect(access).not.toBeDisabled();
    fireEvent.click(access);
    expect(panelIdsOnPage()).toEqual([...defaultLayout.filter((panel) => panel.id !== "movement").map((panel) => panel.id), "access"]);
  });

  it("reads back the arrangement stored on this device, and ignores one it cannot understand", async () => {
    window.localStorage.setItem(layoutKey, JSON.stringify([{ id: "goal", span: 6 }, { id: "accounts", span: 3 }]));
    await openOverview();
    expect(panelIdsOnPage()).toEqual(["goal", "accounts"]);
    expect(spansOnPage()).toEqual(["6", "3"]);
  });

  it("falls back to the original arrangement rather than breaking on a damaged one", () => {
    expect(parseLayout("not json")).toBeUndefined();
    expect(parseLayout('{"id":"goal"}')).toBeUndefined();
    // Unknown panels, repeats and impossible spans are dropped or corrected.
    expect(parseLayout('[{"id":"ghost","span":2},{"id":"goal","span":5},{"id":"goal","span":2}]'))
      .toEqual([{ id: "goal", span: 2 }]);
    // An empty workspace is a real answer, not a damaged one.
    expect(parseLayout("[]")).toEqual([]);
  });
});
