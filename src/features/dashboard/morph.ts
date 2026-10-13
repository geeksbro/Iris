/*
 * Spring dynamics for morphing surfaces.
 *
 * A morph claims that something is still the same thing while its geometry,
 * layer or surroundings change. The claim breaks whenever an interruption
 * resets motion instead of continuing it, so the rule this module exists to
 * enforce is: position and velocity are continuous, targets are disposable.
 *
 *   value(t-) === value(t+)      a new target never moves the value
 *   velocity(t-) === velocity(t+)  a new target never zeroes the velocity
 *
 * Reversing halfway therefore carries the current speed into the return
 * instead of starting again from a standstill, and a resize mid-flight is
 * "recompute the targets", never "cancel and snap".
 */

/** Damping for a stiffness and a damping ratio: zeta 1 is critical. */
export function dampingFor(stiffness: number, ratio: number, mass = 1): number {
  return 2 * ratio * Math.sqrt(stiffness * mass);
}

export type SpringOptions = {
  stiffness?: number;
  ratio?: number;
  mass?: number;
  /** Settled below this distance from the target, in the channel's own units. */
  positionTolerance?: number;
  /** ...and below this speed, in units per second. */
  velocityTolerance?: number;
};

/*
 * One scalar under a damped spring. Geometry channels are measured in pixels,
 * normalised channels (a reveal, an opacity) in units of 1, so tolerances are
 * given per channel rather than shared.
 */
export class SpringValue {
  value: number;
  target: number;
  velocity = 0;
  private readonly stiffness: number;
  private readonly damping: number;
  private readonly mass: number;
  private readonly positionTolerance: number;
  private readonly velocityTolerance: number;

  constructor(value: number, options: SpringOptions = {}) {
    const { stiffness = 170, ratio = 0.9, mass = 1, positionTolerance = 0.4, velocityTolerance = 4 } = options;
    this.value = value;
    this.target = value;
    this.stiffness = stiffness;
    this.mass = mass;
    this.damping = dampingFor(stiffness, ratio, mass);
    this.positionTolerance = positionTolerance;
    this.velocityTolerance = velocityTolerance;
  }

  /** Aim somewhere else. Never touches value or velocity: that is the point. */
  setTarget(target: number) {
    this.target = target;
  }

  /** Place the channel at rest. Only legitimate when it is not already moving. */
  seed(value: number) {
    this.value = value;
    this.target = value;
    this.velocity = 0;
  }

  /*
   * Semi-implicit Euler: velocity first, then position with the new velocity.
   * Explicit Euler (position first) gains energy and wobbles on stiff springs.
   */
  step(dt: number) {
    const acceleration = (-this.stiffness * (this.value - this.target) - this.damping * this.velocity) / this.mass;
    this.velocity += acceleration * dt;
    this.value += this.velocity * dt;
  }

  settled(): boolean {
    return Math.abs(this.value - this.target) < this.positionTolerance && Math.abs(this.velocity) < this.velocityTolerance;
  }

  /** Land exactly, so no sub-pixel residue survives the morph. */
  snap() {
    this.value = this.target;
    this.velocity = 0;
  }
}

/*
 * A set of channels stepped together. Rigid boxes want coherent parameters
 * across x/y/width/height, or the edges arrive at different moments and the
 * box shears; content channels are deliberately softer, so content appears
 * once the space for it exists.
 */
export class SpringGroup<K extends string> {
  readonly channels: Record<K, SpringValue>;

  constructor(channels: Record<K, SpringValue>) {
    this.channels = channels;
  }

  get(key: K): SpringValue {
    return this.channels[key];
  }

  setTargets(targets: Partial<Record<K, number>>) {
    for (const key of Object.keys(targets) as K[]) {
      const next = targets[key];
      if (typeof next === "number") this.channels[key].setTarget(next);
    }
  }

  seed(values: Partial<Record<K, number>>) {
    for (const key of Object.keys(values) as K[]) {
      const next = values[key];
      if (typeof next === "number") this.channels[key].seed(next);
    }
  }

  step(dt: number) {
    for (const key of Object.keys(this.channels) as K[]) this.channels[key].step(dt);
  }

  settled(): boolean {
    return (Object.keys(this.channels) as K[]).every((key) => this.channels[key].settled());
  }

  snap() {
    for (const key of Object.keys(this.channels) as K[]) this.channels[key].snap();
  }

  values(): Record<K, number> {
    const out = {} as Record<K, number>;
    for (const key of Object.keys(this.channels) as K[]) out[key] = this.channels[key].value;
    return out;
  }
}

/** A rectangle in viewport coordinates, as measured or as aimed at. */
export type Rect = { left: number; top: number; width: number; height: number };

/**
 * Whether there is a real region to travel between. Zero-sized boxes (a bar
 * before layout, a hidden trigger) and non-finite numbers are not geometry a
 * morph can be run on: the caller should show the destination instead of
 * animating to it, exactly as it would under reduced motion.
 */
export function morphableRect(rect: Rect | null | undefined): rect is Rect {
  if (!rect) return false;
  return [rect.left, rect.top, rect.width, rect.height].every(Number.isFinite) && rect.width > 0 && rect.height > 0;
}

/**
 * What a border-box adds around its content vertically: borders, and a
 * horizontal scrollbar if one is showing. A height measured from the content
 * is in content-box units, so it has to be carried across this gap before it
 * can be written to a border-box `height` — otherwise the box lands exactly
 * that much too short, and whatever is inside scrolls by a hairline.
 */
export function verticalBoxExtra(node: HTMLElement | null | undefined): number {
  if (!node) return 0;
  return Math.max(0, node.offsetHeight - node.clientHeight);
}

/*
 * FLIP over a set of elements that are about to be laid out differently.
 *
 * The layout is allowed to land wherever it lands; what moves is a transform
 * that puts each element back where it was, and is then played off to
 * nothing. Two rules make it survive being interrupted:
 *
 * · every rect is read before anything is written — one interleaved write
 *   poisons every later read;
 * · a rect is read through whatever transform an unfinished FLIP left
 *   behind, so that element leaves from where it currently *appears*, not
 *   from where the layout thinks it is.
 *
 * `measure` returns the reader; call it, mutate the layout, then call what
 * it returned. Elements present only before or only after are left alone:
 * they have no counterpart, and pretending otherwise is the one thing a
 * morph must not do.
 */
export function measureFlip(elements: Iterable<HTMLElement>) {
  const before = new Map<HTMLElement, DOMRect>();
  for (const element of elements) before.set(element, element.getBoundingClientRect());

  return function play(options: {
    durationMs?: number;
    easing?: string;
    /** Plays something more alongside each mover's slide (it starts at the same moment). */
    alongside?: (move: { element: HTMLElement; dx: number; dy: number; width: number }, timing: { durationMs: number }) => void;
  } = {}) {
    const { durationMs = 420, easing = "cubic-bezier(0.22, 1, 0.36, 1)", alongside } = options;
    const moved: Array<{ element: HTMLElement; dx: number; dy: number; width: number }> = [];

    // Read every new rect first; only then write a single transform each.
    for (const [element, from] of before) {
      if (!element.isConnected) continue;
      const to = element.getBoundingClientRect();
      const dx = from.left - to.left;
      const dy = from.top - to.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
      moved.push({ element, dx, dy, width: to.width });
    }

    for (const move of moved) {
      move.element.animate(
        [{ transform: `translate(${move.dx}px, ${move.dy}px)` }, { transform: "none" }],
        { duration: durationMs, easing, composite: "replace" },
      );
      alongside?.(move, { durationMs });
    }
    return moved.length;
  };
}

/** Longest step the integrator will take: a tab switch must not explode it. */
const maxStep = 1 / 30;
/** Substeps per frame, for accuracy on stiff springs across refresh rates. */
const substeps = 2;

/*
 * A frame loop that stops itself when there is nothing left to move. The
 * callback advances the springs and reports whether the system is at rest;
 * settling is therefore decided every frame from the actual state, never
 * scheduled in advance by a timer that a later intent would invalidate.
 */
export function createTicker(onFrame: (dt: number) => boolean) {
  let frame: number | undefined;
  let last = 0;

  const tick = (now: number) => {
    const elapsed = Math.min((now - last) / 1000, maxStep);
    last = now;
    const dt = elapsed / substeps;
    let done = false;
    for (let i = 0; i < substeps; i += 1) done = onFrame(dt);
    frame = done ? undefined : window.requestAnimationFrame(tick);
  };

  return {
    start() {
      if (frame !== undefined) return;
      last = performance.now();
      frame = window.requestAnimationFrame(tick);
    },
    stop() {
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      frame = undefined;
    },
    get running() {
      return frame !== undefined;
    },
  };
}
