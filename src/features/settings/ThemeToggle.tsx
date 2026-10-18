"use client";

import { ThemeGlyph } from "@/features/dashboard/morph-glyphs";
import { useLanguage } from "@/features/i18n/language";

import { theme } from "./preferences";

/**
 * Light or dark, built like the privacy eye and the sounds speaker: the icon
 * shows the theme in force, the name is the action it offers, so it carries
 * no pressed state. One glyph morphs: the sun's rays fold in and a bite
 * slides over the disc to leave the moon (morph-glyphs.tsx).
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
        <ThemeGlyph size={19} />
      </span>
    </button>
  );
}
