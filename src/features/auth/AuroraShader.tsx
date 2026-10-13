"use client";

import { useEffect, useRef } from "react";

/*
 * THE AURORA (owner, 10 Oct 2026): the lock screen's own ground, astral and
 * abstract, in IRIS's violets. Built on the Trading OS lock ground (one
 * fragment shader, no library) with its own scene:
 *   - a deep indigo night (a pale lavender dawn on the light theme);
 *   - a soft nebula breathing in two opposite corners;
 *   - three silk ribbons of violet and blue light flowing left to right,
 *     faint rays rising from their crests like an aurora's curtain;
 *   - the Trading OS wave of points, in lilac, across the middle;
 *   - a few loose motes drifting up. No starfield: the owner removed the
 *     stars from an earlier hero atmosphere (26 Sep 2026).
 * The centre stays calm, where the PIN card sits; the light is at the edges.
 *
 * Quiet on purpose: drawn at the screen's size in CSS pixels, slow, on a clock
 * that starts at a random moment so it has no rhythm; it stops while the tab
 * is hidden, and under reduced motion (or `still`) it is one still frame. The
 * clouds stay available beside it (Settings → lock screen background). If
 * WebGL is not there, nothing is drawn and the CSS gradient under it stays.
 */

const VERTEX = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAGMENT = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 uRes;
uniform float uTime;
uniform float uDark;

const vec3 VIOLET = vec3(0.486, 0.455, 0.949);
const vec3 LILAC = vec3(0.72, 0.68, 1.0);
const vec3 BLUE = vec3(0.31, 0.50, 1.0);
const vec3 DEEP = vec3(0.32, 0.20, 0.78);

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) {
    v += a * noise(p);
    p = p * 2.02 + vec2(1.3, 7.1);
    a *= 0.5;
  }
  return v;
}

// Light added to the scene: summed on the night, laid over on the dawn.
vec3 lit(vec3 col, vec3 c, float k) {
  vec3 dark = col + c * k;
  vec3 pale = mix(col, c * 0.9, clamp(k * 0.55, 0.0, 1.0));
  return mix(pale, dark, uDark);
}

// One silk ribbon: a bright thin edge, a soft body, and rays above its crest.
vec3 ribbon(vec3 col, vec2 p, vec2 uv, float t, float y0, float amp, float freq,
            float pace, float width, vec3 c, float k, float calm) {
  float s = p.x - t * pace;
  float yc = y0
    + amp * sin(s * freq + t * 0.05)
    + 0.6 * amp * sin(s * freq * 2.3 - t * 0.04 + 1.7)
    + 0.09 * (fbm(vec2(s * 0.9, t * 0.02 + y0 * 9.0)) - 0.45);
  float d = uv.y - yc;
  float edge = exp(-abs(d) / (width * 0.09));
  float body = exp(-(d * d) / (width * width));
  float rays = d > 0.0
    ? exp(-d / (width * 2.8)) * (0.45 + 0.55 * sin(s * 58.0 + fbm(vec2(s * 7.0, t * 0.08)) * 6.0))
    : 0.0;
  return lit(col, c, (edge * 0.75 + body * 0.32 + rays * 0.16) * k * calm);
}

// The wave of points (the Trading OS lock ground's): rows of dots on a curve,
// curve and dots sliding together, left to right.
vec3 wave(vec3 col, vec2 frag, vec2 uv, float x, float t, float phase, float amp, float calm) {
  float s = x - t * 0.02;
  float yc = 0.50 + 0.05 * sin(s * 3.1 + t * 0.05 + phase)
               + 0.03 * sin(s * 7.3 - t * 0.08 + 1.3 + phase)
               + 0.02 * sin(s * 1.3 + t * 0.03);
  float thick = (0.05 + 0.028 * sin(s * 2.0 + t * 0.04 + 2.0 + phase)) * uRes.y;
  float v = frag.y - yc * uRes.y;
  float sp = 7.0;
  vec2 cell = vec2(frag.x - t * 0.02 * uRes.y, v) / sp;
  vec2 id = floor(cell);
  vec2 f = (fract(cell) - 0.5) * sp;
  float band = exp(-(v * v) / (thick * thick));
  float rad = 0.45 + 0.95 * band;
  float dotm = 1.0 - smoothstep(rad - 0.55, rad + 0.55, length(f));
  float tw = 0.55 + 0.45 * sin(hash(id) * 6.2832 + t * 0.9);
  float along = (0.3 + 0.7 * smoothstep(0.05, 0.55, uv.x)) * (1.0 - 0.35 * smoothstep(0.85, 1.0, uv.x));
  float line = (exp(-abs(v) / 2.2) * 0.28 + exp(-abs(v) / 20.0) * 0.09) * along;
  return lit(col, LILAC, (dotm * band * tw * along * 1.4 + line) * amp * calm);
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 uv = frag / uRes;
  float asp = uRes.x / uRes.y;
  vec2 p = vec2(uv.x * asp, uv.y);
  float t = uTime;

  vec3 col = mix(
    mix(vec3(0.925, 0.928, 0.972), vec3(0.962, 0.962, 0.988), uv.y),
    mix(vec3(0.018, 0.022, 0.058), vec3(0.040, 0.044, 0.105), uv.y),
    uDark);

  // The calm centre: the light thins out behind the card.
  vec2 fromCentre = (uv - vec2(0.5, 0.5)) * vec2(1.5, 1.15);
  float calm = 1.0 - 0.55 * exp(-dot(fromCentre, fromCentre) / 0.07);

  // The nebula, in two opposite corners.
  float neb = fbm(p * 1.6 + vec2(t * 0.010, -t * 0.006));
  float corners = exp(-length((p - vec2(0.12, 0.88)) * vec2(1.0, 1.3)) / 0.42)
                + exp(-length((p - vec2(asp - 0.1, 0.14)) * vec2(1.0, 1.2)) / 0.38);
  col = lit(col, DEEP, smoothstep(0.32, 0.82, neb) * corners * 0.6);
  col = lit(col, BLUE, smoothstep(0.5, 0.9, neb) * corners * 0.22);

  // The ribbons: the far one first, the bright violet one last.
  col = ribbon(col, p, uv, t, 0.74, 0.05, 2.7, 0.010, 0.035, LILAC, 0.42, calm);
  col = ribbon(col, p, uv, t, 0.36, 0.06, 2.1, 0.022, 0.050, BLUE, 0.55, calm);
  col = wave(col, frag, uv, p.x, t, 0.0, 0.9, calm);
  col = wave(col, frag, uv, p.x, t, 2.4, 0.4, calm);
  col = ribbon(col, p, uv, t, 0.62, 0.07, 1.6, 0.015, 0.060, VIOLET, 0.85, calm);

  // Loose motes, drifting up.
  float cs = 96.0;
  vec2 drift = vec2(t * 1.5, -t * 4.0);
  vec2 sc = (frag + drift) / cs;
  vec2 sid = floor(sc);
  float pick = hash(sid + 3.1);
  // Few and faint, so they read as dust in the light, not as a starfield.
  if (pick > 0.94) {
    vec2 at = (sid + 0.2 + 0.6 * vec2(hash(sid + 1.3), hash(sid + 7.1))) * cs - drift;
    float d = length(frag - at);
    float size = 0.9 + 1.0 * hash(sid + 5.7);
    float flick = 0.6 + 0.4 * sin(t * 1.3 + pick * 40.0);
    float mote = (1.0 - smoothstep(size - 0.8, size + 0.8, d)) + exp(-d / 5.0) * 0.25;
    col = lit(col, LILAC, mote * flick * 0.4);
  }

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

// The pace of the whole scene.
const SPEED = 2.5;

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
}

export function AuroraShader({ className, still = false }: { className?: string; still?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: false });
    if (!gl) return;

    const vs = compile(gl, gl.VERTEX_SHADER, VERTEX);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
    const program = gl.createProgram();
    if (!vs || !fs || !program) return;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(program, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(program, "uRes");
    const uTime = gl.getUniformLocation(program, "uTime");
    const uDark = gl.getUniformLocation(program, "uDark");

    // Drawn at the screen's full size in CSS pixels: a stretched canvas would
    // soften the points.
    const resize = () => {
      const width = Math.max(1, Math.round(window.innerWidth));
      const height = Math.max(1, Math.round(window.innerHeight));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      gl.viewport(0, 0, width, height);
      gl.uniform2f(uRes, width, height);
    };

    // A clock that starts anywhere: no two openings of the screen look alike.
    const origin = performance.now() - Math.random() * 600_000;
    const draw = (now: number) => {
      gl.uniform1f(uDark, document.documentElement.dataset.theme === "dark" ? 1 : 0);
      gl.uniform1f(uTime, ((now - origin) / 1000) * SPEED);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };

    resize();
    canvas.parentElement?.setAttribute("data-aurora", "");

    let frame = 0;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      draw(now);
    };
    const quiet = still || Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
    const start = () => {
      if (!frame && !quiet && document.visibilityState === "visible") frame = requestAnimationFrame(tick);
    };
    const stop = () => {
      cancelAnimationFrame(frame);
      frame = 0;
    };

    draw(performance.now());
    start();

    const onVisibility = () => (document.visibilityState === "visible" ? start() : stop());
    const onResize = () => {
      resize();
      draw(performance.now());
    };
    // A theme switch repaints at once, even when the scene is still.
    const themeWatch = new MutationObserver(() => draw(performance.now()));
    themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("resize", onResize);
    return () => {
      stop();
      themeWatch.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("resize", onResize);
      canvas.parentElement?.removeAttribute("data-aurora");
      // Free what this run made, but keep the context: Strict Mode runs the
      // effect again on the same canvas, and a context lost on purpose never
      // comes back.
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    };
  }, [still]);

  return <canvas aria-hidden="true" className={className ? `aurora-shader ${className}` : "aurora-shader"} ref={canvasRef} />;
}
