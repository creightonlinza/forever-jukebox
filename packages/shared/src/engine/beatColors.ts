import type { QuantumBase, Segment } from "./types";

const NO_SEGMENT_COLOR = "#333333";

// One hex color per beat, from timbre coefficients 1-3 normalized across the track.
export function computeBeatColors(
  beats: QuantumBase[],
  segments: Segment[],
): string[] {
  const min = [100, 100, 100];
  const max = [-100, -100, -100];
  for (const seg of segments) {
    for (let i = 0; i < 3; i += 1) {
      const value = seg.timbre[i + 1];
      if (value < min[i]) {
        min[i] = value;
      }
      if (value > max[i]) {
        max[i] = value;
      }
    }
  }
  return beats.map((beat) => {
    const segment = beat.overlappingSegments[0];
    if (!segment) {
      return NO_SEGMENT_COLOR;
    }
    const color = [];
    for (let i = 0; i < 3; i += 1) {
      const value = segment.timbre[i + 1];
      const range = max[i] - min[i];
      const norm = range === 0 ? 0.5 : (value - min[i]) / range;
      color[i] = Math.max(0, Math.min(255, Math.round(norm * 255)));
    }
    return toHex(color[1], color[2], color[0]);
  });
}

function toHex(r: number, g: number, b: number) {
  const convert = (value: number) => value.toString(16).padStart(2, "0");
  return `#${convert(r)}${convert(g)}${convert(b)}`;
}
