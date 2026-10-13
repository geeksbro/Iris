import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { formatCurrency } from "@/domain/formatters";

import {
  countStart,
  countCurve,
  cubicBezier,
  EntranceShell,
  entranceDurationMs,
  entrancePace,
  entranceTimeline,
  resetEntranceForTests,
  useEntranceContent,
} from "./entrance";
import { Money } from "./ui";

// The page's clock and its animation frames run only when a test says so.
let clock = 0;
let frames = new Map<number, FrameRequestCallback>();
let nextFrame = 1;

function frameAt(time: number) {
  clock = time;
  const pending = frames;
  frames = new Map();
  act(() => pending.forEach((callback) => callback(time)));
}

function stubReducedMotion(reduce: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduce && query.includes("prefers-reduced-motion: reduce"),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

function ContentProbe() {
  return <span data-testid="content">{useEntranceContent() ? "entering" : "settled"}</span>;
}

function Dashboard({ amount = 1234.56, view = "overview" }: { amount?: number; view?: string }) {
  return (
    <EntranceShell className="app-shell" contentKey={view}>
      <p data-testid="total"><Money amount={amount} countUp /></p>
      <ContentProbe key={view} />
    </EntranceShell>
  );
}

const shell = (container: HTMLElement) => container.querySelector(".app-shell") as HTMLElement;
// What is drawn, and what assistive technology reads.
const drawn = () => screen.getByTestId("total").querySelector('[aria-hidden="true"]')?.textContent ?? screen.getByTestId("total").textContent;
const spoken = () => screen.getByTestId("total").querySelector(".visually-hidden")?.textContent ?? screen.getByTestId("total").textContent;

describe("dashboard entrance", () => {
  beforeEach(() => {
    resetEntranceForTests();
    clock = 0;
    frames = new Map();
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.set(nextFrame, callback);
      return nextFrame++;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("plays on the first dashboard of a page load, and never again in that page", () => {
    stubReducedMotion(false);
    const first = render(<Dashboard />);
    expect(shell(first.container)).toHaveAttribute("data-entrance");
    expect(shell(first.container).style.getPropertyValue("--entrance-hero-at")).toBe(`${entranceTimeline.cards.hero}ms`);
    expect(screen.getByTestId("content")).toHaveTextContent("entering");
    first.unmount();

    // Reopened in the same page, as after an idle lock: the dashboard simply shows.
    const again = render(<Dashboard />);
    expect(shell(again.container)).not.toHaveAttribute("data-entrance");
    expect(screen.getByTestId("content")).toHaveTextContent("settled");
    expect(screen.getByTestId("total").textContent).toBe(formatCurrency(1234.56));
  });

  it("does not play under reduced motion: the real values, at once", () => {
    stubReducedMotion(true);
    const { container } = render(<Dashboard />);
    expect(shell(container)).not.toHaveAttribute("data-entrance");
    expect(shell(container).getAttribute("style")).toBeNull();
    expect(screen.getByTestId("total").textContent).toBe(formatCurrency(1234.56));
    expect(screen.getByTestId("content")).toHaveTextContent("settled");
  });

  it("does not play where the motion preference cannot be read", () => {
    const { container } = render(<Dashboard />);
    expect(shell(container)).not.toHaveAttribute("data-entrance");
    expect(screen.getByTestId("total").textContent).toBe(formatCurrency(1234.56));
  });

  it("counts from zero to exactly the real value, which assistive technology reads throughout", () => {
    stubReducedMotion(false);
    render(<Dashboard />);
    const start = countStart(0);
    const final = formatCurrency(1234.56);

    expect(drawn()).toBe(formatCurrency(0));
    expect(spoken()).toBe(final);
    frameAt(start - 100);
    expect(drawn()).toBe(formatCurrency(0));

    frameAt(start + entranceTimeline.data.count / 2);
    const midway = drawn();
    expect(midway).not.toBe(formatCurrency(0));
    expect(midway).not.toBe(final);
    expect(spoken()).toBe(final);

    frameAt(start + entranceTimeline.data.count);
    // Counting over: React's own text, and nothing hidden left behind.
    expect(screen.getByTestId("total").textContent).toBe(final);
    expect(screen.getByTestId("total").querySelector('[aria-hidden="true"]')).toBeNull();
  });

  it("is not restarted by a re-render, and does not come back once over", () => {
    stubReducedMotion(false);
    const { container, rerender } = render(<Dashboard />);
    const start = countStart(0);
    frameAt(start + 300);
    const before = drawn();

    rerender(<Dashboard />);
    frameAt(start + 300);
    expect(drawn()).toBe(before);
    expect(shell(container)).toHaveAttribute("data-entrance");

    frameAt(start + entranceTimeline.data.count);
    act(() => vi.advanceTimersByTime(entranceDurationMs() + 200));
    expect(shell(container)).not.toHaveAttribute("data-entrance");
    rerender(<Dashboard />);
    expect(shell(container)).not.toHaveAttribute("data-entrance");
    expect(screen.getByTestId("total").textContent).toBe(formatCurrency(1234.56));
  });

  it("shows a value that changes mid-count at once, uncounted", () => {
    stubReducedMotion(false);
    const { rerender } = render(<Dashboard />);
    frameAt(countStart(0) + 300);

    rerender(<Dashboard amount={2000} />);
    expect(screen.getByTestId("total").textContent).toBe(formatCurrency(2000));
  });

  it("ends everything with its one timer, even if no frame ever comes (a hidden tab)", () => {
    stubReducedMotion(false);
    const { container } = render(<Dashboard />);
    expect(drawn()).toBe(formatCurrency(0));

    act(() => vi.advanceTimersByTime(entranceDurationMs() + 200));
    expect(shell(container)).not.toHaveAttribute("data-entrance");
    expect(screen.getByTestId("total").textContent).toBe(formatCurrency(1234.56));
  });

  it("belongs to the view it opened on: after a view change, content mounts settled", () => {
    stubReducedMotion(false);
    const { container, rerender } = render(<Dashboard />);
    expect(screen.getByTestId("content")).toHaveTextContent("entering");

    rerender(<Dashboard view="accounts" />);
    expect(screen.getByTestId("content")).toHaveTextContent("settled");
    rerender(<Dashboard view="overview" />);
    expect(screen.getByTestId("content")).toHaveTextContent("settled");
    // The shell's own part still finishes as planned.
    expect(shell(container)).toHaveAttribute("data-entrance");
  });
});

describe("entrance timeline", () => {
  // The bounds are the brief's, carried at whatever pace the owner has set
  // (entrancePace): they guard the choreography's proportions, not its speed,
  // so lengthening the arrival cannot silently reshape it.
  it("stays inside the brief: structure first, data second, done in about 2.5-3.2s at pace 1", () => {
    const { card, cards, data } = entranceTimeline;
    expect(entranceDurationMs()).toBeGreaterThanOrEqual(2_500 * entrancePace);
    expect(entranceDurationMs()).toBeLessThanOrEqual(3_200 * entrancePace);
    // The owner lengthened the card settle past the first brief's 400–550ms.
    expect(card.duration).toBeGreaterThanOrEqual(400 * entrancePace);
    expect(card.duration).toBeLessThanOrEqual(1_000 * entrancePace);
    expect(cards.categoryStagger).toBeGreaterThanOrEqual(80 * entrancePace);
    expect(cards.categoryStagger).toBeLessThanOrEqual(120 * entrancePace);
    expect(card.distance).toBeLessThanOrEqual(24);
    expect(card.blur).toBeLessThanOrEqual(6);
    expect(data.count).toBeGreaterThanOrEqual(800 * entrancePace);
    expect(data.count).toBeLessThanOrEqual(1_400 * entrancePace);
    // A figure counts only once its panel has nearly settled, never with it.
    const cardProgress = cubicBezier(entranceTimeline.ease)((countStart(0) - cards.panels) / card.duration);
    expect(cardProgress).toBeGreaterThanOrEqual(0.9);
  });

  it("eases without bounce or overshoot", () => {
    for (const ease of [cubicBezier(entranceTimeline.ease), cubicBezier(entranceTimeline.dataEase), countCurve(entranceTimeline.countShape)]) {
      expect(ease(0)).toBe(0);
      expect(ease(1)).toBe(1);
      let previous = 0;
      for (let step = 1; step <= 100; step += 1) {
        const value = ease(step / 100);
        expect(value).toBeGreaterThanOrEqual(previous - 1e-9);
        expect(value).toBeLessThanOrEqual(1 + 1e-9);
        previous = value;
      }
    }
  });

  it("counts slowly to 30%, very fast from 30% to 75%, then settles slowly to 100%, without a jolt", () => {
    const shape = entranceTimeline.countShape;
    const curve = countCurve(shape);
    const slowEnd = (3 * shape.slowUntil) / shape.fastSpeed;
    const fastEnd = slowEnd + (shape.fastUntil - shape.slowUntil) / shape.fastSpeed;
    expect(curve(slowEnd)).toBeCloseTo(shape.slowUntil, 6);
    expect(curve(fastEnd)).toBeCloseTo(shape.fastUntil, 6);
    // Speed (a finite difference) matches across both joins, and the run is
    // the fastest part: several times the average, where start and end crawl.
    const speed = (at: number) => (curve(at + 1e-4) - curve(at - 1e-4)) / 2e-4;
    expect(speed(slowEnd - 1e-3)).toBeCloseTo(speed(slowEnd + 1e-3), 1);
    expect(speed(fastEnd - 1e-3)).toBeCloseTo(speed(fastEnd + 1e-3), 1);
    expect(speed((slowEnd + fastEnd) / 2)).toBeCloseTo(shape.fastSpeed, 3);
    expect(speed(0.02)).toBeLessThan(0.1);
    expect(speed(0.98)).toBeLessThan(0.01);
  });
});
