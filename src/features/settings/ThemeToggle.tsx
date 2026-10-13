"use client";

import { Moon, Sun } from "lucide-react";

import { useLanguage } from "@/features/i18n/language";

import { theme } from "./preferences";

/**
 * Light or dark, built like the privacy eye and the sounds speaker: the icon
 * shows the theme in force, the name is the action it offers, so it carries
 * no pressed state. The two icons share one slot and cross-fade.
 */
export function ThemeToggle() {
  const current = theme.use();
  const { text } = useLanguage();
  const dark = current === "dark";
  const label = dark ? text("Passa al tema chiaro", "Switch to light theme") : text("Passa al tema scuro", "Switch to dark theme");

  return (
    <button
      aria-label={label}
      className="button button--ghost topbar-icon theme-toggle"
      onClick={() => theme.set(dark ? "light" : "dark")}
      title={label}
      type="button"
    >
      <span aria-hidden="true" className="icon-swap" data-state={dark ? "hidden" : "shown"}>
        <span className="icon-swap__icon" data-icon="shown"><Sun size={19} strokeWidth={2} /></span>
        <span className="icon-swap__icon" data-icon="hidden"><Moon size={19} strokeWidth={2} /></span>
      </span>
    </button>
  );
}
