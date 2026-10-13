"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { ArrowDownToLine, ArrowLeft, ArrowRight, Check, HardDrive, KeyRound, Plus, RefreshCw } from "lucide-react";

import { Button } from "@/features/dashboard/ui";
import { useLanguage } from "@/features/i18n/language";
import { playUISound, primeUISounds, type UISound } from "@/features/sound/ui-sound";

import { placePanel, spotlightBox, spotlightRadius, unionBox, visibleShare, type Box, type PanelPlacement, type Size } from "./geometry";
import type { TourOutcome } from "./onboarding";
import { guidedSteps, tourSections, tourSteps, type TourStep, type TourView } from "./steps";

/*
 * THE GUIDED TOUR (First-Run Onboarding).
 *
 * One modal window for the whole tour (Radix Dialog: focus held inside,
 * Escape to leave, the page behind hidden from assistive technology and
 * unscrollable by hand). Its parts:
 *
 * - the scrim, a dim over everything but one opening — the spotlight — cut
 *   around the real element the step is about. The opening is one element
 *   that travels from step to step; at the welcome and at the end it is
 *   closed to nothing at the screen's centre, so the first step opens it
 *   like an iris;
 * - the panel: the step's words, the progress through six sections and the
 *   controls. Centred for the welcome and the end; beside the opening for
 *   every other step; a sheet across the screen on a phone.
 *
 * The opening is measured every frame while the tour is open and redrawn
 * only when it moves, so it stays on its element through a view mounting,
 * the page scrolling into place, the window resizing or a panel moving. A
 * target that never appears (a panel the owner removed) leaves the step
 * centred: the tour never waits on data or layout.
 *
 * The tour points and never acts: nothing here opens a window, writes a
 * record or changes a preference. How it ended is handed to `onEnd`, which
 * the dashboard records (onboarding.ts); a lock simply unmounts it.
 */

/** How long a missing target is waited for before its fallback, then the centre. */
const fallbackAfterMs = 700;
const giveUpAfterMs = 1_400;
/** The opening's margin around its target, and the panel's gap from it. */
const spotlightPad = 8;

type Spotlight = { hole: Box | null; radius: number };

const closedSpotlight: Spotlight = { hole: null, radius: 0 };

const toBox = (rect: DOMRect): Box => ({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });

/*
 * The part of the page the owner actually sees. Not innerWidth/innerHeight:
 * on a phone, content wider than the screen widens the layout viewport they
 * report, and a panel placed against them falls off the screen's foot.
 */
const viewportSize = (): Size => ({
  width: document.documentElement.clientWidth || window.innerWidth,
  height: document.documentElement.clientHeight || window.innerHeight,
});

function findTargets(names: ReadonlyArray<string> | undefined): HTMLElement[] {
  if (!names) return [];
  return names
    .flatMap((name) => [...document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`)])
    .filter((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
}

/** The corner an element shows, in pixels: its CSS radius, never more than half its short side. */
function ownCorner(element: Element): number {
  const box = element.getBoundingClientRect();
  const raw = window.getComputedStyle(element).borderTopLeftRadius;
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value) || box.width <= 0 || box.height <= 0) return 0;
  const radius = raw.trim().endsWith("%") ? (Math.min(box.width, box.height) * value) / 100 : value;
  return Math.min(radius, Math.min(box.width, box.height) / 2);
}

/*
 * The corner the opening is concentric with (owner, 13 Oct 2026: the shapes
 * around a row of buttons and around two rail items were wrong). It is the
 * target's own visible corner — a pill's is half its height, not "999px",
 * so two rail pills open as a rounded box, not a swollen capsule — and a
 * wrapper with no corner of its own, like a row of buttons, takes the
 * corner of what it holds.
 */
function cornerOf(element: HTMLElement): number {
  const own = ownCorner(element);
  if (own > 0) return own;
  return Math.max(0, ...[...element.children].map(ownCorner));
}

/*
 * Brings the target into the part of the page the bar does not cover, once
 * per step, at once (the scrim hides the jump; the opening travels instead).
 * Elements of the frame — the bar, the rail, the round buttons — are always
 * on screen and never scroll.
 */
function revealTarget(elements: HTMLElement[], target: Box) {
  if (elements.some((element) => element.closest(".topbar, .sidebar, .dashboard-fab"))) return;
  const viewport = viewportSize();
  const bar = document.querySelector(".topbar")?.getBoundingClientRect();
  const inset = bar && bar.bottom > 0 ? bar.bottom : 0;
  if (visibleShare(target, viewport, inset) >= 0.98) return;
  const room = viewport.height - inset;
  const offset = target.height > room - 48
    ? target.top - inset - 24
    : target.top + target.height / 2 - (inset + room / 2);
  window.scrollBy({ top: offset, left: 0, behavior: "instant" });
}

function sameSpotlight(first: Spotlight, second: Spotlight): boolean {
  if (!first.hole || !second.hole) return first.hole === second.hole;
  const close = (a: number, b: number) => Math.abs(a - b) < 0.5;
  return close(first.hole.left, second.hole.left) && close(first.hole.top, second.hole.top)
    && close(first.hole.width, second.hole.width) && close(first.hole.height, second.hole.height)
    && close(first.radius, second.radius);
}

/** The opening for a step, kept on its element every frame. */
function useSpotlight(step: TourStep): { spotlight: Spotlight; viewport: Size } {
  const [spotlight, setSpotlight] = useState<Spotlight>(closedSpotlight);
  const [viewport, setViewport] = useState<Size>(() => (typeof window === "undefined" ? { width: 0, height: 0 } : viewportSize()));
  const latest = useRef(spotlight);

  useEffect(() => {
    const raf = window.requestAnimationFrame?.bind(window) ?? ((callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 16));
    const cancel = window.cancelAnimationFrame?.bind(window) ?? window.clearTimeout;
    const startedAt = performance.now();
    let revealed = false;
    let frame = 0;

    const publish = (next: Spotlight) => {
      if (sameSpotlight(latest.current, next)) return;
      latest.current = next;
      setSpotlight(next);
    };

    const tick = () => {
      const size = viewportSize();
      setViewport((current) => (current.width === size.width && current.height === size.height ? current : size));
      const waited = performance.now() - startedAt;
      let elements = findTargets(step.targets);
      if (elements.length === 0 && waited >= fallbackAfterMs) elements = findTargets(step.fallbackTargets);

      if (elements.length > 0) {
        const boxes = elements.map((element) => toBox(element.getBoundingClientRect()));
        const target = unionBox(boxes)!;
        if (!revealed) {
          revealed = true;
          revealTarget(elements, target);
          frame = raf(tick);
          return;
        }
        const hole = spotlightBox(target, size, spotlightPad);
        publish({ hole, radius: spotlightRadius(cornerOf(elements[0]), spotlightPad, hole) });
      } else if (!step.targets || waited >= giveUpAfterMs) {
        // A centred card, or a target that is not on screen: the panel centres.
        publish(closedSpotlight);
      }
      // Otherwise the previous opening stays while the view mounts.
      frame = raf(tick);
    };

    tick();
    return () => cancel(frame);
  }, [step]);

  return { spotlight, viewport };
}

export function OnboardingTour({ onEnd, onNavigate }: {
  /** How the tour ended; the dashboard records it and puts the page back. */
  onEnd: (outcome: TourOutcome) => void;
  /** Shows a view, through the dashboard's own navigation. */
  onNavigate: (view: TourView) => void;
}) {
  const { text } = useLanguage();
  const [index, setIndex] = useState(0);
  const step = tourSteps[index];
  const { spotlight, viewport } = useSpotlight(step);
  // A state, not a ref: the portal mounts the panel a render after the tour.
  const [panel, setPanel] = useState<HTMLDivElement | null>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const [panelSize, setPanelSize] = useState<Size>({ width: 0, height: 0 });
  const ended = useRef(false);
  // Shown, and free to travel, only from the frame after its first placement:
  // it appears where it belongs instead of gliding there from the corner.
  const [placedOnce, setPlacedOnce] = useState(false);
  const measured = panelSize.width > 0;
  useEffect(() => {
    if (!measured || placedOnce) return;
    const frame = window.requestAnimationFrame(() => setPlacedOnce(true));
    return () => window.cancelAnimationFrame(frame);
  }, [measured, placedOnce]);

  const layout = step.id === "welcome" ? "welcome" : step.id === "done" ? "done" : "step";
  const guidedIndex = guidedSteps.indexOf(step);

  // The step's view first; its target is looked for once the view is there.
  // The latest navigation is kept aside, so a new render of the dashboard
  // never sends the tour to a view again.
  const navigate = useRef(onNavigate);
  useLayoutEffect(() => {
    navigate.current = onNavigate;
  });
  useEffect(() => {
    if (step.view) navigate.current(step.view);
  }, [step]);

  // The panel's own size, for placing it: it changes with each step's words.
  useLayoutEffect(() => {
    if (!panel) return;
    const measure = () => {
      const width = panel.offsetWidth;
      const height = panel.offsetHeight;
      setPanelSize((current) => (current.width === width && current.height === height ? current : { width, height }));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(panel);
    return () => observer.disconnect();
  }, [panel]);

  // Focus stays on the control that was pressed; if the step removed it,
  // it goes to the step's main action.
  useEffect(() => {
    if (panel && !panel.contains(document.activeElement)) primaryRef.current?.focus({ preventScroll: true });
  }, [index, panel]);

  /*
   * The tour's own sounds (ui-sound.ts), each readied by the press or key
   * that asks for it, and silent if sounds are off. The welcome chimes only
   * when audio is already awake — opened from Settings or search; after a
   * first PIN it appears on its own, and a sound is never started without a
   * gesture. Controls with a sound of their own skip the generic tap.
   */
  const sound = (name: UISound) => {
    primeUISounds();
    playUISound(name);
  };
  useEffect(() => {
    playUISound("tour-open");
  }, []);

  const end = (outcome: TourOutcome) => {
    if (ended.current) return;
    ended.current = true;
    onEnd(outcome);
  };
  const skip = () => {
    if (!ended.current) sound("tour-close");
    end("skipped");
  };
  const next = () => {
    if (index >= tourSteps.length - 1) {
      end("completed");
      return;
    }
    sound(tourSteps[index + 1].id === "done" ? "tour-complete" : "tour-next");
    setIndex(index + 1);
  };
  const back = () => {
    if (index === 0) return;
    sound("tour-back");
    setIndex(index - 1);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "ArrowRight" && layout === "step") {
      event.preventDefault();
      next();
    } else if (event.key === "ArrowLeft" && index > 0) {
      event.preventDefault();
      back();
    }
  };

  const placed = placePanel(layout === "step" ? spotlight.hole : null, panelSize, viewport, step.prefer);
  const placement: PanelPlacement = placed.placement;
  const hole = spotlight.hole;
  const holeStyle: CSSProperties = hole
    ? { width: hole.width, height: hole.height, transform: `translate(${hole.left}px, ${hole.top}px)`, borderRadius: spotlight.radius }
    : { width: 0, height: 0, transform: `translate(${viewport.width / 2}px, ${viewport.height / 2}px)`, borderRadius: 0 };
  const sectionLabel = text(...tourSections[step.section]);

  return (
    <Dialog.Root
      onOpenChange={(open) => {
        if (!open) skip();
      }}
      open
    >
      <Dialog.Portal>
        {/* The page behind is out of reach for the whole tour: it is pointed at, not used. */}
        <Dialog.Overlay className="tour-catcher" />
        <div aria-hidden="true" className="tour-scrim" data-open={hole ? "true" : undefined}>
          <div className="tour-hole" style={holeStyle} />
        </div>
        <Dialog.Content
          className="tour-panel"
          data-layout={layout}
          data-placed={placedOnce ? "true" : undefined}
          data-placement={placement}
          data-step={step.id}
          onInteractOutside={(event) => event.preventDefault()}
          onKeyDown={onKeyDown}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            primaryRef.current?.focus({ preventScroll: true });
          }}
          // The dashboard decides where focus goes once the page is put back.
          onCloseAutoFocus={(event) => event.preventDefault()}
          ref={setPanel}
          style={{ transform: `translate(${Math.round(placed.left)}px, ${Math.round(placed.top)}px)` }}
        >
          {layout === "step" ? (
            <div className="tour-progress">
              <ol aria-label={text("Sezioni del tour", "Tour sections")} className="tour-progress__track">
                {tourSections.map((section, position) => (
                  <li
                    aria-current={position === step.section ? "step" : undefined}
                    data-state={position < step.section ? "done" : position === step.section ? "current" : "todo"}
                    key={section[0]}
                  >
                    <span className="visually-hidden">{text(...section)}</span>
                  </li>
                ))}
              </ol>
              <span className="tour-progress__count">
                {text(`Passo ${guidedIndex + 1} di ${guidedSteps.length}`, `Step ${guidedIndex + 1} of ${guidedSteps.length}`)}
              </span>
            </div>
          ) : null}

          {/* Keyed by step: the words change with a short fade, the panel itself stays. */}
          <div aria-live="polite" className="tour-panel__body" key={step.id}>
            {layout === "welcome" ? <span aria-hidden="true" className="tour-panel__wordmark">Iris</span> : null}
            {layout === "done" ? (
              <span aria-hidden="true" className="tour-panel__seal"><Check size={26} strokeWidth={2.4} /></span>
            ) : null}
            {layout === "step" ? <p className="eyebrow tour-panel__section">{sectionLabel}</p> : null}
            <Dialog.Title className="tour-panel__title">{text(...step.title)}</Dialog.Title>
            <Dialog.Description className="tour-panel__text">{text(...step.body)}</Dialog.Description>

            {layout === "welcome" ? (
              <ul className="tour-facts">
                <li>
                  <span aria-hidden="true" className="tour-facts__icon"><HardDrive size={19} /></span>
                  <div>
                    <strong>{text("I dati restano qui", "Your data stays here")}</strong>
                    <span>{text(
                      "Conti, saldi e storico sono salvati solo in questo browser, su questo dispositivo. Nessun cloud, nessun server.",
                      "Accounts, balances and history are stored only in this browser, on this device. No cloud, no server.",
                    )}</span>
                  </div>
                </li>
                <li>
                  <span aria-hidden="true" className="tour-facts__icon"><KeyRound size={19} /></span>
                  <div>
                    <strong>{text("Il PIN non è un account e non cifra", "The PIN is not an account and does not encrypt")}</strong>
                    <span>{text(
                      "Blocca l'interfaccia di IRIS in questo browser, ma i dati non sono cifrati: chi usa questo computer può leggerli con strumenti tecnici. Non c'è un account online né un recupero del PIN.",
                      "It locks IRIS's interface in this browser, but the data is not encrypted: anyone using this computer can read it with technical tools. There is no online account and no PIN recovery.",
                    )}</span>
                  </div>
                </li>
                <li>
                  <span aria-hidden="true" className="tour-facts__icon"><ArrowDownToLine size={19} /></span>
                  <div>
                    <strong>{text("Il backup lo fai tu", "Backups are yours to make")}</strong>
                    <span>{text(
                      "Per conservare o spostare i dati, esporta un backup dalle Impostazioni.",
                      "To keep or move your data, export a backup from Settings.",
                    )}</span>
                  </div>
                </li>
              </ul>
            ) : null}

            {layout === "done" ? (
              <ol className="tour-facts tour-facts--next">
                <li>
                  <span aria-hidden="true" className="tour-facts__icon"><Plus size={19} /></span>
                  <div>
                    <strong>{text("Aggiungi i tuoi conti", "Add your accounts")}</strong>
                    <span>{text("Da Conti, con «Aggiungi conto».", "From Accounts, with Add account.")}</span>
                  </div>
                </li>
                <li>
                  <span aria-hidden="true" className="tour-facts__icon"><RefreshCw size={19} /></span>
                  <div>
                    <strong>{text("Salva il primo aggiornamento", "Save your first update")}</strong>
                    <span>{text("Con «Aggiorna saldi», il pulsante tondo in basso a sinistra.", "With Update balances, the round button at the bottom left.")}</span>
                  </div>
                </li>
                <li>
                  <span aria-hidden="true" className="tour-facts__icon"><ArrowDownToLine size={19} /></span>
                  <div>
                    <strong>{text("Esporta un backup ogni tanto", "Export a backup now and then")}</strong>
                    <span>{text("Da Impostazioni › Dati. Il tour si riapre da «Ripeti tutorial», in Impostazioni.", "From Settings › Data. The tour opens again from Take the tour again, in Settings.")}</span>
                  </div>
                </li>
              </ol>
            ) : null}
          </div>

          <div className="tour-panel__actions">
            {layout === "welcome" ? (
              <>
                <Button data-ui-sound="off" onClick={skip} variant="ghost">{text("Salta", "Skip")}</Button>
                <span className="tour-panel__hint">{text("Circa un minuto · 6 sezioni", "About a minute · 6 sections")}</span>
                <Button data-ui-sound="off" onClick={next} ref={primaryRef} variant="primary">
                  {text("Inizia il tour", "Start the tour")} <ArrowRight aria-hidden="true" size={16} />
                </Button>
              </>
            ) : null}
            {layout === "step" ? (
              <>
                <Button className="tour-panel__skip" data-ui-sound="off" onClick={skip} variant="ghost">{text("Salta tour", "Skip tour")}</Button>
                <Button aria-label={text("Passo precedente", "Previous step")} className="tour-panel__back" data-ui-sound="off" onClick={back} variant="secondary">
                  <ArrowLeft aria-hidden="true" size={16} /> <span className="tour-panel__back-label">{text("Indietro", "Back")}</span>
                </Button>
                <Button data-ui-sound="off" onClick={next} ref={primaryRef} variant="primary">
                  {text("Avanti", "Next")} <ArrowRight aria-hidden="true" size={16} />
                </Button>
              </>
            ) : null}
            {layout === "done" ? (
              <>
                <Button aria-label={text("Passo precedente", "Previous step")} data-ui-sound="off" onClick={back} variant="ghost">
                  <ArrowLeft aria-hidden="true" size={16} /> {text("Indietro", "Back")}
                </Button>
                <Button onClick={() => end("completed")} ref={primaryRef} variant="primary">
                  {text("Inizia a usare IRIS", "Start using IRIS")}
                </Button>
              </>
            ) : null}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
