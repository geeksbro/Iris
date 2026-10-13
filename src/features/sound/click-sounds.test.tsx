import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installFakeAudio } from "@/test/fake-audio";

import { useClickSounds } from "./click-sounds";
import { resetUISoundsForTests } from "./ui-sound";

function Controls() {
  useClickSounds();
  return (
    <div>
      <button type="button">Aggiorna saldi</button>
      <button aria-label="Chiudi" className="window-close" type="button"><span className="window-control" data-testid="red-dot" /></button>
      <div role="option" aria-selected="false" tabIndex={-1}>Conti</div>
      <label className="check-field"><input type="checkbox" /> <span data-testid="check-label">Includi</span></label>
      <label><span data-testid="field-label">Importo</span><input type="text" /></label>
      <input aria-label="Cerca" type="text" />
      <p data-testid="plain">Patrimonio totale</p>
      <button disabled type="button">Disabilitato</button>
      <div aria-disabled="true" role="button">Non disponibile</div>
      <button data-ui-sound="off" type="button">Disattiva suoni interfaccia</button>
    </div>
  );
}

// Every tap opens on the same 1.1kHz note: one per press heard.
const taps = (audio: ReturnType<typeof installFakeAudio>) => audio.oscillators.filter((note) => note.frequency === 1100).length;
const press = (element: Element, init: Partial<PointerEventInit> = {}) =>
  fireEvent.pointerDown(element, { pointerType: "mouse", button: 0, ...init });

describe("click sounds", () => {
  beforeEach(() => {
    window.localStorage.removeItem("wealth-ui-sounds");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  });

  afterEach(() => {
    resetUISoundsForTests();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    window.localStorage.removeItem("wealth-ui-sounds");
  });

  it("taps once for each control pressed with the mouse, in windows and lists too", () => {
    const audio = installFakeAudio();
    render(<Controls />);

    press(screen.getByRole("button", { name: "Aggiorna saldi" }));
    expect(taps(audio)).toBe(1);
    // The red close control, pressed on its dot.
    vi.advanceTimersByTime(100);
    press(screen.getByTestId("red-dot"));
    expect(taps(audio)).toBe(2);
    vi.advanceTimersByTime(100);
    press(screen.getByRole("option", { name: "Conti" }));
    expect(taps(audio)).toBe(3);
    // A checkbox, and its label, which operates it.
    vi.advanceTimersByTime(100);
    press(screen.getByRole("checkbox"));
    vi.advanceTimersByTime(100);
    press(screen.getByTestId("check-label"));
    expect(taps(audio)).toBe(5);
  });

  it("is short and quiet, and does not stack on a double press", () => {
    const audio = installFakeAudio();
    render(<Controls />);
    const button = screen.getByRole("button", { name: "Aggiorna saldi" });

    press(button);
    press(button);
    expect(taps(audio)).toBe(1);
    expect(audio.oscillators.map((note) => note.frequency)).toEqual([1100, 550]);
    expect(Math.max(...audio.oscillators.map((note) => note.stop))).toBeLessThanOrEqual(0.07);
  });

  it("stays silent for text fields, plain content, disabled controls and anything marked off", () => {
    const audio = installFakeAudio();
    render(<Controls />);

    press(screen.getByRole("textbox", { name: "Cerca" }));
    press(screen.getByTestId("field-label"));
    press(screen.getByTestId("plain"));
    press(screen.getByRole("button", { name: "Disabilitato" }));
    press(screen.getByRole("button", { name: "Non disponibile" }));
    press(screen.getByRole("button", { name: "Disattiva suoni interfaccia" }));
    expect(taps(audio)).toBe(0);
    // Nothing pressed that taps: audio is not even started.
    expect(audio.contexts).toHaveLength(0);
  });

  it("answers the mouse only: not touch, a pen, another button or a key", () => {
    const audio = installFakeAudio();
    render(<Controls />);
    const button = screen.getByRole("button", { name: "Aggiorna saldi" });

    press(button, { pointerType: "touch" });
    press(button, { pointerType: "pen" });
    press(button, { button: 2 });
    fireEvent.keyDown(button, { key: "Enter" });
    fireEvent.click(button);
    expect(taps(audio)).toBe(0);
  });

  it("is silent with interface sounds off, and gone once the dashboard is", () => {
    window.localStorage.setItem("wealth-ui-sounds", "0");
    const audio = installFakeAudio();
    const { unmount } = render(<Controls />);
    press(screen.getByRole("button", { name: "Aggiorna saldi" }));
    expect(audio.contexts).toHaveLength(0);

    window.localStorage.removeItem("wealth-ui-sounds");
    const button = screen.getByRole("button", { name: "Aggiorna saldi" });
    unmount();
    press(button);
    press(document.body);
    expect(taps(audio)).toBe(0);
  });
});
