"use client";

import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";

import { useLanguage } from "@/features/i18n/language";

/*
 * A date field with IRIS's own calendar (owner, 10 Oct 2026: "Aggiorna anche
 * i calendari"). The platform's date popup cannot be restyled, unlike the
 * select's list, so it is not used: the native date input stays for typing
 * (its day/month/year segments, its validation, `required`), its own picker
 * icon is hidden, and the calendar button opens this calendar instead.
 *
 * The calendar is a popover in the top layer, anchored under the field
 * (flipping above when there is no room), so a window's scrolling body never
 * clips it; it stays inside the window's DOM, so the window's focus trap and
 * outside-click rules treat it as part of the window. Escape closes the
 * calendar only (the window's own Escape is held while it is open, see
 * isDatePickerOpen), and gives the focus back to the field.
 *
 * Keyboard: arrows move a day or a week, Page Up/Down a month, Home/End the
 * start and end of the week, Enter or Space choose. Weeks start on Monday.
 */

type Day = { year: number; month: number; day: number };

const pad = (value: number) => String(value).padStart(2, "0");
const toIso = ({ year, month, day }: Day) => `${year}-${pad(month + 1)}-${pad(day)}`;

function fromIso(value: string): Day | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : { year: date.getFullYear(), month: date.getMonth(), day: date.getDate() };
}

function today(): Day {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth(), day: now.getDate() };
}

/** The day a number of days away, across months and years. */
function shift({ year, month, day }: Day, days: number): Day {
  const date = new Date(year, month, day + days);
  return { year: date.getFullYear(), month: date.getMonth(), day: date.getDate() };
}

/** The same day a number of months away, kept within the shorter months. */
function shiftMonths({ year, month, day }: Day, months: number): Day {
  const first = new Date(year, month + months, 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return { year: first.getFullYear(), month: first.getMonth(), day: Math.min(day, last) };
}

const sameDay = (a: Day | null, b: Day | null) => Boolean(a && b && a.year === b.year && a.month === b.month && a.day === b.day);

/** Monday = 0 … Sunday = 6. */
const weekdayOf = ({ year, month, day }: Day) => (new Date(year, month, day).getDay() + 6) % 7;

/** The six weeks shown for a month, from the Monday on or before its first day. */
function weeksOf(year: number, month: number): Day[][] {
  const first: Day = { year, month, day: 1 };
  const start = shift(first, -weekdayOf(first));
  return Array.from({ length: 6 }, (_, week) => Array.from({ length: 7 }, (_, weekday) => shift(start, week * 7 + weekday)));
}

/** True while a calendar is open: a window holds its own Escape meanwhile. */
export function isDatePickerOpen(): boolean {
  return typeof document !== "undefined" && document.querySelector(".date-picker[data-open]") !== null;
}

export function DateField({
  value,
  onChange,
  required = false,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  /** For a field whose label does not wrap it. */
  ariaLabel?: string;
}) {
  const { locale, text } = useLanguage();
  const [open, setOpen] = useState(false);
  const selected = fromIso(value);
  const [focusDay, setFocusDay] = useState<Day>(() => selected ?? today());
  const fieldRef = useRef<HTMLSpanElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const anchor = `--date-field-${useId().replace(/[^\w-]/g, "")}`;
  const now = today();

  const openPicker = () => {
    setFocusDay(selected ?? today());
    setOpen(true);
  };

  const close = (returnFocus = true) => {
    setOpen(false);
    if (returnFocus) inputRef.current?.focus();
  };

  const choose = (day: Day) => {
    onChange(toIso(day));
    close();
  };

  // Shown in the top layer once mounted; hidden again before it unmounts.
  useLayoutEffect(() => {
    const picker = pickerRef.current;
    if (!open || !picker) return;
    try {
      picker.showPopover?.();
    } catch {
      // Already shown, or no popover support: it is still in the flow.
    }
    return () => {
      try {
        picker.hidePopover?.();
      } catch {
        // Already hidden.
      }
    };
  }, [open]);

  // The focus follows the day in focus, inside the grid.
  useEffect(() => {
    if (!open) return;
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-day="${toIso(focusDay)}"]`)?.focus({ preventScroll: true });
  }, [open, focusDay]);

  // A press anywhere outside the field and its calendar closes it.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (fieldRef.current?.contains(target) || pickerRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open]);

  const onGridKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, () => Day> = {
      ArrowLeft: () => shift(focusDay, -1),
      ArrowRight: () => shift(focusDay, 1),
      ArrowUp: () => shift(focusDay, -7),
      ArrowDown: () => shift(focusDay, 7),
      PageUp: () => shiftMonths(focusDay, -1),
      PageDown: () => shiftMonths(focusDay, 1),
      Home: () => shift(focusDay, -weekdayOf(focusDay)),
      End: () => shift(focusDay, 6 - weekdayOf(focusDay)),
    };
    if (moves[event.key]) {
      event.preventDefault();
      setFocusDay(moves[event.key]());
    }
  };

  const onPickerKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  };

  const monthLabel = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(new Date(focusDay.year, focusDay.month, 1));
  const weekdayLabels = Array.from({ length: 7 }, (_, index) =>
    new Intl.DateTimeFormat(locale, { weekday: "short" }).format(new Date(2026, 0, 5 + index)).replace(".", ""));
  const fullDate = (day: Day) =>
    new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(day.year, day.month, day.day));
  const toggleLabel = open ? text("Chiudi il calendario", "Close the calendar") : text("Apri il calendario", "Open the calendar");

  return (
    <span className="date-field" ref={fieldRef} style={{ anchorName: anchor } as React.CSSProperties}>
      <input
        aria-label={ariaLabel}
        className="date-field__input"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          // The platform's own shortcuts for its popup open this calendar.
          if ((event.altKey && event.key === "ArrowDown") || event.key === "F4") {
            event.preventDefault();
            openPicker();
          }
        }}
        ref={inputRef}
        required={required}
        type="date"
        value={value}
      />
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={toggleLabel}
        className="date-field__toggle"
        onClick={() => (open ? close() : openPicker())}
        title={toggleLabel}
        type="button"
      >
        <CalendarDays aria-hidden="true" size={17} strokeWidth={2} />
      </button>

      {open ? (
        <div
          aria-label={text("Scegli una data", "Choose a date")}
          className="date-picker"
          data-open=""
          onKeyDown={onPickerKey}
          popover="manual"
          ref={pickerRef}
          role="dialog"
          style={{ positionAnchor: anchor } as React.CSSProperties}
        >
          <div className="date-picker__header">
            <span aria-live="polite" className="date-picker__month">{monthLabel}</span>
            <span className="date-picker__nav">
              <button aria-label={text("Mese precedente", "Previous month")} onClick={() => setFocusDay(shiftMonths(focusDay, -1))} type="button">
                <ChevronLeft aria-hidden="true" size={17} strokeWidth={2.25} />
              </button>
              <button aria-label={text("Mese successivo", "Next month")} onClick={() => setFocusDay(shiftMonths(focusDay, 1))} type="button">
                <ChevronRight aria-hidden="true" size={17} strokeWidth={2.25} />
              </button>
            </span>
          </div>

          <div className="date-picker__grid" onKeyDown={onGridKey} ref={gridRef} role="grid">
            <div className="date-picker__row date-picker__row--weekdays" role="row">
              {weekdayLabels.map((label) => (
                <span className="date-picker__weekday" key={label} role="columnheader">{label}</span>
              ))}
            </div>
            {weeksOf(focusDay.year, focusDay.month).map((week) => (
              <div className="date-picker__row" key={toIso(week[0])} role="row">
                {week.map((day) => {
                  const inMonth = day.month === focusDay.month;
                  const isSelected = sameDay(day, selected);
                  return (
                    <span key={toIso(day)} role="gridcell">
                      <button
                        aria-current={sameDay(day, now) ? "date" : undefined}
                        aria-label={fullDate(day)}
                        aria-pressed={isSelected}
                        className="date-picker__day"
                        data-day={toIso(day)}
                        data-outside={inMonth ? undefined : ""}
                        onClick={() => choose(day)}
                        tabIndex={sameDay(day, focusDay) ? 0 : -1}
                        type="button"
                      >
                        {day.day}
                      </button>
                    </span>
                  );
                })}
              </div>
            ))}
          </div>

          <div className="date-picker__footer">
            {required ? <span /> : (
              <button className="date-picker__link" onClick={() => { onChange(""); close(); }} type="button">
                {text("Cancella", "Clear")}
              </button>
            )}
            <button className="date-picker__link" onClick={() => choose(today())} type="button">
              {text("Oggi", "Today")}
            </button>
          </div>
        </div>
      ) : null}
    </span>
  );
}
