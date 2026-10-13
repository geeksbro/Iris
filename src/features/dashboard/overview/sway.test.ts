import { describe, expect, it } from "vitest";

import { stepSway, swayAtRest, swayConfig, swayDrive, swayLimit, type SwayState } from "./sway";

const frame = 1 / 60;

function run(state: SwayState, drive: number, seconds: number) {
  const angles: number[] = [];
  let current = state;
  for (let elapsed = 0; elapsed < seconds; elapsed += frame) {
    current = stepSway(current, drive, frame);
    angles.push(current.angle);
  }
  return { state: current, angles };
}

describe("the lean of a dragged panel", () => {
  it("tilts wide panels less than narrow ones, their corners travelling the same, and never past the cap", () => {
    expect(swayLimit(0)).toBe(0);
    expect(swayLimit(1200)).toBeLessThan(swayLimit(400));
    expect(swayLimit(1200)).toBeCloseTo((Math.atan(swayConfig.edgeTravelPx / 600) * 180) / Math.PI, 6);
    expect(swayLimit(60)).toBe(swayConfig.maxDegrees);
  });

  it("leans with the mouse — right tilts clockwise, left the other way — up to the limit", () => {
    const limit = swayLimit(700);
    const half = swayConfig.fullSpeed / 2;
    expect(swayDrive(half, limit)).toBeCloseTo(limit / 2, 6);
    expect(swayDrive(-half, limit)).toBeCloseTo(-limit / 2, 6);
    expect(swayDrive(50, limit)).toBe(limit);
    expect(swayDrive(-50, limit)).toBe(-limit);
  });

  it("is a movement, not a spring: it eases into the lean without passing it, and back straight without swinging", () => {
    const limit = swayLimit(700);
    const leaning = run({ angle: 0, speed: 0 }, limit, 0.6);
    // Always moving towards the lean, never beyond it.
    leaning.angles.forEach((angle, index) => {
      expect(angle).toBeLessThanOrEqual(limit);
      if (index > 0) expect(angle).toBeGreaterThanOrEqual(leaning.angles[index - 1]);
    });
    expect(leaning.state.angle).toBeGreaterThan(limit * 0.95);

    const straightening = run(leaning.state, 0, 1);
    // Back to the centre from one side only: it never crosses it.
    straightening.angles.forEach((angle, index) => {
      expect(angle).toBeGreaterThanOrEqual(0);
      if (index > 0) expect(angle).toBeLessThanOrEqual(straightening.angles[index - 1]);
    });
    expect(swayAtRest(straightening.state)).toBe(true);
  });
});
