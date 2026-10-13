/*
 * The sway of a dragged panel (owner, 13 Oct 2026: "a movement to the right
 * and left that gradually stops at the centre, as if forces were at play —
 * the force of the mouse's movement").
 *
 * While a panel is held by its grip it hangs from it, like a card on a
 * string: moving the mouse to the right drags the top along and leaves the
 * bottom behind, so the panel tilts clockwise; moving left tilts it the other
 * way. The faster the mouse, the deeper the lean. It is a movement, not a
 * spring (owner, 13 Oct 2026, replacing the first version's swings): the
 * tilt eases into the lean the motion asks for and, when the mouse slows or
 * stops, eases back straight without ever swinging through the centre.
 * Released, it straightens the same way before the arranging jiggle takes
 * it back.
 *
 * It writes only the panel's `rotate` (pivoting on the top edge, where the
 * grip is): the reorder's FLIP owns `transform` and the jiggle, which leaves
 * the held panel alone, owns `rotate` only on the others. Reduced motion has
 * no sway at all.
 */

export const swayConfig = {
  /** How quickly the tilt follows the motion, and straightens once it stops (s). */
  followSeconds: 0.12,
  /** The pointer speed (px/ms) that drives the tilt to its limit. */
  fullSpeed: 1.2,
  /** How far, in px, the panel's bottom corners may travel at the limit. */
  edgeTravelPx: 22,
  /** Never more than this, however narrow the panel. */
  maxDegrees: 4.5,
  /** How quickly the measured speed follows the pointer (0–1 per event). */
  smoothing: 0.4,
  /** Without a move for this long, the pointer counts as slowing to a stop. */
  idleMs: 45,
  /** How quickly a stopped pointer's speed fades (s). */
  fadeSeconds: 0.06,
  /** At rest below these. */
  restDegrees: 0.03,
  restSpeed: 0.08,
};

/** The largest tilt for a panel this wide: wide panels tilt less, their corners travel the same. */
export function swayLimit(width: number): number {
  if (!(width > 0)) return 0;
  return Math.min(swayConfig.maxDegrees, (Math.atan(swayConfig.edgeTravelPx / (width / 2)) * 180) / Math.PI);
}

/** The tilt a pointer moving at `velocity` px/ms leans the panel to. */
export function swayDrive(velocity: number, limit: number): number {
  const share = Math.max(-1, Math.min(1, velocity / swayConfig.fullSpeed));
  return share * limit;
}

export type SwayState = { angle: number; speed: number };

/*
 * One step of the motion, `dt` in seconds. Not a spring (owner, 13 Oct 2026:
 * "a movement, not a spring"): the tilt eases towards the lean the motion
 * asks for and never past it, so it leans while the panel moves and comes
 * back straight when it stops, without swinging through the centre.
 */
export function stepSway(state: SwayState, drive: number, dt: number): SwayState {
  const follow = 1 - Math.exp(-dt / swayConfig.followSeconds);
  const angle = state.angle + (drive - state.angle) * follow;
  return { angle, speed: dt > 0 ? (angle - state.angle) / dt : 0 };
}

export function swayAtRest(state: SwayState): boolean {
  return Math.abs(state.angle) < swayConfig.restDegrees && Math.abs(state.speed) < swayConfig.restSpeed;
}

/**
 * Runs the sway of one held panel. `move` feeds it the pointer, `release`
 * lets it settle; `onRest` is called once it hangs straight after a release
 * (or at once when cancelled), with its styles already cleared.
 */
export function startSway(element: HTMLElement, clientX: number, onRest: () => void) {
  const limit = swayLimit(element.offsetWidth);
  let state: SwayState = { angle: 0, speed: 0 };
  let velocity = 0;
  let lastX = clientX;
  let lastMoveAt = performance.now();
  let lastFrameAt = lastMoveAt;
  let released = false;
  let frame = 0;
  let done = false;

  element.style.transformOrigin = "50% 0";

  const finish = () => {
    if (done) return;
    done = true;
    cancelAnimationFrame(frame);
    element.style.removeProperty("rotate");
    element.style.removeProperty("transform-origin");
    onRest();
  };

  const tick = (now: number) => {
    // A frame late (a hidden tab, a long task) is not a reason to fly off.
    const dt = Math.min(0.032, Math.max(0, (now - lastFrameAt) / 1000));
    lastFrameAt = now;
    if (now - lastMoveAt > swayConfig.idleMs) velocity *= Math.exp(-dt / swayConfig.fadeSeconds);
    state = stepSway(state, released ? 0 : swayDrive(velocity, limit), dt);
    if (released && Math.abs(velocity) < 0.01 && swayAtRest(state)) {
      finish();
      return;
    }
    element.style.rotate = `${state.angle.toFixed(3)}deg`;
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);

  return {
    move(x: number) {
      const now = performance.now();
      const elapsed = Math.max(1, now - lastMoveAt);
      const instant = (x - lastX) / elapsed;
      velocity += (instant - velocity) * swayConfig.smoothing;
      lastX = x;
      lastMoveAt = now;
    },
    release() {
      released = true;
    },
    cancel: finish,
  };
}

export type Sway = ReturnType<typeof startSway>;
