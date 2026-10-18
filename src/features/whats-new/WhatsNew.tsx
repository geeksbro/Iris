"use client";

import { useEffect, useEffectEvent, useId, useLayoutEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, Sparkles } from "lucide-react";

import { measurePlacement, type Placement } from "@/features/dashboard/ProfileMenu";
import { useLanguage } from "@/features/i18n/language";
import { seenRelease } from "@/features/settings/preferences";
import type { SettingTarget } from "@/features/settings/setting-link";

import { latestRelease, releases } from "./releases";

/*
 * "Novità" (owner, 18 Oct 2026): IRIS's release notes, behind a button in
 * the bar between the eye and the theme. The button carries a dot while the
 * newest release is unseen on this device, like a notification, and only
 * then: opening the panel is having seen it. The panel is the profile
 * menu's (same surface, placement under its trigger, 140ms opening, closing
 * reversed), a non-modal dialog: Escape or a click elsewhere closes it, and
 * a note about a setting offers "Prova", which opens Settings on that row.
 * Settings › Sistema opens the same panel (openWhatsNew), dot or no dot.
 */

/** Wider than the profile menu: it carries sentences. */
const whatsNewWidth = 380;

const openListeners = new Set<() => void>();

/** Opens the panel from elsewhere (Settings › Sistema). */
export function openWhatsNew() {
  openListeners.forEach((listener) => listener());
}

export function WhatsNew({ onTry }: { onTry: (target: SettingTarget) => void }) {
  const { locale, text } = useLanguage();
  const seen = seenRelease.use();
  const unseen = seen !== latestRelease.version;

  const [placement, setPlacement] = useState<Placement | null>(null);
  const [closing, setClosing] = useState(false);
  const exitRef = useRef<Animation | null>(null);
  const open = placement !== null && !closing;

  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const baseId = useId();
  const panelId = `${baseId}-panel`;
  const titleId = `${baseId}-title`;

  const openPanel = () => {
    const exit = exitRef.current;
    if (exit) {
      exitRef.current = null;
      exit.reverse();
      setClosing(false);
      return;
    }
    setPlacement(measurePlacement(triggerRef.current, whatsNewWidth) ?? { left: 16, top: 72, width: whatsNewWidth, maxHeight: 520 });
    // Seen as soon as it is shown: the dot goes.
    seenRelease.set(latestRelease.version);
  };

  const closePanel = (restoreFocus: boolean) => {
    if (!open) return;
    if (restoreFocus) triggerRef.current?.focus({ preventScroll: true });
    const panel = panelRef.current;
    const quiet = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (!panel || typeof panel.animate !== "function" || quiet) {
      setPlacement(null);
      return;
    }
    setClosing(true);
    const exit = panel.animate(
      [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(-4px) scale(0.97)" }],
      { duration: 140, easing: "cubic-bezier(0.25, 0.1, 0.25, 1)", fill: "forwards" },
    );
    exitRef.current = exit;
    exit.finished.then(() => {
      if (exitRef.current !== exit) return;
      exitRef.current = null;
      setClosing(false);
      setPlacement(null);
    }).catch(() => undefined);
  };

  // Settings › Sistema asks for the panel: it opens under the button.
  const onOpenRequest = useEffectEvent(() => {
    if (!open) openPanel();
  });
  useEffect(() => {
    const listener = () => onOpenRequest();
    openListeners.add(listener);
    return () => {
      openListeners.delete(listener);
    };
  }, []);

  const onResize = useEffectEvent(() => {
    if (!open) return;
    const next = measurePlacement(triggerRef.current, whatsNewWidth);
    if (next) setPlacement(next);
  });
  useEffect(() => {
    if (!open) return;
    const listener = () => onResize();
    window.addEventListener("resize", listener);
    return () => window.removeEventListener("resize", listener);
  }, [open]);

  // Opened, the panel takes the focus, so Escape and Tab work from the start.
  useLayoutEffect(() => {
    if (open) panelRef.current?.focus({ preventScroll: true });
  }, [open]);

  const onPanelKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closePanel(true);
    }
  };

  // Focus leaving both the button and the (portaled) panel closes it.
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget;
    if (next instanceof Node && (event.currentTarget.contains(next) || panelRef.current?.contains(next))) return;
    closePanel(false);
  };

  const formatDay = (date: string) =>
    new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));

  const label = unseen ? text("Novità: c'è una nuova versione", "What's new: there is a new version") : text("Novità", "What's new");

  const panel = placement ? (
    <div
      aria-labelledby={titleId}
      className="profile-panel whats-new-panel"
      id={panelId}
      inert={closing}
      onKeyDown={onPanelKeyDown}
      ref={panelRef}
      role="dialog"
      style={{ left: placement.left, top: placement.top, width: placement.width, maxHeight: placement.maxHeight }}
      tabIndex={-1}
    >
      <div className="whats-new__head">
        <span aria-hidden="true" className="whats-new__mark"><Sparkles size={20} strokeWidth={2} /></span>
        <div>
          <h2 className="whats-new__title" id={titleId}>{text("Novità", "What's new")}</h2>
          <p className="whats-new__current">
            {text("Versione", "Version")} {latestRelease.version} · {formatDay(latestRelease.date)}
          </p>
        </div>
      </div>

      <div className="profile-panel__sep" role="separator" />

      <div className="whats-new__releases">
        {releases.map((release, index) => (
          <section aria-labelledby={`${baseId}-${release.version}`} className="whats-new__release" key={release.version}>
            <h3 className="whats-new__release-title" id={`${baseId}-${release.version}`}>
              <span className="whats-new__version">{release.version}</span>
              <span>{text(...release.title)}</span>
            </h3>
            {index > 0 ? <p className="whats-new__date">{formatDay(release.date)}</p> : null}
            <ul className="whats-new__notes">
              {release.notes.map((note) => (
                <li key={note.text[0]}>
                  <span>{text(...note.text)}</span>
                  {note.tryIt ? (
                    <button
                      className="whats-new__try"
                      onClick={() => {
                        closePanel(true);
                        onTry(note.tryIt!);
                      }}
                      type="button"
                    >
                      {text("Prova", "Try it")}
                      <ArrowRight aria-hidden="true" size={14} strokeWidth={2.25} />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  ) : null;

  return (
    <div className="whats-new" onBlur={onBlur}>
      <button
        aria-controls={open ? panelId : undefined}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={label}
        className="button button--ghost topbar-icon whats-new__trigger"
        onClick={() => (open ? closePanel(true) : openPanel())}
        // A second click closes, rather than blurring the panel and reopening it.
        onMouseDown={(event) => { if (open) event.preventDefault(); }}
        ref={triggerRef}
        title={label}
        type="button"
      >
        <Sparkles aria-hidden="true" size={19} strokeWidth={2} />
        {unseen ? <span aria-hidden="true" className="whats-new__dot" /> : null}
      </button>

      {panel && typeof document !== "undefined" ? createPortal(panel, document.body) : null}
    </div>
  );
}
