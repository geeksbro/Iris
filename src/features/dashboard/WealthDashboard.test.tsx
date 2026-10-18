import "fake-indexeddb/auto";

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  resetDatabaseForTests,
  updateAccount,
  wealthDb,
} from "@/data/repository";
import * as repository from "@/data/repository";
import type { WealthSnapshot } from "@/domain/types";
import { LanguageProvider } from "@/features/i18n/language";

import { WealthDashboard } from "./WealthDashboard";
import { ProgressView } from "./ProgressView";
import { GoalsView } from "./GoalsView";
import { ScenarioView } from "./ScenarioView";
import { CashFlowView, yearOverYear } from "./CashFlowView";
import {
  AllocationChart,
  buildWealthHistoryTickLabels,
  calculateScenarioYAxisDomain,
  formatScenarioAxisTick,
  formatWealthAxisTick,
  isHistoryRangeUseful,
  summarizeIncomeByCalendarMonth,
  summarizeIncomeByMonth,
  WealthHistoryChart,
  WealthHistoryTooltip,
} from "./Charts";
import { ConfirmDialog, PaycheckFormDialog } from "./Dialogs";
import { PrivacyProvider, PrivacyToggle, Sensitive } from "./privacy";
import { Delta, Money } from "./ui";
import { initializeWithDemoArchive } from "@/test/demo-archive";

// Language and the eye live in the top bar (owner, 12 Oct 2026: the
// profile's menu is about its picture only).
async function openProfilePanel() {
  // The top bar, not a view's own header (some views have one too).
  await screen.findAllByRole("banner");
  return document.querySelector<HTMLElement>(".topbar")!;
}

describe("WealthDashboard", () => {
  beforeEach(async () => {
    // jsdom does not implement scrolling; the dashboard scrolls when a child view opens or closes.
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
    window.localStorage.removeItem("wealth-sidebar-collapsed");
    await resetDatabaseForTests();
  });

  it("renders the derived Total Wealth hero from live account data", async () => {
    render(<WealthDashboard />);

    const hero = await screen.findByTestId("wealth-hero");
    expect(within(hero).getByText("TOTAL WEALTH")).toBeInTheDocument();
    expect(within(hero).getByRole("heading", { level: 1, name: /9\.420,40/ })).toBeInTheDocument();
  });

  it("renders a zero-baseline delta without inventing a percentage", () => {
    render(<Delta amount={250} percentage={null} />);

    expect(screen.getByText(/\+250,00\s*€\s*·\s*—/)).toBeInTheDocument();
    expect(screen.queryByText(/0,00%/)).not.toBeInTheDocument();
  });

  it("keeps the zero-baseline amount in the wealth chart tooltip without inventing a percentage", () => {
    render(<WealthHistoryTooltip active point={{
      date: "2026-08-26T09:00:00.000Z",
      wealth: 250,
      changeAmount: 250,
      changePercentage: null,
    }} />);

    expect(screen.getByText(/\+250,00\s*€\s*·\s*—/)).toBeInTheDocument();
    expect(screen.queryByText(/0,00%/)).not.toBeInTheDocument();
  });

  it("shows an honest history state when only one stored snapshot exists", async () => {
    render(<WealthDashboard />);

    expect(await screen.findByText(/update your balances again to reveal/i)).toBeInTheDocument();
    expect(screen.queryByText(/sample data/i)).not.toBeInTheDocument();
  });

  it("uses six primary workflows while keeping category details reachable from Overview", async () => {
    render(<WealthDashboard />);

    await screen.findByTestId("wealth-hero");
    const primaryNavigation = screen.getByRole("navigation", { name: "Primary navigation" });
    // Settings is the top bar's gear, not a financial view of the rail.
    expect(within(primaryNavigation).getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Overview",
      "Accounts",
      "Cash Flow",
      "Trend",
      "Goals",
      "Projections",
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Accounts" }));
    expect(await screen.findByRole("heading", { name: "Accounts" })).toBeInTheDocument();

    for (const section of ["Cash Flow", "Goals"]) {
      fireEvent.click(screen.getByRole("button", { name: section }));
      expect(await screen.findByRole("heading", { name: section })).toBeInTheDocument();
    }

    fireEvent.click(screen.getByRole("button", { name: "Projections" }));
    expect(await screen.findByRole("heading", { name: "Projections" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Overview" }));
    expect(await screen.findByTestId("wealth-hero")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open Investments detail" }));
    expect(await screen.findByRole("heading", { name: "Investments" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Overview" }));
    fireEvent.click(screen.getByRole("button", { name: "Open Trading detail" }));
    expect(await screen.findByRole("heading", { name: "Trading" })).toBeInTheDocument();
  });

  it("offers a back control only on child views and returns to their parent, not to history", async () => {
    const historyBack = vi.spyOn(window.history, "back");
    render(<WealthDashboard />);

    await screen.findByTestId("wealth-hero");
    const primaryNavigation = screen.getByRole("navigation", { name: "Primary navigation" });
    for (const section of ["Overview", "Accounts", "Cash Flow", "Trend", "Goals", "Projections"]) {
      fireEvent.click(within(primaryNavigation).getByRole("button", { name: section }));
      await screen.findByRole("heading", { level: 1 });
      expect(screen.queryByRole("button", { name: /^Back/ })).not.toBeInTheDocument();
    }

    fireEvent.click(within(primaryNavigation).getByRole("button", { name: "Overview" }));
    for (const [card, heading] of [["Open Investments detail", "Investments"], ["Open Trading detail", "Trading"]]) {
      fireEvent.click(await screen.findByRole("button", { name: card }));
      expect(await screen.findByRole("heading", { level: 1, name: heading })).toBeInTheDocument();

      const back = screen.getByRole("button", { name: "Back to Overview" });
      expect(back).toHaveTextContent("Back");
      expect(back).toHaveAttribute("type", "button");
      fireEvent.click(back);

      expect(await screen.findByTestId("wealth-hero")).toBeInTheDocument();
      await waitFor(() => expect(screen.getByRole("button", { name: card })).toHaveFocus());
    }
    expect(historyBack).not.toHaveBeenCalled();
  });

  it("opens a child view at the top and returns to the exact Overview position and card", async () => {
    const scrollTo = vi.mocked(window.scrollTo);
    const setScrollY = (value: number) => Object.defineProperty(window, "scrollY", { configurable: true, value });
    render(<WealthDashboard />);

    await screen.findByTestId("wealth-hero");
    for (const [card, heading, position] of [["Open Investments detail", "Investments", 1234], ["Open Trading detail", "Trading", 87]] as const) {
      setScrollY(position);
      scrollTo.mockClear();
      fireEvent.click(screen.getByRole("button", { name: card }));
      await screen.findByRole("heading", { level: 1, name: heading });
      expect(scrollTo).toHaveBeenCalledTimes(1);
      expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, left: 0, behavior: "instant" });

      setScrollY(0);
      const focus = vi.spyOn(HTMLElement.prototype, "focus");
      fireEvent.click(screen.getByRole("button", { name: "Back to Overview" }));
      await screen.findByTestId("wealth-hero");
      expect(scrollTo).toHaveBeenCalledTimes(2);
      expect(scrollTo).toHaveBeenLastCalledWith({ top: position, left: 0, behavior: "instant" });
      expect(screen.getByRole("button", { name: card })).toHaveFocus();
      expect(focus).toHaveBeenLastCalledWith({ preventScroll: true });
      focus.mockRestore();
    }

    // Root navigation keeps its behaviour: it applies no scroll of its own.
    scrollTo.mockClear();
    const primaryNavigation = screen.getByRole("navigation", { name: "Primary navigation" });
    fireEvent.click(within(primaryNavigation).getByRole("button", { name: "Accounts" }));
    await screen.findByRole("heading", { level: 1, name: "Accounts" });
    fireEvent.click(within(primaryNavigation).getByRole("button", { name: "Overview" }));
    await screen.findByTestId("wealth-hero");
    fireEvent.click(screen.getByRole("button", { name: "Open Liquidity detail" }));
    await screen.findByRole("heading", { level: 1, name: "Accounts" });
    expect(scrollTo).not.toHaveBeenCalled();
    setScrollY(0);
  });

  it("names the back control in Italian by default", async () => {
    window.localStorage.removeItem("wealth-language");
    render(<WealthDashboard />);

    fireEvent.click(await screen.findByRole("button", { name: "Apri dettaglio Trading" }));
    const back = await screen.findByRole("button", { name: "Indietro, torna a Panoramica" });
    expect(back).toHaveTextContent("Indietro");
  });

  it("gives Settings the same back control, returning to the view and the place it was opened from", async () => {
    const historyBack = vi.spyOn(window.history, "back");
    const scrollTo = vi.mocked(window.scrollTo);
    const setScrollY = (value: number) => Object.defineProperty(window, "scrollY", { configurable: true, value });
    render(<WealthDashboard />);
    await screen.findByTestId("wealth-hero");

    fireEvent.click(within(screen.getByRole("navigation", { name: "Primary navigation" })).getByRole("button", { name: "Accounts" }));
    await screen.findByRole("heading", { level: 1, name: "Accounts" });
    setScrollY(640);
    const gear = screen.getByRole("button", { name: "Settings" });
    fireEvent.click(gear);
    await screen.findByRole("heading", { level: 1, name: "Settings" });

    // The child views' control: same component, class and wording, placed before the title.
    const back = screen.getByRole("button", { name: "Back to Accounts" });
    expect(back).toHaveClass("button", "back-control");
    expect(back).toHaveTextContent("Back");
    expect(back).toHaveAttribute("type", "button");
    expect(back.compareDocumentPosition(screen.getByRole("heading", { level: 1, name: "Settings" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    setScrollY(0);
    scrollTo.mockClear();
    fireEvent.click(back);
    await screen.findByRole("heading", { level: 1, name: "Accounts" });
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 640, left: 0, behavior: "instant" });
    expect(gear).toHaveFocus();
    expect(historyBack).not.toHaveBeenCalled();

    // Opened from the Overview, it returns there.
    fireEvent.click(within(screen.getByRole("navigation", { name: "Primary navigation" })).getByRole("button", { name: "Overview" }));
    await screen.findByTestId("wealth-hero");
    fireEvent.click(gear);
    fireEvent.click(await screen.findByRole("button", { name: "Back to Overview" }));
    expect(await screen.findByTestId("wealth-hero")).toBeInTheDocument();
    setScrollY(0);
  });

  it("names the Settings back control in Italian after the view it returns to", async () => {
    window.localStorage.removeItem("wealth-language");
    render(<WealthDashboard />);
    await screen.findByTestId("wealth-hero");

    fireEvent.click(screen.getByRole("button", { name: "Conti" }));
    await screen.findByRole("heading", { level: 1, name: "Conti" });
    fireEvent.click(screen.getByRole("button", { name: "Impostazioni" }));
    const back = await screen.findByRole("button", { name: "Indietro, torna a Conti" });
    expect(back).toHaveTextContent("Indietro");
  });

  it("folds the rail to its icons and back, every page still named, remembered on this device", async () => {
    window.localStorage.removeItem("wealth-language");
    window.localStorage.removeItem("wealth-sidebar-collapsed");
    const { container, unmount } = render(<WealthDashboard />);
    await screen.findByTestId("wealth-hero");
    expect(container.querySelector(".sidebar")).not.toHaveClass("sidebar--collapsed");
    expect(screen.getByRole("button", { name: "Panoramica" })).not.toHaveAttribute("title");

    fireEvent.click(screen.getByRole("button", { name: "Riduci barra laterale" }));
    expect(container.querySelector(".sidebar")).toHaveClass("sidebar--collapsed");
    expect(window.localStorage.getItem("wealth-sidebar-collapsed")).toBe("1");
    // Only the icons show: each page keeps its name, says it on hover, and still opens.
    const accounts = screen.getByRole("button", { name: "Conti" });
    expect(accounts).toHaveAttribute("title", "Conti");
    fireEvent.click(accounts);
    expect(accounts).toHaveAttribute("aria-current", "page");

    // A reload keeps it folded; the same control unfolds it.
    unmount();
    const again = render(<WealthDashboard />);
    await screen.findByTestId("wealth-hero");
    expect(again.container.querySelector(".sidebar")).toHaveClass("sidebar--collapsed");
    fireEvent.click(screen.getByRole("button", { name: "Espandi barra laterale" }));
    await waitFor(() => expect(again.container.querySelector(".sidebar")).not.toHaveClass("sidebar--collapsed"));
    expect(screen.getByRole("button", { name: "Riduci barra laterale" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Panoramica" })).not.toHaveAttribute("title");
    expect(window.localStorage.getItem("wealth-sidebar-collapsed")).toBe("0");
  });

  it("defaults to Italian and switches the whole interface to English from the top bar, language before privacy", async () => {
    window.localStorage.removeItem("wealth-language");
    render(<WealthDashboard />);

    await screen.findByTestId("wealth-hero");
    const bar = await openProfilePanel();
    const language = within(bar).getByRole("button", { name: "Passa all'inglese" });
    const privacyToggle = within(bar).getByRole("button", { name: "Nascondi importi" });
    expect(language.compareDocumentPosition(privacyToggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Navigazione principale" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Panoramica" })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("it");

    fireEvent.click(language);

    expect(screen.getByRole("button", { name: "Overview" })).toBeInTheDocument();
    expect(within(bar).getByRole("button", { name: "Hide amounts" })).toBeInTheDocument();
    expect(within(bar).getByRole("button", { name: "Switch to Italian" })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("en");
    expect(window.localStorage.getItem("wealth-language")).toBe("en");
  });

  it("opens Trend with what is known first and a compact list of insights still waiting for history", async () => {
    render(<WealthDashboard />);

    await screen.findByTestId("wealth-hero");
    fireEvent.click(screen.getByRole("button", { name: "Trend" }));

    expect(await screen.findByRole("heading", { level: 1, name: "Trend" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Progress" })).not.toBeInTheDocument();
    expect(screen.getByText("Current wealth")).toBeInTheDocument();
    expect(screen.getByText("All-time high")).toBeInTheDocument();

    // One saved update: nothing derived is computable, so no empty metric cards render.
    expect(screen.queryByRole("group", { name: "Trajectory metrics" })).not.toBeInTheDocument();
    const readiness = screen.getByRole("region", { name: "History in progress" });
    expect(within(readiness).getByText("30 days").parentElement).toHaveTextContent(/Waiting.*about 30 days before/i);
    expect(within(readiness).getByText("Average monthly pace").parentElement).toHaveTextContent(/3 updates.*60 days/i);
    expect(within(readiness).getByText("Pace change").parentElement).toHaveTextContent(/two non-overlapping periods/i);
    expect(within(readiness).getByText("Best and worst periods")).toBeInTheDocument();
    expect(within(readiness).queryByText("—")).not.toBeInTheDocument();

    fireEvent.click(within(await openProfilePanel()).getByRole("button", { name: "Hide amounts" }));
    const currentObserved = screen.getByTestId("progress-current-wealth");
    expect(currentObserved).toHaveTextContent(/\*/);
    expect(currentObserved).not.toHaveTextContent(/9\.420,40/);
  });

  it("names observed and derived data only, since Trend shows nothing simulated", async () => {
    render(<WealthDashboard />);

    await screen.findByTestId("wealth-hero");
    fireEvent.click(screen.getByRole("button", { name: "Trend" }));

    const legend = await screen.findByRole("group", { name: "Data basis legend" });
    expect(within(legend).getByText("Observed")).toBeInTheDocument();
    expect(within(legend).getByText("Derived")).toBeInTheDocument();
    expect(within(legend).queryByText("Simulated")).not.toBeInTheDocument();
    expect(legend.querySelector(".basis-mark--observed")).not.toBeNull();
    expect(legend.querySelector(".basis-mark--derived")).not.toBeNull();
  });

  it("holds best and worst back until two comparable periods exist, and shows derived insights only when available", () => {
    const renderTrend = (snapshots: WealthSnapshot[]) => render(
      <PrivacyProvider>
        <ProgressView currentWealth={snapshots.at(-1)?.totalWealth ?? 0} snapshots={snapshots} />
      </PrivacyProvider>,
    );
    const june = { id: "june", createdAt: "2026-06-01T09:00:00.000Z", totalWealth: 9000, accountBalances: [] };
    const july = { id: "july", createdAt: "2026-07-01T09:00:00.000Z", totalWealth: 9500, accountBalances: [] };
    const august = { id: "august", createdAt: "2026-07-31T09:00:00.000Z", totalWealth: 9300, accountBalances: [] };

    const { unmount } = renderTrend([june, july]);
    const insights = screen.getByRole("group", { name: "Trajectory metrics" });
    expect(within(insights).getByText("30 days").parentElement).toHaveTextContent(/\+500,00/);
    expect(within(insights).queryByText("Best")).not.toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "History in progress" })).getByText("Best and worst periods")).toBeInTheDocument();
    expect(screen.getByText("Latest observed change").closest("article")).toHaveTextContent(/\+500,00/);
    unmount();

    renderTrend([june, july, august]);
    const extrema = screen.getByText("Best and worst periods").parentElement as HTMLElement;
    expect(within(extrema).getByText("Best").parentElement).toHaveTextContent(/\+500,00/);
    expect(within(extrema).getByText("Worst").parentElement).toHaveTextContent(/-200,00/);
  });

  it("derives reached and next milestones from observed wealth", async () => {
    render(<WealthDashboard />);

    await screen.findByTestId("wealth-hero");
    fireEvent.click(screen.getByRole("button", { name: "Trend" }));

    const milestones = await screen.findByRole("region", { name: "Wealth milestones" });
    expect(within(milestones).getByRole("heading", { name: "Wealth milestones" })).toBeInTheDocument();
    expect(within(milestones).getByText("Next milestone").parentElement).toHaveTextContent(/10\.000,00/);
    expect(within(milestones).getAllByText("Reached")).toHaveLength(2);
    expect(within(milestones).getByText("Next")).toBeInTheDocument();
    expect(within(milestones).getAllByText("Not yet reached").length).toBeGreaterThan(0);
    expect(within(milestones).getAllByText(/^First observed [0-9]/)).toHaveLength(2);
  });

  it("renders an honest monthly review and explicit allocation limitation", async () => {
    await wealthDb.snapshots.bulkAdd([
      { id: "review-opening", createdAt: "2026-07-31T12:00:00.000Z", totalWealth: 9000, accountBalances: [] },
      { id: "review-closing", createdAt: "2026-08-31T12:00:00.000Z", totalWealth: 10000, accountBalances: [] },
    ]);
    render(<WealthDashboard />);

    await screen.findByTestId("wealth-hero");
    fireEvent.click(screen.getByRole("button", { name: "Trend" }));

    const review = await screen.findByRole("region", { name: "Monthly wealth review" });
    expect(within(review).getByRole("heading", { name: "Monthly review" })).toBeInTheDocument();
    expect(within(review).getByText("Opening wealth").parentElement).toHaveTextContent(/9\.000,00/);
    expect(within(review).getByText("Closing wealth").parentElement).toHaveTextContent(/10\.000,00/);
    expect(within(review).getByText("Observed change").parentElement).toHaveTextContent(/\+1\.000,00/);
    expect(within(review).getByText("Allocation evolution").parentElement).toHaveTextContent(/Not applicable/i);
    expect(within(review).getByText(/snapshots lack immutable category metadata/i)).toBeInTheDocument();
  });

  it("answers \"can I afford it?\" on the main goal, saves the choice, and never touches observed data", async () => {
    const before = {
      accounts: await wealthDb.accounts.toArray(),
      snapshots: await wealthDb.snapshots.toArray(),
      goals: await wealthDb.goals.toArray(),
    };
    render(<WealthDashboard />);

    await screen.findByTestId("wealth-hero");
    fireEvent.click(screen.getByRole("button", { name: "Projections" }));
    expect(await screen.findByRole("heading", { name: "Projections" })).toBeInTheDocument();
    // Nothing asked yet: the page says how to start, and draws nothing.
    expect(screen.getByRole("heading", { name: /Type an amount or pick one of the ideas/ })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Without and with this choice" })).not.toBeInTheDocument();

    // A ready-made idea fills the question: a 1.500 € holiday, once.
    fireEvent.click(screen.getByRole("button", { name: /A holiday/ }));
    expect(screen.getByLabelText("Amount")).toHaveValue(1500);
    expect(screen.getByRole("radio", { name: "Spending" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "once" })).toHaveAttribute("aria-checked", "true");
    // With no monthly saving, the goal cannot be dated: the page asks for it.
    expect(screen.getByRole("heading", { name: /say how much you set aside each month/i })).toBeInTheDocument();

    // 500 € a month: 22 months to 20.000 € without it, 25 with it.
    fireEvent.change(screen.getByLabelText("Today's monthly saving"), { target: { value: "500" } });
    expect(screen.getByRole("heading", { name: "Your goal moves 3 months later." })).toBeInTheDocument();
    expect(screen.getByTestId("afford-year-with")).toHaveTextContent(/13\.920,40/);
    expect(screen.getByText("You put it back in").parentElement).toHaveTextContent("3 months");
    expect(screen.getByText("To keep the goal's date").parentElement).toHaveTextContent(/549,07/);
    expect(screen.getByText("To keep the goal's date").parentElement).toHaveTextContent(/49,07/);
    const chart = screen.getByRole("region", { name: "Without and with this choice" });
    expect(within(chart).getByText("Without this choice")).toBeInTheDocument();
    expect(within(chart).getByText("With this choice")).toBeInTheDocument();

    // Saved, it stays on this device and is answered again.
    fireEvent.change(screen.getByLabelText("Name of the choice"), { target: { value: "Holiday" } });
    fireEvent.click(screen.getByRole("button", { name: "Save this choice" }));
    const saved = screen.getByRole("region", { name: "Your saved choices" });
    expect(within(saved).getByText("Holiday")).toBeInTheDocument();
    expect(within(saved).getByText("+3 months on the goal")).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem("wealth-saved-scenarios") ?? "[]")).toMatchObject([{ name: "Holiday", kind: "spend", amount: 1500, frequency: "once", monthly: 500 }]);

    expect(await wealthDb.accounts.toArray()).toEqual(before.accounts);
    expect(await wealthDb.snapshots.toArray()).toEqual(before.snapshots);
    expect(await wealthDb.goals.toArray()).toEqual(before.goals);

    fireEvent.click(screen.getByRole("button", { name: "Start over" }));
    expect(screen.getByLabelText("Amount")).toHaveValue(null);
    expect(screen.getByLabelText("Today's monthly saving")).toHaveValue(0);
    window.localStorage.removeItem("wealth-saved-scenarios");
  });

  it("separates recorded balances from unavailable cash-flow and performance analytics", async () => {
    render(<WealthDashboard />);

    await screen.findByTestId("wealth-hero");
    fireEvent.click(screen.getByRole("button", { name: "Cash Flow" }));
    // No outflows are stored, so nothing is computed from them (owner, 17 Oct
    // 2026: the empty outflows card is gone), and nothing pretends otherwise.
    expect(await screen.findByText("Typical salary")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Data not yet available" })).not.toBeInTheDocument();
    expect(screen.queryByText("Net cash flow")).not.toBeInTheDocument();
    expect(screen.queryByText("Savings rate")).not.toBeInTheDocument();
    expect(screen.getByText("Typical salary").parentElement).toHaveTextContent(/€/);

    fireEvent.click(screen.getByRole("button", { name: "Overview" }));
    fireEvent.click(screen.getByRole("button", { name: "Open Investments detail" }));
    expect(await screen.findByText("No holdings recorded yet")).toBeInTheDocument();
    expect(screen.getByText("Portfolio value").parentElement).toHaveTextContent("3.379,05");
    expect(screen.getByText("Return").parentElement).toHaveTextContent("—");

    fireEvent.click(screen.getByRole("button", { name: "Overview" }));
    fireEvent.click(screen.getByRole("button", { name: "Open Trading detail" }));
    expect(await screen.findByText("Performance not yet calculable")).toBeInTheDocument();
    expect(screen.getByText("Trading capital").parentElement).toHaveTextContent("425,60");
    expect(screen.getByText("Net P&L").parentElement).toHaveTextContent("—");
  });

  it("opens Update balances with accessible labels for every active account", async () => {
    render(<WealthDashboard />);

    await screen.findByTestId("wealth-hero");
    fireEvent.click(screen.getByRole("button", { name: /update balances/i }));

    const dialog = await screen.findByRole("dialog", { name: /update balances/i });
    const categoryHeadings = Array.from(dialog.querySelectorAll(".balance-group > h3"))
      .map((heading) => heading.textContent);
    expect(categoryHeadings).toEqual(["Liquidity", "Investments", "Trading"]);
    expect(within(dialog).getByLabelText("Banca Aurora balance")).toHaveValue(4820.35);
    expect(within(dialog).getByLabelText("Cash balance")).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: /save snapshot/i })).toBeInTheDocument();
  });

  it("tells carried-over balances from edited ones before saving confirms them", async () => {
    render(<WealthDashboard />);

    await screen.findByTestId("wealth-hero");
    fireEvent.click(screen.getByRole("button", { name: /update balances/i }));
    const dialog = await screen.findByRole("dialog", { name: /update balances/i });
    const rowOf = (name: string) => within(dialog).getByLabelText(`${name} balance`).closest("label")!;

    // Untouched: a proposal carried over from the last save, dated.
    expect(rowOf("Banca Aurora")).toHaveTextContent("Last saved balance");
    expect(within(dialog).getByText("No balance edited: saving confirms every current value.")).toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText("Banca Aurora balance"), { target: { value: "6100" } });

    expect(rowOf("Banca Aurora")).toHaveTextContent("Edited now · was");
    expect(rowOf("Conto Vela")).toHaveTextContent("Last saved balance");
    // Cash keeps its own origin and is not counted either way.
    expect(rowOf("Cash")).toHaveTextContent("Derived from Cash Counter");
    expect(dialog.querySelector(".balance-summary")).toHaveTextContent(
      "1 balance edited now · 5 unchanged, which saving confirms at their current value.",
    );
  });

  it("removes a selected stored snapshot after confirmation without changing current balances", async () => {
    const saved = await repository.saveBalanceSnapshot(
      [{ accountId: "banca-aurora", balance: 6000 }],
      "2026-08-26T09:00:00.000Z",
    );
    render(<WealthDashboard />);

    await screen.findByTestId("wealth-hero");
    fireEvent.click(screen.getByRole("button", { name: /update balances/i }));
    const dialog = await screen.findByRole("dialog", { name: /update balances/i });
    fireEvent.click(within(dialog).getAllByRole("button", { name: /remove snapshot from/i })[0]);

    const confirmation = await screen.findByRole("alertdialog", { name: "Remove this snapshot?" });
    expect(confirmation).toHaveTextContent("Current account balances will not change.");
    fireEvent.click(within(confirmation).getByRole("button", { name: /^Remove snapshot$/ }));

    await waitFor(async () => {
      expect(await wealthDb.snapshots.get(saved.id)).toBeUndefined();
    });
    expect(await wealthDb.snapshots.get("initial-snapshot")).toBeDefined();
    expect(await wealthDb.accounts.get("banca-aurora")).toMatchObject({ balance: 6000 });
    expect(screen.getByRole("status")).toHaveTextContent("Snapshot removed from history.");
  });

  it("removes excluded accounts from Total Wealth while keeping them manageable", async () => {
    await updateAccount("conto-vela", { includedInWealth: false }, "2026-08-25T12:00:00.000Z");
    render(<WealthDashboard />);

    const hero = await screen.findByTestId("wealth-hero");
    expect(within(hero).getByRole("heading", { level: 1, name: /8\.805,00/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Accounts" }));
    const contoVela = await screen.findByTestId("account-conto-vela");
    expect(within(contoVela).getByText(/excluded/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(within(contoVela).getByRole("checkbox", { name: /include conto vela/i })).not.toBeChecked();
    });
  });

  it("keeps the reserved Cash account recoverable by hiding destructive deletion", async () => {
    render(<WealthDashboard />);

    await screen.findByTestId("wealth-hero");
    fireEvent.click(screen.getByRole("button", { name: "Accounts" }));
    fireEvent.click(await screen.findByRole("button", { name: "Open Cash details" }));

    const dialog = await screen.findByRole("dialog", { name: "Cash" });
    expect(within(dialog).queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
    expect(await screen.findByTestId("account-cash")).toBeInTheDocument();
  });

  it("orders offset timestamps by epoch before deriving the latest snapshot change", async () => {
    await wealthDb.snapshots.bulkAdd([
      {
        id: "offset-older",
        createdAt: "2026-08-25T10:30:00+02:00",
        totalWealth: 10000,
        accountBalances: [],
      },
      {
        id: "offset-latest",
        createdAt: "2026-08-25T09:00:00+00:00",
        totalWealth: 10300,
        accountBalances: [],
      },
    ]);

    render(<WealthDashboard />);

    await screen.findByTestId("wealth-hero");
    const metrics = screen.getByLabelText("Wealth change metrics");
    const lastUpdate = within(metrics).getByText("Last update").closest(".wealth-context__item");
    expect(lastUpdate).toHaveTextContent("+300,00");
  });

  it("shows in the hero the move of the last saved update on the one before it", async () => {
    await wealthDb.snapshots.bulkAdd([
      { id: "previous", createdAt: "2026-08-27T10:00:00.000Z", totalWealth: 10000, accountBalances: [] },
      { id: "latest", createdAt: "2026-08-28T10:00:00.000Z", totalWealth: 10250, accountBalances: [] },
    ]);
    render(<WealthDashboard />);
    const hero = await screen.findByTestId("wealth-hero");

    await waitFor(() => {
      expect(within(hero).getByText(/\+250,00/)).toBeInTheDocument();
    });
    expect(within(hero).getByText("since the previous update")).toBeInTheDocument();
    // An account edited after the last update does not move it: only saved updates do.
    await updateAccount("banca-aurora", { balance: 6052.01 }, "2026-08-29T08:00:00.000Z");
    expect(within(hero).getByText(/\+250,00/)).toBeInTheDocument();
  });

  it("says when the hero has only one update to show", async () => {
    render(<WealthDashboard />);
    const hero = await screen.findByTestId("wealth-hero");
    expect(within(hero).getByText("The change shows from the next update")).toBeInTheDocument();
  });

  it("defaults a paycheck to the user's local calendar date", () => {
    const previousTimezone = process.env.TZ;
    process.env.TZ = "Pacific/Kiritimati";
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-25T12:30:00.000Z"));

    try {
      render(
        <PaycheckFormDialog
          onOpenChange={() => undefined}
          onSave={async () => undefined}
          open
        />,
      );

      expect(screen.getByLabelText("Payment date")).toHaveValue("2026-08-26");
    } finally {
      vi.useRealTimers();
      process.env.TZ = previousTimezone;
    }
  });

  it("shows an honest allocation empty state when no account is included", async () => {
    const accounts = await wealthDb.accounts.toArray();
    await Promise.all(accounts.map((account) => updateAccount(
      account.id,
      { includedInWealth: false },
      "2026-08-26T08:00:00.000Z",
    )));

    render(<WealthDashboard />);

    const allocation = await screen.findByLabelText("Composition by category");
    expect(within(allocation).getByText("No account is included in Total Wealth.")).toBeInTheDocument();
    expect(within(allocation).queryByText("Total wealth")).not.toBeInTheDocument();
  });

  it("shows category, EUR value, and derived percentage in the allocation legend", () => {
    render(<AllocationChart totals={{ liquidity: 100, investments: 50, trading: 50 }} />);

    const allocation = screen.getByLabelText("Composition by category");
    expect(within(allocation).getByText("Total wealth").parentElement).toHaveTextContent(/200,00\s*€/);
    expect(within(allocation).getByText("Liquidity").parentElement).toHaveTextContent(/100,00\s*€/);
    expect(within(allocation).getByText("Liquidity").parentElement).toHaveTextContent("50,00%");
    expect(within(allocation).getByText("Investments").parentElement).toHaveTextContent("25,00%");
    expect(within(allocation).getByText("Trading").parentElement).toHaveTextContent("25,00%");
  });

  it("shows the latest stored balance explicitly in account details", async () => {
    render(<WealthDashboard />);

    await screen.findByTestId("wealth-hero");
    fireEvent.click(screen.getByRole("button", { name: "Accounts" }));
    fireEvent.click(await screen.findByRole("button", { name: "Open Banca Aurora details" }));

    const dialog = await screen.findByRole("dialog", { name: "Banca Aurora" });
    expect(within(dialog).getByText("Previous snapshot balance").parentElement)
      .toHaveTextContent(/4\.820,35\s*€/);
  });

  it("surfaces included-toggle persistence errors through operation feedback", async () => {
    vi.spyOn(repository, "updateAccount").mockRejectedValueOnce(new Error("storage write failed"));
    render(<WealthDashboard />);

    await screen.findByTestId("wealth-hero");
    fireEvent.click(screen.getByRole("button", { name: "Accounts" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: /include conto vela/i }));

    expect(await screen.findByRole("status")).toHaveTextContent("Could not update Conto Vela: storage write failed");
  });

  it("offers and completes goal creation when no goal exists", async () => {
    await wealthDb.goals.clear();
    render(<WealthDashboard />);

    fireEvent.click(await screen.findByRole("button", { name: "Add wealth goal" }));
    const dialog = await screen.findByRole("dialog", { name: "Create wealth goal" });
    fireEvent.change(within(dialog).getByLabelText("Goal name"), { target: { value: "Next threshold" } });
    fireEvent.change(within(dialog).getByLabelText("Target amount"), { target: { value: "20000" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create goal" }));

    await waitFor(async () => {
      expect(await wealthDb.goals.get("wealth-goal")).toMatchObject({
        name: "Next threshold",
        targetAmount: 20000,
      });
    });
  });

  it("uses account initials across overview, account, investment, and trading rows", async () => {
    render(<WealthDashboard />);

    await screen.findByTestId("wealth-hero");
    expect(screen.getByTestId("account-mark-banca-aurora")).toHaveTextContent("BA");

    fireEvent.click(screen.getByRole("button", { name: "Accounts" }));
    expect(await screen.findByTestId("account-mark-banca-aurora")).toHaveTextContent("BA");
    expect(screen.getByTestId("account-mark-cash")).toHaveTextContent("CA");

    fireEvent.click(screen.getByRole("button", { name: "Overview" }));
    fireEvent.click(screen.getByRole("button", { name: "Open Investments detail" }));
    expect(await screen.findByTestId("account-mark-crypto-delta")).toHaveTextContent("CR");

    fireEvent.click(screen.getByRole("button", { name: "Overview" }));
    fireEvent.click(screen.getByRole("button", { name: "Open Trading detail" }));
    expect(await screen.findByTestId("account-mark-trading-nord")).toHaveTextContent("TR");
  });

  it("groups accounts by user-defined access while preserving category and volatility metadata", async () => {
    await updateAccount("banca-aurora", { access: "immediate", volatility: "stable" }, "2026-08-26T08:00:00.000Z");
    await updateAccount("crypto-delta", { access: "days", volatility: "moderate" }, "2026-08-26T08:00:00.000Z");
    await updateAccount("trading-nord", { access: "locked", volatility: "volatile" }, "2026-08-26T08:00:00.000Z");
    render(<WealthDashboard />);

    await screen.findByTestId("wealth-hero");
    fireEvent.click(screen.getByRole("button", { name: "Accounts" }));

    const accessSummary = await screen.findByRole("region", { name: "Wealth access" });
    expect(within(accessSummary).getByTestId("access-summary-total")).toHaveTextContent(/Total Wealth[\s\S]*9\.420,40/);

    const immediate = screen.getByTestId("access-group-immediate");
    expect(within(immediate).getByText("Banca Aurora")).toBeInTheDocument();
    expect(within(immediate).getByText("Liquidity")).toBeInTheDocument();
    expect(within(immediate).getByText("Stable")).toBeInTheDocument();

    const days = screen.getByTestId("access-group-days");
    expect(within(days).getByText("Crypto Delta")).toBeInTheDocument();
    expect(within(days).getByText("Moderate")).toBeInTheDocument();

    const locked = screen.getByTestId("access-group-locked");
    expect(within(locked).getByText("Trading Nord")).toBeInTheDocument();
    expect(within(locked).getByText("Volatile")).toBeInTheDocument();

    const unclassified = screen.getByTestId("access-group-unclassified");
    expect(within(unclassified).getByText("Conto Vela")).toBeInTheDocument();
    expect(within(unclassified).getAllByText("Unclassified").length).toBeGreaterThan(0);
  });

  it("sorts each access group by displayed balance even when an account is excluded", async () => {
    await updateAccount("conto-vela", { access: "immediate", balance: 10_000, includedInWealth: false }, "2026-08-26T08:00:00.000Z");
    await updateAccount("banca-aurora", { access: "immediate" }, "2026-08-26T08:00:00.000Z");
    render(<WealthDashboard />);

    await screen.findByTestId("wealth-hero");
    fireEvent.click(screen.getByRole("button", { name: "Accounts" }));

    const group = await screen.findByTestId("access-group-immediate");
    const rows = Array.from(group.querySelectorAll("article.ledger-row"));
    expect(rows[0]).toHaveAttribute("data-testid", "account-conto-vela");
    expect(rows[1]).toHaveAttribute("data-testid", "account-banca-aurora");
  });

  it("formats Account Access percentages with the active language locale", async () => {
    await updateAccount("banca-aurora", { access: "immediate" }, "2026-08-26T08:00:00.000Z");
    render(<WealthDashboard />);

    await screen.findByTestId("wealth-hero");
    fireEvent.click(screen.getByRole("button", { name: "Accounts" }));

    expect(within(await screen.findByTestId("access-summary-immediate")).getByText(/51\.17% of total wealth/)).toBeInTheDocument();
  });

  it("keeps every seeded provider unclassified instead of inferring access from its name or category", async () => {
    render(<WealthDashboard />);

    await screen.findByTestId("wealth-hero");
    fireEvent.click(screen.getByRole("button", { name: "Accounts" }));

    const unclassified = await screen.findByTestId("access-group-unclassified");
    for (const provider of ["Cash", "Conto Vela", "Banca Aurora", "Crypto Delta", "Lira Invest", "Broker Orione", "Trading Nord"]) {
      expect(within(unclassified).getByText(provider)).toBeInTheDocument();
    }
    expect(screen.queryByTestId("access-group-immediate")).not.toBeInTheDocument();
    expect(screen.queryByTestId("access-group-days")).not.toBeInTheDocument();
    expect(screen.queryByTestId("access-group-locked")).not.toBeInTheDocument();
  });

  it("offers localized optional access and volatility selectors in the account editor", async () => {
    render(<WealthDashboard />);

    await screen.findByTestId("wealth-hero");
    fireEvent.click(screen.getByRole("button", { name: "Accounts" }));
    fireEvent.click(screen.getByRole("button", { name: "Add account" }));

    const dialog = await screen.findByRole("dialog", { name: "Add account" });
    expect(within(dialog).getByLabelText("Access")).toHaveDisplayValue("Unclassified");
    expect(within(dialog).getByLabelText("Access")).toContainHTML("Within days");
    expect(within(dialog).getByLabelText("Volatility")).toHaveDisplayValue("Unclassified");
    expect(within(dialog).getByLabelText("Volatility")).toContainHTML("Moderate");
  });

  it("uses the exact Italian access labels and treats missing volatility as unclassified", async () => {
    window.localStorage.setItem("wealth-language", "it");
    await updateAccount("crypto-delta", { access: "days" }, "2026-08-26T08:00:00.000Z");
    render(<WealthDashboard />);

    await screen.findByTestId("wealth-hero");
    fireEvent.click(screen.getByRole("button", { name: "Conti" }));

    const days = await screen.findByTestId("access-group-days");
    expect(within(days).getByRole("heading", { name: "A giorni" })).toBeInTheDocument();
    expect(within(days).getByText("Non classificata")).toBeInTheDocument();
  });

  it("localizes the access profile and masks its amounts with Privacy Mode", async () => {
    window.localStorage.setItem("wealth-language", "it");
    await updateAccount("banca-aurora", { access: "immediate", volatility: "stable" }, "2026-08-26T08:00:00.000Z");
    render(<WealthDashboard />);

    await screen.findByTestId("wealth-hero");
    fireEvent.click(screen.getByRole("button", { name: "Conti" }));

    const summary = await screen.findByTestId("access-summary-immediate");
    expect(within(summary).getByText("Immediato")).toBeInTheDocument();
    const pending = screen.getByTestId("access-summary-unclassified");
    expect(within(pending).getByText("Da classificare")).toBeInTheDocument();
    expect(within(pending).getByText("6 conti")).toBeInTheDocument();
    expect(within(screen.getByTestId("access-group-immediate")).getByText("Stabile")).toBeInTheDocument();
    expect(summary.querySelector(".money")).not.toHaveClass("is-masked");

    fireEvent.click(within(await openProfilePanel()).getByRole("button", { name: "Nascondi importi" }));

    expect(summary.querySelector(".money")).toHaveClass("is-masked");
    expect(summary.querySelector(".money")).toHaveTextContent(/\*/);
  });

  it("starts the scenario axis at zero so small differences are not magnified", () => {
    expect(calculateScenarioYAxisDomain([9420.4, 9420.4])).toEqual([0, 11000]);
    expect(calculateScenarioYAxisDomain([9420.4, 9220.4])).toEqual([0, 11000]);
    expect(calculateScenarioYAxisDomain([123456.78])).toEqual([0, 140000]);
    expect(calculateScenarioYAxisDomain([0, 0])).toEqual([0, 1000]);
    expect(formatScenarioAxisTick(0, "it-IT")).toBe("0");
  });

  it("keeps nearby scenario axis ticks distinguishable", () => {
    expect(formatScenarioAxisTick(9250, "it-IT")).toBe("9,25k");
    expect(formatScenarioAxisTick(9750, "en-US")).toBe("9.75k");
  });

  it("closes every application window from its red control and returns to the page underneath", async () => {
    const closeWindow = async (name: string) => {
      const dialog = await screen.findByRole("dialog", { name });
      expect(dialog.querySelectorAll(".window-control")).toHaveLength(1);
      fireEvent.click(within(dialog).getByRole("button", { name: "Close dialog" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    };
    const goalBefore = await wealthDb.goals.get("wealth-goal");
    const paychecksBefore = await wealthDb.paychecks.count();
    const accountsBefore = await wealthDb.accounts.count();
    render(<WealthDashboard />);
    await screen.findByTestId("wealth-hero");

    fireEvent.click(screen.getByRole("button", { name: "Edit wealth goal" }));
    await closeWindow("Edit wealth goal");
    expect(screen.getByTestId("wealth-hero")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Accounts" }));
    expect(await screen.findByRole("heading", { name: "Accounts" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add account" }));
    await closeWindow("Add account");
    fireEvent.click(screen.getByRole("button", { name: "Open Banca Aurora details" }));
    await closeWindow("Banca Aurora");
    expect(screen.getByRole("heading", { name: "Accounts" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cash Flow" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Cash Flow" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add paycheck" }));
    await closeWindow("Add paycheck");
    expect(screen.getByRole("heading", { level: 1, name: "Cash Flow" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Goals" }));
    expect(await screen.findByRole("heading", { name: "Goals" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit goal" }));
    await closeWindow("Edit wealth goal");
    expect(screen.getByRole("heading", { name: "Goals" })).toBeInTheDocument();

    expect(await wealthDb.goals.get("wealth-goal")).toEqual(goalBefore);
    expect(await wealthDb.paychecks.count()).toBe(paychecksBefore);
    expect(await wealthDb.accounts.count()).toBe(accountsBefore);
  });

  it("keeps the red control, Cancel and Save to their own jobs", async () => {
    const onOpenChange = vi.fn();
    const onSave = vi.fn(async () => undefined);
    render(<PaycheckFormDialog onOpenChange={onOpenChange} onSave={onSave} open />);

    const dialog = screen.getByRole("dialog", { name: "Add paycheck" });
    const close = within(dialog).getByRole("button", { name: "Close dialog" });
    expect(close.tagName).toBe("BUTTON");
    expect(close.closest(".window-bar")).not.toBeNull();
    close.focus();
    expect(close).toHaveFocus();

    fireEvent.click(close);
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenCalledTimes(2);
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByLabelText("Amount"), { target: { value: "1200" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save paycheck" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ amount: 1200 }));
  });

  it("closes a confirmation from its red control without confirming", () => {
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn(async () => undefined);
    render(
      <ConfirmDialog
        confirmLabel="Delete account"
        description="The account and its current balance will be removed."
        onConfirm={onConfirm}
        onOpenChange={onOpenChange}
        open
        title="Delete Main?"
      />,
    );

    const confirmation = screen.getByRole("alertdialog", { name: "Delete Main?" });
    fireEvent.click(within(confirmation).getByRole("button", { name: "Close dialog" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("edits goal type and target date and exposes honest goal intelligence", async () => {
    render(<WealthDashboard />);

    await screen.findByTestId("wealth-hero");
    fireEvent.click(screen.getByRole("button", { name: "Goals" }));
    expect(await screen.findByRole("heading", { name: "Goals" })).toBeInTheDocument();
    const readiness = screen.getByRole("region", { name: "Data in progress" });
    expect(within(readiness).getByText("Observed monthly pace").parentElement).toHaveTextContent("Waiting");
    expect(within(readiness).getByText("Required monthly pace").parentElement).toHaveTextContent(/Needs a target date/);
    expect(screen.queryByRole("group", { name: "Goal intelligence" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit goal" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit wealth goal" });
    fireEvent.change(within(dialog).getByLabelText("Goal basis"), { target: { value: "liquidity" } });
    fireEvent.change(within(dialog).getByLabelText("Target date"), { target: { value: "2027-03-31" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save goal" }));

    await waitFor(async () => {
      expect(await wealthDb.goals.get("wealth-goal")).toMatchObject({
        type: "liquidity",
        targetDate: "2027-03-31",
      });
    });
    expect(await screen.findByText("Liquidity")).toBeInTheDocument();
    expect(screen.getAllByText(/historical liquidity categories are unavailable/i).length).toBeGreaterThan(0);
  });

  it("turns a reached goal into a state, dated only by the first saved update at or above it", () => {
    const account = { id: "main", name: "Main", category: "liquidity" as const, currency: "EUR" as const, balance: 9500, includedInWealth: true, createdAt: "2026-06-01T09:00:00.000Z", lastUpdated: "2026-07-01T09:00:00.000Z" };
    render(
      <PrivacyProvider>
        <GoalsView
          accounts={[account]}
          goal={{ id: "wealth-goal", name: "Total Wealth", targetAmount: 5000 }}
          onEditGoal={() => undefined}
          snapshots={[
            { id: "a", createdAt: "2026-06-01T09:00:00.000Z", totalWealth: 4000, accountBalances: [] },
            { id: "b", createdAt: "2026-07-01T09:00:00.000Z", totalWealth: 6000, accountBalances: [] },
          ]}
          totalWealth={9500}
        />
      </PrivacyProvider>,
    );

    expect(screen.getByRole("heading", { name: "Wealth goal" })).toBeInTheDocument();
    expect(screen.getByText("Goal reached")).toBeInTheDocument();
    expect(screen.queryByText("Remaining")).not.toBeInTheDocument();
    expect(screen.getByText("First update at or above target").parentElement).toHaveTextContent("01 Jul 2026");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
    expect(screen.queryByRole("region", { name: "Data in progress" })).not.toBeInTheDocument();
  });

  it("hides goal progress with amounts, and shows a clear empty state without a goal", () => {
    window.localStorage.setItem("wealth-amounts-hidden", "1");
    const account = { id: "main", name: "Main", category: "liquidity" as const, currency: "EUR" as const, balance: 10000, includedInWealth: true, createdAt: "2026-06-01T09:00:00.000Z", lastUpdated: "2026-07-01T09:00:00.000Z" };
    const { container, unmount } = render(
      <PrivacyProvider>
        <GoalsView accounts={[account]} goal={{ id: "wealth-goal", name: "House", targetAmount: 15000 }} onEditGoal={() => undefined} snapshots={[]} totalWealth={10000} />
      </PrivacyProvider>,
    );
    expect(screen.getByRole("heading", { name: "House" })).toBeInTheDocument();
    expect(container).not.toHaveTextContent("66,67");
    expect(container).not.toHaveTextContent("15.000,00");
    expect(container).not.toHaveTextContent("10.000,00");
    expect(screen.getByRole("progressbar")).not.toHaveAttribute("aria-valuenow");
    unmount();
    window.localStorage.removeItem("wealth-amounts-hidden");

    render(
      <PrivacyProvider>
        <GoalsView accounts={[account]} onEditGoal={() => undefined} snapshots={[]} totalWealth={10000} />
      </PrivacyProvider>,
    );
    expect(screen.getByText("No goal set")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Add goal" })).toHaveLength(2);
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("answers in a year's terms without a goal, both ways, and keeps standing on any typed figure", () => {
    render(
      <PrivacyProvider>
        <ScenarioView currentWealth={9500} />
      </PrivacyProvider>,
    );
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1500" } });
    expect(screen.getByRole("heading", { name: /In a year you would have 1\.500,00\s€ less\./ })).toBeInTheDocument();
    expect(screen.getByText("You put it back in").parentElement).toHaveTextContent(/Say how much you set aside/);

    fireEvent.click(screen.getByRole("radio", { name: "Receiving or saving" }));
    fireEvent.click(screen.getByRole("radio", { name: "every month" }));
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "100" } });
    expect(screen.getByRole("heading", { name: /In a year you would have 1\.200,00\s€ more\./ })).toBeInTheDocument();
    expect(screen.queryByText("You put it back in")).not.toBeInTheDocument();

    // Out-of-range and negative entries never reach the engine as such.
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1e400" } });
    expect(screen.getByRole("heading", { name: /Type an amount or pick one of the ideas/ })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Today's monthly saving"), { target: { value: "-5" } });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "-50" } });
    expect(screen.getByRole("heading", { name: /Type an amount or pick one of the ideas/ })).toBeInTheDocument();
  });

  it("offers the observed pace only on request, and answers a saved choice again on today's wealth", () => {
    window.localStorage.setItem("wealth-saved-scenarios", JSON.stringify([
      { id: "scenario-a", name: "New car", kind: "spend", amount: 10000, frequency: "once", monthly: 500 },
      { id: "broken", name: 7 },
    ]));
    render(
      <PrivacyProvider>
        <ScenarioView
          currentWealth={9000}
          goals={[{ id: "wealth-goal", name: "Total Wealth", targetAmount: 20000 }]}
          snapshots={[
            { id: "a", createdAt: "2026-01-01T09:00:00.000Z", totalWealth: 6000, accountBalances: [] },
            { id: "b", createdAt: "2026-04-01T09:00:00.000Z", totalWealth: 7500, accountBalances: [] },
            { id: "c", createdAt: "2026-07-01T09:00:00.000Z", totalWealth: 9000, accountBalances: [] },
          ]}
        />
      </PrivacyProvider>,
    );
    // Never projected by itself: the saving starts at 0 until asked.
    expect(screen.getByLabelText("Today's monthly saving")).toHaveValue(0);
    fireEvent.click(screen.getByRole("button", { name: /Start from my observed pace/ }));
    expect(Number((screen.getByLabelText("Today's monthly saving") as HTMLInputElement).value)).toBeGreaterThan(0);

    // The damaged entry is dropped; the car is answered on 9.000 € today.
    const saved = screen.getByRole("region", { name: "Your saved choices" });
    expect(within(saved).getAllByRole("listitem")).toHaveLength(1);
    expect(within(saved).getByText(/1 year and 8 months on the goal|months on the goal/)).toBeInTheDocument();
    fireEvent.click(within(saved).getByRole("button", { name: /^New car/ }));
    expect(screen.getByLabelText("Amount")).toHaveValue(10000);
    expect(screen.getByLabelText("Today's monthly saving")).toHaveValue(500);
    fireEvent.click(within(saved).getByRole("button", { name: "Delete “New car”" }));
    expect(within(saved).queryByRole("listitem")).not.toBeInTheDocument();
    window.localStorage.removeItem("wealth-saved-scenarios");
  });

  it("hides amounts at once and eases them in only when they are revealed", () => {
    render(
      <PrivacyProvider>
        <PrivacyToggle />
        <Sensitive>1.234,56 €</Sensitive>
      </PrivacyProvider>,
    );
    const toggle = screen.getByRole("button", { name: "Hide amounts" });

    fireEvent.click(toggle);
    expect(screen.getByLabelText("Hidden amount")).toHaveTextContent("*.***,** €");
    expect(document.documentElement.dataset.privacyReveal).toBeUndefined();
    expect(toggle.querySelector(".icon-swap")).toHaveAttribute("data-state", "hidden");

    fireEvent.click(screen.getByRole("button", { name: "Show amounts" }));
    expect(screen.getByText("1.234,56 €")).toBeInTheDocument();
    expect(document.documentElement.dataset.privacyReveal).toBe("true");
    expect(toggle.querySelector(".icon-swap")).toHaveAttribute("data-state", "shown");
    delete document.documentElement.dataset.privacyReveal;
  });

  it("keeps a save button's name while its operation is pending", async () => {
    let finish: () => void = () => undefined;
    const onSave = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    render(<PaycheckFormDialog onOpenChange={() => undefined} onSave={onSave} open />);

    const dialog = screen.getByRole("dialog", { name: "Add paycheck" });
    fireEvent.change(within(dialog).getByLabelText("Amount"), { target: { value: "1200" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save paycheck" }));

    const save = within(dialog).getByRole("button", { name: "Save paycheck" });
    await waitFor(() => expect(save).toHaveAttribute("aria-busy", "true"));
    expect(save).toBeDisabled();
    await act(async () => { finish(); });
    await waitFor(() => expect(save).toHaveAttribute("aria-busy", "false"));
  });

  it("offers the periods as one dropdown whose trigger shows the chosen period", () => {
    render(
      <WealthHistoryChart snapshots={[
        { id: "first", createdAt: "2025-06-01T12:00:00.000Z", totalWealth: 7000, accountBalances: [] },
        { id: "middle", createdAt: "2026-03-01T12:00:00.000Z", totalWealth: 8000, accountBalances: [] },
        { id: "latest", createdAt: "2026-08-25T12:00:00.000Z", totalWealth: 9500, accountBalances: [] },
      ]} />,
    );

    // One control, no row of period buttons.
    const period = screen.getByRole("combobox", { name: "Trend period" });
    expect(screen.queryByRole("button", { name: "1Y" })).not.toBeInTheDocument();
    expect(within(period).getAllByRole("option").map((option) => option.textContent)).toEqual(["1M", "3M", "6M", "YTD", "1Y", "All"]);
    expect(period).toHaveValue("ALL");
    expect(period).toHaveDisplayValue("All");

    fireEvent.change(period, { target: { value: "1Y" } });
    expect(period).toHaveValue("1Y");
    expect(period).toHaveDisplayValue("1Y");
  });

  it("keeps a period that cannot change the view offered but disabled in the dropdown", () => {
    render(
      <WealthHistoryChart snapshots={[
        { id: "first", createdAt: "2026-08-25T12:00:00+02:00", totalWealth: 8000, accountBalances: [] },
        { id: "latest", createdAt: "2026-08-28T18:23:00+02:00", totalWealth: 9500, accountBalances: [] },
      ]} />,
    );

    const period = screen.getByRole("combobox", { name: "Trend period" });
    const disabled = within(period).getAllByRole("option").filter((option) => (option as HTMLOptionElement).disabled);
    expect(disabled.map((option) => option.textContent)).toEqual(["1M", "3M", "6M", "YTD", "1Y"]);
    expect(within(period).getByRole("option", { name: "All" })).toBeEnabled();
  });

  it("distinguishes a sparse selected range from globally missing history", () => {
    render(
      <WealthHistoryChart snapshots={[
        { id: "old", createdAt: "2026-01-01T12:00:00.000Z", totalWealth: 8000, accountBalances: [] },
        { id: "latest", createdAt: "2026-08-25T12:00:00.000Z", totalWealth: 9500, accountBalances: [] },
      ]} />,
    );

    fireEvent.change(screen.getByRole("combobox", { name: "Trend period" }), { target: { value: "1M" } });

    expect(screen.getByText("No comparison in this range.")).toBeInTheDocument();
    expect(screen.queryByText(/history starts with your next update/i)).not.toBeInTheDocument();
  });

  it("labels the one-year and full-history ranges in Italian without changing the ranges", () => {
    window.localStorage.setItem("wealth-language", "it");
    try {
      render(
        <LanguageProvider>
          <WealthHistoryChart snapshots={[
            { id: "old", createdAt: "2025-01-01T12:00:00.000Z", totalWealth: 8000, accountBalances: [] },
            { id: "latest", createdAt: "2026-08-25T12:00:00.000Z", totalWealth: 9500, accountBalances: [] },
          ]} />
        </LanguageProvider>,
      );

      const period = screen.getByRole("combobox", { name: "Periodo dell'andamento" });
      expect(within(period).getAllByRole("option").map((option) => option.textContent)).toEqual(["1M", "3M", "6M", "YTD", "1A", "Tutto"]);
      expect(period).toHaveValue("ALL");
      expect(period).toHaveDisplayValue("Tutto");
    } finally {
      window.localStorage.removeItem("wealth-language");
    }
  });

  it("adds local times only when wealth-history ticks share the same calendar day", () => {
    const previousTimezone = process.env.TZ;
    process.env.TZ = "Europe/Rome";

    try {
      expect(buildWealthHistoryTickLabels([
        "2026-08-27T10:00:00+02:00",
        "2026-08-28T14:10:00+02:00",
        "2026-08-28T18:23:00+02:00",
      ], "it-IT")).toEqual({
        "2026-08-27T10:00:00+02:00": "27 ago",
        "2026-08-28T14:10:00+02:00": "28 ago, 14:10",
        "2026-08-28T18:23:00+02:00": "28 ago, 18:23",
      });
    } finally {
      process.env.TZ = previousTimezone;
    }
  });

  it("preserves half-thousand wealth-axis ticks instead of rounding them unevenly", () => {
    expect(formatWealthAxisTick(0, "it-IT")).toBe("");
    expect(formatWealthAxisTick(2500, "it-IT")).toBe("2,5k");
    expect(formatWealthAxisTick(7500, "it-IT")).toBe("7,5k");
  });

  it("disables history ranges that cannot change a short all-time view", () => {
    const snapshots = [
      { id: "first", createdAt: "2026-08-25T12:00:00+02:00", totalWealth: 8000, accountBalances: [] },
      { id: "latest", createdAt: "2026-08-28T18:23:00+02:00", totalWealth: 9500, accountBalances: [] },
    ];

    expect(isHistoryRangeUseful(snapshots, "1M")).toBe(false);
    expect(isHistoryRangeUseful(snapshots, "1Y")).toBe(false);
    expect(isHistoryRangeUseful(snapshots, "ALL")).toBe(true);
  });

  it("keeps a history range enabled when it excludes older snapshots", () => {
    const snapshots = [
      { id: "old", createdAt: "2026-01-01T12:00:00+01:00", totalWealth: 8000, accountBalances: [] },
      { id: "latest", createdAt: "2026-08-28T18:23:00+02:00", totalWealth: 9500, accountBalances: [] },
    ];

    expect(isHistoryRangeUseful(snapshots, "1M")).toBe(true);
  });

  it("keeps local-calendar snapshots in the YTD history range across UTC offsets", () => {
    const previousTimezone = process.env.TZ;
    process.env.TZ = "Europe/Rome";

    try {
      render(
        <WealthHistoryChart snapshots={[
          { id: "new-year", createdAt: "2026-01-01T00:30:00+01:00", totalWealth: 8000, accountBalances: [] },
          { id: "next-day", createdAt: "2026-01-02T00:30:00+01:00", totalWealth: 8200, accountBalances: [] },
        ]} />,
      );

      fireEvent.change(screen.getByRole("combobox", { name: "Trend period" }), { target: { value: "YTD" } });
      expect(screen.queryByText("No comparison in this range.")).not.toBeInTheDocument();
      expect(document.querySelector(".chart-canvas--history")).toBeInTheDocument();
    } finally {
      process.env.TZ = previousTimezone;
    }
  });

  it("clamps one-month history ranges at short month boundaries", () => {
    const previousTimezone = process.env.TZ;
    process.env.TZ = "Europe/Rome";

    try {
      render(
        <WealthHistoryChart snapshots={[
          { id: "february-end", createdAt: "2026-02-28T12:00:00+01:00", totalWealth: 8000, accountBalances: [] },
          { id: "march-end", createdAt: "2026-03-31T12:00:00+02:00", totalWealth: 8200, accountBalances: [] },
        ]} />,
      );

      fireEvent.change(screen.getByRole("combobox", { name: "Trend period" }), { target: { value: "1M" } });
      expect(screen.queryByText("No comparison in this range.")).not.toBeInTheDocument();
      expect(document.querySelector(".chart-canvas--history")).toBeInTheDocument();
    } finally {
      process.env.TZ = previousTimezone;
    }
  });

  it("totals paychecks per payment month and keeps months without payments empty, not zero", () => {
    expect(summarizeIncomeByMonth([
      { id: "a", paymentDate: "2025-11-10", amount: 1000 },
      { id: "b", paymentDate: "2026-02-27", amount: 1200.1 },
      { id: "c", paymentDate: "2026-02-28", amount: 300.2 },
    ])).toEqual([
      { month: "2025-11", total: 1000, count: 1 },
      { month: "2025-12", total: null, count: 0 },
      { month: "2026-01", total: null, count: 0 },
      { month: "2026-02", total: 1500.3, count: 2 },
    ]);
    expect(summarizeIncomeByMonth([])).toEqual([]);
  });

  it("lays income on the twelve calendar months, for one year or every year summed", () => {
    const paychecks = [
      { id: "a", paymentDate: "2025-01-27", amount: 1000 },
      { id: "b", paymentDate: "2026-01-27", amount: 1100 },
      { id: "c", paymentDate: "2026-03-27", amount: 1200 },
    ];
    const year = summarizeIncomeByCalendarMonth(paychecks, "2026");
    expect(year).toHaveLength(12);
    expect(year[0]).toMatchObject({ month: "01", total: 1100, count: 1, types: { salary: 1100 } });
    expect(year[1]).toMatchObject({ month: "02", total: null, count: 0, types: {} });
    expect(year[2]).toMatchObject({ month: "03", total: 1200, count: 1 });
    expect(summarizeIncomeByCalendarMonth(paychecks, "all")[0]).toMatchObject({ month: "01", total: 2100, count: 2 });
  });

  it("shows no artificial averages or chart without paychecks, and one month for one paycheck", () => {
    const year = new Date().getFullYear();
    const { unmount } = render(
      <PrivacyProvider>
        <CashFlowView onAdd={() => undefined} onEdit={() => undefined} paychecks={[]} />
      </PrivacyProvider>,
    );
    expect(screen.getByText("Typical salary").parentElement).toHaveTextContent("—");
    expect(screen.getByText("Last salary").parentElement).toHaveTextContent("—");
    expect(screen.getByText("No income recorded")).toBeInTheDocument();
    expect(screen.getByText(/No paychecks recorded yet/)).toBeInTheDocument();
    unmount();

    render(
      <PrivacyProvider>
        <CashFlowView onAdd={() => undefined} onEdit={() => undefined} paychecks={[
          { id: "only", paymentDate: `${year}-03-10`, amount: 1500 },
        ]} />
      </PrivacyProvider>,
    );
    expect(screen.getAllByRole("row")).toHaveLength(2);
    expect(screen.getByText("Recorded payments").parentElement).toHaveTextContent("1");
  });

  it("names all-time income separately only when it differs from this year's", () => {
    const year = new Date().getFullYear();
    render(
      <PrivacyProvider>
        <CashFlowView onAdd={() => undefined} onEdit={() => undefined} paychecks={[
          { id: "last-year", paymentDate: `${year - 1}-12-10`, amount: 1000 },
          { id: "this-year", paymentDate: `${year}-01-10`, amount: 1200 },
        ]} />
      </PrivacyProvider>,
    );
    expect(screen.getByText(`${year} income`).parentElement).toHaveTextContent(/1\.200,00/);
    expect(screen.getByText("Total of all recorded income").parentElement).toHaveTextContent(/2\.200,00/);
    const rows = screen.getAllByRole("button", { name: /Paycheck/ });
    expect(rows.map((row) => row.id)).toEqual(["paycheck-row-focus-this-year", "paycheck-row-focus-last-year"]);
  });

  it("opens the most recent year, keeps older years closed, and remembers a year opened by hand", () => {
    window.localStorage.removeItem("wealth-paycheck-years");
    const year = new Date().getFullYear();
    const paychecks = [
      { id: "older", paymentDate: `${year - 1}-03-27`, amount: 1000, label: "Stipendio" },
      { id: "older-bonus", paymentDate: `${year - 1}-12-18`, amount: 900, label: "Tredicesima" },
      { id: "recent", paymentDate: `${year}-01-27`, amount: 1100 },
    ];
    const { unmount } = render(
      <PrivacyProvider>
        <CashFlowView onAdd={() => undefined} onEdit={() => undefined} paychecks={paychecks} />
      </PrivacyProvider>,
    );

    const recent = screen.getByRole("button", { name: new RegExp(`^${year}`) });
    const older = screen.getByRole("button", { name: new RegExp(`^${year - 1}`) });
    expect(recent).toHaveAttribute("aria-expanded", "true");
    expect(older).toHaveAttribute("aria-expanded", "false");
    expect(document.getElementById(older.getAttribute("aria-controls")!)).toHaveAttribute("inert");
    // The heading holds the year and its total, nothing else.
    expect(older).toHaveTextContent(new RegExp(`^${year - 1}1\\.900,00`));
    expect(older).not.toHaveTextContent(/payment/);

    fireEvent.click(older);
    expect(older).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById(older.getAttribute("aria-controls")!)).not.toHaveAttribute("inert");
    unmount();

    render(
      <PrivacyProvider>
        <CashFlowView onAdd={() => undefined} onEdit={() => undefined} paychecks={paychecks} />
      </PrivacyProvider>,
    );
    expect(screen.getByRole("button", { name: new RegExp(`^${year - 1}`) })).toHaveAttribute("aria-expanded", "true");
    window.localStorage.removeItem("wealth-paycheck-years");
  });

  it("reads the summary from the year chosen for the chart, with the typical salary and the share beyond it", () => {
    const year = new Date().getFullYear();
    render(
      <PrivacyProvider>
        <CashFlowView onAdd={() => undefined} onEdit={() => undefined} paychecks={[
          { id: "old-1", paymentDate: `${year - 1}-01-27`, amount: 2000 },
          { id: "old-2", paymentDate: `${year - 1}-02-27`, amount: 2200 },
          { id: "old-13th", paymentDate: `${year - 1}-12-18`, amount: 1800, type: "extra-month" },
          { id: "new", paymentDate: `${year}-01-27`, amount: 2400 },
        ]} />
      </PrivacyProvider>,
    );
    expect(screen.getByText(`${year} income`).parentElement).toHaveTextContent(/2\.400,00/);

    fireEvent.change(screen.getByRole("combobox", { name: "Income year" }), { target: { value: String(year - 1) } });
    const summary = screen.getByText(`${year - 1} income`).parentElement!;
    expect(summary).toHaveTextContent(/6\.000,00/);
    expect(summary).toHaveTextContent(/Beyond the salary\s*30,00%/);
    expect(screen.getByText("Typical salary").parentElement).toHaveTextContent(/2\.100,00/);
    expect(screen.getByText("Typical salary").parentElement).toHaveTextContent("Median of 2 salaries");

    fireEvent.change(screen.getByRole("combobox", { name: "Income year" }), { target: { value: "all" } });
    expect(screen.getByText("All income").parentElement).toHaveTextContent(/8\.400,00/);
  });

  it("compares a finished year with the one before, but never the running year or a short first year", () => {
    const year = new Date().getFullYear();
    const group = (key: number, dates: string[], amount: number) => ({
      key: String(key),
      paychecks: dates.map((date, index) => ({ id: `${key}-${index}`, paymentDate: `${key}-${date}`, amount })),
    });
    const running = group(year, ["01-27"], 1000);
    const last = group(year - 1, ["01-27", "02-27"], 1100);
    const fullFirst = group(year - 2, ["01-27", "02-27"], 1000);
    const shortFirst = group(year - 2, ["09-27", "10-27"], 1000);

    expect(yearOverYear(last, fullFirst, fullFirst, year)).toBeCloseTo(10);
    expect(yearOverYear(running, last, fullFirst, year)).toBeNull();
    expect(yearOverYear(last, shortFirst, shortFirst, year)).toBeNull();
    expect(yearOverYear(last, undefined, last, year)).toBeNull();
  });

  it("renders paycheck calendar dates without shifting them west of UTC", () => {
    const previousTimezone = process.env.TZ;
    process.env.TZ = "America/Los_Angeles";

    try {
      render(
        <PrivacyProvider>
          <CashFlowView onAdd={() => undefined} onEdit={() => undefined} paychecks={[
            { id: "paycheck", paymentDate: "2026-08-25", amount: 100 },
          ]} />
        </PrivacyProvider>,
      );

      const row = screen.getByRole("button", { name: /Paycheck/ });
      expect(within(row).getByText("25")).toBeInTheDocument();
    } finally {
      process.env.TZ = previousTimezone;
    }
  });

  it("masks every money amount while the eye toggle hides them", async () => {
    render(<WealthDashboard />);

    const hero = await screen.findByTestId("wealth-hero");
    const heroHeading = within(hero).getByRole("heading", { level: 1 });
    expect(heroHeading).toHaveTextContent(/9\.420,40/);
    expect(document.querySelectorAll(".money.is-masked")).toHaveLength(0);

    const panel = await openProfilePanel();
    fireEvent.click(within(panel).getByRole("button", { name: "Hide amounts" }));

    const eye = within(panel).getByRole("button", { name: "Show amounts" });
    expect(eye).not.toHaveAttribute("aria-pressed");
    expect(eye.querySelector(".icon-swap")).toHaveAttribute("data-state", "hidden");
    expect(document.querySelectorAll(".money.is-masked").length).toBeGreaterThan(0);
    expect(document.querySelectorAll(".money.is-masked")[0].textContent).toMatch(/\*\.\*\*\*,\*\*\s€/);
    expect(heroHeading).toHaveTextContent(/\*\.*\*\*\*,\*\*\s€/);
    expect(window.localStorage.getItem("wealth-amounts-hidden")).toBe("1");

    fireEvent.click(eye);

    expect(within(panel).getByRole("button", { name: "Hide amounts" }).querySelector(".icon-swap")).toHaveAttribute("data-state", "shown");
    expect(document.querySelectorAll(".money.is-masked")).toHaveLength(0);
    expect(within(hero).getByRole("heading", { level: 1 })).toHaveTextContent(/9\.420,40/);
    expect(window.localStorage.getItem("wealth-amounts-hidden")).toBe("0");
  });

  it("initializes the mask from the stored preference", async () => {
    window.localStorage.setItem("wealth-amounts-hidden", "1");
    render(<WealthDashboard />);

    const hero = await screen.findByTestId("wealth-hero");
    expect(document.querySelectorAll(".money.is-masked").length).toBeGreaterThan(0);
    expect(within(hero).getByRole("heading", { level: 1 })).toHaveTextContent(/\*/);
    const panel = await openProfilePanel();
    expect(within(panel).getByRole("button", { name: "Show amounts" })).toBeInTheDocument();
  });

  it("masks the What changed movements when amounts are hidden", async () => {
    await repository.saveBalanceSnapshot([
      { accountId: "banca-aurora", balance: 6000 },
    ]);
    render(<WealthDashboard />);

    await screen.findByText(/no comparable account balance changed|what changed/i);
    const movementPanel = document.querySelector(".movement-panel");
    expect(movementPanel).not.toBeNull();
    expect(movementPanel?.textContent).toMatch(/\d/);

    fireEvent.click(within(await openProfilePanel()).getByRole("button", { name: "Hide amounts" }));

    expect(movementPanel?.textContent).not.toMatch(/\d/);
    expect(movementPanel?.textContent).toMatch(/\*/);
  });

  it("masks Money and Sensitive only inside a hiding provider", () => {
    const { container } = render(
      <PrivacyProvider>
        <Money amount={100} />
        <Sensitive>250,00 €</Sensitive>
        <PrivacyToggle />
      </PrivacyProvider>,
    );

    expect(container.querySelector(".money")).not.toHaveClass("is-masked");
    expect(container.querySelector(".money")).toHaveTextContent("100,00 €");
    expect(container.querySelector(".sensitive")).not.toHaveClass("is-hidden");
    expect(container.querySelector(".sensitive")).toHaveTextContent("250,00 €");

    fireEvent.click(screen.getByRole("button", { name: /hide amounts/i }));

    expect(container.querySelector(".money")).toHaveClass("is-masked");
    expect(container.querySelector(".money")).toHaveTextContent(/\*\*\*,\*\*\s€/);
    expect(container.querySelector(".sensitive")).toHaveClass("is-hidden");
    expect(container.querySelector(".sensitive")).toHaveTextContent(/\*\*\*,\*\*\s€/);
  });
});
