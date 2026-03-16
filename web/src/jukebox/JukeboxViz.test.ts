import { beforeEach, describe, expect, it, vi } from "vitest";
import { JukeboxViz } from "./JukeboxViz";

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
    lineWidth: 0,
    fillStyle: "",
    strokeStyle: "",
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
  const canvases: HTMLCanvasElement[] = [];
  let rafId = 0;
  const rafTimers = new Map<number, ReturnType<typeof setTimeout>>();
  (globalThis as any).window = {
    devicePixelRatio: 1,
    requestAnimationFrame: (cb: () => void) => {
      rafId += 1;
      const id = rafId;
      const timer = setTimeout(cb, 0);
      rafTimers.set(id, timer);
      return id;
    },
    cancelAnimationFrame: (id: number) => {
      const timer = rafTimers.get(id);
      if (timer) {
        clearTimeout(timer);
        rafTimers.delete(id);
      }
    },
  };
  (globalThis as any).document = {
    documentElement: {},
    createElement: (tag: string) => {
      if (tag === "canvas") {
        const canvas = createMockCanvas(ctx);
        canvases.push(canvas);
        return canvas;
      }
      return {};
    },
  } as Document;
  (globalThis as any).getComputedStyle = () => ({
    getPropertyValue: () => "",
  });
  return canvases;
}

function createContainer() {
  return {
    append: vi.fn(),
    getBoundingClientRect: () => ({ width: 300, height: 300 }),
  } as unknown as HTMLElement;
}

describe("JukeboxViz", () => {
  let canvases: HTMLCanvasElement[];

  beforeEach(() => {
    canvases = setMockDocument();
  });

  it("tracks available visualization layouts but mounts one active viz", () => {
    const container = createContainer();
    const viz = new JukeboxViz(container);
    expect(viz.getCount()).toBe(6);
    expect(canvases.length).toBe(2);
  });

  it("toggles visibility on the active visualization canvases", () => {
    const container = createContainer();
    const viz = new JukeboxViz(container);
    viz.setVisible(false);
    const inner = viz as unknown as { activeViz: any };
    const first = inner.activeViz;
    const baseCanvas = first.baseCanvas as HTMLCanvasElement;
    const overlayCanvas = first.overlayCanvas as HTMLCanvasElement;
    expect(baseCanvas.style.display).toBe("none");
    expect(overlayCanvas.style.display).toBe("none");
  });

  it("creates a classic positioner", () => {
    const positioner = JukeboxViz.createClassicPositioner();
    const points = positioner(
      {
        beats: [
          { which: 0, start: 0, duration: 1 },
          { which: 1, start: 1, duration: 1 },
          { which: 2, start: 2, duration: 1 },
          { which: 3, start: 3, duration: 1 },
        ],
        edges: [],
      } as any,
      100,
      100
    );
    expect(points.length).toBe(4);
  });

  it("tracks jump line updates", () => {
    const container = createContainer();
    const viz = new JukeboxViz(container);
    const inner = viz as unknown as {
      activeViz: {
        update: (index: number, jumped: boolean, prev: number | null) => void;
        jumpLine: { from: number; to: number; at: number } | null;
      } | null;
    };
    const data = {
      beats: [
        { which: 0, start: 0, duration: 1 },
        { which: 1, start: 1, duration: 1 },
      ],
      edges: [],
    };
    viz.setData(data as any);
    viz.update(1, true, 0);
    const jumpLine = inner.activeViz?.jumpLine;
    expect(jumpLine?.from).toBe(0);
    expect(jumpLine?.to).toBe(1);
  });

  it("stores selected edge", () => {
    const container = createContainer();
    const viz = new JukeboxViz(container);
    const edge = {
      src: { which: 0 },
      dest: { which: 1 },
      deleted: false,
    };
    viz.setSelectedEdge(edge as any);
    const inner = viz as unknown as { selectedEdge: unknown };
    expect(inner.selectedEdge).toBe(edge);
  });

  it("clears selected edge when clicking empty visualization space", () => {
    const container = createContainer();
    const viz = new JukeboxViz(container);
    const edge = {
      id: 7,
      src: { which: 0 },
      dest: { which: 1 },
      deleted: false,
    };
    viz.setData(
      {
        beats: [
          { which: 0, start: 0, duration: 1 },
          { which: 1, start: 1, duration: 1 },
        ],
        edges: [edge],
        lastBranchPoint: 0,
        anchorEdgeId: null,
      } as any
    );
    viz.setSelectedEdge(edge as any);
    const onEdgeSelect = vi.fn();
    viz.setOnEdgeSelect(onEdgeSelect);
    const active = (viz as any).activeViz;

    active.handleCanvasClick({
      clientX: -100,
      clientY: -100,
    } as MouseEvent);

    expect(onEdgeSelect).toHaveBeenCalledWith(null);
  });

  it("swaps visualization instances when active index changes", () => {
    const container = createContainer();
    const viz = new JukeboxViz(container);
    expect(canvases.length).toBe(2);
    const firstBase = canvases[0] as any;
    const firstOverlay = canvases[1] as any;

    viz.setActiveIndex(1);

    expect(firstBase.remove).toHaveBeenCalledTimes(1);
    expect(firstOverlay.remove).toHaveBeenCalledTimes(1);
    expect(canvases.length).toBe(4);
  });

  it("does not remount when active index is unchanged", () => {
    const container = createContainer();
    const viz = new JukeboxViz(container);
    const firstBase = canvases[0] as any;
    const firstOverlay = canvases[1] as any;

    viz.setActiveIndex(0);

    expect(firstBase.remove).not.toHaveBeenCalled();
    expect(firstOverlay.remove).not.toHaveBeenCalled();
    expect(canvases.length).toBe(2);
  });

  it("rehydrates stored state after switching visualizations", () => {
    const container = createContainer();
    const viz = new JukeboxViz(container);
    const edge = {
      id: 7,
      src: { which: 0 },
      dest: { which: 1 },
      deleted: false,
    };
    const data = {
      beats: [
        { which: 0, start: 0, duration: 1 },
        { which: 1, start: 1, duration: 1 },
      ],
      edges: [edge],
      lastBranchPoint: 0,
      anchorEdgeId: 7,
    };

    viz.setVisible(false);
    viz.setAnchorHighlightEnabled(true);
    viz.setSelectedEdge(edge as any);
    viz.setData(data as any);
    viz.update(1, true, 0);
    viz.setActiveIndex(1);

    const inner = viz as unknown as { activeViz: any };
    const active = inner.activeViz;
    expect(active).not.toBeNull();
    expect(active.data).toBe(data);
    expect(active.selectedEdge).toBe(edge);
    expect(active.currentIndex).toBe(1);
    expect(active.anchorHighlightEnabled).toBe(true);
    expect((active.baseCanvas as HTMLCanvasElement).style.display).toBe("none");
    expect((active.overlayCanvas as HTMLCanvasElement).style.display).toBe("none");
  });

  it("ignores invalid visualization indexes", () => {
    const container = createContainer();
    const viz = new JukeboxViz(container);

    viz.setActiveIndex(-1);
    viz.setActiveIndex(99);

    expect(canvases.length).toBe(2);
  });
});
