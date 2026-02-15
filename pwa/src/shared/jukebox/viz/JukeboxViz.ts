// Copied from web/src/jukebox/JukeboxViz.ts on 2026-02-11, reason: reuse visualization canvas logic.
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
}

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
  private visible = true;

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
    options: { enableInteraction?: boolean } = {}
  ) {
    this.container = container;
    this.positioner = positioner;
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
      const bend = this.shouldBendEdge(from, to, edge.src.which, edge.dest.which);
      const control = bend ? this.getBendControlPoint(from, to) : null;
      this.edgeGeometry.set(edge, { bend, control });
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
            this.drawBentLine(this.overlayCtx, from, to, jumpColor, 2);
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
    const bend = this.shouldBendEdge(from, to, edge.src.which, edge.dest.which);
    const control = bend ? this.getBendControlPoint(from, to) : null;
    const next = { bend, control };
    this.edgeGeometry.set(edge, next);
    return next;
  }

  private shouldBendEdge(
    from: { x: number; y: number },
    to: { x: number; y: number },
    fromIndex?: number,
    toIndex?: number
  ) {
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

  private drawBentLine(
    ctx: CanvasRenderingContext2D,
    from: { x: number; y: number },
    to: { x: number; y: number },
    color: string,
    lineWidth: number
  ) {
    const [cx, cy] = this.getBendControlPoint(from, to);
    this.drawBentLineWithControl(ctx, from, to, [cx, cy], color, lineWidth);
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

function createVisualizations(
  vizLayer: HTMLElement,
  positioners?: Positioner[],
  enableInteraction = true
) {
  const list = positioners ?? [
    JukeboxViz.createClassicPositioner(),
    (data: VisualizationData, width: number, height: number) => {
      const count = data.beats.length;
      const cx = width / 2;
      const cy = height / 2;
      const maxRadius = Math.min(width, height) * 0.42;
      const minRadius = Math.min(width, height) * 0.08;
      const turns = 3;
      return Array.from({ length: count }, (_, i) => {
        const t = i / count;
        const angle = t * Math.PI * 2 * turns - Math.PI / 2;
        const radius = minRadius + (maxRadius - minRadius) * t;
        return {
          x: cx + Math.cos(angle) * radius,
          y: cy + Math.sin(angle) * radius,
        };
      });
    },
    (data: VisualizationData, width: number, height: number) => {
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
          for (const [size, count] of counts.entries()) {
            if (count > bestCount) {
              bestCount = count;
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
      const paddingX = 40;
      const paddingTop = 64;
      const paddingBottom = 80;
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
    },
    (data: VisualizationData, width: number, height: number) => {
      const count = data.beats.length;
      const padding = 40;
      const amp = height * 0.25;
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
    },
    (data: VisualizationData, width: number, height: number) => {
      const count = data.beats.length;
      const cx = width / 2;
      const cy = height / 2;
      const ampX = width * 0.35;
      const ampY = height * 0.25;
      return Array.from({ length: count }, (_, i) => {
        const t = (i / count) * Math.PI * 2;
        return {
          x: cx + Math.sin(t) * ampX,
          y: cy + Math.sin(t * 2) * ampY,
        };
      });
    },
    (data: VisualizationData, width: number, height: number) => {
      const count = data.beats.length;
      const cx = width / 2;
      const cy = height / 2;
      const maxRadius = Math.min(width, height) * 0.42;
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
    },
  ];
  return list.map(
    (positioner) => new CanvasViz(vizLayer, positioner, { enableInteraction })
  );
}

export class JukeboxViz {
  private visualizations: CanvasViz[];
  private activeIndex = 0;
  private visible = true;
  private data: VizData | null = null;
  private selectedEdge: Edge | null = null;
  private lastUpdate: LastUpdate | null = null;

  static createClassicPositioner(): Positioner {
    return (data: VisualizationData, width: number, height: number) => {
      const count = data.beats.length;
      const radius = Math.min(width, height) * 0.4;
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
    options?: { positioners?: Positioner[]; enableInteraction?: boolean }
  ) {
    const enableInteraction = options?.enableInteraction ?? true;
    this.visualizations = createVisualizations(
      vizLayer,
      options?.positioners,
      enableInteraction
    );
    this.setActiveIndex(0);
  }

  getCount() {
    return this.visualizations.length;
  }

  setActiveIndex(index: number) {
    if (index < 0 || index >= this.visualizations.length) {
      return;
    }
    this.activeIndex = index;
    if (this.visible) {
      this.visualizations.forEach((viz, vizIndex) => {
        viz.setVisible(vizIndex === index);
      });
    } else {
      this.visualizations.forEach((viz) => viz.setVisible(false));
    }
    this.visualizations[index]?.resizeNow();
    if (this.data) {
      this.visualizations[index]?.setData(this.data);
    }
    if (this.selectedEdge) {
      this.visualizations[index]?.setSelectedEdge(this.selectedEdge);
    }
    if (this.lastUpdate) {
      this.visualizations[index]?.update(
        this.lastUpdate.index,
        this.lastUpdate.animate,
        this.lastUpdate.previousIndex
      );
    }
  }

  setVisible(visible: boolean) {
    this.visible = visible;
    if (!visible) {
      this.visualizations.forEach((viz) => viz.setVisible(false));
      return;
    }
    this.visualizations.forEach((viz, index) => {
      viz.setVisible(index === this.activeIndex);
    });
  }

  setData(data: VizData) {
    this.data = data;
    this.visualizations.forEach((viz) => viz.setData(data));
  }

  refresh() {
    this.visualizations.forEach((viz) => viz.refresh());
  }

  resizeNow() {
    this.visualizations.forEach((viz) => viz.resizeNow());
  }

  resizeActive() {
    this.visualizations[this.activeIndex]?.resizeNow();
  }

  update(index: number, animate: boolean, previousIndex: number | null) {
    this.lastUpdate = { index, animate, previousIndex };
    this.visualizations[this.activeIndex]?.update(index, animate, previousIndex);
  }

  reset() {
    this.visualizations.forEach((viz) => viz.reset());
  }

  destroy() {
    this.visualizations.forEach((viz) => viz.destroy());
    this.visualizations = [];
    this.data = null;
    this.selectedEdge = null;
    this.lastUpdate = null;
    this.visible = false;
    this.activeIndex = 0;
  }

  setOnSelect(handler: (index: number) => void) {
    this.visualizations.forEach((viz) => viz.setOnSelect(handler));
  }

  setOnEdgeSelect(handler: (edge: Edge | null) => void) {
    this.visualizations.forEach((viz) => viz.setOnEdgeSelect(handler));
  }

  setSelectedEdge(edge: Edge | null) {
    this.selectedEdge = edge;
    this.visualizations.forEach((viz) => viz.setSelectedEdge(edge));
  }

  setSelectedEdgeActive(edge: Edge | null) {
    this.selectedEdge = edge;
    this.visualizations[this.activeIndex]?.setSelectedEdge(edge);
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
