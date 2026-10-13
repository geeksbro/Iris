import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CloudShader, copyCloudFrame } from "./CloudShader";

// jsdom has no WebGL: a stand-in context records what the component asks of
// the GPU, and animation frames run only when a test says so.
function installFakeWebGL() {
  const gl = {
    VERTEX_SHADER: 1,
    FRAGMENT_SHADER: 2,
    ARRAY_BUFFER: 3,
    STATIC_DRAW: 4,
    FLOAT: 5,
    TRIANGLES: 6,
    COMPILE_STATUS: 7,
    LINK_STATUS: 8,
    createShader: vi.fn(() => ({})),
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    getShaderParameter: vi.fn(() => true),
    deleteShader: vi.fn(),
    createProgram: vi.fn(() => ({})),
    attachShader: vi.fn(),
    bindAttribLocation: vi.fn(),
    linkProgram: vi.fn(),
    getProgramParameter: vi.fn(() => true),
    useProgram: vi.fn(),
    deleteProgram: vi.fn(),
    createBuffer: vi.fn(() => ({})),
    bindBuffer: vi.fn(),
    bufferData: vi.fn(),
    deleteBuffer: vi.fn(),
    enableVertexAttribArray: vi.fn(),
    vertexAttribPointer: vi.fn(),
    getUniformLocation: vi.fn((_program: unknown, name: string) => name),
    uniform1f: vi.fn(),
    uniform2f: vi.fn(),
    uniform3f: vi.fn(),
    viewport: vi.fn(),
    drawArrays: vi.fn(),
    loseContext: vi.fn(),
    getExtension: vi.fn(() => ({ loseContext: gl.loseContext })),
  };
  const drawImage = vi.fn();
  vi.stubGlobal("WebGLRenderingContext", function WebGLRenderingContext() {});
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement, type: string) {
    return (type === "webgl" ? gl : { drawImage }) as never;
  });

  let frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 1;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(nextFrame, callback);
    return nextFrame++;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  const runFrames = (count: number, stepMs: number, from = performance.now()) => {
    for (let index = 1; index <= count; index += 1) {
      const pending = frames;
      frames = new Map();
      pending.forEach((callback) => callback(from + index * stepMs));
    }
  };
  const pendingFrames = () => frames.size;
  return { gl, drawImage, runFrames, pendingFrames };
}

function stubReducedMotion(matches: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: matches && query.includes("prefers-reduced-motion: reduce"),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

const timeUniforms = (gl: ReturnType<typeof installFakeWebGL>["gl"]) =>
  gl.uniform1f.mock.calls.filter(([name]) => name === "u_time").map(([, value]) => value as number);

describe("CloudShader", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("is a background only, and keeps its sky where WebGL is missing", () => {
    const { container } = render(<CloudShader className="lock-sky" skyTopColor="#0f1230" skyBottomColor="#232859" />);
    const layer = container.querySelector(".cloud-shader.lock-sky") as HTMLElement;

    expect(layer).toHaveAttribute("aria-hidden", "true");
    expect(layer.style.background).toContain("linear-gradient");
    expect(layer.querySelector("canvas.cloud-shader__canvas")).not.toBeNull();
    expect(layer.children).toHaveLength(1);
  });

  it("draws before its first paint, drifts at a capped rate, and stops for good once unmounted", () => {
    stubReducedMotion(false);
    const { gl, runFrames, pendingFrames } = installFakeWebGL();
    const { unmount } = render(<CloudShader speed={0.3} count={5} sunGlow={0} />);

    // Configured once, with the sun glow off; a frame is already drawn.
    expect(gl.uniform1f).toHaveBeenCalledWith("u_count", 5);
    expect(gl.uniform1f).toHaveBeenCalledWith("u_sun", 0);
    const atMount = gl.drawArrays.mock.calls.length;
    expect(atMount).toBeGreaterThan(0);

    // One second of a 120 Hz display: about 30 frames drawn, not 120.
    runFrames(120, 1000 / 120);
    const drawn = gl.drawArrays.mock.calls.length - atMount;
    expect(drawn).toBeGreaterThanOrEqual(28);
    expect(drawn).toBeLessThanOrEqual(31);
    const times = timeUniforms(gl);
    expect(times.at(-1)).toBeGreaterThan(0);

    unmount();
    expect(pendingFrames()).toBe(0);
    const atUnmount = gl.drawArrays.mock.calls.length;
    runFrames(60, 1000 / 60);
    expect(gl.drawArrays).toHaveBeenCalledTimes(atUnmount);
    expect(gl.deleteProgram).toHaveBeenCalledTimes(1);
    // The context itself goes once the canvas has left the page.
    vi.runAllTimers();
    expect(gl.loseContext).toHaveBeenCalledTimes(1);
  });

  it("holds one still frame under reduced motion", () => {
    stubReducedMotion(true);
    const { gl, runFrames, pendingFrames } = installFakeWebGL();
    render(<CloudShader />);

    expect(pendingFrames()).toBe(0);
    const atMount = gl.drawArrays.mock.calls.length;
    expect(atMount).toBeGreaterThan(0);
    runFrames(60, 1000 / 60);
    expect(gl.drawArrays).toHaveBeenCalledTimes(atMount);
    expect(new Set(timeUniforms(gl))).toEqual(new Set([0]));
  });

  it("holds one still frame when asked to, whatever the motion preference", () => {
    stubReducedMotion(false);
    const { gl, runFrames, pendingFrames } = installFakeWebGL();
    render(<CloudShader still />);

    expect(pendingFrames()).toBe(0);
    const atMount = gl.drawArrays.mock.calls.length;
    expect(atMount).toBeGreaterThan(0);
    runFrames(60, 1000 / 60);
    expect(gl.drawArrays).toHaveBeenCalledTimes(atMount);
    expect(new Set(timeUniforms(gl))).toEqual(new Set([0]));
  });

  it("paints the frame on screen into a cloned canvas", () => {
    stubReducedMotion(false);
    const { gl, drawImage } = installFakeWebGL();
    const { container } = render(<CloudShader />);
    const clone = container.cloneNode(true) as HTMLElement;
    const drawsBefore = gl.drawArrays.mock.calls.length;

    copyCloudFrame(container, clone);

    // Drawn again first, in the same task, then copied.
    expect(gl.drawArrays).toHaveBeenCalledTimes(drawsBefore + 1);
    expect(drawImage).toHaveBeenCalledWith(container.querySelector(".cloud-shader__canvas"), 0, 0);
  });
});
