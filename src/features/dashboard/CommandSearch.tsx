"use client";

import {
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Search } from "lucide-react";

import { useLanguage } from "@/features/i18n/language";

import { cx } from "./ui";

/*
 * One index of the dashboard, opened from the top bar. It lists only what
 * the product has: its views, its active accounts and the actions its own
 * buttons already run. Each result carries that object's existing mark, so
 * it reads as the thing it opens.
 *
 * ── How it opens (owner, 12 Oct 2026) ───────────────────────────────────
 * As the profile menu does, after Trading OS's: the panel appears whole, in
 * 140ms — from transparent, 4px higher and at 97% of its size, grown from
 * the top at the field's centre — and closes at once. The pill is never
 * covered (owner, 12 Oct 2026): clicked, it becomes the field itself, ringed
 * in violet, and the results open in a panel of their own under it, as wide
 * as it. From a compact icon, or on a phone, there is no pill to type in,
 * and the panel under the bar holds the field. The animation is CSS
 * (command-open in globals.css); reduced motion drops it.
 *
 * It lives in a portal on the body, as the profile menu does, because the
 * bar is a stacking context below the rail. The input is focused from the
 * first frame, so typing is never lost to the animation.
 */

export type CommandGroup = "views" | "accounts" | "actions";

export type CommandItem = {
  id: string;
  group: CommandGroup;
  label: string;
  /** Shown quietly after the name, and searched with it. */
  context?: string;
  icon: ReactNode;
  run: () => void;
};

const groupOrder: CommandGroup[] = ["views", "accounts", "actions"];

// Case- and accent-insensitive, so "liquidita" finds "Liquidità".
function normalize(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

type Placement = {
  /** "field": the pill is the field, the results open under it; "below": no
      pill to type in (a compact icon, a phone), the panel holds the field. */
  mode: "field" | "below";
  /** Where the panel grows from, in its own coordinates: the trigger's centre. */
  originX: number;
  left: number;
  top: number;
  width: number;
  maxHeight: number;
};

const panelWidth = 420;
const panelMaxHeight = 520;
const belowGap = 8;

/*
 * The panel is placed against the top bar, never the viewport: it stays
 * inside the bar's content edges, so it can never slide under the sidebar.
 * A field wide enough to type in becomes the panel's own first row; a
 * compact icon, or no visible trigger at all, opens it under the bar.
 */
function measurePlacement(trigger: HTMLElement | null): Placement | null {
  const bar = trigger?.closest<HTMLElement>(".topbar");
  if (!bar) return null;
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
  const anchor = trigger && trigger.getClientRects().length > 0 ? trigger.getBoundingClientRect() : null;
  const field = anchor !== null && anchor.width >= 200;
  /* Under the pill the panel is exactly as wide as the pill (owner,
     12 Oct 2026): the field above, its results below, one column. */
  const width = Math.min(available, field ? anchor.width : panelWidth);
  const clampLeft = (value: number) => Math.min(Math.max(value, insetLeft), barRect.width - insetRight - width);

  const anchorCenter = anchor ? anchor.left + anchor.width / 2 - barRect.left : barRect.width / 2;
  // Centred on a field or on the bar; from a compact icon, it opens leftward.
  const left = clampLeft(anchor && !field ? anchor.right - barRect.left - width : anchorCenter - width / 2);
  const originX = Math.min(Math.max(anchorCenter - left, 0), width);
  // Under the pill, 8px down; otherwise under the bar.
  const top = anchor && field ? anchor.bottom - barRect.top + belowGap : barRect.height + belowGap;
  const maxHeight = Math.min(panelMaxHeight, window.innerHeight - (barRect.top + top) - 16);
  /* Solved against the bar, handed over in viewport coordinates: the panel is
     portaled and fixed, so that is the space it is placed in. */
  return { mode: field ? "field" : "below", originX, left: barRect.left + left, top: barRect.top + top, width, maxHeight };
}

export function CommandSearch({ items, shortcutEnabled }: { items: CommandItem[]; shortcutEnabled: boolean }) {
  const { text } = useLanguage();
  /* The placement is the panel: present while it is open, gone when closed. */
  const [placement, setPlacement] = useState<Placement | null>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  /* Closing plays the opening backwards before the panel leaves, as the
     profile menu does (owner, 13 Oct 2026); for those 140ms it is on screen
     but no longer open, and the pill is already a button again. */
  const [closing, setClosing] = useState(false);
  const exitRef = useRef<Animation | null>(null);
  const open = placement !== null && !closing;
  const mode = placement?.mode ?? "below";
  const triggerRef = useRef<HTMLButtonElement>(null);
  const zoneRef = useRef<HTMLDivElement>(null);
  /** Focus goes back to the pill's button once it is a button again. */
  const refocusRef = useRef(false);
  // The pill, whichever it is now: the button at rest, the field while open.
  const pill = () => zoneRef.current?.querySelector<HTMLElement>(".command-trigger") ?? triggerRef.current;
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const baseId = useId();
  const panelId = `${baseId}-panel`;
  const listId = `${baseId}-list`;
  const optionId = (item: CommandItem) => `${baseId}-option-${item.id}`;

  const placeholder = text("Cerca conti, viste o azioni…", "Search accounts, views or actions…");
  const groupLabels: Record<CommandGroup, string> = {
    views: text("Viste", "Views"),
    accounts: text("Conti", "Accounts"),
    actions: text("Azioni", "Actions"),
  };

  // Every word typed must appear in the name or its context.
  const tokens = normalize(query).split(/\s+/).filter(Boolean);
  const groups = groupOrder
    .map((group) => ({
      group,
      items: items.filter((item) => item.group === group && tokens.every((token) => normalize(`${item.label} ${item.context ?? ""}`).includes(token))),
    }))
    .filter(({ items: groupItems }) => groupItems.length > 0);
  const results = groups.flatMap(({ items: groupItems }) => groupItems);
  const selected = Math.min(activeIndex, results.length - 1);
  const activeItem = results[selected];

  const openPanel = (initialQuery = "") => {
    // Asked back mid-close: the exit turns round from where it is.
    const exit = exitRef.current;
    if (exit) {
      exitRef.current = null;
      exit.reverse();
      setClosing(false);
    }
    if (!open) {
      returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    setQuery(initialQuery);
    setActiveIndex(0);
    setPlacement(measurePlacement(pill()) ?? {
      mode: "below", originX: panelWidth / 2, left: 16, top: 72, width: Math.min(panelWidth, window.innerWidth - 32), maxHeight: panelMaxHeight,
    });
  };

  const closePanel = (restoreFocus: boolean) => {
    if (!open) return;
    // Focus leaves the input first, so a window an item opens returns focus
    // to the trigger when it closes.
    if (restoreFocus) {
      const trigger = triggerRef.current;
      if (trigger) {
        const target = trigger.getClientRects().length > 0 ? trigger : returnFocusRef.current;
        if (target?.isConnected) target.focus({ preventScroll: true });
      } else {
        // The pill is the open field: its button returns with the close.
        refocusRef.current = true;
      }
    }
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

  // Focus leaves the input first, so a window the item opens returns focus
  // to the trigger when it closes.
  const activate = (item: CommandItem) => {
    closePanel(true);
    item.run();
  };

  // Ctrl+K opens the same panel. Off while an application window is open,
  // so the shortcut never reaches past a modal; read at keypress, so it is
  // back the moment that window closes.
  const onShortcut = useEffectEvent((event: globalThis.KeyboardEvent) => {
    if (!shortcutEnabled) return;
    if (event.key.toLowerCase() !== "k" || !event.ctrlKey || event.altKey || event.shiftKey || event.metaKey) return;
    event.preventDefault();
    if (open) {
      inputRef.current?.select();
    } else {
      openPanel();
    }
  });

  useEffect(() => {
    const listener = (event: globalThis.KeyboardEvent) => onShortcut(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  // A resize places the panel where the field now is.
  const onResize = useEffectEvent(() => {
    if (!open) return;
    const next = measurePlacement(pill());
    if (next) setPlacement(next);
  });

  useEffect(() => {
    if (!open) return;
    const listener = () => onResize();
    window.addEventListener("resize", listener);
    return () => window.removeEventListener("resize", listener);
  }, [open]);

  /* The input is live from the first frame of the opening: the panel travels
     around a field that can already be typed into. */
  useLayoutEffect(() => {
    if (open || !refocusRef.current) return;
    refocusRef.current = false;
    triggerRef.current?.focus({ preventScroll: true });
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const input = inputRef.current;
    if (!input || document.activeElement === input) return;
    input.focus({ preventScroll: true });
    input.setSelectionRange(input.value.length, input.value.length);
  }, [open]);

  const activeOptionId = activeItem ? optionId(activeItem) : undefined;
  useLayoutEffect(() => {
    if (!open || !activeOptionId) return;
    document.getElementById(activeOptionId)?.scrollIntoView?.({ block: "nearest" });
  }, [open, activeOptionId]);

  const move = (delta: number) => {
    if (results.length === 0) return;
    setActiveIndex((selected + delta + results.length) % results.length);
  };

  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      move(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      move(-1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (activeItem) activate(activeItem);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closePanel(true);
    }
  };

  // Typing on the focused trigger starts the search with that character.
  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      openPanel();
    } else if (event.key.length === 1 && event.key !== " " && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      openPanel(event.key);
    }
  };

  /*
   * Focus moving anywhere outside the search (a click elsewhere, Tab) closes
   * it. The panel is portaled, so it is no longer a DOM descendant of this
   * wrapper even though React still routes its events here: containment has
   * to be asked of both boxes, or focus entering the input would read as
   * having left the search and close it on the way in.
   */
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget;
    if (next instanceof Node && (event.currentTarget.contains(next) || panelRef.current?.contains(next))) return;
    closePanel(false);
  };

  const status = !query.trim()
    ? ""
    : results.length === 0
      ? text("Nessun risultato", "No results")
      : results.length === 1
        ? text("1 risultato", "1 result")
        : text(`${results.length} risultati`, `${results.length} results`);

  const field = (
    <input
      aria-activedescendant={activeOptionId}
      aria-autocomplete="list"
      aria-controls={results.length > 0 ? listId : undefined}
      aria-expanded={results.length > 0}
      aria-label={placeholder}
      autoComplete="off"
      className="command-panel__input"
      onChange={(event) => {
        setQuery(event.target.value);
        setActiveIndex(0);
      }}
      onKeyDown={onInputKeyDown}
      placeholder={placeholder}
      ref={inputRef}
      role="combobox"
      spellCheck={false}
      type="text"
      value={query}
    />
  );

  return (
    <div className="topbar-search" data-panel={open ? mode : undefined} onBlur={onBlur} ref={zoneRef}>
      {open && mode === "field" ? (
        <div className="command-trigger" data-open="true">
          <Search aria-hidden="true" size={16} />
          {field}
          <span aria-hidden="true" className="command-trigger__hint">Esc</span>
        </div>
      ) : (
        <button
          aria-controls={open ? panelId : undefined}
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-keyshortcuts="Control+K"
          className="command-trigger"
          onClick={() => (open ? closePanel(true) : openPanel())}
          onKeyDown={onTriggerKeyDown}
          // A second click on the compact trigger closes, rather than blurring and reopening.
          onMouseDown={(event) => { if (open) event.preventDefault(); }}
          ref={triggerRef}
          type="button"
        >
          <Search aria-hidden="true" size={16} />
          <span className="command-trigger__label">{placeholder}</span>
          <span aria-hidden="true" className="command-trigger__hint">Ctrl K</span>
        </button>
      )}

      {placement ? createPortal(
        <div
          aria-label={text("Cerca nella dashboard", "Search the dashboard")}
          className="command-panel"
          data-mode={mode}
          data-state={closing ? "closing" : "open"}
          id={panelId}
          inert={closing}
          // Clicks on rows and headings keep focus in the input.
          onMouseDown={(event) => { if (event.target !== inputRef.current) event.preventDefault(); }}
          ref={panelRef}
          role="dialog"
          style={{
            left: placement.left,
            top: placement.top,
            width: placement.width,
            maxHeight: placement.maxHeight,
            transformOrigin: `${placement.originX}px 0`,
          }}
        >
        <div className="command-panel__inner">
          {mode === "below" ? (
            <div className="command-panel__field">
              <Search aria-hidden="true" size={16} />
              {field}
              <span aria-hidden="true" className="command-panel__hint">Esc</span>
            </div>
          ) : null}

          {results.length > 0 ? (
            <div aria-label={text("Risultati", "Results")} className="command-list" id={listId} role="listbox">
              {groups.map(({ group, items: groupItems }) => (
                <div aria-labelledby={`${baseId}-${group}`} className="command-list__group" key={group} role="group">
                  <div className="command-list__heading" id={`${baseId}-${group}`} role="presentation">{groupLabels[group]}</div>
                  {groupItems.map((item) => {
                    const index = results.indexOf(item);
                    const isActive = index === selected;
                    return (
                      <div
                        aria-selected={isActive}
                        className={cx("command-option", isActive && "is-active")}
                        id={optionId(item)}
                        key={item.id}
                        onClick={() => activate(item)}
                        // Move, not enter: a list scrolled by the keyboard under a
                        // resting pointer must not steal the selection.
                        onMouseMove={() => { if (!isActive) setActiveIndex(index); }}
                        role="option"
                      >
                        <span aria-hidden="true" className="command-option__icon">{item.icon}</span>
                        <span className="command-option__label" title={group === "accounts" ? item.label : undefined}>{item.label}</span>
                        {item.context ? <span className="command-option__context">{item.context}</span> : null}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          ) : (
            <div className="command-empty">
              <p>{text(`Nessun risultato per “${query.trim()}”.`, `No results for “${query.trim()}”.`)}</p>
              <p>{text("La ricerca copre i conti attivi, le viste e le azioni della dashboard.", "Search covers active accounts, views and dashboard actions.")}</p>
            </div>
          )}

          <p aria-live="polite" className="visually-hidden" role="status">{status}</p>
        </div>
        </div>,
        document.body,
      ) : null}
    </div>
  );
}
