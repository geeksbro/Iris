"use client";

import {
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FocusEvent,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { ImagePlus, Trash2, UserRound } from "lucide-react";

import { useLanguage } from "@/features/i18n/language";
import { displayName, profileImage } from "@/features/settings/preferences";

import { ProfileImageCrop } from "./ProfileImageCrop";

/*
 * The profile's circle and its menu, copied from Trading OS's profile menu
 * (owner, 12 Oct 2026). The menu is about the picture only: the circle at
 * its head with the name and "Vuoi cambiare l'immagine del profilo?", a
 * hairline, then "Scegli immagine…" ("Cambia immagine…" when there is one)
 * and, when there is one, "Rimuovi immagine". Language, privacy, the
 * auto-lock and backups left it: language and the eye are in the bar, the
 * rest in Settings and in the search's actions.
 *
 * ── How it opens (owner, 12 Oct 2026: "identical to Trading OS") ─────────
 * As Trading OS's profile menu does: it appears under the circle, anchored at
 * its right edge, in 140ms — from transparent, 4px higher and at 97% of its
 * size, grown from its top right corner — and closes at once. Escape, a
 * click outside or Tab away closes it; Escape returns the focus to the
 * circle; the arrows, Home and End move through its items. The animation is
 * CSS (iris-profile-open in globals.css); reduced motion drops it.
 *
 * It lives in a portal on the body rather than beside its trigger, because
 * the bar is a stacking context (z-index, backdrop-filter, container-type)
 * at a lower layer than the rail. Anchored inside the bar the panel could
 * only ever be placed where the rail would not cover it; from the body it is
 * simply above, and its placement answers to the bar's edges alone.
 */

export type Placement = {
  /** Viewport coordinates: the portal layer is the viewport. */
  left: number;
  top: number;
  width: number;
  maxHeight: number;
};

/** Trading OS's menu width. */
const profilePanelWidth = 300;
const panelWidth = profilePanelWidth;
/** Trading OS's distance between the circle and its menu. */
const panelGap = 12;
/** Below the panel's width plus this much, the bar is phone-width. */
const sheetThreshold = 120;

/*
 * Placed against the top bar, never the viewport, so the panel keeps to the
 * bar's content edges — but expressed in viewport coordinates, because that
 * is the space the portal layer lives in. Its right edge is the circle's.
 */
export function measurePlacement(trigger: HTMLElement | null, panelWidth = profilePanelWidth): Placement | null {
  const bar = trigger?.closest<HTMLElement>(".topbar");
  if (!trigger || !bar) return null;
  const barRect = bar.getBoundingClientRect();
  const style = window.getComputedStyle(bar);
  /* Folding the rail slides the bar's groups sideways (--topbar-shift in
     globals.css) while the bar's own box stays put, so the edges the panel
     must stay inside are the bar's padding carried by that shift — not the
     padding alone. It is a registered property, so this reads a length. */
  const shift = Number.parseFloat(style.getPropertyValue("--topbar-shift")) || 0;
  const insetLeft = (Number.parseFloat(style.paddingLeft) || 16) + shift;
  const insetRight = (Number.parseFloat(style.paddingRight) || 16) - shift;
  const available = barRect.width - insetLeft - insetRight;
  const anchor = trigger.getBoundingClientRect();
  // A phone-width bar has no room for a panel beside its trigger: the panel
  // becomes a sheet across the bar's content edges instead of a narrow card.
  const sheet = available < panelWidth + sheetThreshold;
  const width = sheet ? available : panelWidth;
  const right = anchor.right - barRect.left;
  const left = sheet
    ? insetLeft
    : Math.min(Math.max(right - width, insetLeft), barRect.width - insetRight - width);
  const top = anchor.bottom - barRect.top + panelGap;
  const maxHeight = window.innerHeight - (barRect.top + top) - 16;
  return { left: barRect.left + left, top: barRect.top + top, width, maxHeight };
}

function initialOf(name: string): string {
  const letter = name.trim().charAt(0);
  return letter ? letter.toLocaleUpperCase() : "";
}

/*
 * The picture when there is one; otherwise the greeting name's initial; with
 * neither — a new device, no name chosen — a person's outline, so the circle
 * never reads as something that failed to load.
 */
function Face({ image, name }: { image: string; name: string }) {
  if (image) {
    // A 256px data URL cut on this device: nothing for next/image to optimise.
    // eslint-disable-next-line @next/next/no-img-element
    return <img alt="" src={image} />;
  }
  const initial = initialOf(name);
  return initial ? <>{initial}</> : <UserRound aria-hidden="true" className="profile-face-glyph" strokeWidth={2} />;
}

export function ProfileMenu() {
  const { text } = useLanguage();
  const image = profileImage.use();
  const name = displayName.use();
  const fileRef = useRef<HTMLInputElement>(null);
  // The picked file, open in the crop editor until it is kept or dropped.
  const [cropSource, setCropSource] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);

  const [placement, setPlacement] = useState<Placement | null>(null);
  /* Closing plays the opening backwards before the menu leaves (owner,
     12 Oct 2026); for those 140ms it is on screen but no longer open. */
  const [closing, setClosing] = useState(false);
  const exitRef = useRef<Animation | null>(null);
  const open = placement !== null && !closing;

  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const baseId = useId();
  const panelId = `${baseId}-panel`;

  const openPanel = () => {
    // Asked back mid-close: the exit turns round from where it is.
    const exit = exitRef.current;
    if (exit) {
      exitRef.current = null;
      exit.reverse();
      setClosing(false);
      return;
    }
    setPlacement(measurePlacement(triggerRef.current) ?? { left: 16, top: 72, width: panelWidth, maxHeight: 480 });
  };

  const closePanel = (restoreFocus: boolean) => {
    if (!open) return;
    // Focus goes home before the panel goes, so whatever an action opens
    // afterwards returns to the trigger rather than to the body.
    if (restoreFocus) triggerRef.current?.focus({ preventScroll: true });
    const panel = panelRef.current;
    const quiet = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (!panel || typeof panel.animate !== "function" || quiet) {
      setPlacement(null);
      return;
    }
    /* The opening run backwards, on Trading OS's numbers: 140ms to
       transparent, 4px up and 97%, towards the circle's corner. */
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

  // An action that leaves the panel (a download, the file picker, a window)
  // hands focus back to the trigger first, so whatever it opens returns there.
  const runAndClose = (action: () => void) => {
    closePanel(true);
    action();
  };

  // A resize moves the panel to where the circle now is.
  const onResize = useEffectEvent(() => {
    if (!open) return;
    const next = measurePlacement(triggerRef.current);
    if (next) setPlacement(next);
  });

  useEffect(() => {
    if (!open) return;
    const listener = () => onResize();
    window.addEventListener("resize", listener);
    return () => window.removeEventListener("resize", listener);
  }, [open]);

  // On open, the first item takes the focus, as in Trading OS.
  useLayoutEffect(() => {
    if (open) panelRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
  }, [open]);

  const items = () => [...(panelRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];

  /* Trading OS's menu keys: the arrows move through the items, Home and End
     jump to the ends, Escape closes and returns to the circle, Tab leaves. */
  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const list = items();
    const at = list.indexOf(document.activeElement as HTMLElement);
    const go = (index: number) => {
      event.preventDefault();
      list[(index + list.length) % list.length]?.focus();
    };
    if (event.key === "ArrowDown") go(at + 1);
    else if (event.key === "ArrowUp") go(at - 1);
    else if (event.key === "Home") go(0);
    else if (event.key === "End") go(list.length - 1);
    else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closePanel(true);
    } else if (event.key === "Tab") {
      closePanel(false);
    }
  };

  /*
   * Focus moving anywhere outside the profile (a click elsewhere, Tab) closes
   * it. The panel is portaled, so it is no longer a DOM descendant of this
   * wrapper even though React still routes its events here: containment has
   * to be asked of both boxes, or focus entering the panel would read as
   * having left the profile and close it on the way in.
   */
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget;
    if (next instanceof Node && (event.currentTarget.contains(next) || panelRef.current?.contains(next))) return;
    closePanel(false);
  };

  const pickImage = () => {
    setImageError(null);
    runAndClose(() => fileRef.current?.click());
  };

  const onFile = (event: ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0];
    event.target.value = "";
    if (!picked) return;
    if (!/^image\/(png|jpeg|webp)$/.test(picked.type)) {
      setImageError(text("Scegli un'immagine PNG, JPEG o WebP.", "Choose a PNG, JPEG or WebP image."));
      openPanel();
      return;
    }
    setCropSource(URL.createObjectURL(picked));
  };

  const closeCrop = () => {
    if (cropSource) URL.revokeObjectURL(cropSource);
    setCropSource(null);
    triggerRef.current?.focus({ preventScroll: true });
  };

  const keepCrop = (dataUrl: string) => {
    closeCrop();
    profileImage.set(dataUrl);
    // The circle changes only once the picture is really stored.
    if (profileImage.get() !== dataUrl) {
      setImageError(text("L'immagine non è stata salvata: lo spazio del browser è pieno.", "The image was not saved: the browser's storage is full."));
      openPanel();
    }
  };

  const removeImage = () => {
    setImageError(null);
    profileImage.set("");
    closePanel(true);
  };

  const profileLabel = text("Profilo", "Profile");
  /* What the panel is, not what the trigger is: the trigger is "Profile",
     the window it opens is the local profile itself. */
  const panelLabel = text(`Profilo di ${name.trim() || "IRIS"}`, `${name.trim() || "IRIS"}'s profile`);

  const shownName = name.trim() || profileLabel;

  const panel = placement ? (
    <div
      aria-label={panelLabel}
      className="profile-panel"
      id={panelId}
      inert={closing}
      onKeyDown={onMenuKeyDown}
      ref={panelRef}
      role="menu"
      style={{ left: placement.left, top: placement.top, width: placement.width, maxHeight: placement.maxHeight }}
    >
      <div className="profile-panel__head" role="presentation">
        <span aria-hidden="true" className="profile-panel__avatar"><Face image={image} name={name} /></span>
        <div className="profile-panel__who">
          <p className="profile-panel__name">{shownName}</p>
          <p className="profile-panel__where">{text("Vuoi cambiare l'immagine del profilo?", "Change your profile picture?")}</p>
        </div>
      </div>

      <div className="profile-panel__sep" role="separator" />

      <button className="profile-panel__item" onClick={pickImage} role="menuitem" type="button">
        <span aria-hidden="true" className="profile-panel__item-icon"><ImagePlus size={20} strokeWidth={2} /></span>
        <span className="profile-panel__item-label">
          {image ? text("Cambia immagine…", "Change picture…") : text("Scegli immagine…", "Choose picture…")}
        </span>
      </button>

      {image ? (
        <button className="profile-panel__item" onClick={removeImage} role="menuitem" type="button">
          <span aria-hidden="true" className="profile-panel__item-icon"><Trash2 size={20} strokeWidth={2} /></span>
          <span className="profile-panel__item-label">{text("Rimuovi immagine", "Remove picture")}</span>
        </button>
      ) : null}

      {imageError ? <p className="profile-panel__error" role="alert">{imageError}</p> : null}
    </div>
  ) : null;

  return (
    <div className="profile-menu" onBlur={onBlur}>
      <button
        aria-controls={open ? panelId : undefined}
        aria-expanded={open}
        aria-haspopup="menu"
        // The circle alone: the name stays for assistive tech, and shows on hover.
        aria-label={profileLabel}
        className="button button--ghost profile-trigger"
        onClick={() => (open ? closePanel(true) : openPanel())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            openPanel();
          }
        }}
        // A second click closes, rather than blurring the panel and reopening it.
        onMouseDown={(event) => { if (open) event.preventDefault(); }}
        ref={triggerRef}
        title={profileLabel}
        type="button"
      >
        <span aria-hidden="true" className="profile-mark" data-image={image ? "true" : undefined}>
          <Face image={image} name={name} />
        </span>
      </button>

      {/* The picker that "Scegli immagine…" opens: never a stop of its own. */}
      <input
        accept="image/png,image/jpeg,image/webp"
        aria-hidden="true"
        className="visually-hidden"
        onChange={onFile}
        ref={fileRef}
        tabIndex={-1}
        type="file"
      />
      {cropSource ? <ProfileImageCrop onCancel={closeCrop} onConfirm={keepCrop} source={cropSource} /> : null}

      {panel && typeof document !== "undefined" ? createPortal(panel, document.body) : null}
    </div>
  );
}
