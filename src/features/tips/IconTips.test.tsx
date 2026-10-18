import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { IconTips, iconTipDelayMs } from "./IconTips";

const tip = () => document.querySelector(".icon-tip");

describe("icon names on rest", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("names an icon after a second of rest, not before", () => {
    render(
      <>
        <IconTips />
        <button aria-label="Nascondi importi" type="button"><svg /></button>
      </>,
    );
    const eye = screen.getByRole("button", { name: "Nascondi importi" });
    fireEvent.pointerOver(eye);
    act(() => {
      vi.advanceTimersByTime(iconTipDelayMs - 1);
    });
    expect(tip()).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(tip()).toHaveTextContent("Nascondi importi");
    // For the eye only: the button already carries its name.
    expect(tip()).toHaveAttribute("aria-hidden", "true");

    fireEvent.pointerOut(eye, { relatedTarget: document.body });
    expect(tip()).toBeNull();
  });

  it("is called off by a click, and stays away until the pointer comes back", () => {
    render(
      <>
        <IconTips />
        <button aria-label="Blocca ora" type="button"><svg /></button>
      </>,
    );
    const lock = screen.getByRole("button", { name: "Blocca ora" });
    fireEvent.pointerOver(lock);
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    fireEvent.pointerDown(lock);
    act(() => {
      vi.advanceTimersByTime(iconTipDelayMs * 2);
    });
    expect(tip()).toBeNull();
  });

  it("takes a native tooltip's words, so the browser never shows them first", () => {
    render(
      <>
        <IconTips />
        <button aria-label="Tema scuro" title="Passa al tema scuro" type="button"><svg /></button>
      </>,
    );
    const theme = screen.getByRole("button", { name: "Tema scuro" });
    fireEvent.pointerOver(theme);
    expect(theme).not.toHaveAttribute("title");
    act(() => {
      vi.advanceTimersByTime(iconTipDelayMs);
    });
    expect(tip()).toHaveTextContent("Passa al tema scuro");
  });

  it("leaves controls with words of their own alone", () => {
    render(
      <>
        <IconTips />
        <button type="button">Esporta backup</button>
      </>,
    );
    fireEvent.pointerOver(screen.getByRole("button", { name: "Esporta backup" }));
    act(() => {
      vi.advanceTimersByTime(iconTipDelayMs * 2);
    });
    expect(tip()).toBeNull();
  });
});
