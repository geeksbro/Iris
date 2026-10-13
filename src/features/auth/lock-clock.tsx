"use client";

import { useSyncExternalStore } from "react";

import { useLanguage } from "@/features/i18n/language";

/*
 * The lock screen's sense of time (owner, 10 Oct 2026, ported from the
 * Trading OS lock screen): the greeting by the hour, the time with its
 * seconds, today as a calendar leaf and the last access as its twin.
 *
 * Every reading goes through useSyncExternalStore with a server snapshot of
 * null: the server cannot know when the page is looked at, so it renders a
 * placeholder of the same shape and the browser fills in its own clock after
 * hydration, with no mismatch.
 */

type Text = (italian: string, english: string) => string;

function subscribeMinutes(onChange: () => void): () => void {
  const timer = window.setInterval(onChange, 10_000);
  return () => window.clearInterval(timer);
}

const minuteNow = () => Math.floor(Date.now() / 60_000);
const onServer = () => null;

function useMinute(): Date | null {
  const minute = useSyncExternalStore(subscribeMinutes, minuteNow, onServer);
  return minute === null ? null : new Date(minute * 60_000);
}

/*
 * The greeting by the hour: the same words for anyone, so it never has to
 * guess a gender from a name ("Bentornato" greeted Giulia in the masculine).
 * Buongiorno until noon, Buon pomeriggio until 18:00, Buonasera after.
 */
export function greetingFor(date: Date, name: string, text: Text): string {
  const hour = date.getHours();
  const word = hour < 12
    ? text("Buongiorno", "Good morning")
    : hour < 18
      ? text("Buon pomeriggio", "Good afternoon")
      : text("Buonasera", "Good evening");
  return name ? `${word}, ${name}` : word;
}

/** The greeting, live: it turns with the hour while the screen stays open. */
export function useGreeting(name: string): string | null {
  const { text } = useLanguage();
  const now = useMinute();
  return now ? greetingFor(now, name, text) : null;
}

/* The time with its seconds, re-aligned on every tick so it never drifts. */
function subscribeSeconds(onChange: () => void): () => void {
  let timer = 0;
  const tick = () => {
    onChange();
    timer = window.setTimeout(tick, 1000 - (Date.now() % 1000) + 5);
  };
  timer = window.setTimeout(tick, 1000 - (Date.now() % 1000) + 5);
  return () => window.clearTimeout(timer);
}

const secondNow = () => Math.floor(Date.now() / 1000);
const pad = (value: number) => String(value).padStart(2, "0");

export function LiveClock({ className }: { className?: string }) {
  const second = useSyncExternalStore(subscribeSeconds, secondNow, onServer);
  const now = second === null ? null : new Date(second * 1000);
  return (
    <p aria-hidden="true" className={className}>
      <span style={now ? undefined : { visibility: "hidden" }}>
        {now ? `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}` : "00:00:00"}
      </span>
    </p>
  );
}

/** Today: the weekday, the day's number large, the month and the year. */
export function TodayLeaf() {
  const { locale } = useLanguage();
  const now = useMinute();
  return (
    <div className="iris-lock__leaf" style={now ? undefined : { visibility: "hidden" }}>
      <span className="iris-lock__leaf-label">
        {now ? new Intl.DateTimeFormat(locale, { weekday: "long" }).format(now) : "giorno"}
      </span>
      <span className="iris-lock__leaf-figure">{now ? now.getDate() : "00"}</span>
      <span className="iris-lock__leaf-caption">
        {now ? new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(now) : "mese"}
      </span>
    </div>
  );
}

/**
 * The last access on this device, and the wrong PINs typed since: its time
 * large, its day under it ("oggi", "ieri", "28 settembre").
 */
export function AccessLeaf({ at, wrongSince }: { at: string | null; wrongSince: number }) {
  const { locale, text } = useLanguage();
  const now = useMinute();
  const when = at ? new Date(at) : null;
  let day = "";
  if (when && now) {
    const startOf = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    const days = Math.round((startOf(now) - startOf(when)) / 86_400_000);
    day = days === 0
      ? text("oggi", "today")
      : days === 1
        ? text("ieri", "yesterday")
        : new Intl.DateTimeFormat(locale, { day: "numeric", month: "long" }).format(when);
  }
  return (
    <div className="iris-lock__leaf" style={now ? undefined : { visibility: "hidden" }}>
      <span className="iris-lock__leaf-label">{text("Ultimo accesso", "Last access")}</span>
      <span className="iris-lock__leaf-figure iris-lock__leaf-figure--time">
        {when ? `${pad(when.getHours())}:${pad(when.getMinutes())}` : "—"}
      </span>
      <span className="iris-lock__leaf-caption">{when ? day : text("nessuno registrato", "none recorded")}</span>
      {wrongSince > 0 ? (
        <span className="iris-lock__leaf-alert">
          {wrongSince === 1
            ? text("1 PIN errato da allora", "1 wrong PIN since")
            : text(`${wrongSince} PIN errati da allora`, `${wrongSince} wrong PINs since`)}
        </span>
      ) : null}
    </div>
  );
}
