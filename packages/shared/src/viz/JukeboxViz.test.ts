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
  (globalThis as any).window = {
    devicePixelRatio: 1,
    setTimeout: (cb: () => void, ms: number) => setTimeout(cb, ms),
    clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
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

  describe("beat tiles", () => {
    const CLASSIC_INDEX = 1;

    function mountClassic(beatVisits: number[]) {
      const viz = new JukeboxViz(createContainer());
      viz.setActiveIndex(CLASSIC_INDEX);
      viz.setData({
        beats: beatVisits.map((_, which) => ({
          which,
          start: which,
          duration: 1,
          neighbors: [],
        })),
        beatVisits,
        beatColors: beatVisits.map(() => "#123456"),
        edges: [],
      } as any);
      const ctx = canvases[0].getContext("2d") as unknown as {
        stroke: ReturnType<typeof vi.fn>;
        clearRect: ReturnType<typeof vi.fn>;
      };
      ctx.stroke.mockClear();
      ctx.clearRect.mockClear();
      return { viz, ctx };
    }

    it("draws unplayed beats as fixed dots instead of beat dots", () => {
      const { ctx } = mountClassic(new Array<number>(1024).fill(0));
      const mock = ctx as unknown as {
        arc: ReturnType<typeof vi.fn>;
        moveTo: ReturnType<typeof vi.fn>;
        lineTo: ReturnType<typeof vi.fn>;
        lineWidth: number;
      };
      expect(mock.arc).not.toHaveBeenCalled();
      const [startX, startY] = mock.moveTo.mock.calls.at(-1) as [number, number];
      const [endX, endY] = mock.lineTo.mock.calls.at(-1) as [number, number];
      const cap = mock.lineWidth / 2;
      expect(Math.hypot(startX - 150, startY - 150) - cap).toBeCloseTo(118);
      expect(Math.hypot(endX - 150, endY - 150) + cap).toBeCloseTo(122);
    });

    it("keeps unplayed tiles drawable and centered when wider than a dot", () => {
      const { ctx } = mountClassic(new Array<number>(64).fill(0));
      const mock = ctx as unknown as {
        moveTo: ReturnType<typeof vi.fn>;
        lineTo: ReturnType<typeof vi.fn>;
      };
      const [startX, startY] = mock.moveTo.mock.calls.at(-1) as [number, number];
      const [endX, endY] = mock.lineTo.mock.calls.at(-1) as [number, number];
      expect(Math.hypot(startX - 150, startY - 150)).toBeCloseTo(120);
      expect(Math.hypot(endX - startX, endY - startY)).toBeGreaterThan(0);
    });

    it("caps tile width on very short tracks", () => {
      const { ctx } = mountClassic(new Array<number>(10).fill(0));
      const { lineWidth } = ctx as unknown as { lineWidth: number };
      expect(lineWidth).toBeCloseTo(9);
    });

    it("throws when the tile canvas has no context", () => {
      const viz = new JukeboxViz(createContainer());
      const createElement = document.createElement.bind(document);
      let created = 0;
      (document as any).createElement = (tag: string) => {
        const element = createElement(tag) as HTMLCanvasElement;
        created += 1;
        if (created === 3) {
          element.getContext = vi.fn(() => null) as any;
        }
        return element;
      };
      expect(() => viz.setActiveIndex(CLASSIC_INDEX)).toThrow("Canvas not supported");
    });

    it("adds a tile canvas only to the classic layout", () => {
      const viz = new JukeboxViz(createContainer());
      expect(canvases.length).toBe(2);
      viz.setActiveIndex(CLASSIC_INDEX);
      expect(canvases.length).toBe(5);
    });

    it("repaints only the changed tile while the scale is unchanged", () => {
      const beatVisits = [2, 0, 0, 0];
      const { viz, ctx } = mountClassic(beatVisits);
      beatVisits[1] = 1;
      viz.update(1, false, null);
      // The changed tile, then the overlay's current tile.
      expect(ctx.stroke).toHaveBeenCalledTimes(2);
      // The overlay clear only.
      expect(ctx.clearRect).toHaveBeenCalledTimes(1);
    });

    it("repaints every tile when the scale halves", () => {
      const beatVisits = [8, 1, 0, 0];
      const { viz, ctx } = mountClassic(beatVisits);
      beatVisits[0] = 9;
      viz.update(0, false, null);
      // All four tiles, then the overlay's current tile.
      expect(ctx.stroke).toHaveBeenCalledTimes(5);
      expect(ctx.clearRect).toHaveBeenCalledTimes(2);
    });

    it("grows tiles per play and halves them at the threshold", () => {
      const beatVisits = [8, 2, 0, 0];
      const { viz } = mountClassic(beatVisits);
      const active = (viz as any).activeViz;
      const levels = () => [active.tileLevel(0), active.tileLevel(1)];

      expect(levels()).toEqual([1, 6 / 12]);

      beatVisits[0] = 9;
      viz.update(0, false, null);
      expect(levels()).toEqual([6.5 / 12, 3 / 12]);

      beatVisits[0] = 20;
      viz.update(0, false, null);
      expect(levels()).toEqual([1, 3 / 12]);

      beatVisits[0] = 21;
      viz.update(0, false, null);
      expect(levels()).toEqual([6.25 / 12, 1.5 / 12]);

      beatVisits.fill(0);
      viz.reset();
      expect(levels()).toEqual([0, 0]);
    });

    it("colors tiles by beat, and keeps markers in the theme color", () => {
      const beatVisits = [8, 0];
      const viz = new JukeboxViz(createContainer());
      viz.setActiveIndex(CLASSIC_INDEX);
      const ctx = canvases[0].getContext("2d") as unknown as {
        stroke: ReturnType<typeof vi.fn>;
        strokeStyle: string;
      };
      const styles: string[] = [];
      ctx.stroke.mockImplementation(() => {
        styles.push(ctx.strokeStyle);
      });
      viz.setData({
        beats: beatVisits.map((_, which) => ({ which, start: which, duration: 1 })),
        beatVisits,
        beatColors: ["#112233", "#445566"],
        edges: [],
      } as any);
      expect(styles.slice(0, 2)).toEqual(["#112233", "#445566"]);

      viz.update(0, true, null);
      expect(styles.at(-1)).toBe("#ffd46a");
    });

    it("skips drawing when nothing changed", () => {
      const beatVisits = [1, 0, 0, 0];
      const { viz, ctx } = mountClassic(beatVisits);
      viz.update(0, false, null);
      ctx.stroke.mockClear();
      ctx.clearRect.mockClear();
      viz.update(0, false, null);
      expect(ctx.stroke).not.toHaveBeenCalled();
      expect(ctx.clearRect).not.toHaveBeenCalled();
    });

    it("clears tiles on reset", () => {
      const beatVisits = [3, 1, 0, 0];
      const { viz, ctx } = mountClassic(beatVisits);
      beatVisits.fill(0);
      viz.reset();
      // Erases the two played tiles and paints them back as dots.
      expect(ctx.stroke).toHaveBeenCalledTimes(4);
    });

    it("marks the current beat with a tile instead of the cursor dot", () => {
      const { viz, ctx } = mountClassic([1, 0, 0, 0]);
      const arc = (ctx as unknown as { arc: ReturnType<typeof vi.fn> }).arc;
      arc.mockClear();
      viz.update(0, true, null);
      expect(arc).not.toHaveBeenCalled();
      expect(ctx.stroke).toHaveBeenCalledTimes(1);
    });

    it("draws tiles with round caps from the beat dot to their height", () => {
      const beatVisits = new Array<number>(256).fill(0);
      beatVisits[0] = 1;
      const { viz, ctx } = mountClassic(beatVisits);
      const mock = ctx as unknown as {
        moveTo: ReturnType<typeof vi.fn>;
        lineTo: ReturnType<typeof vi.fn>;
        lineCap: string;
        lineWidth: number;
      };
      let strokeCap = "";
      ctx.stroke.mockImplementation(() => {
        strokeCap = mock.lineCap;
      });
      viz.update(0, true, null);
      expect(strokeCap).toBe("round");
      expect(mock.lineCap).toBe("butt");
      const [x, y] = mock.lineTo.mock.calls.at(-1) as [number, number];
      expect(Math.hypot(x - 150, y - 150)).toBeLessThan(150);
      // The inner cap reaches the far side of the 2px beat dot on the 120 ring.
      const [startX, startY] = mock.moveTo.mock.calls.at(-1) as [number, number];
      const innerTip = Math.hypot(startX - 150, startY - 150) - mock.lineWidth / 2;
      expect(innerTip).toBeCloseTo(118);
    });

    describe("markers", () => {
      function mountMarkers(firstBeatVisits: number) {
        const beatVisits = new Array<number>(64).fill(0);
        beatVisits[0] = firstBeatVisits;
        const { viz, ctx } = mountClassic(beatVisits);
        const lineTo = (ctx as unknown as { lineTo: ReturnType<typeof vi.fn> }).lineTo;
        const markerEnd = () => {
          const [x, y] = lineTo.mock.calls.at(-1) as [number, number];
          return Math.hypot(x - 150, y - 150);
        };
        return { viz, markerEnd };
      }

      it("draws current and hovered markers at a fixed length", () => {
        const { viz, markerEnd } = mountMarkers(2);
        viz.update(0, true, null);
        const played = markerEnd();
        viz.update(2, true, null);
        const unplayed = markerEnd();
        viz.update(-1, false, null);
        (viz as any).activeViz.handlePointerMove({
          pointerType: "mouse",
          clientX: 290,
          clientY: 150,
        });
        const hovered = markerEnd();

        expect(played).toBeGreaterThan(140);
        expect(played).toBeLessThan(150);
        expect(unplayed).toBeCloseTo(played);
        expect(hovered).toBeCloseTo(played);
      });

      it("lets a played tile reach the marker's length but not pass it", () => {
        const { viz, ctx } = mountClassic(new Array<number>(64).fill(8));
        const lineTo = (ctx as unknown as { lineTo: ReturnType<typeof vi.fn> }).lineTo;
        const end = () => {
          const [x, y] = lineTo.mock.calls.at(-1) as [number, number];
          return Math.hypot(x - 150, y - 150);
        };
        const fullTile = end();
        viz.update(0, true, null);
        expect(end()).toBeCloseTo(fullTile);
      });
    });

    it("highlights the hovered beat's remaining branches and clears hover on new data", () => {
      const { viz } = mountClassic([1, 0, 0, 0]);
      const active = (viz as any).activeViz;
      const beats = active.data.beats;
      const kept = { src: beats[1], dest: beats[3], deleted: false };
      const deleted = { src: beats[1], dest: beats[2], deleted: true };
      beats[1].neighbors = [kept, deleted];
      const drawEdge = vi.spyOn(active, "drawEdge");

      active.handlePointerMove({ pointerType: "mouse", clientX: 290, clientY: 150 });

      expect(drawEdge).toHaveBeenCalledTimes(1);
      expect(drawEdge.mock.calls[0][1]).toBe(kept);

      viz.setData(active.data);
      expect(active.hoveredBeat).toBeNull();
      expect(active.overlayCanvas.style.cursor).toBe("");
    });

    it("selects the beat under a clicked tile, including unplayed ones", () => {
      const { viz } = mountClassic([1, 0, 0, 0]);
      const onSelect = vi.fn();
      viz.setOnSelect(onSelect);
      const active = (viz as any).activeViz;
      // Container is 300x300, so the band runs from the ring at 120 out to the edge.
      active.handleCanvasClick({ clientX: 290, clientY: 150 });
      expect(onSelect).toHaveBeenLastCalledWith(1);
      active.handleCanvasClick({ clientX: 150, clientY: 10 });
      expect(onSelect).toHaveBeenLastCalledWith(0);
      onSelect.mockClear();
      active.handleCanvasClick({ clientX: 150, clientY: 150 });
      expect(onSelect).not.toHaveBeenCalled();
    });

    it("highlights the hovered tile for mouse pointers only", () => {
      const { viz, ctx } = mountClassic([1, 0, 0, 0]);
      const active = (viz as any).activeViz;
      const overlay = active.overlayCanvas as HTMLCanvasElement;
      active.handlePointerMove({ pointerType: "touch", clientX: 290, clientY: 150 });
      expect(ctx.stroke).not.toHaveBeenCalled();

      active.handlePointerMove({ pointerType: "mouse", clientX: 290, clientY: 150 });
      expect(ctx.stroke).toHaveBeenCalledTimes(1);
      expect(overlay.style.cursor).toBe("pointer");

      active.handlePointerMove({ pointerType: "mouse", clientX: 291, clientY: 150 });
      expect(ctx.stroke).toHaveBeenCalledTimes(1);

      active.handlePointerLeave();
      expect(overlay.style.cursor).toBe("");
      expect(active.hoveredBeat).toBeNull();
    });
  });

  describe("beat hover on layouts without tiles", () => {
    function mountLayout() {
      const viz = new JukeboxViz(createContainer(), {
        positioners: [
          () => [
            { x: 50, y: 50 },
            { x: 250, y: 50 },
            { x: 150, y: 250 },
          ],
        ],
      });
      const beats = [0, 1, 2].map((which) => ({
        which,
        start: which,
        duration: 1,
        neighbors: [] as unknown[],
      }));
      const kept = { src: beats[0], dest: beats[1], deleted: false };
      const deleted = { src: beats[0], dest: beats[2], deleted: true };
      beats[0].neighbors = [kept, deleted];
      const data = { beats, beatVisits: [0, 0, 0], beatColors: [], edges: [kept] };
      viz.setData(data as any);
      const active = (viz as any).activeViz;
      const ctx = canvases[0].getContext("2d") as unknown as {
        arc: ReturnType<typeof vi.fn>;
        fillStyle: string;
      };
      ctx.arc.mockClear();
      return { viz, active, ctx, kept, data };
    }

    it("shows a translucent cursor dot, branches and pointer on a nearby beat", () => {
      const { active, ctx, kept } = mountLayout();
      const drawEdge = vi.spyOn(active, "drawEdge");

      active.handlePointerMove({ pointerType: "mouse", clientX: 55, clientY: 53 });

      expect(ctx.arc).toHaveBeenCalledTimes(1);
      expect(ctx.arc.mock.calls[0].slice(0, 3)).toEqual([50, 50, 10]);
      expect(ctx.fillStyle).toBe("rgba(255, 212, 106, 0.6)");
      expect(drawEdge).toHaveBeenCalledTimes(1);
      expect(drawEdge.mock.calls[0][1]).toBe(kept);
      expect(active.overlayCanvas.style.cursor).toBe("pointer");
    });

    it("clears on resize, hiding and touch", () => {
      const { viz, active } = mountLayout();
      const hover = () =>
        active.handlePointerMove({ pointerType: "mouse", clientX: 50, clientY: 50 });

      hover();
      active.container.getBoundingClientRect = () => ({ width: 200, height: 200 });
      viz.resizeNow();
      expect(active.hoveredBeat).toBeNull();
      expect(active.overlayCanvas.style.cursor).toBe("");

      hover();
      viz.setVisible(false);
      expect(active.hoveredBeat).toBeNull();
      viz.setVisible(true);

      hover();
      active.handlePointerMove({ pointerType: "touch", clientX: 50, clientY: 50 });
      expect(active.hoveredBeat).toBeNull();
    });

    it("clears on moving away, leaving and new data", () => {
      const { viz, active, data } = mountLayout();
      const hover = () =>
        active.handlePointerMove({ pointerType: "mouse", clientX: 50, clientY: 50 });

      hover();
      expect(active.hoveredBeat).toBe(0);
      active.handlePointerMove({ pointerType: "mouse", clientX: 150, clientY: 150 });
      expect(active.hoveredBeat).toBeNull();
      expect(active.overlayCanvas.style.cursor).toBe("");

      hover();
      active.handlePointerLeave();
      expect(active.hoveredBeat).toBeNull();

      hover();
      viz.setData(data as any);
      expect(active.hoveredBeat).toBeNull();
    });

    it("ignores touch pointers", () => {
      const { active, ctx } = mountLayout();
      active.handlePointerMove({ pointerType: "touch", clientX: 50, clientY: 50 });
      expect(active.hoveredBeat).toBeNull();
      expect(ctx.arc).not.toHaveBeenCalled();
    });

    it("selects the hovered beat on click and otherwise falls through to edges", () => {
      const { viz, active, kept } = mountLayout();
      const onSelect = vi.fn();
      const onEdgeSelect = vi.fn();
      viz.setOnSelect(onSelect);
      viz.setOnEdgeSelect(onEdgeSelect);

      active.handleCanvasClick({ clientX: 55, clientY: 53 });
      expect(onSelect).toHaveBeenCalledWith(0);
      expect(onEdgeSelect).not.toHaveBeenCalled();

      onSelect.mockClear();
      active.handleCanvasClick({ clientX: 150, clientY: 52 });
      expect(onSelect).not.toHaveBeenCalled();
      expect(onEdgeSelect).toHaveBeenCalledWith(kept);
    });
  });

  describe("layout switching cost", () => {
    function mountWithEdge() {
      const viz = new JukeboxViz(createContainer());
      const beats = [0, 1].map((which) => ({
        which,
        start: which,
        duration: 1,
        neighbors: [] as unknown[],
      }));
      const edge = { src: beats[0], dest: beats[1], deleted: false, id: 1 };
      viz.setData({
        beats,
        beatVisits: [0, 0],
        beatColors: ["#111111", "#222222"],
        edges: [edge],
      } as any);
      const ctx = canvases[0].getContext("2d") as unknown as {
        stroke: ReturnType<typeof vi.fn>;
      };
      ctx.stroke.mockClear();
      return { viz, ctx };
    }

    it("draws the new layout's edges once across a full switch", () => {
      const { viz, ctx } = mountWithEdge();
      const GALAXY_INDEX = 2;
      const widthSets = () => canvases.slice(2).map((canvas) => canvas.width);

      viz.setActiveIndex(GALAXY_INDEX);
      viz.setVisible(true);
      viz.resizeNow();
      viz.setActiveIndex(GALAXY_INDEX);
      viz.setAnchorHighlightEnabled(false);

      expect(ctx.stroke).toHaveBeenCalledTimes(1);
      expect(widthSets()).toEqual([300, 300]);
    });

    it("releases the previous layout's canvas bitmaps", () => {
      const { viz } = mountWithEdge();
      const [firstBase, firstOverlay] = canvases;
      expect(firstBase.width).toBe(300);

      viz.setActiveIndex(1);

      expect(firstBase.width).toBe(0);
      expect(firstBase.height).toBe(0);
      expect(firstOverlay.width).toBe(0);
    });

    it("still redraws when the size really changes", () => {
      const { viz, ctx } = mountWithEdge();
      const active = (viz as any).activeViz;
      active.container.getBoundingClientRect = () => ({ width: 200, height: 200 });
      viz.resizeNow();
      expect(ctx.stroke).toHaveBeenCalledTimes(1);
      expect(canvases[0].width).toBe(200);
    });

    it("redraws when shown again after being hidden", () => {
      const { viz, ctx } = mountWithEdge();
      viz.setVisible(false);
      viz.setVisible(true);
      expect(ctx.stroke).toHaveBeenCalledTimes(1);
    });
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

  it("draws user-selected anchor highlight even when anchor highlighting is disabled", () => {
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

  it("does not draw an anchor highlight for a deleted anchor edge", () => {
    const container = createContainer();
    const viz = new JukeboxViz(container);
    const edge = {
      id: 7,
      src: { which: 0 },
      dest: { which: 1 },
      deleted: true,
    };
    viz.setAnchorHighlightEnabled(true);
    viz.setData(
      {
        beats: [
          { which: 0, start: 0, duration: 1 },
          { which: 1, start: 1, duration: 1 },
        ],
        edges: [edge],
        lastBranchPoint: 0,
        anchorEdgeId: 7,
        userAnchorEdgeId: null,
      } as any
    );
    const active = (viz as any).activeViz;
    const drawEdge = vi.spyOn(active, "drawEdge");

    active.drawBase();

    expect(drawEdge).not.toHaveBeenCalled();
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
    // Two from the first layout, plus base, overlay and tiles for classic.
    expect(canvases.length).toBe(5);
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
