import { describe, expect, it } from "vitest";

import { makingWayLean } from "./Workspace";

describe("a panel making way", () => {
  it("leans the way it travels: clockwise going right, the other way going left, not at all going straight down", () => {
    // It starts 300px left of its slot: it travels right.
    expect(makingWayLean(-300, 360)).toBeGreaterThan(0);
    expect(makingWayLean(300, 360)).toBeLessThan(0);
    expect(makingWayLean(0, 360)).toBe(0);
  });

  it("leans less when it is wide or barely moves", () => {
    expect(makingWayLean(-300, 1100)).toBeLessThan(makingWayLean(-300, 360));
    expect(makingWayLean(-40, 360)).toBeLessThan(makingWayLean(-300, 360));
    expect(makingWayLean(-300, 100)).toBeLessThanOrEqual(1.6);
  });
});
