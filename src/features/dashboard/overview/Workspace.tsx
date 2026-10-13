"use client";

import { useEffect, useEffectEvent, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Check, GripVertical, Minus, Plus, RotateCcw } from "lucide-react";

import { useLanguage } from "@/features/i18n/language";

import { PanelSlot } from "../entrance";
import { measureFlip } from "../morph";
import { Button, cx } from "../ui";
import {
  addPanel,
  catalogueFor,
  defaultLayout,
  gridUnits,
  movePanel,
  overviewLayout,
  removePanel,
  resizePanel,
  sameLayout,
  spans,
  type OverviewLayout,
  type PanelId,
  type Span,
} from "./layout";
import { useJiggle } from "./jiggle";
import { startSway, type Sway } from "./sway";
import { panelClassName, panelRegistry, type PanelActions, type PanelData } from "./registry";

/*
 * The arrangeable half of the Overview.
 *
 * Reading and arranging are different states, and only one of them puts
 * controls on the page. Outside editing there is nothing but the panels: no
 * handles, no crosses, no plus. That is deliberate — the Overview is the
 * page this dashboard opens on, and a page one looks at every morning should
 * not be dressed as a page one is about to take apart.
 *
 * ── Desired and committed ────────────────────────────────────────────────
 * Editing works on a draft. The stored arrangement is untouched until "Fine
 * modifica", which is what makes "Annulla modifiche" able to mean anything:
 * it is not an undo stack, it is the draft being dropped and the committed
 * arrangement standing where it always stood.
 *
 * ── The motion ───────────────────────────────────────────────────────────
 * Every change of the draft moves panels that did not change: remove one and
 * the rest close the gap, widen one and its neighbours give way. Those panels
 * are the same panels throughout, so they travel rather than jump — measured
 * before the change, inverted after it, played to nothing. That is all the
 * machinery this needs: one identity per panel, no layer to escape, no
 * interruption that cannot simply be re-measured from where things now are.
 */

type WorkspaceProps = PanelData & PanelActions & {
  /** Whether the reader is arranging. Owned by the shell: the control that
      turns it on is the round pen at the bottom right of the page. */
  editing: boolean;
  /** Arranging is over — finished or discarded, the shell only needs to know. */
  onStopEditing: () => void;
};

type HeldPanel = { panel: HTMLElement | null; grip: HTMLElement; pointerId: number; grabX: number; grabY: number; x: number; y: number };

/**
 * Puts a held panel under the pointer, held by the point it was grabbed at,
 * through its `translate` measured against its layout box (offsetLeft/Top,
 * which no transform touches).
 */
function placeUnderPointer(held: HeldPanel | null) {
  const panel = held?.panel;
  if (!held || !panel) return;
  const parent = panel.offsetParent as HTMLElement | null;
  const origin = parent ? parent.getBoundingClientRect() : { left: 0, top: 0 };
  const left = held.x - held.grabX - origin.left - (parent?.clientLeft ?? 0) - panel.offsetLeft;
  const top = held.y - held.grabY - origin.top - (parent?.clientTop ?? 0) - panel.offsetTop;
  panel.style.translate = `${left.toFixed(1)}px ${top.toFixed(1)}px`;
}

/*
 * How a panel makes way (owner, 13 Oct 2026: the panels that move animate
 * too, with a movement, not a spring). A panel pushed to a new place slides
 * there and, while it travels left or right, leans the way it goes —
 * clockwise to the right, as the held panel does — then arrives straight.
 * Nothing overshoots: the slide eases out into its slot, the lean rises and
 * falls back to zero. Wide panels lean less, so every corner travels about
 * the same. The lean is added on top of the reorder's own slide (both are
 * `transform`), so the jiggle's `rotate` is left alone.
 */
const makeWayMs = 480;

/** How far a panel leans while it travels `dx` px (the FLIP's offset) at width `width`. */
export function makingWayLean(dx: number, width: number): number {
  if (dx === 0 || !(width > 0)) return 0;
  const limit = Math.min(1.6, (Math.atan(10 / (width / 2)) * 180) / Math.PI);
  // dx is where it starts relative to its slot: it travels the other way.
  return -Math.sign(dx) * limit * Math.min(1, Math.abs(dx) / 160);
}

function leanAlongside(move: { element: HTMLElement; dx: number; width: number }, timing: { durationMs: number }) {
  const lean = makingWayLean(move.dx, move.width);
  if (lean === 0) return;
  move.element.animate(
    [{ transform: "rotate(0deg)" }, { offset: 0.4, transform: `rotate(${lean.toFixed(3)}deg)` }, { transform: "rotate(0deg)" }],
    { duration: timing.durationMs, easing: "ease-in-out", composite: "add" },
  );
}

/** Where a dragged panel would land, given the pointer and the panels' boxes. */
function dropIndexFor(grid: HTMLElement, clientX: number, clientY: number, dragging: number): number {
  const boxes = [...grid.querySelectorAll<HTMLElement>("[data-panel-index]")]
    .map((element) => ({ index: Number(element.dataset.panelIndex), rect: element.getBoundingClientRect() }))
    .filter((box) => box.index !== dragging);

  for (const { index, rect } of boxes) {
    const beforeInRow = clientY < rect.bottom && clientX < rect.left + rect.width / 2;
    const aboveRow = clientY < rect.top;
    if (aboveRow || beforeInRow) return index > dragging ? index - 1 : index;
  }
  return boxes.length;
}

export function OverviewWorkspace({ editing, onStopEditing, ...props }: WorkspaceProps) {
  const { text } = useLanguage();
  const committed = overviewLayout.use();
  const [draft, setDraft] = useState<OverviewLayout | null>(null);
  const [catalogueOpen, setCatalogueOpen] = useState(false);
  const [dragging, setDragging] = useState<number | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const baseId = useId();

  const layout = draft ?? committed;
  const catalogue = catalogueFor(layout);

  /* The held panel sways with the mouse (sway.ts) and keeps swaying after
     release until it hangs straight; only then does it jiggle again. */
  const swayRef = useRef<Sway | null>(null);
  const [settling, setSettling] = useState<PanelId | null>(null);
  const settlingIndex = settling === null ? -1 : layout.findIndex((placed) => placed.id === settling);
  const still = dragging ?? (settlingIndex >= 0 ? settlingIndex : null);

  /* While arranging, the panels shake like icons come loose. While a panel
     is held, every panel holds still (owner, 13 Oct 2026): only the one in
     hand and the ones making way for it move; the shaking returns on
     release, the released one joining once it hangs straight. */
  useJiggle(gridRef, editing && dragging === null, still, layout.map((placed) => `${placed.id}:${placed.span}`).join(" "));

  // Leaving the arrangement (or the page) straightens a panel at once.
  useEffect(() => {
    if (!editing) swayRef.current?.cancel();
  }, [editing]);
  useEffect(() => () => swayRef.current?.cancel(), []);

  const pendingFlip = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    const flip = pendingFlip.current;
    pendingFlip.current = null;
    flip?.();
  });

  /*
   * Panels are measured before the arrangement changes and played back to
   * where they were after it, so what the reader follows is the same panel
   * moving. The measurement is taken in the event that causes the change,
   * never in an effect: by the time an effect runs the old boxes are gone.
   */
  const rearrange = (next: OverviewLayout) => {
    const grid = gridRef.current;
    const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!grid || typeof grid.animate !== "function" || reduced) {
      setDraft(next);
      return;
    }
    // The held panel is under the pointer, not in the reflow: it is left out.
    const play = measureFlip(grid.querySelectorAll<HTMLElement>("[data-panel-index]:not(.is-dragging)"));
    /* The new boxes exist only once React has written them — which, for a
       pointer move, can be after the next frame: the flight is played from
       the layout effect of the commit that wrote them, never guessed. */
    pendingFlip.current = () => play({ durationMs: makeWayMs, alongside: leanAlongside });
    setDraft(next);
  };

  /* The draft exists exactly while the shell says the reader is arranging: it
     is taken from the committed arrangement on the way in and dropped on the
     way out, whichever way the way out was. Adjusted while rendering rather
     than in an effect, so the first paint of an edit already has its draft and
     no render is spent showing the state that is about to be replaced. */
  const [arranging, setArranging] = useState(editing);
  /* On the way out the controls stay on the page while they fold away, as
     ghosts: hidden from assistive tech and inert from the first frame, so
     they stop being controls at once and only their room closes gradually.
     Coming back in mid-fold simply reopens them from where they are. */
  const [leaving, setLeaving] = useState(false);
  if (arranging !== editing) {
    setArranging(editing);
    setDraft(editing ? committed : null);
    setCatalogueOpen(false);
    setLeaving(!editing);
  }

  useEffect(() => {
    if (!leaving) return;
    const done = window.setTimeout(() => setLeaving(false), revealMs);
    return () => window.clearTimeout(done);
  }, [leaving]);

  const showControls = editing || leaving;

  const finishEditing = () => {
    if (draft && !sameLayout(draft, committed)) overviewLayout.set(draft);
    onStopEditing();
  };

  const cancelEditing = () => {
    const grid = gridRef.current;
    const play = grid && typeof grid.animate === "function"
      ? measureFlip(grid.querySelectorAll<HTMLElement>("[data-panel-index]"))
      : null;
    onStopEditing();
    if (play) requestAnimationFrame(() => play());
  };

  /* ── Dragging ──────────────────────────────────────────────────────────
     The pointer owns the panel's position while it is down: the panel is
     lifted above the others and follows the cursor, held by the point where
     it was grabbed (owner, 13 Oct 2026). The panels it passes rearrange
     underneath it, each time settling into a real layout rather than a
     preview of one; its own slot moves with them, and it is placed again
     against that slot. On release it glides back into the slot, which
     already is the arrangement: there is nothing to undo.

     The follow is the panel's `translate` (placeUnderPointer): the reorder's
     FLIP owns `transform`, and the sway owns `rotate`. */
  const dragState = useRef<{
    index: number;
    pointerId: number;
    panel: HTMLElement | null;
    grip: HTMLElement;
    grabX: number;
    grabY: number;
    x: number;
    y: number;
  } | null>(null);

  // A reorder moves the held panel's slot: it is placed again before paint.
  // Moving a node in the DOM releases the pointer capture it held, and a
  // reorder moves the held panel: its grip takes the pointer back at once,
  // or the drag would lose the moves and the release that follow.
  useLayoutEffect(() => {
    const held = dragState.current;
    placeUnderPointer(held);
    if (held?.grip.isConnected) {
      try {
        held.grip.setPointerCapture(held.pointerId);
      } catch {
        // The pointer is already up: its release is on its way.
      }
    }
  });

  // Scrolling under a held panel moves its slot too.
  const holding = dragging !== null;
  useEffect(() => {
    if (!holding) return;
    const onScroll = () => placeUnderPointer(dragState.current);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [holding]);

  const onDragPointerDown = (index: number) => (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!editing || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const panel = event.currentTarget.closest<HTMLElement>("[data-panel-index]");
    panel?.getAnimations().forEach((animation) => animation.cancel());
    const box = panel?.getBoundingClientRect();
    dragState.current = {
      index,
      pointerId: event.pointerId,
      panel,
      grip: event.currentTarget,
      grabX: box ? event.clientX - box.left : 0,
      grabY: box ? event.clientY - box.top : 0,
      x: event.clientX,
      y: event.clientY,
    };
    if (panel) delete panel.dataset.returning;
    setDragging(index);

    swayRef.current?.cancel();
    const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (panel && !reduced && typeof requestAnimationFrame === "function") {
      const id = layout[index].id;
      const sway = startSway(panel, event.clientX, () => {
        if (swayRef.current === sway) swayRef.current = null;
        setSettling((current) => (current === id ? null : current));
      });
      swayRef.current = sway;
      setSettling(id);
    }
  };

  const onDragPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const state = dragState.current;
    const grid = gridRef.current;
    if (!state || !grid || event.pointerId !== state.pointerId) return;
    state.x = event.clientX;
    state.y = event.clientY;
    placeUnderPointer(state);
    swayRef.current?.move(event.clientX);
    const to = dropIndexFor(grid, event.clientX, event.clientY, state.index);
    if (to === state.index) return;
    const next = movePanel(layout, state.index, to);
    state.index = to;
    setDragging(to);
    rearrange(next);
  };

  const endDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const state = dragState.current;
    if (!state || event.pointerId !== state.pointerId) return;
    dragState.current = null;
    setDragging(null);
    swayRef.current?.release();

    // Back into its slot, still above the others until it is there.
    const panel = state.panel;
    if (!panel) return;
    const from = panel.style.translate;
    panel.style.removeProperty("translate");
    const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!from || reduced || typeof panel.animate !== "function") return;
    panel.dataset.returning = "";
    const glide = panel.animate([{ translate: from }, { translate: "0px 0px" }], { duration: 380, easing: "cubic-bezier(0.32, 0.72, 0, 1)" });
    const done = () => { if (dragState.current?.panel !== panel) delete panel.dataset.returning; };
    glide.addEventListener("finish", done);
    glide.addEventListener("cancel", done);
  };

  /* Arranging with a pointer is one way in, not the only one: the same two
     moves are on the keyboard, so the workspace can be arranged without
     ever dragging anything. */
  const moveBy = (index: number, delta: number) => {
    const to = index + delta;
    if (to < 0 || to >= layout.length) return;
    rearrange(movePanel(layout, index, to));
    // Focus follows the panel, not the place it left.
    pendingFocusRef.current = layout[index].id;
  };

  const pendingFocusRef = useRef<PanelId | null>(null);
  const restoreFocus = useEffectEvent(() => {
    const wanted = pendingFocusRef.current;
    if (!wanted) return;
    pendingFocusRef.current = null;
    document.getElementById(`${baseId}-grip-${wanted}`)?.focus({ preventScroll: true });
  });

  useLayoutEffect(() => {
    restoreFocus();
  }, [layout]);

  // Escape leaves editing the way the cancel control does: nothing committed.
  const onKeyDown = useEffectEvent((event: globalThis.KeyboardEvent) => {
    if (event.key === "Escape" && editing && !catalogueOpen) cancelEditing();
  });

  useEffect(() => {
    if (!editing) return;
    const listener = (event: globalThis.KeyboardEvent) => onKeyDown(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [editing]);

  const dirty = editing && draft !== null && !sameLayout(draft, committed);

  return (
    <section
      aria-label={text("Panoramica personalizzabile", "Customisable overview")}
      className={cx("overview-workspace", editing && "is-editing")}
      data-editing={editing ? "true" : undefined}
    >
      {/* A toolbar, and only while arranging: outside editing the Overview
          shows its panels and nothing else. The way in is the pen at the bottom right. */}
      {showControls ? (
        <Reveal className="workspace-reveal--bar" open={editing}>
        <div className="workspace-bar">
          <div className="workspace-bar__text">
            <p>{text(
              "Trascina i pannelli per riordinarli, cambia la loro larghezza, togli quelli che non guardi.",
              "Drag panels to reorder them, change how wide they are, remove the ones you do not read.",
            )}</p>
          </div>
          <div className="workspace-bar__actions">
            <Button onClick={() => setCatalogueOpen((open) => !open)} variant="ghost">
              <Plus aria-hidden="true" size={15} /> {text("Aggiungi pannello", "Add panel")}
            </Button>
            <Button disabled={!dirty} onClick={cancelEditing} variant="ghost">
              <RotateCcw aria-hidden="true" size={15} /> {text("Annulla modifiche", "Discard changes")}
            </Button>
            <Button onClick={finishEditing}>
              <Check aria-hidden="true" size={15} /> {text("Fine modifica", "Done")}
            </Button>
          </div>
        </div>
        </Reveal>
      ) : null}

      {editing && catalogueOpen ? (
        <Catalogue
          catalogue={catalogue}
          data={props}
          onAdd={(id) => {
            rearrange(addPanel(layout, id, panelRegistry[id].defaultSpan));
            setCatalogueOpen(false);
          }}
          onClose={() => setCatalogueOpen(false)}
        />
      ) : null}

      <div className="overview-grid" ref={gridRef}>
        {layout.map((placed, index) => {
          const definition = panelRegistry[placed.id];
          const name = definition.name(text);
          return (
            /* A panel that is already a surface — the total, a category card —
               is placed and moved like any other, but must not be wrapped in a
               second card: it keeps its own. */
            <section
              className={cx(
                definition.bare ? "workspace-panel--bare" : "panel",
                panelClassName[placed.id],
                "workspace-panel",
                dragging === index && "is-dragging",
              )}
              data-panel-index={index}
              data-panel-id={placed.id}
              key={placed.id}
              style={{ "--panel-span": placed.span, "--entrance-nth": index } as CSSProperties}
            >
              {showControls ? (
                <Reveal className="workspace-reveal--panel" open={editing}>
                <div className="workspace-panel__controls">
                  <button
                    aria-label={text(`Sposta ${name}. Usa le frecce per riordinare.`, `Move ${name}. Use the arrow keys to reorder.`)}
                    className="workspace-grip"
                    id={`${baseId}-grip-${placed.id}`}
                    onKeyDown={(event) => {
                      if (event.key === "ArrowLeft" || event.key === "ArrowUp") { event.preventDefault(); moveBy(index, -1); }
                      if (event.key === "ArrowRight" || event.key === "ArrowDown") { event.preventDefault(); moveBy(index, 1); }
                    }}
                    onPointerCancel={endDrag}
                    onPointerDown={onDragPointerDown(index)}
                    onPointerMove={onDragPointerMove}
                    onPointerUp={endDrag}
                    type="button"
                  >
                    <GripVertical aria-hidden="true" size={15} />
                  </button>
                  <span className="workspace-panel__name">{name}</span>
                  <SpanChooser
                    label={text(`Larghezza di ${name}`, `Width of ${name}`)}
                    onChange={(span) => rearrange(resizePanel(layout, placed.id, span))}
                    value={placed.span}
                  />
                  <button
                    aria-label={text(`Togli ${name}`, `Remove ${name}`)}
                    className="workspace-remove"
                    onClick={() => rearrange(removePanel(layout, placed.id))}
                    type="button"
                  >
                    <Minus aria-hidden="true" size={15} />
                  </button>
                </div>
                </Reveal>
              ) : null}
              <PanelSlot index={index}><definition.Render {...props} /></PanelSlot>
            </section>
          );
        })}

        {layout.length === 0 ? (
          <div className="workspace-empty">
            <p>{text("La panoramica è vuota.", "The overview is empty.")}</p>
            {editing ? (
              <Button onClick={() => setCatalogueOpen(true)} variant="ghost">
                <Plus aria-hidden="true" size={15} /> {text("Scegli un pannello", "Choose a panel")}
              </Button>
            ) : (
              <p>{text(
                "Aprila con la penna, in basso a destra.",
                "Open it with the pen, at the bottom right.",
              )}</p>
            )}
          </div>
        ) : null}
      </div>

      {showControls ? (
        <Reveal className="workspace-reveal--reset" open={editing}>
          <p className="workspace-reset">
            <button onClick={() => rearrange(defaultLayout)} type="button">
              {text("Torna alla disposizione originale", "Back to the original arrangement")}
            </button>
          </p>
        </Reveal>
      ) : null}
    </section>
  );
}

/** How long the arranging controls take to unfold and fold; matches --workspace-reveal-dur. */
const revealMs = 420;

/*
 * The arranging controls do not pop in or out: their room opens from nothing
 * to their real height (a 0fr → 1fr grid row, so no height is ever guessed),
 * and the panels around them move with it rather than jumping by a strip.
 * Opening plays from @starting-style on mount; closing is `open` turning
 * false while the shell keeps the controls mounted for `revealMs`.
 */
function Reveal({ children, className, open }: { children: ReactNode; className: string; open: boolean }) {
  return (
    <div
      aria-hidden={open ? undefined : true}
      className={cx("workspace-reveal", className)}
      data-open={open ? "true" : "false"}
      inert={!open}
    >
      <div className="workspace-reveal__clip">{children}</div>
    </div>
  );
}

/** The widths a panel may take, named by what they are rather than by sixths. */
function SpanChooser({ label, onChange, value }: { label: string; onChange: (span: Span) => void; value: Span }) {
  const { text } = useLanguage();
  const names: Record<Span, string> = {
    2: text("Un terzo", "A third"),
    3: text("Metà", "Half"),
    4: text("Due terzi", "Two thirds"),
    6: text("Intera", "Full width"),
  };
  return (
    <span aria-label={label} className="workspace-span" role="radiogroup">
      {spans.map((span) => (
        <button
          aria-checked={span === value}
          aria-label={names[span]}
          key={span}
          onClick={() => onChange(span)}
          role="radio"
          title={names[span]}
          type="button"
        >
          <span aria-hidden="true" style={{ "--span-preview": span } as CSSProperties} />
        </button>
      ))}
    </span>
  );
}

/*
 * What is not on the page, and for the ones that cannot be put there yet,
 * why. A panel with nothing to show is not hidden from the catalogue: it is
 * listed with the reason it is not ready, because "there is no such thing"
 * and "there is nothing in it yet" are different answers and this dashboard
 * does not blur them.
 */
function Catalogue({ catalogue, data, onAdd, onClose }: {
  catalogue: PanelId[];
  data: PanelData;
  onAdd: (id: PanelId) => void;
  onClose: () => void;
}) {
  const { text } = useLanguage();
  const entries = catalogue.map((id) => {
    const definition = panelRegistry[id];
    return { id, definition, reason: definition.unavailable(data, text) };
  });

  return (
    <div aria-label={text("Catalogo pannelli", "Panel catalogue")} className="workspace-catalogue" role="group">
      {entries.length === 0 ? (
        <p className="inline-empty">{text("Ogni pannello è già sulla panoramica.", "Every panel is already on the overview.")}</p>
      ) : (
        <ul>
          {entries.map(({ id, definition, reason }) => (
            <li key={id}>
              <button
                aria-describedby={reason ? `catalogue-reason-${id}` : undefined}
                disabled={reason !== null}
                onClick={() => onAdd(id)}
                type="button"
              >
                <span className="workspace-catalogue__name">{definition.name(text)}</span>
                <span className="workspace-catalogue__summary">{definition.summary(text)}</span>
                {reason ? (
                  <span className="workspace-catalogue__reason" id={`catalogue-reason-${id}`}>{reason}</span>
                ) : (
                  <span aria-hidden="true" className="workspace-catalogue__add"><Plus size={15} /></span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      <Button onClick={onClose} variant="ghost">{text("Chiudi il catalogo", "Close the catalogue")}</Button>
    </div>
  );
}

export { gridUnits };
