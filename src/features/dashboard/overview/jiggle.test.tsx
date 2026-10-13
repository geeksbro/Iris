import { render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { jiggleDegrees, useJiggle } from "./jiggle";

function Grid({ active, still = null }: { active: boolean; still?: number | null }) {
  const ref = useRef<HTMLDivElement>(null);
  useJiggle(ref, active, still, "a b c");
  return (
    <div ref={ref}>
      <section data-panel-index="0" />
      <section data-panel-index="1" />
      <section data-panel-index="2" />
    </div>
  );
}

describe("the arranging jiggle", () => {
  const original = Element.prototype.animate;
  afterEach(() => {
    Element.prototype.animate = original;
  });

  it("tilts a wide panel less than a narrow one, never past an icon's tilt", () => {
    expect(jiggleDegrees(1200)).toBeLessThan(jiggleDegrees(400));
    expect(jiggleDegrees(20)).toBe(1.2);
    expect(jiggleDegrees(0)).toBe(0);
  });

  it("shakes every panel but the dragged one while arranging, and stops on the way out", () => {
    const cancel = vi.fn();
    const animate = vi.fn(() => ({ cancel }) as unknown as Animation);
    Element.prototype.animate = animate;

    const { rerender } = render(<Grid active={false} />);
    expect(animate).not.toHaveBeenCalled();

    rerender(<Grid active still={1} />);
    // A swing and a bob for each of the two panels left free.
    expect(animate).toHaveBeenCalledTimes(4);
    const animated = new Set(animate.mock.contexts.map((element) => (element as HTMLElement).dataset.panelIndex));
    expect([...animated].sort()).toEqual(["0", "2"]);
    // Only rotate and translate: transform belongs to the reorder's FLIP.
    for (const [keyframes] of animate.mock.calls as unknown as Array<[Keyframe[]]>) {
      for (const frame of keyframes) expect(Object.keys(frame).every((key) => key === "rotate" || key === "translate")).toBe(true);
    }

    rerender(<Grid active={false} />);
    expect(cancel).toHaveBeenCalledTimes(4);
  });
});
