"use client";

import { Volume2, VolumeX } from "lucide-react";

import { useLanguage } from "@/features/i18n/language";

import { setUISoundsEnabled, useUISoundsEnabled } from "./ui-sound";

/**
 * The interface-sounds switch, built like the privacy eye: the icon shows
 * what is true now, the name is the action it offers, so it carries no
 * pressed state. Toggling it makes no sound of its own.
 */
export function SoundToggle({ className, tooltip = false }: { className?: string; tooltip?: boolean }) {
  const enabled = useUISoundsEnabled();
  const { text } = useLanguage();
  const label = enabled
    ? text("Disattiva suoni interfaccia", "Disable interface sounds")
    : text("Attiva suoni interfaccia", "Enable interface sounds");

  return (
    <button
      aria-label={label}
      className={["button button--ghost sound-toggle", className].filter(Boolean).join(" ")}
      title={tooltip ? label : undefined}
      // Not even the dashboard's tap (click-sounds.ts).
      data-ui-sound="off"
      onClick={() => setUISoundsEnabled(!enabled)}
      type="button"
    >
      {/* The eye's icon swap: "shown" is the speaker, "hidden" the muted one. */}
      <span aria-hidden="true" className="icon-swap" data-state={enabled ? "shown" : "hidden"}>
        <span className="icon-swap__icon" data-icon="shown"><Volume2 size={20} /></span>
        <span className="icon-swap__icon" data-icon="hidden"><VolumeX size={20} /></span>
      </span>
    </button>
  );
}
