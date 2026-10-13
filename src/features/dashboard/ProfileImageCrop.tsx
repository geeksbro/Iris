"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type WheelEvent } from "react";

import { useLanguage } from "@/features/i18n/language";
import { profileImageSize } from "@/features/settings/preferences";

import { Button } from "./ui";

/*
 * Choosing the part of the picture that goes in the profile circle (owner,
 * 12 Oct 2026; ported from Trading OS's profile-image-crop.tsx). The picked
 * image opens here before anything is kept: it can be dragged to choose what
 * the circle frames, and zoomed with the slider or the wheel. It always
 * covers the circle — the offsets are clamped at every move — so no empty
 * corner can ever be framed.
 *
 * Direct manipulation: the picture follows the pointer 1:1 from where it was
 * grabbed, with pointer capture so the drag survives leaving the frame;
 * zooming keeps the point under the wheel (or the frame's centre, for the
 * slider and the keys) where it is. The keyboard does all of it: arrows
 * move, + and − zoom.
 *
 * "Salva" draws exactly the framed square at profileImageSize and hands it
 * back as a data URL; "Annulla" or Escape leaves everything as it was.
 */

const frame = 300;
const maxZoom = 4;
const keyStep = 12;

type View = { zoom: number; x: number; y: number };

export function ProfileImageCrop({
  source,
  onCancel,
  onConfirm,
}: {
  /** An object URL of the picked file. */
  source: string;
  onCancel: () => void;
  onConfirm: (dataUrl: string) => void;
}) {
  const { text } = useLanguage();
  const dialog = useRef<HTMLDialogElement>(null);
  const image = useRef<HTMLImageElement | null>(null);
  const drag = useRef<{ id: number; startX: number; startY: number; fromX: number; fromY: number } | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState<View>({ zoom: 1, x: 0, y: 0 });

  // The scale at which the picture just covers the frame (zoom 1).
  const base = natural ? Math.max(frame / natural.w, frame / natural.h) : 1;

  const clamp = (next: View): View => {
    if (!natural) return next;
    const zoom = Math.min(maxZoom, Math.max(1, next.zoom));
    const w = natural.w * base * zoom;
    const h = natural.h * base * zoom;
    return {
      zoom,
      x: Math.min(0, Math.max(frame - w, next.x)),
      y: Math.min(0, Math.max(frame - h, next.y)),
    };
  };

  // Zoom around a point of the frame, so that point stays where it is.
  const zoomAround = (zoom: number, px = frame / 2, py = frame / 2) =>
    setView((was) => {
      const next = Math.min(maxZoom, Math.max(1, zoom));
      const ratio = next / was.zoom;
      return clamp({ zoom: next, x: px - (px - was.x) * ratio, y: py - (py - was.y) * ratio });
    });

  useEffect(() => {
    const node = dialog.current;
    if (node && !node.open && typeof node.showModal === "function") node.showModal();
    const img = new Image();
    img.onload = () => {
      image.current = img;
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      const cover = Math.max(frame / w, frame / h);
      setNatural({ w, h });
      // Centred at zoom 1.
      setView({ zoom: 1, x: (frame - w * cover) / 2, y: (frame - h * cover) / 2 });
    };
    img.onerror = () => setFailed(true);
    img.src = source;
  }, [source]);

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id: event.pointerId, startX: event.clientX, startY: event.clientY, fromX: view.x, fromY: view.y };
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const held = drag.current;
    if (!held || held.id !== event.pointerId) return;
    setView((was) => clamp({ ...was, x: held.fromX + event.clientX - held.startX, y: held.fromY + event.clientY - held.startY }));
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.id === event.pointerId) drag.current = null;
  }

  function onWheel(event: WheelEvent<HTMLDivElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    zoomAround(view.zoom * Math.exp(-event.deltaY * 0.0015), event.clientX - box.left, event.clientY - box.top);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [keyStep, 0],
      ArrowRight: [-keyStep, 0],
      ArrowUp: [0, keyStep],
      ArrowDown: [0, -keyStep],
    };
    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      setView((was) => clamp({ ...was, x: was.x + move[0], y: was.y + move[1] }));
    } else if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      zoomAround(view.zoom * 1.15);
    } else if (event.key === "-") {
      event.preventDefault();
      zoomAround(view.zoom / 1.15);
    }
  }

  function save() {
    const img = image.current;
    if (!img || !natural) return;
    const scale = base * view.zoom;
    const canvas = document.createElement("canvas");
    canvas.width = profileImageSize;
    canvas.height = profileImageSize;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.imageSmoothingQuality = "high";
    context.drawImage(img, -view.x / scale, -view.y / scale, frame / scale, frame / scale, 0, 0, profileImageSize, profileImageSize);
    let dataUrl = canvas.toDataURL("image/webp", 0.86);
    if (!dataUrl.startsWith("data:image/webp")) dataUrl = canvas.toDataURL("image/jpeg", 0.88);
    onConfirm(dataUrl);
  }

  return (
    <dialog
      aria-labelledby="profile-crop-title"
      className="profile-crop"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      ref={dialog}
    >
      <h2 className="profile-crop__title" id="profile-crop-title">
        {text("Scegli la parte da mostrare", "Choose what to show")}
      </h2>
      <p className="profile-crop__note">
        {failed
          ? text("Questa immagine non si apre. Scegline un'altra.", "This image does not open. Choose another one.")
          : text("Trascina la foto per spostarla; ingrandisci con il cursore o con la rotella.", "Drag the photo to move it; zoom with the slider or the wheel.")}
      </p>

      <div
        aria-label={text("Area della foto: le frecce la spostano, più e meno ingrandiscono", "Photo area: the arrows move it, plus and minus zoom")}
        className="profile-crop__frame"
        onKeyDown={onKeyDown}
        onPointerCancel={onPointerUp}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
        role="application"
        style={{ width: frame, height: frame }}
        tabIndex={0}
      >
        {natural ? (
          // An object URL of the file just picked: nothing for next/image here.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            alt=""
            className="profile-crop__image"
            draggable={false}
            src={source}
            style={{
              width: natural.w * base * view.zoom,
              height: natural.h * base * view.zoom,
              transform: `translate(${view.x}px, ${view.y}px)`,
            }}
          />
        ) : null}
        <span aria-hidden="true" className="profile-crop__mask" />
      </div>

      <label className="profile-crop__zoom">
        <span>{text("Zoom", "Zoom")}</span>
        <input
          disabled={!natural}
          max={maxZoom}
          min={1}
          onChange={(event) => zoomAround(Number(event.target.value))}
          step={0.01}
          type="range"
          value={view.zoom}
        />
        <span className="profile-crop__zoom-value">{view.zoom.toFixed(1)}×</span>
      </label>

      <div className="profile-crop__actions">
        <Button onClick={onCancel} variant="ghost">{text("Annulla", "Cancel")}</Button>
        <Button disabled={!natural} onClick={save} variant="primary">{text("Salva", "Save")}</Button>
      </div>
    </dialog>
  );
}
