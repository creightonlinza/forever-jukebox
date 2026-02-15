// Copied from web/src/autocanonizer/AutocanonizerViz.test.ts on 2026-02-12, reason: keep basic autocanonizer viz behavior covered in PWA tests.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AutocanonizerViz } from "./AutocanonizerViz";

function createMockCtx() {
  return {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    lineWidth: 0,
    fillStyle: "",
    strokeStyle: "",
    globalAlpha: 1,
  } as unknown as CanvasRenderingContext2D;
}

function createMockCanvas(ctx: CanvasRenderingContext2D) {
  return {
    style: {},
    width: 0,
    height: 0,
    getContext: vi.fn(() => ctx),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 200 }),
    remove: vi.fn(),
  } as unknown as HTMLCanvasElement;
}

function setMockDocument() {
  const ctx = createMockCtx();
  (globalThis as any).window = {
    devicePixelRatio: 1,
    requestAnimationFrame: (cb: () => void) => {
      cb();
      return 1;
    },
  };
  (globalThis as any).document = {
    documentElement: {},
    createElement: (tag: string) => {
      if (tag === "canvas") {
        return createMockCanvas(ctx);
      }
      return {};
    },
  } as Document;
}

function createContainer() {
  return {
    append: vi.fn(),
    getBoundingClientRect: () => ({ width: 300, height: 300 }),
  } as unknown as HTMLElement;
}

describe("AutocanonizerViz", () => {
  beforeEach(() => {
    setMockDocument();
  });

  it("toggles visibility", () => {
    const container = createContainer();
    const viz = new AutocanonizerViz(container);
    viz.setVisible(false);
    const inner = viz as unknown as { baseCanvas: HTMLCanvasElement; overlayCanvas: HTMLCanvasElement };
    expect(inner.baseCanvas.style.display).toBe("none");
    expect(inner.overlayCanvas.style.display).toBe("none");
  });

  it("accepts layout updates", () => {
    const container = createContainer();
    const viz = new AutocanonizerViz(container);
    const beatA = {
      which: 0,
      start: 0,
      duration: 1,
      volume: 0.5,
      median_volume: 0.5,
      color: "#fff",
      section: 0,
    } as any;
    const beatB = {
      which: 1,
      start: 1,
      duration: 1,
      volume: 0.5,
      median_volume: 0.5,
      color: "#fff",
      section: 1,
    } as any;
    beatA.other = beatB;
    beatA.otherGain = 1;
    beatB.other = beatA;
    beatB.otherGain = 1;
    viz.setData(
      [beatA, beatB],
      2,
      [
        { start: 0, duration: 1 },
        { start: 1, duration: 1 },
      ]
    );
    const inner = viz as unknown as { beats: unknown[] };
    expect(inner.beats.length).toBe(2);
  });

  it("tracks current index updates", () => {
    const container = createContainer();
    const viz = new AutocanonizerViz(container);
    const beat = {
      which: 0,
      start: 0,
      duration: 1,
      volume: 0.5,
      median_volume: 0.5,
      color: "#fff",
      section: 0,
    } as any;
    beat.other = beat;
    beat.otherGain = 1;
    viz.setData([beat], 1, [{ start: 0, duration: 1 }]);
    viz.setCurrentIndex(0, false);
    const inner = viz as unknown as { currentIndex: number };
    expect(inner.currentIndex).toBe(0);
  });
});
