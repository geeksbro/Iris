"use client";

import { useEffect } from "react";

import { playUISound, primeUISounds } from "./ui-sound";

/*
 * A tap for every control of the dashboard pressed with the mouse: buttons
 * and links, the rail, search and its results, the profile, switches and
 * checkboxes, the windows' red close control. The owner's brief: the mouse
 * only, so keys, touch and pens stay silent.
 *
 * - On the press (pointerdown), like a physical button, not on the release.
 * - One listener on the document, in the capture phase: it covers windows and
 *   panels rendered outside the shell too, and no control's own handler can
 *   swallow it.
 * - Silent: text fields, anything disabled, and anything inside
 *   data-ui-sound="off" (the interface-sounds switch, which makes no sound of
 *   its own). The lock screen keeps only its own two sounds: this listener
 *   lives with the dashboard (useClickSounds), not with the gate.
 */

const controls = [
  "button",
  "a[href]",
  "summary",
  "select",
  '[role="button"]',
  '[role="option"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[role="tab"]',
  '[role="switch"]',
  '[role="checkbox"]',
  '[role="radio"]',
  'input[type="checkbox"]',
  'input[type="radio"]',
  'input[type="button"]',
  'input[type="submit"]',
  'input[type="reset"]',
].join(", ");

const toggleInputs = 'input[type="checkbox"], input[type="radio"]';

/** The control a press on `target` operates, or null when the press should stay silent. */
export function pressedControl(target: EventTarget | null): Element | null {
  if (!(target instanceof Element) || target.closest('[data-ui-sound="off"]')) {
    return null;
  }
  let control = target.closest(controls);
  // A checkbox's label operates the checkbox; a text field's label only focuses it.
  if (!control) {
    const associated = target.closest("label")?.control;
    control = associated?.matches(toggleInputs) ? associated : null;
  }
  if (!control || control.matches(":disabled") || control.closest('[aria-disabled="true"], [inert]')) {
    return null;
  }
  return control;
}

/** Taps for the dashboard's controls while the component using it is mounted. */
export function useClickSounds(): void {
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || event.button !== 0 || !pressedControl(event.target)) {
        return;
      }
      // The press itself readies audio, so even the first one is heard.
      primeUISounds();
      playUISound("tap");
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, []);
}
