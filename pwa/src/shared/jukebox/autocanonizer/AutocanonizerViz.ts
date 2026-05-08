// Copied from web/src/autocanonizer/AutocanonizerViz.ts on 2026-02-12, reason: add equivalent autocanonizer visualization to PWA.
import type { QuantumBase } from "../engine/types";

export type CanonizerBeat = QuantumBase & {
  other: CanonizerBeat;
  otherGain: number;
  section: number;
  volume: number;
  median_volume: number;
  color: string;
};

type CanonizerSections = Array<{ start: number; duration: number }>;

type BeatLayout = {
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  otherX: number;
};

type ConnectionPath = {
  fromX: number;
  toX: number;
  cx: number;
  cy: number;
  startY: number;
  samples: Array<{ x: number; y: number; len: number }>;
  totalLength: number;
};

const SECTION_HEIGHT = 16;
const CURSOR_SIZE = 8;
const OTHER_CURSOR_CENTER_OFFSET = SECTION_HEIGHT - CURSOR_SIZE / 2;
const CONNECTION_LINE_WIDTH = 3;

export class AutocanonizerViz {
  private container: HTMLElement;
  private baseCanvas: HTMLCanvasElement;
  private overlayCanvas: HTMLCanvasElement;
  private baseCtx: CanvasRenderingContext2D;
  private overlayCtx: CanvasRenderingContext2D;
  private beats: CanonizerBeat[] = [];
  private sections: CanonizerSections = [];
  private trackDuration = 0;
  private layouts: BeatLayout[] = [];
  private visible = false;
  private currentIndex = -1;
  private maxDelta = 1;
  private onSelect: ((index: number) => void) | null = null;
  private connections: Array<ConnectionPath | null> = [];
  private tileColorOverrides = new Map<number, string>();
  private otherAnim: {
    path: ConnectionPath;
    start: number;
    duration: number;
  } | null = null;
  private forcedOtherIndex: number | null = null;
  private lastOtherCursor: { x: number; y: number } | null = null;
  private otherAnimEndedAt: number | null = null;
  private rafId: number | null = null;

  private layoutMetrics = {
    width: 0,
    height: 0,
    fullHeight: 0,
    tileHeight: 0,
    connectionHeight: 0,
    hPad: 20,
    vPad: 12,
    topPad: 0,
    bottomPad: 0,
  };

  constructor(container: HTMLElement) {
    this.container = container;
    this.baseCanvas = document.createElement("canvas");
    this.overlayCanvas = document.createElement("canvas");
    const baseCtx = this.baseCanvas.getContext("2d");
    const overlayCtx = this.overlayCanvas.getContext("2d");
    if (!baseCtx || !overlayCtx) {
      throw new Error("Canvas not supported");
    }
    this.baseCtx = baseCtx;
    this.overlayCtx = overlayCtx;
    this.applyCanvasStyles();
    this.container.append(this.baseCanvas, this.overlayCanvas);
    this.resizeNow();
    this.overlayCanvas.addEventListener("click", this.handleClick);
  }

  setVisible(visible: boolean) {
    this.visible = visible;
    const display = visible ? "block" : "none";
    this.baseCanvas.style.display = display;
    this.overlayCanvas.style.display = display;
    if (visible) {
      this.drawBase();
      this.drawOverlay();
    }
  }

  setData(
    beats: CanonizerBeat[],
    trackDuration: number,
    sections: CanonizerSections,
  ) {
    this.beats = beats;
    this.trackDuration = trackDuration;
    this.sections = sections;
    this.tileColorOverrides.clear();
    this.computeLayout();
    this.drawBase();
    this.drawOverlay();
  }

  reset() {
    this.currentIndex = -1;
    this.tileColorOverrides.clear();
    this.clearCanvas(this.overlayCtx);
  }

  update(index: number) {
    this.setCurrentIndex(index, true);
  }

  resizeNow() {
    const rect = this.container.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    this.baseCanvas.width = rect.width * dpr;
    this.baseCanvas.height = rect.height * dpr;
    this.overlayCanvas.width = rect.width * dpr;
    this.overlayCanvas.height = rect.height * dpr;
    this.baseCanvas.style.width = `${rect.width}px`;
    this.baseCanvas.style.height = `${rect.height}px`;
    this.overlayCanvas.style.width = `${rect.width}px`;
    this.overlayCanvas.style.height = `${rect.height}px`;
    this.baseCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.overlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.computeLayout();
    this.drawBase();
    this.drawOverlay();
  }

  destroy() {
    this.overlayCanvas.removeEventListener("click", this.handleClick);
    this.baseCanvas.remove();
    this.overlayCanvas.remove();
    this.beats = [];
    this.sections = [];
    this.layouts = [];
  }

  setOnSelect(handler: ((index: number) => void) | null) {
    this.onSelect = handler;
  }

  private applyCanvasStyles() {
    this.baseCanvas.style.position = "absolute";
    this.baseCanvas.style.inset = "0";
    this.overlayCanvas.style.position = "absolute";
    this.overlayCanvas.style.inset = "0";
  }

  private clearCanvas(ctx: CanvasRenderingContext2D) {
    const { width, fullHeight } = this.layoutMetrics;
    ctx.clearRect(0, 0, width, fullHeight);
  }

  private computeLayout() {
    const rect = this.container.getBoundingClientRect();
    if (!rect.width || !rect.height || !this.trackDuration) {
      this.layouts = [];
      return;
    }
    const availableHeight = Math.max(
      0,
      rect.height - this.layoutMetrics.bottomPad - this.layoutMetrics.topPad,
    );
    const tileHeight = Math.max(120, availableHeight * 0.64);
    const connectionHeight = Math.max(80, availableHeight - tileHeight - 6);
    this.layoutMetrics = {
      width: rect.width,
      height: availableHeight,
      fullHeight: rect.height,
      tileHeight,
      connectionHeight,
      hPad: 20,
      vPad: 12,
      topPad: this.layoutMetrics.topPad,
      bottomPad: this.layoutMetrics.bottomPad,
    };
    const { width, hPad, vPad, topPad } = this.layoutMetrics;
    const spanWidth = Math.max(1, width - hPad * 2);
    const baseY = topPad + tileHeight - vPad;
    this.layouts = this.beats.map((beat) => {
      const beatWidth = (spanWidth * beat.duration) / this.trackDuration;
      const x = hPad + (spanWidth * beat.start) / this.trackDuration;
      const height =
        (tileHeight - vPad) *
        Math.pow(Math.max(0, beat.median_volume), 4) *
        0.9;
      const y = baseY - height;
      const otherX =
        hPad +
        (spanWidth * (beat.other ? beat.other.start : beat.start)) /
          this.trackDuration;
      return {
        x,
        y,
        width: Math.max(1, beatWidth),
        height: Math.max(2, height),
        color: beat.color,
        otherX,
      };
    });
    this.maxDelta = this.computeMaxDelta();
    this.connections = this.computeConnections();
  }

  private computeMaxDelta() {
    let maxDelta = 1;
    for (let i = 0; i < this.beats.length - 1; i += 1) {
      const current = this.beats[i];
      const next = this.beats[i + 1];
      if (!current?.other || !next?.other) {
        continue;
      }
      const delta = Math.abs(next.other.which - current.other.which);
      if (delta > maxDelta) {
        maxDelta = delta;
      }
    }
    return maxDelta;
  }

  private computeConnections() {
    const { width, tileHeight, connectionHeight, hPad, topPad, vPad } =
      this.layoutMetrics;
    const spanWidth = Math.max(1, width - hPad * 2);
    const maxDelta = this.maxDelta || 1;
    const sectionY = topPad + tileHeight - vPad;
    const startY = sectionY + OTHER_CURSOR_CENTER_OFFSET;
    return this.beats.map((beat, i) => {
      const next = this.beats[i + 1];
      if (!beat?.other || !next?.other) {
        return null;
      }
      const delta = next.other.which - beat.other.which;
      if (i === 0 || delta === 1) {
        return null;
      }
      const fromX = hPad + (spanWidth * beat.other.start) / this.trackDuration;
      const toX = hPad + (spanWidth * next.other.start) / this.trackDuration;
      const cx = (toX - fromX) / 2 + fromX;
      let cy = (Math.abs(delta) / maxDelta) * connectionHeight * 1.35;
      if (cy < 24) {
        cy = 24;
      }
      cy = Math.min(
        topPad + tileHeight + connectionHeight - 8,
        topPad + tileHeight + cy,
      );
      const samples = sampleQuadraticPath(
        fromX,
        startY,
        cx,
        cy,
        toX,
        startY,
        80,
      );
      const totalLength = samples.length ? samples[samples.length - 1].len : 0;
      return { fromX, toX, cx, cy, startY, samples, totalLength };
    });
  }

  private drawBase() {
    if (!this.visible) {
      return;
    }
    const {
      width,
      fullHeight,
      tileHeight,
      connectionHeight,
      hPad,
      topPad,
      vPad,
    } = this.layoutMetrics;
    this.baseCtx.clearRect(0, 0, width, fullHeight);
    if (!this.beats.length || !this.trackDuration) {
      return;
    }
    const spanWidth = Math.max(1, width - hPad * 2);
    this.drawConnections();
    this.baseCtx.save();
    for (let i = 0; i < this.layouts.length; i += 1) {
      const layout = this.layouts[i];
      const next = this.layouts[i + 1] ?? null;
      const override = this.tileColorOverrides.get(i);
      const fillColor = override ?? layout.color;
      const x = layout.x;
      const y = layout.y;
      const w = layout.width;
      const h = layout.height;
      const nextTop = next ? Math.min(next.y, y + h) : y;
      const topRightX = next ? Math.max(next.x, x + w) : x + w;
      this.baseCtx.fillStyle = fillColor;
      this.baseCtx.strokeStyle = fillColor;
      this.baseCtx.beginPath();
      this.baseCtx.moveTo(x, y);
      this.baseCtx.lineTo(topRightX, nextTop);
      this.baseCtx.lineTo(topRightX, y + h);
      this.baseCtx.lineTo(x, y + h);
      this.baseCtx.closePath();
      this.baseCtx.fill();
      this.baseCtx.stroke();
    }
    this.baseCtx.restore();
    if (this.sections.length) {
      const sectionY = topPad + tileHeight - vPad;
      this.baseCtx.save();
      for (let i = 0; i < this.sections.length; i += 1) {
        const section = this.sections[i];
        const sectionX =
          hPad + (spanWidth * section.start) / this.trackDuration;
        const sectionWidth =
          (spanWidth * section.duration) / this.trackDuration;
        this.baseCtx.fillStyle = sectionColor(i);
        this.baseCtx.fillRect(sectionX, sectionY, sectionWidth, SECTION_HEIGHT);
      }
      this.baseCtx.restore();
    }
    if (connectionHeight > 0) {
      this.baseCtx.save();
      this.baseCtx.strokeStyle = "rgba(255, 255, 255, 0.08)";
      this.baseCtx.beginPath();
      this.baseCtx.moveTo(hPad, topPad + tileHeight - vPad + SECTION_HEIGHT);
      this.baseCtx.lineTo(
        width - hPad,
        topPad + tileHeight - vPad + SECTION_HEIGHT,
      );
      this.baseCtx.stroke();
      this.baseCtx.restore();
    }
  }

  private drawConnections() {
    if (!this.layouts.length) {
      return;
    }
    this.baseCtx.save();
    this.baseCtx.lineWidth = CONNECTION_LINE_WIDTH;
    for (let i = 0; i < this.beats.length - 1; i += 1) {
      const beat = this.beats[i];
      const path = this.connections[i];
      if (!beat?.other || !path) {
        continue;
      }
      this.baseCtx.strokeStyle = withAlpha(beat.other.color, 0.6);
      this.baseCtx.beginPath();
      this.baseCtx.moveTo(path.fromX, path.startY);
      this.baseCtx.quadraticCurveTo(path.cx, path.cy, path.toX, path.startY);
      this.baseCtx.stroke();
    }
    this.baseCtx.restore();
  }

  private drawOverlay() {
    if (!this.visible) {
      return;
    }
    const { width, fullHeight, tileHeight, topPad, vPad } = this.layoutMetrics;
    this.overlayCtx.clearRect(0, 0, width, fullHeight);
    if (!this.layouts.length || this.currentIndex < 0) {
      return;
    }
    const current = this.layouts[this.currentIndex];
    const beat = this.beats[this.currentIndex];
    if (!current || !beat?.other) {
      return;
    }
    const otherIndex = this.forcedOtherIndex ?? beat.other.which;
    const otherLayout = this.layouts[otherIndex];
    const cursorWidth = CURSOR_SIZE;
    const cursorHeight = CURSOR_SIZE;
    const sectionY = topPad + tileHeight - vPad;
    const otherCursorCenterY = sectionY + OTHER_CURSOR_CENTER_OFFSET;
    this.overlayCtx.save();
    this.overlayCtx.fillStyle = "rgba(79, 143, 255, 0.65)";
    this.overlayCtx.fillRect(
      current.x,
      current.y,
      current.width,
      current.height,
    );
    if (otherLayout) {
      this.overlayCtx.fillStyle = "rgba(16, 223, 0, 0.5)";
      this.overlayCtx.fillRect(
        otherLayout.x,
        otherLayout.y,
        otherLayout.width,
        otherLayout.height,
      );
    }
    this.overlayCtx.fillStyle = "#4F8FFF";
    this.overlayCtx.fillRect(
      current.x - cursorWidth / 2,
      sectionY + 0,
      cursorWidth,
      cursorHeight,
    );
    if (this.forcedOtherIndex !== null && otherLayout) {
      this.overlayCtx.fillStyle = "#10DF00";
      this.drawCenteredCursor(
        otherLayout.x,
        otherCursorCenterY,
        cursorWidth,
        cursorHeight,
      );
      this.lastOtherCursor = {
        x: otherLayout.x,
        y: otherCursorCenterY,
      };
    } else {
      const otherCursor = this.getAnimatedOtherCursor();
      if (otherCursor) {
        this.overlayCtx.fillStyle = "#10DF00";
        this.drawCenteredCursor(
          otherCursor.x,
          otherCursor.y,
          cursorWidth,
          cursorHeight,
        );
        this.lastOtherCursor = { x: otherCursor.x, y: otherCursor.y };
      } else if (this.lastOtherCursor) {
        if (this.otherAnimEndedAt !== null) {
          this.overlayCtx.fillStyle = "#10DF00";
          this.drawCenteredCursor(
            this.lastOtherCursor.x,
            this.lastOtherCursor.y,
            cursorWidth,
            cursorHeight,
          );
          this.overlayCtx.restore();
          return;
        }
        if (otherLayout) {
          const follow = { x: otherLayout.x, y: otherCursorCenterY };
          this.overlayCtx.fillStyle = "#10DF00";
          this.drawCenteredCursor(follow.x, follow.y, cursorWidth, cursorHeight);
          this.lastOtherCursor = follow;
        } else {
          this.overlayCtx.fillStyle = "#10DF00";
          this.drawCenteredCursor(
            this.lastOtherCursor.x,
            this.lastOtherCursor.y,
            cursorWidth,
            cursorHeight,
          );
        }
      } else if (otherLayout) {
        this.overlayCtx.fillStyle = "#10DF00";
        const fallback = {
          x: otherLayout.x,
          y: otherCursorCenterY,
        };
        this.drawCenteredCursor(
          fallback.x,
          fallback.y,
          cursorWidth,
          cursorHeight,
        );
        this.lastOtherCursor = fallback;
      }
    }
    this.overlayCtx.restore();
  }

  private drawCenteredCursor(
    centerX: number,
    centerY: number,
    width: number,
    height: number,
  ) {
    this.overlayCtx.fillRect(
      centerX - width / 2,
      centerY - height / 2,
      width,
      height,
    );
  }

  private getAnimatedOtherCursor() {
    if (!this.otherAnim) {
      return null;
    }
    const now = performance.now();
    const elapsed = now - this.otherAnim.start;
    if (elapsed >= this.otherAnim.duration) {
      const endPath = this.otherAnim.path;
      this.lastOtherCursor = { x: endPath.toX, y: endPath.startY };
      this.otherAnim = null;
      this.otherAnimEndedAt = now;
      return null;
    }
    const t = elapsed / this.otherAnim.duration;
    const { path } = this.otherAnim;
    const progress = path.totalLength * t;
    const point = pointAtLength(path, progress);
    const x = point.x;
    const y = point.y;
    this.requestAnimation();
    return { x, y };
  }

  private requestAnimation() {
    if (this.rafId !== null) {
      return;
    }
    this.rafId = window.requestAnimationFrame(() => {
      this.rafId = null;
      this.drawOverlay();
    });
  }

  setCurrentIndex(index: number, animate: boolean) {
    this.currentIndex = index;
    this.forcedOtherIndex = null;
    this.otherAnim = null;
    this.otherAnimEndedAt = null;
    if (animate) {
      const path = this.connections[index];
      if (path) {
        const beat = this.beats[index];
        const duration = Math.max(0, beat.other.duration * 0.75) * 1000;
        this.otherAnim = {
          path,
          start: performance.now(),
          duration,
        };
        this.requestAnimation();
      }
    }
    this.applyTileOverride(index, "#4F8FFF");
    const beat = this.beats[index];
    if (beat?.other) {
      this.applyTileOverride(beat.other.which, "#10DF00");
    }
    this.drawOverlay();
  }

  setOtherIndex(index: number) {
    if (!this.layouts[index]) {
      return;
    }
    this.forcedOtherIndex = index;
    this.otherAnim = null;
    this.otherAnimEndedAt = null;
    this.applyTileOverride(index, "#10DF00");
    this.drawOverlay();
  }

  private applyTileOverride(index: number, color: string) {
    if (!this.layouts[index]) {
      return;
    }
    if (this.tileColorOverrides.get(index) === color) {
      return;
    }
    this.tileColorOverrides.set(index, color);
    this.drawBase();
  }

  private handleClick = (event: MouseEvent) => {
    if (!this.visible || !this.onSelect || !this.layouts.length) {
      return;
    }
    const rect = this.overlayCanvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    for (let i = 0; i < this.layouts.length; i += 1) {
      const layout = this.layouts[i];
      if (
        x >= layout.x &&
        x <= layout.x + layout.width &&
        y >= layout.y &&
        y <= layout.y + layout.height
      ) {
        this.onSelect(i);
        break;
      }
    }
  };
}

function withAlpha(color: string, alpha: number) {
  if (color.startsWith("rgb(")) {
    return color.replace("rgb(", "rgba(").replace(")", `, ${alpha})`);
  }
  return color;
}

function sectionColor(index: number) {
  const hue = (index * 47) % 360;
  return `hsl(${hue}, 80%, 55%)`;
}

function quadraticPoint(p0: number, p1: number, p2: number, t: number) {
  const mt = 1 - t;
  return mt * mt * p0 + 2 * mt * t * p1 + t * t * p2;
}

function sampleQuadraticPath(
  x0: number,
  y0: number,
  cx: number,
  cy: number,
  x1: number,
  y1: number,
  steps: number,
) {
  const samples: Array<{ x: number; y: number; len: number }> = [];
  let prevX = x0;
  let prevY = y0;
  let total = 0;
  samples.push({ x: x0, y: y0, len: 0 });
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const x = quadraticPoint(x0, cx, x1, t);
    const y = quadraticPoint(y0, cy, y1, t);
    const dx = x - prevX;
    const dy = y - prevY;
    total += Math.hypot(dx, dy);
    samples.push({ x, y, len: total });
    prevX = x;
    prevY = y;
  }
  return samples;
}

function pointAtLength(path: ConnectionPath, length: number) {
  if (!path.samples.length) {
    return { x: path.fromX, y: path.startY };
  }
  const clamped = Math.max(0, Math.min(length, path.totalLength));
  const samples = path.samples;
  let idx = 0;
  while (idx < samples.length && samples[idx].len < clamped) {
    idx += 1;
  }
  if (idx === 0) {
    return { x: samples[0].x, y: samples[0].y };
  }
  const prev = samples[idx - 1];
  const cur = samples[Math.min(idx, samples.length - 1)];
  const span = cur.len - prev.len;
  const t = span === 0 ? 0 : (clamped - prev.len) / span;
  const x = prev.x + (cur.x - prev.x) * t;
  const y = prev.y + (cur.y - prev.y) * t;
  return { x, y };
}
