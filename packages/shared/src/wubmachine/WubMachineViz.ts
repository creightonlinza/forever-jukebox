import type { DubstepPartKind } from "./dubstepArrangement";
import type { DubstepRenderedPart } from "./dubstepRenderer";

const PART_COLORS: Record<DubstepPartKind, string> = {
  intro: "#3DD9C1",
  drop: "#9B5CFF",
  break: "#FF4FA3",
  ending: "#8A93A6",
};
const LOOP_COLOR = "#F1C47A";
const H_PAD = 20;
const PART_GAP = 2;

// Linear timeline of the remix: one waveform block per part, a playhead, and
// the loop-back arc while looping is on.
export class WubMachineViz {
  private readonly container: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private peaks: Float32Array = new Float32Array(0);
  private parts: DubstepRenderedPart[] = [];
  private duration = 0;
  private loopStart = 0;
  private loopEnd = 0;
  private loop = false;
  private seconds = 0;
  private visible = false;
  private width = 0;
  private height = 0;
  private playheadColor = "#ffffff";
  private onSelect: ((seconds: number) => void) | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    this.canvas = document.createElement("canvas");
    const ctx = this.canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Canvas not supported");
    }
    this.ctx = ctx;
    this.canvas.style.position = "absolute";
    this.canvas.style.inset = "0";
    this.canvas.style.display = "none";
    this.container.append(this.canvas);
    this.canvas.addEventListener("click", this.handleClick);
    this.resizeNow();
  }

  setVisible(visible: boolean) {
    this.visible = visible;
    this.canvas.style.display = visible ? "block" : "none";
    if (visible) {
      this.resizeNow();
    }
  }

  setOnSelect(handler: ((seconds: number) => void) | null) {
    this.onSelect = handler;
  }

  setData(
    peaks: Float32Array,
    duration: number,
    parts: DubstepRenderedPart[],
    loopStart: number,
    loopEnd: number,
  ) {
    this.peaks = peaks;
    this.duration = duration;
    this.parts = parts;
    this.loopStart = loopStart;
    this.loopEnd = loopEnd;
    this.seconds = 0;
    this.draw();
  }

  setLoop(loop: boolean) {
    this.loop = loop;
    this.draw();
  }

  update(seconds: number) {
    this.seconds = seconds;
    this.draw();
  }

  resizeNow() {
    const rect = this.container.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    this.width = rect.width;
    this.height = rect.height;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.playheadColor =
      getComputedStyle(this.container).getPropertyValue("--text").trim() ||
      this.playheadColor;
    this.draw();
  }

  destroy() {
    this.canvas.removeEventListener("click", this.handleClick);
    this.canvas.remove();
  }

  private xOf(seconds: number) {
    return H_PAD + (seconds / this.duration) * (this.width - 2 * H_PAD);
  }

  private readonly handleClick = (event: MouseEvent) => {
    if (this.duration <= 0 || this.width <= 2 * H_PAD) {
      return;
    }
    const rect = this.canvas.getBoundingClientRect();
    const ratio = (event.clientX - rect.left - H_PAD) / (this.width - 2 * H_PAD);
    this.onSelect?.(Math.max(0, Math.min(1, ratio)) * this.duration);
  };

  private draw() {
    const { ctx, width, height } = this;
    if (!this.visible || width === 0 || height === 0) {
      return;
    }
    ctx.clearRect(0, 0, width, height);
    if (this.duration <= 0 || width <= 2 * H_PAD) {
      return;
    }
    const blockHeight = Math.max(60, height * 0.45);
    const blockTop = Math.max(0, (height - blockHeight) / 2 + height * 0.08);
    const mid = blockTop + blockHeight / 2;
    const playheadX = this.xOf(this.seconds);

    for (const part of this.parts) {
      const left = this.xOf(part.start);
      const right = this.xOf(part.start + part.duration) - PART_GAP;
      ctx.fillStyle = PART_COLORS[part.kind];
      ctx.globalAlpha = 0.16;
      ctx.fillRect(left, blockTop, Math.max(1, right - left), blockHeight);
      for (let x = Math.ceil(left); x < right; x += 2) {
        const bin = Math.floor(
          ((x - H_PAD) / (width - 2 * H_PAD)) * this.peaks.length,
        );
        const peak = this.peaks[bin] ?? 0;
        const bar = Math.max(1, peak * blockHeight * 0.92);
        ctx.globalAlpha = x <= playheadX ? 1 : 0.5;
        ctx.fillRect(x, mid - bar / 2, 1.5, bar);
      }
    }
    ctx.globalAlpha = 1;

    if (this.loop && this.loopEnd > this.loopStart) {
      const fromX = this.xOf(this.loopEnd);
      const toX = this.xOf(this.loopStart);
      const arcTop = Math.max(8, blockTop - Math.min(blockTop - 8, height * 0.22));
      ctx.strokeStyle = LOOP_COLOR;
      ctx.fillStyle = LOOP_COLOR;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(fromX, blockTop - 4);
      ctx.bezierCurveTo(fromX, arcTop, toX, arcTop, toX, blockTop - 4);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(toX, blockTop - 2);
      ctx.lineTo(toX - 5, blockTop - 11);
      ctx.lineTo(toX + 5, blockTop - 11);
      ctx.closePath();
      ctx.fill();
    }

    ctx.fillStyle = this.playheadColor;
    ctx.fillRect(playheadX - 1, blockTop - 6, 2, blockHeight + 12);
  }
}
