import type { JukeboxEngine } from "../engine";
import type { Edge, QuantumBase } from "../engine/types";
import {
  BEAT_AVOID_RADIUS_PX,
  BEAT_SELECT_RADIUS_PX,
  EDGE_SELECT_RADIUS_PX,
  MAX_EDGE_SAMPLES,
  MAX_EDGES_BASE,
} from "../constants/visualization";

type VizData = NonNullable<ReturnType<JukeboxEngine["getVisualizationData"]>>;

type LastUpdate = {
  index: number;
  animate: boolean;
  previousIndex: number | null;
};

interface VisualizationData {
  beats: QuantumBase[];
  edges: Edge[];
  lastBranchPoint: number;
  anchorEdgeId: number | null;
}

const ANCHOR_HIGHLIGHT_COLOR = "#ff2d2d";

interface JumpLine {
  from: number;
  to: number;
  at: number;
}

type Positioner = (
  data: VisualizationData,
  width: number,
  height: number
) => Array<{ x: number; y: number }>;

type EdgeControlPointResolver = (args: {
  edge: Edge | null;
  from: { x: number; y: number };
  to: { x: number; y: number };
  fromIndex: number;
  toIndex: number;
  data: VisualizationData;
  center: { x: number; y: number };
}) => [number, number];

type CanvasVizOptions = {
  enableInteraction?: boolean;
  forceBendEdges?: boolean;
  edgeControlPointResolver?: EdgeControlPointResolver;
};

type VisualizationDefinition = {
  positioner: Positioner;
  options?: Omit<CanvasVizOptions, "enableInteraction">;
};

class CanvasViz {
  private container: HTMLElement;
  private baseCanvas: HTMLCanvasElement;
  private overlayCanvas: HTMLCanvasElement;
  private baseCtx: CanvasRenderingContext2D;
  private overlayCtx: CanvasRenderingContext2D;

  private size = { width: 0, height: 0 };
  private data: VisualizationData | null = null;
  private positions: Array<{ x: number; y: number }> = [];
  private center = { x: 0, y: 0 };
  private bendCache = new Map<string, boolean>();

  private currentIndex = -1;
  private jumpLine: JumpLine | null = null;
  private selectedEdge: Edge | null = null;
  private overlayRafId: number | null = null;

  private onSelect: ((index: number) => void) | null = null;
  private onEdgeSelect: ((edge: Edge | null) => void) | null = null;

  private positioner: Positioner;
  private forceBendEdges: boolean;
  private edgeControlPointResolver: EdgeControlPointResolver | null;
  private visible = true;
  private anchorHighlightEnabled = false;

  private edgeGeometry = new WeakMap<
    Edge,
    { bend: boolean; control: [number, number] | null }
  >();
  private theme = {
    edgeStroke: "rgba(74, 199, 255, 0.12)",
    beatFill: "rgba(255, 215, 130, 0.55)",
    edgeSelected: "#ff5b5b",
    beatHighlight: "#ffd46a",
    beatHighlightRgb: null as { r: number; g: number; b: number } | null,
  };

  constructor(
    container: HTMLElement,
    positioner: Positioner,
    options: CanvasVizOptions = {}
  ) {
    this.container = container;
    this.positioner = positioner;
    this.forceBendEdges = options.forceBendEdges ?? false;
    this.edgeControlPointResolver = options.edgeControlPointResolver ?? null;
    this.baseCanvas = document.createElement("canvas");
    this.overlayCanvas = document.createElement("canvas");
    const baseCtx = this.baseCanvas.getContext("2d");
    const overlayCtx = this.overlayCanvas.getContext("2d");
    if (!baseCtx || !overlayCtx) {
      throw new Error("Canvas not supported");
    }
    this.baseCtx = baseCtx;
    this.overlayCtx = overlayCtx;
    this.container.append(this.baseCanvas, this.overlayCanvas);
    this.applyCanvasStyles();
    this.updateTheme();
    this.resize();
    if (options.enableInteraction !== false) {
      this.overlayCanvas.addEventListener("click", this.handleCanvasClick);
    }
  }

  setVisible(visible: boolean) {
    this.visible = visible;
    const display = visible ? "block" : "none";
    this.baseCanvas.style.display = display;
    this.overlayCanvas.style.display = display;
    if (visible && this.data) {
      this.drawBase();
      this.drawOverlay();
    } else {
      this.cancelOverlayAnimation();
    }
  }

  setData(data: VisualizationData) {
    this.data = data;
    this.computePositions();
    this.computeEdgeGeometry();
    this.drawBase();
    this.drawOverlay();
  }

  refresh() {
    if (!this.data) {
      return;
    }
    this.updateTheme();
    this.drawBase();
    this.drawOverlay();
  }

  update(currentIndex: number, lastJumped: boolean, previousIndex: number | null) {
    this.currentIndex = currentIndex;
    if (lastJumped && previousIndex !== null) {
      this.jumpLine = {
        from: previousIndex,
        to: currentIndex,
        at: performance.now(),
      };
    }
    this.drawOverlay();
  }

  reset() {
    this.currentIndex = -1;
    this.jumpLine = null;
    this.selectedEdge = null;
    this.cancelOverlayAnimation();
    this.drawOverlay();
  }

  destroy() {
    this.overlayCanvas.removeEventListener("click", this.handleCanvasClick);
    this.baseCanvas.remove();
    this.overlayCanvas.remove();
    this.data = null;
    this.positions = [];
    this.edgeGeometry = new WeakMap();
    this.bendCache.clear();
    this.cancelOverlayAnimation();
  }

  setOnSelect(handler: (index: number) => void) {
    this.onSelect = handler;
  }

  setOnEdgeSelect(handler: (edge: Edge | null) => void) {
    this.onEdgeSelect = handler;
  }

  setSelectedEdge(edge: Edge | null) {
    this.selectedEdge = edge;
    this.drawOverlay();
  }

  setAnchorHighlightEnabled(enabled: boolean) {
    this.anchorHighlightEnabled = enabled;
    this.drawBase();
  }

  resizeNow() {
    this.resize();
  }

  private applyCanvasStyles() {
    this.baseCanvas.style.position = "absolute";
    this.baseCanvas.style.inset = "0";
    this.baseCanvas.style.width = "100%";
    this.baseCanvas.style.height = "100%";
    this.overlayCanvas.style.position = "absolute";
    this.overlayCanvas.style.inset = "0";
    this.overlayCanvas.style.width = "100%";
    this.overlayCanvas.style.height = "100%";
  }

  private resize() {
    const rect = this.container.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    this.size = { width: rect.width, height: rect.height };
    this.baseCanvas.width = rect.width * dpr;
    this.baseCanvas.height = rect.height * dpr;
    this.overlayCanvas.width = rect.width * dpr;
    this.overlayCanvas.height = rect.height * dpr;
    this.baseCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.overlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.data) {
      this.computePositions();
      this.computeEdgeGeometry();
      this.drawBase();
      this.drawOverlay();
    }
  }

  private computePositions() {
    if (!this.data) {
      return;
    }
    const { width, height } = this.size;
    this.positions = this.positioner(this.data, width, height);
    this.center = { x: width / 2, y: height / 2 };
    this.bendCache.clear();
  }

  private computeEdgeGeometry() {
    if (!this.data) {
      return;
    }
    this.edgeGeometry = new WeakMap();
    for (const edge of this.data.edges) {
      if (edge.deleted) {
        continue;
      }
      const from = this.positions[edge.src.which];
      const to = this.positions[edge.dest.which];
      if (!from || !to) {
        continue;
      }
      this.edgeGeometry.set(
        edge,
        this.resolveEdgeGeometry(edge, from, to, edge.src.which, edge.dest.which)
      );
    }
  }

  private updateTheme() {
    const styles = getComputedStyle(document.documentElement);
    this.theme.edgeStroke =
      styles.getPropertyValue("--edge-stroke").trim() || this.theme.edgeStroke;
    this.theme.beatFill =
      styles.getPropertyValue("--beat-fill").trim() || this.theme.beatFill;
    this.theme.edgeSelected =
      styles.getPropertyValue("--edge-selected").trim() ||
      this.theme.edgeSelected;
    this.theme.beatHighlight =
      styles.getPropertyValue("--beat-highlight").trim() ||
      this.theme.beatHighlight;
    this.theme.beatHighlightRgb = this.parseThemeColor(this.theme.beatHighlight);
  }

  private parseThemeColor(color: string) {
    const value = color.trim();
    if (value.startsWith("#")) {
      const hex = value.slice(1);
      const normalized =
        hex.length === 3
          ? hex
              .split("")
              .map((ch) => ch + ch)
              .join("")
          : hex.slice(0, 6);
      const r = Number.parseInt(normalized.slice(0, 2), 16);
      const g = Number.parseInt(normalized.slice(2, 4), 16);
      const b = Number.parseInt(normalized.slice(4, 6), 16);
      if (
        Number.isFinite(r) &&
        Number.isFinite(g) &&
        Number.isFinite(b)
      ) {
        return { r, g, b };
      }
    }
    const match = value.match(/rgba?\(([^)]+)\)/i);
    if (match) {
      const parts = match[1].split(",").map((val) => Number.parseFloat(val));
      if (parts.length >= 3 && parts.every((val) => Number.isFinite(val))) {
        return { r: parts[0], g: parts[1], b: parts[2] };
      }
    }
    return null;
  }

  private drawBase() {
    if (!this.data || !this.visible) {
      return;
    }
    const { width, height } = this.size;
    this.baseCtx.clearRect(0, 0, width, height);
    this.baseCtx.save();
    this.baseCtx.lineWidth = 1;

    const edges = this.data.edges;
    const step =
      edges.length > MAX_EDGES_BASE
        ? Math.ceil(edges.length / MAX_EDGES_BASE)
        : 1;

    this.baseCtx.strokeStyle = this.theme.edgeStroke;
    for (let i = 0; i < edges.length; i += step) {
      const edge = edges[i];
      if (edge.deleted) {
        continue;
      }
      const from = this.positions[edge.src.which];
      const to = this.positions[edge.dest.which];
      if (!from || !to) {
        continue;
      }
      const geometry = this.getEdgeGeometry(edge);
      if (geometry?.bend && geometry.control) {
        this.baseCtx.beginPath();
        this.baseCtx.moveTo(from.x, from.y);
        this.baseCtx.quadraticCurveTo(
          geometry.control[0],
          geometry.control[1],
          to.x,
          to.y
        );
        this.baseCtx.stroke();
      } else {
        this.baseCtx.beginPath();
        this.baseCtx.moveTo(from.x, from.y);
        this.baseCtx.lineTo(to.x, to.y);
        this.baseCtx.stroke();
      }
    }

    if (this.anchorHighlightEnabled && this.data.anchorEdgeId !== null) {
      for (const edge of edges) {
        if (edge.deleted || edge.id !== this.data.anchorEdgeId) {
          continue;
        }
        this.drawEdge(this.baseCtx, edge, ANCHOR_HIGHLIGHT_COLOR, 1.8);
        break;
      }
    }

    this.baseCtx.fillStyle = this.theme.beatFill;
    for (let i = 0; i < this.positions.length; i += 1) {
      const p = this.positions[i];
      this.baseCtx.beginPath();
      this.baseCtx.arc(p.x, p.y, 2, 0, Math.PI * 2);
      this.baseCtx.fill();
    }
    this.baseCtx.restore();
  }

  private drawOverlay() {
    const { width, height } = this.size;
    this.overlayCtx.clearRect(0, 0, width, height);
    if (!this.data || !this.visible) {
      this.cancelOverlayAnimation();
      return;
    }
    if (this.selectedEdge && !this.selectedEdge.deleted) {
      this.drawEdge(
        this.overlayCtx,
        this.selectedEdge,
        this.theme.edgeSelected,
        2.5
      );
    }
    if (this.currentIndex < 0) {
      return;
    }
    const current = this.positions[this.currentIndex];
    if (current) {
      this.overlayCtx.fillStyle = this.theme.beatHighlight;
      this.overlayCtx.beginPath();
      this.overlayCtx.arc(current.x, current.y, 10, 0, Math.PI * 2);
      this.overlayCtx.fill();
    }
    if (this.jumpLine) {
      const age = performance.now() - this.jumpLine.at;
      if (age < 1000) {
        const from = this.positions[this.jumpLine.from];
        const to = this.positions[this.jumpLine.to];
        if (from && to) {
          const alpha = 1 - age / 1000;
          const jumpColor = this.resolveBeatJumpColor(alpha);
          if (this.shouldBendEdge(from, to, this.jumpLine.from, this.jumpLine.to)) {
            const control = this.resolveControlPointForPair(
              from,
              to,
              this.jumpLine.from,
              this.jumpLine.to
            );
            this.drawBentLineWithControl(
              this.overlayCtx,
              from,
              to,
              control,
              jumpColor,
              2
            );
          } else {
            this.overlayCtx.strokeStyle = jumpColor;
            this.overlayCtx.lineWidth = 2;
            this.overlayCtx.beginPath();
            this.overlayCtx.moveTo(from.x, from.y);
            this.overlayCtx.lineTo(to.x, to.y);
            this.overlayCtx.stroke();
          }
        }
        this.requestOverlayAnimation();
      } else {
        this.jumpLine = null;
        this.cancelOverlayAnimation();
      }
    } else {
      this.cancelOverlayAnimation();
    }
  }

  private requestOverlayAnimation() {
    if (this.overlayRafId !== null) {
      return;
    }
    this.overlayRafId = window.requestAnimationFrame(() => {
      this.overlayRafId = null;
      this.drawOverlay();
    });
  }

  private cancelOverlayAnimation() {
    if (this.overlayRafId === null) {
      return;
    }
    window.cancelAnimationFrame(this.overlayRafId);
    this.overlayRafId = null;
  }

  private resolveBeatJumpColor(alpha: number) {
    if (this.theme.beatHighlightRgb) {
      const { r, g, b } = this.theme.beatHighlightRgb;
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    return this.theme.beatHighlight;
  }

  private handleCanvasClick = (event: MouseEvent) => {
    if (!this.data || !this.visible) {
      return;
    }
    const rect = this.overlayCanvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    if (this.onSelect) {
      const maxDistance = BEAT_SELECT_RADIUS_PX;
      let bestIndex = -1;
      let bestDist = Infinity;
      for (let i = 0; i < this.positions.length; i += 1) {
        const p = this.positions[i];
        const dx = p.x - x;
        const dy = p.y - y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < bestDist) {
          bestDist = d;
          bestIndex = i;
        }
      }
      if (bestIndex >= 0 && bestDist <= maxDistance) {
        if (this.onEdgeSelect && this.selectedEdge) {
          this.onEdgeSelect(null);
        }
        this.onSelect(bestIndex);
        return;
      }
    }
    if (this.onEdgeSelect) {
      const edgeThreshold = EDGE_SELECT_RADIUS_PX;
      let bestEdge: Edge | null = null;
      let bestEdgeDist = Infinity;
      for (const edge of this.data.edges) {
        if (edge.deleted) {
          continue;
        }
        const from = this.positions[edge.src.which];
        const to = this.positions[edge.dest.which];
        if (!from || !to) {
          continue;
        }
        const geometry = this.getEdgeGeometry(edge);
        if (!geometry) {
          continue;
        }
        const dist =
          geometry.bend && geometry.control
            ? distanceToQuadratic(
                x,
                y,
                from.x,
                from.y,
                ...geometry.control,
                to.x,
                to.y
              )
            : distanceToSegment(x, y, from.x, from.y, to.x, to.y);
        if (dist < bestEdgeDist) {
          bestEdgeDist = dist;
          bestEdge = edge;
        }
      }
      if (bestEdge && bestEdgeDist <= edgeThreshold) {
        const nextEdge = this.selectedEdge === bestEdge ? null : bestEdge;
        this.onEdgeSelect(nextEdge);
        return;
      }
      if (this.selectedEdge) {
        this.onEdgeSelect(null);
      }
    }
  };

  private drawEdge(
    ctx: CanvasRenderingContext2D,
    edge: Edge,
    color: string,
    lineWidth: number
  ) {
    const from = this.positions[edge.src.which];
    const to = this.positions[edge.dest.which];
    if (!from || !to) {
      return;
    }
    const geometry = this.getEdgeGeometry(edge);
    if (geometry?.bend && geometry.control) {
      this.drawBentLineWithControl(ctx, from, to, geometry.control, color, lineWidth);
      return;
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  }

  private getEdgeGeometry(
    edge: Edge
  ): { bend: boolean; control: [number, number] | null } | null {
    const cached = this.edgeGeometry.get(edge);
    if (cached) {
      return cached;
    }
    const from = this.positions[edge.src.which];
    const to = this.positions[edge.dest.which];
    if (!from || !to) {
      return null;
    }
    const next = this.resolveEdgeGeometry(
      edge,
      from,
      to,
      edge.src.which,
      edge.dest.which
    );
    this.edgeGeometry.set(edge, next);
    return next;
  }

  private resolveEdgeGeometry(
    edge: Edge | null,
    from: { x: number; y: number },
    to: { x: number; y: number },
    fromIndex: number,
    toIndex: number
  ): { bend: boolean; control: [number, number] | null } {
    if (!this.data) {
      return { bend: false, control: null };
    }
    if (this.edgeControlPointResolver) {
      return {
        bend: true,
        control: this.edgeControlPointResolver({
          edge,
          from,
          to,
          fromIndex,
          toIndex,
          data: this.data,
          center: this.center,
        }),
      };
    }
    const bend = this.shouldBendEdge(from, to, fromIndex, toIndex);
    return {
      bend,
      control: bend ? this.getBendControlPoint(from, to) : null,
    };
  }

  private resolveControlPointForPair(
    from: { x: number; y: number },
    to: { x: number; y: number },
    fromIndex: number,
    toIndex: number
  ): [number, number] {
    return this.resolveEdgeGeometry(null, from, to, fromIndex, toIndex).control ?? [
      (from.x + to.x) / 2,
      (from.y + to.y) / 2,
    ];
  }

  private shouldBendEdge(
    from: { x: number; y: number },
    to: { x: number; y: number },
    fromIndex?: number,
    toIndex?: number
  ) {
    if (this.forceBendEdges) {
      return true;
    }
    if (fromIndex !== undefined && toIndex !== undefined) {
      const min = Math.min(fromIndex, toIndex);
      const max = Math.max(fromIndex, toIndex);
      const key = `${min}:${max}`;
      const cached = this.bendCache.get(key);
      if (cached !== undefined) {
        return cached;
      }
      const computed = this.computeShouldBend(from, to);
      this.bendCache.set(key, computed);
      return computed;
    }
    return this.computeShouldBend(from, to);
  }

  private computeShouldBend(from: { x: number; y: number }, to: { x: number; y: number }) {
    const step = Math.max(1, Math.ceil(this.positions.length / MAX_EDGE_SAMPLES));
    for (let i = 0; i < this.positions.length; i += step) {
      const p = this.positions[i];
      if (!p) {
        continue;
      }
      if ((p.x === from.x && p.y === from.y) || (p.x === to.x && p.y === to.y)) {
        continue;
      }
      const dist = distanceToSegment(p.x, p.y, from.x, from.y, to.x, to.y);
      if (dist <= BEAT_AVOID_RADIUS_PX) {
        return true;
      }
    }
    return false;
  }

  private drawBentLineWithControl(
    ctx: CanvasRenderingContext2D,
    from: { x: number; y: number },
    to: { x: number; y: number },
    control: [number, number],
    color: string,
    lineWidth: number
  ) {
    const [cx, cy] = control;
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.quadraticCurveTo(cx, cy, to.x, to.y);
    ctx.stroke();
  }

  private getBendControlPoint(
    from: { x: number; y: number },
    to: { x: number; y: number }
  ): [number, number] {
    const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
    const dirX = this.center.x - mid.x;
    const dirY = this.center.y - mid.y;
    const dirLen = Math.hypot(dirX, dirY);
    if (dirLen === 0) {
      return [mid.x, mid.y];
    }
    const normX = dirX / dirLen;
    const normY = dirY / dirLen;
    const centerDist = Math.hypot(this.center.x - mid.x, this.center.y - mid.y);
    return [
      mid.x + normX * (centerDist * 0.5),
      mid.y + normY * (centerDist * 0.5),
    ];
  }
}

function createArcDiagramPositioner(): Positioner {
  return (data: VisualizationData, width: number, height: number) => {
    const count = data.beats.length;
    const paddingX = 30;
    const timelineY = height * 0.5;
    const span = Math.max(0, width - paddingX * 2);
    if (count <= 0) {
      return [];
    }
    if (count === 1) {
      return [{ x: width / 2, y: timelineY }];
    }
    return Array.from({ length: count }, (_, i) => {
      const t = i / (count - 1);
      return {
        x: paddingX + span * t,
        y: timelineY,
      };
    });
  };
}

function createArcDiagramControlPointResolver(): EdgeControlPointResolver {
  return ({ edge, from, to, fromIndex, toIndex, center }) => {
    const midX = (from.x + to.x) / 2;
    const baseY = (from.y + to.y) / 2;
    const span = Math.abs(to.x - from.x);
    const forward =
      edge !== null ? edge.dest.which >= edge.src.which : toIndex >= fromIndex;
    // Gate: forward jumps arc above the timeline, backward jumps arc below.
    const direction = forward ? -1 : 1;
    const canvasHeight = center.y * 2;
    const availableLift =
      direction < 0
        ? baseY + 100
        : canvasHeight - baseY + 100;
    const maxLift = Math.max(4, availableLift);
    const minLift = Math.min(24, maxLift);
    const desiredLift = Math.max(minLift, span * 1.25);
    const lift = Math.min(maxLift, desiredLift);
    return [midX, baseY + direction * lift];
  };
}

function createGridPositioner(): Positioner {
  return (data: VisualizationData, width: number, height: number) => {
    const count = data.beats.length;
    let beatsPerBar = 4;
    if (count > 0) {
      const counts = new Map<number, number>();
      let totalParents = 0;
      const seenParents = new Set<object>();
      for (const beat of data.beats) {
        const parent = beat.parent;
        if (!parent || !parent.children) {
          continue;
        }
        if (!seenParents.has(parent)) {
          seenParents.add(parent);
          const length = Math.max(1, parent.children.length);
          counts.set(length, (counts.get(length) ?? 0) + 1);
          totalParents += 1;
        }
      }
      if (counts.size > 0) {
        let best = beatsPerBar;
        let bestCount = -1;
        for (const [size, value] of counts.entries()) {
          if (value > bestCount) {
            bestCount = value;
            best = size;
          }
        }
        beatsPerBar = best;
      }
      if (totalParents === 0) {
        beatsPerBar = 4;
      }
    }
    const bars: Array<{ bar: QuantumBase | null; section: QuantumBase | null }> = [];
    const barIndex = new Map<QuantumBase, number>();
    for (const beat of data.beats) {
      const parent = beat.parent ?? null;
      if (parent && !barIndex.has(parent)) {
        barIndex.set(parent, bars.length);
        bars.push({ bar: parent, section: parent.parent ?? null });
      }
    }
    if (bars.length === 0) {
      const totalBars = Math.max(
        1,
        Math.ceil(count / Math.max(1, beatsPerBar))
      );
      for (let i = 0; i < totalBars; i += 1) {
        bars.push({ bar: null, section: null });
      }
    }
    const totalBars = Math.max(1, bars.length);
    const targetBarsPerRow = Math.max(1, Math.ceil(Math.sqrt(totalBars)));
    const rowBars: number[] = [];
    if (bars.some((entry) => entry.section)) {
      let currentSection: QuantumBase | null = bars[0]?.section ?? null;
      let sectionBars = 0;
      const pushSectionRows = () => {
        if (sectionBars <= 0) {
          return;
        }
        let remaining = sectionBars;
        while (remaining > 0) {
          const chunk = Math.min(remaining, targetBarsPerRow);
          rowBars.push(chunk);
          remaining -= chunk;
        }
      };
      for (const entry of bars) {
        if (entry.section !== currentSection) {
          pushSectionRows();
          currentSection = entry.section;
          sectionBars = 0;
        }
        sectionBars += 1;
      }
      pushSectionRows();
    } else {
      let remaining = totalBars;
      while (remaining > 0) {
        const chunk = Math.min(remaining, targetBarsPerRow);
        rowBars.push(chunk);
        remaining -= chunk;
      }
    }
    const rows = Math.max(1, rowBars.length);
    const paddingX = 28;
    const verticalPad = Math.max(18, Math.min(36, height * 0.08));
    const paddingTop = verticalPad;
    const paddingBottom = verticalPad;
    const gridW = width - paddingX * 2;
    const gridH = height - paddingTop - paddingBottom;
    const safeRatio = (index: number, max: number) =>
      max <= 1 ? 0.5 : index / (max - 1);
    const rowStartBar: number[] = [];
    let running = 0;
    for (const barsInRow of rowBars) {
      rowStartBar.push(running);
      running += barsInRow;
    }
    return Array.from({ length: count }, (_, i) => {
      const beat = data.beats[i];
      const parent = beat.parent ?? null;
      const barIdx = parent ? barIndex.get(parent) ?? 0 : Math.floor(i / beatsPerBar);
      let rowIndex = 0;
      for (let r = 0; r < rowBars.length; r += 1) {
        const start = rowStartBar[r] ?? 0;
        const end = start + rowBars[r];
        if (barIdx >= start && barIdx < end) {
          rowIndex = r;
          break;
        }
      }
      const barsInRow = rowBars[rowIndex] ?? 1;
      const rowBarOffset = Math.max(0, barIdx - (rowStartBar[rowIndex] ?? 0));
      let beatInBar = beat.indexInParent ?? -1;
      if (beatInBar < 0 && parent?.children) {
        beatInBar = parent.children.indexOf(beat);
      }
      if (beatInBar < 0) {
        beatInBar = i % Math.max(1, beatsPerBar);
      }
      const cols = Math.max(1, beatsPerBar * barsInRow);
      const col = Math.min(cols - 1, rowBarOffset * beatsPerBar + beatInBar);
      return {
        x: paddingX + safeRatio(col, cols) * gridW,
        y: paddingTop + safeRatio(rowIndex, rows) * gridH,
      };
    });
  };
}

function createWavePositioner(): Positioner {
  return (data: VisualizationData, width: number, height: number) => {
    const count = data.beats.length;
    const padding = 28;
    const amp = Math.min(Math.max(0, height * 0.42), Math.max(0, height / 2 - 18));
    const center = height / 2;
    const span = width - padding * 2;
    const waveTurns = 3;
    return Array.from({ length: count }, (_, i) => {
      const t = i / Math.max(1, count - 1);
      return {
        x: padding + span * t,
        y: center + Math.sin(t * Math.PI * 2 * waveTurns) * amp,
      };
    });
  };
}

function createInfinitePositioner(): Positioner {
  return (data: VisualizationData, width: number, height: number) => {
    const count = data.beats.length;
    const cx = width / 2;
    const cy = height / 2;
    const ampX = width * 0.4;
    const ampY = Math.min(Math.max(0, height * 0.42), Math.max(0, height / 2 - 18));
    return Array.from({ length: count }, (_, i) => {
      const t = (i / count) * Math.PI * 2;
      return {
        x: cx + Math.sin(t) * ampX,
        y: cy + Math.sin(t * 2) * ampY,
      };
    });
  };
}

function createGalaxyPositioner(): Positioner {
  return (data: VisualizationData, width: number, height: number) => {
    const count = data.beats.length;
    const cx = width / 2;
    const cy = height / 2;
    const maxRadius = Math.min(width, height) * 0.49;
    const minRadius = Math.min(width, height) * 0.08;
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    return Array.from({ length: count }, (_, i) => {
      const t = i / Math.max(1, count - 1);
      const angle = i * goldenAngle;
      const radius = minRadius + (maxRadius - minRadius) * Math.sqrt(t);
      const wobble =
        0.06 * Math.sin(i * 12.9898) + 0.04 * Math.cos(i * 4.1414);
      const r = radius * (1 + wobble);
      return {
        x: cx + Math.cos(angle) * r,
        y: cy + Math.sin(angle) * r,
      };
    });
  };
}

function getDefaultVisualizationDefinitions(): VisualizationDefinition[] {
  return [
    {
      positioner: createArcDiagramPositioner(),
      options: {
        forceBendEdges: true,
        edgeControlPointResolver: createArcDiagramControlPointResolver(),
      },
    },
    { positioner: JukeboxViz.createClassicPositioner() },
    { positioner: createGalaxyPositioner() },
    { positioner: createGridPositioner() },
    { positioner: createInfinitePositioner() },
    { positioner: createWavePositioner() },
  ];
}

export class JukeboxViz {
  private readonly vizLayer: HTMLElement;
  private readonly definitions: VisualizationDefinition[];
  private readonly enableInteraction: boolean;
  private activeViz: CanvasViz | null = null;
  private activeIndex = 0;
  private visible = true;
  private data: VizData | null = null;
  private selectedEdge: Edge | null = null;
  private lastUpdate: LastUpdate | null = null;
  private anchorHighlightEnabled = false;
  private onSelectHandler: ((index: number) => void) | null = null;
  private onEdgeSelectHandler: ((edge: Edge | null) => void) | null = null;

  static createClassicPositioner(): Positioner {
    return (data: VisualizationData, width: number, height: number) => {
      const count = data.beats.length;
      const radius = Math.min(width, height) * 0.48;
      const cx = width / 2;
      const cy = height / 2;
      return Array.from({ length: count }, (_, i) => {
        const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
        return {
          x: cx + Math.cos(angle) * radius,
          y: cy + Math.sin(angle) * radius,
        };
      });
    };
  }

  constructor(
    vizLayer: HTMLElement,
    options?: {
      positioners?: Positioner[];
      enableInteraction?: boolean;
    }
  ) {
    this.vizLayer = vizLayer;
    this.enableInteraction = options?.enableInteraction ?? true;
    this.definitions = options?.positioners
      ? options.positioners.map((positioner) => ({ positioner }))
      : getDefaultVisualizationDefinitions();
    this.mountActiveVisualization(0);
  }

  getCount() {
    return this.definitions.length;
  }

  private createVisualization(index: number): CanvasViz | null {
    const definition = this.definitions[index];
    if (!definition) {
      return null;
    }
    const viz = new CanvasViz(this.vizLayer, definition.positioner, {
      enableInteraction: this.enableInteraction,
      ...(definition.options ?? {}),
    });
    viz.setAnchorHighlightEnabled(this.anchorHighlightEnabled);
    viz.setVisible(this.visible);
    if (this.onSelectHandler) {
      viz.setOnSelect(this.onSelectHandler);
    }
    if (this.onEdgeSelectHandler) {
      viz.setOnEdgeSelect(this.onEdgeSelectHandler);
    }
    if (this.data) {
      viz.setData(this.data);
    }
    if (this.selectedEdge) {
      viz.setSelectedEdge(this.selectedEdge);
    }
    if (this.lastUpdate) {
      viz.update(
        this.lastUpdate.index,
        this.lastUpdate.animate,
        this.lastUpdate.previousIndex
      );
    }
    return viz;
  }

  private mountActiveVisualization(index: number) {
    if (this.activeViz) {
      this.activeViz.destroy();
      this.activeViz = null;
    }
    this.activeViz = this.createVisualization(index);
    this.activeViz?.resizeNow();
  }

  setActiveIndex(index: number) {
    if (index < 0 || index >= this.definitions.length) {
      return;
    }
    if (this.activeViz && index === this.activeIndex) {
      this.activeViz.resizeNow();
      return;
    }
    this.activeIndex = index;
    this.mountActiveVisualization(index);
  }

  setVisible(visible: boolean) {
    this.visible = visible;
    this.activeViz?.setVisible(visible);
  }

  setData(data: VizData) {
    this.data = data;
    this.activeViz?.setData(data);
  }

  setAnchorHighlightEnabled(enabled: boolean) {
    this.anchorHighlightEnabled = enabled;
    this.activeViz?.setAnchorHighlightEnabled(enabled);
  }

  refresh() {
    this.activeViz?.refresh();
  }

  resizeNow() {
    this.activeViz?.resizeNow();
  }

  resizeActive() {
    this.activeViz?.resizeNow();
  }

  update(index: number, animate: boolean, previousIndex: number | null) {
    this.lastUpdate = { index, animate, previousIndex };
    this.activeViz?.update(index, animate, previousIndex);
  }

  reset() {
    this.activeViz?.reset();
  }

  destroy() {
    this.activeViz?.destroy();
    this.activeViz = null;
    this.data = null;
    this.selectedEdge = null;
    this.lastUpdate = null;
    this.visible = false;
    this.activeIndex = 0;
    this.onSelectHandler = null;
    this.onEdgeSelectHandler = null;
  }

  setOnSelect(handler: (index: number) => void) {
    this.onSelectHandler = handler;
    this.activeViz?.setOnSelect(handler);
  }

  setOnEdgeSelect(handler: (edge: Edge | null) => void) {
    this.onEdgeSelectHandler = handler;
    this.activeViz?.setOnEdgeSelect(handler);
  }

  setSelectedEdge(edge: Edge | null) {
    this.selectedEdge = edge;
    this.activeViz?.setSelectedEdge(edge);
  }

  setSelectedEdgeActive(edge: Edge | null) {
    this.selectedEdge = edge;
    this.activeViz?.setSelectedEdge(edge);
  }
}

function distanceToSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) {
    return Math.hypot(px - x1, py - y1);
  }
  const t = ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy);
  if (t <= 0) {
    return Math.hypot(px - x1, py - y1);
  }
  if (t >= 1) {
    return Math.hypot(px - x2, py - y2);
  }
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;
  return Math.hypot(px - projX, py - projY);
}

function distanceToQuadratic(
  px: number,
  py: number,
  x1: number,
  y1: number,
  cx: number,
  cy: number,
  x2: number,
  y2: number
) {
  let closest = Infinity;
  const steps = 20;
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const it = 1 - t;
    const qx = it * it * x1 + 2 * it * t * cx + t * t * x2;
    const qy = it * it * y1 + 2 * it * t * cy + t * t * y2;
    const d = Math.hypot(px - qx, py - qy);
    if (d < closest) {
      closest = d;
    }
  }
  return closest;
}
