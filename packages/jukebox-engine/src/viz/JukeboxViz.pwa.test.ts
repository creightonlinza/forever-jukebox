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

  it("mounts only one active visualization at a time", () => {
    const viz = new JukeboxViz(createContainer());
    expect(viz.getCount()).toBe(6);
    expect(canvases.length).toBe(2);
  });

  it("replaces active canvases when the index changes", () => {
    const viz = new JukeboxViz(createContainer());
    const firstBase = canvases[0] as any;
    const firstOverlay = canvases[1] as any;

    viz.setActiveIndex(1);

    expect(firstBase.remove).toHaveBeenCalledTimes(1);
    expect(firstOverlay.remove).toHaveBeenCalledTimes(1);
    expect(canvases.length).toBe(4);
  });

  it("does not remount when setting the same active index", () => {
    const viz = new JukeboxViz(createContainer());
    const firstBase = canvases[0] as any;
    const firstOverlay = canvases[1] as any;

    viz.setActiveIndex(0);

    expect(firstBase.remove).not.toHaveBeenCalled();
    expect(firstOverlay.remove).not.toHaveBeenCalled();
    expect(canvases.length).toBe(2);
  });

  it("rehydrates state when switching visualizations", () => {
    const viz = new JukeboxViz(createContainer());
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

  it("ignores invalid active indexes", () => {
    const viz = new JukeboxViz(createContainer());
    viz.setActiveIndex(-1);
    viz.setActiveIndex(99);
    expect(canvases.length).toBe(2);
  });

  it("clears selected edge when clicking empty visualization space", () => {
    const viz = new JukeboxViz(createContainer());
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

  it("draws user-selected anchor highlight even when anchor highlighting is disabled", () => {
    const viz = new JukeboxViz(createContainer());
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
        anchorEdgeId: 7,
        userAnchorEdgeId: 7,
      } as any
    );
    const active = (viz as any).activeViz;
    const drawEdge = vi.spyOn(active, "drawEdge");

    active.drawBase();

    expect(drawEdge).toHaveBeenCalledWith(
      expect.anything(),
      edge,
      "#ff2d2d",
      1.8,
    );
  });
});
