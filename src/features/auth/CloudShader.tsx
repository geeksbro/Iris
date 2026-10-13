"use client";

import { useEffect, useRef } from "react";

/*
 * Aceternity UI "Cloud Shader" (ui.aceternity.com/components/cloud-shader),
 * registry version of 2026-09-13. The GLSL below is theirs, with one addition:
 * u_sun scales their warm sun glow (1 = the original), which a night sky has
 * no place for. The component around it is adapted to this project:
 * - a background layer only: no children, no pointer, hidden from assistive tech;
 * - the sky gradient doubles as the layer's own CSS background, shown before
 *   the first frame and wherever WebGL is unavailable;
 * - under reduced motion one still frame is drawn (and redrawn on resize),
 *   instead of redrawing the same frame on every animation frame;
 * - rendering is capped in resolution and frame rate: the forms are soft and
 *   the drift is slow, so neither cap is visible, and both cut the GPU work;
 * - the WebGL context is released on unmount;
 * - copyCloudFrame() paints the current frame into a cloned canvas, for the
 *   inert copy the lock window leaves behind while it closes (see LoginGate).
 */

export type CloudShaderProps = {
  className?: string;
  /** Animation speed multiplier. 1 = default drift. */
  speed?: number;
  /** Number of clouds (1-6). */
  count?: number;
  /** Cloud tint color (hex or rgb string). */
  cloudColor?: string;
  /** Sky color at the top (hex or rgb string). */
  skyTopColor?: string;
  /** Sky color at the bottom (hex or rgb string). */
  skyBottomColor?: string;
  /** Strength of the warm sun glow, upper right (0-1). 1 = the original. */
  sunGlow?: number;
  /** Holds the sky at its first moment, as reduced motion does (Settings: still sky). */
  still?: boolean;
};

const VERT = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

// Original cloud shader for Aceternity UI.
// Each cloud is an asymmetric envelope (dome top, flat base) filled with
// domain-warped billow noise. A second density sample above the pixel
// approximates self-shadowing. Clouds drift horizontally and wrap around.
const FRAG = `
precision highp float;

varying vec2 v_uv;

uniform vec2 u_res;
uniform float u_time;
uniform float u_count;
uniform vec3 u_cloud;
uniform vec3 u_skyTop;
uniform vec3 u_skyBottom;
uniform float u_sun;

const mat2 R = mat2(0.80, 0.60, -0.60, 0.80);

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(41.31, 289.17))) * 26737.367);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    sum += amp * vnoise(p);
    p = R * p * 2.03 + 19.19;
    amp *= 0.5;
  }
  return sum;
}

// billow noise: sharp puffy ridges, like cauliflower cloud tops
float billow(vec2 p) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 5; i++) {
    sum += amp * (1.0 - abs(2.0 * vnoise(p) - 1.0));
    p = R * p * 2.11 + 13.37;
    amp *= 0.5;
  }
  return sum;
}

// raw density for one cloud at point p
float cloudDensity(vec2 p, vec2 c, vec2 r, float seed, float t) {
  vec2 q = p - c;

  // envelope: dome above the center, flat base below
  float ry = q.y > 0.0 ? r.y : r.y * 0.42;
  float env = 1.0 - length(vec2(q.x / r.x, q.y / ry));
  if (env < -0.35) return 0.0;

  // domain-warped billow detail, moves with the cloud, evolves slowly
  vec2 dp = q * (2.4 / r.x) + seed;
  dp += 0.6 * vec2(
    fbm(dp * 1.4 + t * 0.04),
    fbm(dp * 1.4 + 7.7 - t * 0.03)
  );
  float detail = billow(dp * 1.6);

  return env + (detail - 0.62) * 0.62;
}

// shades one cloud and blends it over the current color
vec3 shadeCloud(vec3 color, vec3 sky, vec2 p, vec2 c, vec2 r, float seed, float t, float dist) {
  float d = cloudDensity(p, c, r, seed, t);
  if (d < 0.02) return color;

  // sample density toward the sun (straight up) for self-shadowing
  float dUp = cloudDensity(p + vec2(0.0, r.y * 0.55), c, r, seed, t);
  float occl = clamp((dUp - d) * 1.1 + d * 0.55, 0.0, 1.0);

  vec3 lit = u_cloud * 1.04;
  vec3 shadow = mix(u_cloud * 0.60, sky, 0.38);
  vec3 cloudCol = mix(lit, shadow, occl * 0.85);

  float alpha = smoothstep(0.02, 0.38, d);

  // silver lining on thin edges
  float rim = smoothstep(0.02, 0.14, d) * (1.0 - smoothstep(0.14, 0.40, d));
  cloudCol += rim * 0.10;

  // atmospheric perspective: far clouds fade into the sky
  cloudCol = mix(cloudCol, sky, dist * 0.35);
  alpha *= mix(1.0, 0.8, dist);

  return mix(color, cloudCol, alpha);
}

// one drifting cloud: horizontal wrap + gentle vertical bob
vec3 cloudPass(vec3 color, vec3 sky, vec2 p, float aspect, float t,
               float spd, float phase, float y, vec2 r, float seed, float dist) {
  float cx = mix(-r.x - 0.25, aspect + r.x + 0.25, fract(t * spd + phase));
  float cy = y + sin(t * 0.05 + phase * 6.2831) * 0.012;
  return shadeCloud(color, sky, p, vec2(cx, cy), r, seed, t, dist);
}

void main() {
  float aspect = u_res.x / u_res.y;
  vec2 p = vec2(v_uv.x * aspect, v_uv.y);
  float t = u_time;

  vec3 sky = mix(u_skyBottom, u_skyTop, v_uv.y);
  vec3 color = sky;

  // faint haze band near the horizon
  color = mix(color, u_skyBottom * 1.06, smoothstep(0.35, 0.0, v_uv.y) * 0.5);

  // soft sun glow, upper area
  vec2 sunPos = vec2(aspect * 0.78, 0.92);
  float sunDist = length(p - sunPos);
  color += vec3(1.0, 0.95, 0.82) * exp(-sunDist * sunDist * 5.0) * 0.28 * u_sun;

  // thin cirrus streaks, stretched horizontally, high in the sky
  float cirrusBand = smoothstep(0.55, 0.8, v_uv.y) * (1.0 - smoothstep(0.9, 1.0, v_uv.y));
  if (cirrusBand > 0.01) {
    float streak = fbm(vec2(p.x * 1.6 - t * 0.006, p.y * 12.0));
    float wisp = smoothstep(0.52, 0.78, streak) * cirrusBand;
    color = mix(color, u_cloud * 0.98, wisp * 0.35);
  }

  // far layer: small, high, slow
  if (u_count > 5.5) {
    color = cloudPass(color, sky, p, aspect, t, 0.006, 0.10, 0.84, vec2(0.20, 0.10), 43.7, 1.0);
  }
  if (u_count > 4.5) {
    color = cloudPass(color, sky, p, aspect, t, 0.008, 0.62, 0.73, vec2(0.24, 0.12), 71.3, 0.85);
  }

  // middle layer
  if (u_count > 3.5) {
    color = cloudPass(color, sky, p, aspect, t, 0.011, 0.33, 0.60, vec2(0.34, 0.16), 17.3, 0.55);
  }
  if (u_count > 2.5) {
    color = cloudPass(color, sky, p, aspect, t, 0.013, 0.80, 0.47, vec2(0.30, 0.15), 29.9, 0.45);
  }

  // near layer: big, low, fast
  if (u_count > 1.5) {
    color = cloudPass(color, sky, p, aspect, t, 0.016, 0.05, 0.35, vec2(0.46, 0.20), 91.1, 0.15);
  }
  color = cloudPass(color, sky, p, aspect, t, 0.020, 0.48, 0.20, vec2(0.56, 0.24), 57.2, 0.0);

  gl_FragColor = vec4(color, 1.0);
}
`;

/** Soft forms: rendering past one device pixel per CSS pixel adds cost, not detail. */
const maxPixelRatio = 1;
/** A slow drift moves well under a pixel between two frames at this rate. */
const frameIntervalMs = 1000 / 30;

function parseHex(color: string): [number, number, number] {
  const value = color.trim();
  if (value.startsWith("#")) {
    const hex = value.slice(1);
    if (hex.length === 3) {
      return [
        parseInt(hex[0] + hex[0], 16) / 255,
        parseInt(hex[1] + hex[1], 16) / 255,
        parseInt(hex[2] + hex[2], 16) / 255,
      ];
    }
    return [
      parseInt(hex.slice(0, 2), 16) / 255,
      parseInt(hex.slice(2, 4), 16) / 255,
      parseInt(hex.slice(4, 6), 16) / 255,
    ];
  }
  const rgb = value.match(/[\d.]+/g);
  if (rgb && rgb.length >= 3) {
    return [Number(rgb[0]) / 255, Number(rgb[1]) / 255, Number(rgb[2]) / 255];
  }
  return [0.95, 0.95, 0.95];
}

function compile(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

// Draws the current frame at once, for copyCloudFrame().
const renderers = new WeakMap<HTMLCanvasElement, () => void>();

/**
 * Paints the frame on screen in `from` into the canvas at the same place in
 * `to`, a clone of it (cloneNode copies a canvas's size, never its pixels).
 * The frame is drawn again first, in the same task: a WebGL buffer is only
 * readable before the browser presents it.
 */
export function copyCloudFrame(from: ParentNode, to: ParentNode) {
  const source = from.querySelector<HTMLCanvasElement>(".cloud-shader__canvas");
  const target = to.querySelector<HTMLCanvasElement>(".cloud-shader__canvas");
  const redraw = source ? renderers.get(source) : undefined;
  const context = source && redraw ? target?.getContext("2d") : null;
  if (!source || !redraw || !context) {
    return;
  }
  redraw();
  context.drawImage(source, 0, 0);
}

export function CloudShader({
  className,
  speed = 1,
  count = 6,
  cloudColor = "#fbf8f2",
  skyTopColor = "#3876ba",
  skyBottomColor = "#8cbfe8",
  sunGlow = 1,
  still = false,
}: CloudShaderProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    // jsdom and browsers without WebGL keep the CSS sky.
    if (!canvas || typeof WebGLRenderingContext === "undefined") return;

    const gl = canvas.getContext("webgl", {
      alpha: false,
      antialias: false,
      premultipliedAlpha: false,
    });
    if (!gl) return;

    const vert = compile(gl, gl.VERTEX_SHADER, VERT);
    const frag = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!vert || !frag) return;

    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vert);
    gl.attachShader(program, frag);
    gl.bindAttribLocation(program, 0, "a_pos");
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const loc = {
      res: gl.getUniformLocation(program, "u_res"),
      time: gl.getUniformLocation(program, "u_time"),
      count: gl.getUniformLocation(program, "u_count"),
      cloud: gl.getUniformLocation(program, "u_cloud"),
      skyTop: gl.getUniformLocation(program, "u_skyTop"),
      skyBottom: gl.getUniformLocation(program, "u_skyBottom"),
      sun: gl.getUniformLocation(program, "u_sun"),
    };

    // The configuration is fixed for the life of the effect.
    const cloud = parseHex(cloudColor);
    const skyTop = parseHex(skyTopColor);
    const skyBottom = parseHex(skyBottomColor);
    gl.uniform1f(loc.count, Math.min(6, Math.max(1, count)));
    gl.uniform3f(loc.cloud, cloud[0], cloud[1], cloud[2]);
    gl.uniform3f(loc.skyTop, skyTop[0], skyTop[1], skyTop[2]);
    gl.uniform3f(loc.skyBottom, skyBottom[0], skyBottom[1], skyBottom[2]);
    gl.uniform1f(loc.sun, Math.min(1, Math.max(0, sunGlow)));

    const motion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    // Reduced motion, or the still sky chosen in Settings: one held frame.
    const held = () => still || Boolean(motion?.matches);
    const start = performance.now();
    let frame = 0;
    let lastDrawAt = -Infinity;

    // A held sky stays at its first moment.
    const render = (now: number) => {
      const elapsed = held() ? 0 : ((now - start) / 1000) * speed;
      gl.uniform1f(loc.time, elapsed);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      lastDrawAt = now;
    };

    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (now - lastDrawAt >= frameIntervalMs - 1) {
        render(now);
      }
    };

    const play = () => {
      cancelAnimationFrame(frame);
      render(performance.now());
      if (!held()) {
        frame = requestAnimationFrame(tick);
      }
    };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, maxPixelRatio);
      const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, w, h);
      gl.uniform2f(loc.res, w, h);
      // Resizing clears the buffer: a held frame must be drawn again.
      render(performance.now());
    };

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    // The first frame is drawn here, before the layer is first painted.
    play();
    motion?.addEventListener?.("change", play);
    renderers.set(canvas, () => render(performance.now()));

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      motion?.removeEventListener?.("change", play);
      renderers.delete(canvas);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vert);
      gl.deleteShader(frag);
      // Released only once the canvas has left the page: a canvas hands back
      // the same context forever, so one lost while still mounted (a Strict
      // Mode rerun) could never draw again.
      window.setTimeout(() => {
        if (!canvas.isConnected) {
          gl.getExtension("WEBGL_lose_context")?.loseContext();
        }
      });
    };
  }, [speed, count, cloudColor, skyTopColor, skyBottomColor, sunGlow, still]);

  return (
    <div
      aria-hidden="true"
      className={["cloud-shader", className].filter(Boolean).join(" ")}
      style={{ background: `linear-gradient(to bottom, ${skyTopColor}, ${skyBottomColor})` }}
    >
      <canvas className="cloud-shader__canvas" ref={canvasRef} />
    </div>
  );
}
