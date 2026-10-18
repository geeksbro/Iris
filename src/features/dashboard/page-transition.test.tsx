import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PageTransition } from "@/features/settings/preferences";

import { pageTransitionTiming, usePageTransition } from "./page-transition";

function Page({ view, mode, enabled = true }: { view: string; mode: PageTransition; enabled?: boolean }) {
  const { contentView, contentRef, mode: active } = usePageTransition(view, mode, enabled);
  return (
    <main data-active={active ?? "none"} data-testid="content" ref={contentRef}>
      <div className="management-view">
        <header className="view-header">{contentView}</header>
      </div>
    </main>
  );
}

function allowMotion(reduced: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: reduced && query.includes("reduce"),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

describe("page change", () => {
  const original = window.matchMedia;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    window.matchMedia = original;
  });

  it("keeps the plain change for Fade: the new page at once, nothing marked", () => {
    allowMotion(false);
    const { rerender } = render(<Page mode="fade" view="overview" />);
    rerender(<Page mode="fade" view="accounts" />);
    expect(screen.getByText("accounts")).toBeInTheDocument();
    expect(screen.getByTestId("content")).toHaveAttribute("data-active", "none");
  });

  it("lets the old page leave first in Cascade, then shows the new one arriving", () => {
    allowMotion(false);
    const { rerender } = render(<Page mode="cascade" view="overview" />);
    rerender(<Page mode="cascade" view="accounts" />);
    // The old page is still there, leaving.
    expect(screen.getByText("overview")).toBeInTheDocument();
    expect(screen.getByTestId("content").dataset.pageLeave).toBe("cascade");
    act(() => {
      vi.advanceTimersByTime(pageTransitionTiming.cascade.leave);
    });
    expect(screen.getByText("accounts")).toBeInTheDocument();
    expect(screen.getByTestId("content").dataset.pageLeave).toBeUndefined();
    expect(screen.getByTestId("content").dataset.pageEnter).toBe("cascade");
    expect(screen.getByText("accounts")).toHaveAttribute("data-page-card", "");
  });

  it("shows the latest choice made while the old page leaves, and calls the leaving off for the page being left", () => {
    allowMotion(false);
    const { rerender } = render(<Page mode="cascade" view="overview" />);
    rerender(<Page mode="cascade" view="accounts" />);
    rerender(<Page mode="cascade" view="goals" />);
    act(() => {
      vi.advanceTimersByTime(pageTransitionTiming.cascade.leave);
    });
    expect(screen.getByText("goals")).toBeInTheDocument();

    rerender(<Page mode="cascade" view="scenario" />);
    rerender(<Page mode="cascade" view="goals" />);
    expect(screen.getByTestId("content").dataset.pageLeave).toBeUndefined();
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(screen.getByText("goals")).toBeInTheDocument();
  });

  it("keeps the plain change under Reduce motion, and while the tour runs", () => {
    allowMotion(true);
    const { rerender } = render(<Page mode="cinematic" view="overview" />);
    rerender(<Page mode="cinematic" view="accounts" />);
    expect(screen.getByText("accounts")).toBeInTheDocument();

    allowMotion(false);
    const tour = render(<Page enabled={false} mode="cinematic" view="overview" />);
    tour.rerender(<Page enabled={false} mode="cinematic" view="goals" />);
    expect(screen.getByText("goals")).toBeInTheDocument();
  });
});
