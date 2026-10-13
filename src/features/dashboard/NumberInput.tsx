"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import { useRef, type InputHTMLAttributes } from "react";

import { cx } from "./ui";

/*
 * A number field with IRIS's own stepper (owner, 10 Oct 2026: the platform's
 * spin buttons drawn in the theme). The platform's arrows cannot be restyled,
 * only hidden, so they are hidden (globals.css) and two small chevrons take
 * their place at the field's end. They step the field exactly as the
 * platform would — its own step, min and max, through stepUp/stepDown — and
 * then fire the input event React listens to, so the field's onChange runs as
 * for a typed value. They stay out of the tab order and of the accessibility
 * tree: the arrow keys already step a focused number field, and a pointer
 * press on them keeps the focus where it was.
 */
export function NumberInput({ className, disabled, readOnly, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  const inputRef = useRef<HTMLInputElement>(null);

  const stepBy = (direction: 1 | -1) => {
    const input = inputRef.current;
    if (!input || input.disabled || input.readOnly) return;
    try {
      if (direction === 1) input.stepUp();
      else input.stepDown();
    } catch {
      // A field the platform refuses to step (step="any"): start from its
      // minimum, or zero. Through the prototype's setter, so React still
      // sees the change as the user's.
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setValue?.call(input, String(Math.max(Number(input.min) || 0, 0)));
    }
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };

  return (
    <span className="number-input">
      <input
        {...props}
        className={cx("number-input__field", className)}
        disabled={disabled}
        readOnly={readOnly}
        ref={inputRef}
        type="number"
      />
      {disabled || readOnly ? null : (
        <span aria-hidden="true" className="number-input__stepper">
          <button onClick={() => stepBy(1)} onPointerDown={(event) => event.preventDefault()} tabIndex={-1} type="button">
            <ChevronUp size={12} strokeWidth={2.5} />
          </button>
          <button onClick={() => stepBy(-1)} onPointerDown={(event) => event.preventDefault()} tabIndex={-1} type="button">
            <ChevronDown size={12} strokeWidth={2.5} />
          </button>
        </span>
      )}
    </span>
  );
}
