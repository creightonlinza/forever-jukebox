export const DEFAULT_SWING_AMOUNT = 0.33;

const MIN_SWING_AMOUNT = -0.9;
const MAX_SWING_AMOUNT = 0.9;

export type BeatLike = {
  start: number;
  duration: number;
};

export type SwingSegment = {
  inputStart: number;
  inputDuration: number;
  outputDuration: number;
  playbackRate: number;
};

export function clampSwingAmount(swingAmount: number): number {
  if (!Number.isFinite(swingAmount)) {
    return DEFAULT_SWING_AMOUNT;
  }
  return Math.max(MIN_SWING_AMOUNT, Math.min(MAX_SWING_AMOUNT, swingAmount));
}

export function getSwingSegmentsForBeat(
  beat: BeatLike,
  swingAmount = DEFAULT_SWING_AMOUNT,
): [SwingSegment, SwingSegment] {
  const duration = Math.max(0, beat.duration);
  const half = duration / 2;
  const swing = clampSwingAmount(swingAmount);

  const outputADuration = half * (1 + swing);
  const outputBDuration = duration - outputADuration;
  const safeOutputADuration = Math.max(Number.EPSILON, outputADuration);
  const safeOutputBDuration = Math.max(Number.EPSILON, outputBDuration);

  return [
    {
      inputStart: beat.start,
      inputDuration: half,
      outputDuration: outputADuration,
      playbackRate: half / safeOutputADuration,
    },
    {
      inputStart: beat.start + half,
      inputDuration: half,
      outputDuration: outputBDuration,
      playbackRate: half / safeOutputBDuration,
    },
  ];
}

// Identifies the beat grid and swing amount a render was made from.
export function getSwingSignature(
  beats: BeatLike[],
  swingAmount = DEFAULT_SWING_AMOUNT,
): string {
  let hash = 2166136261;
  for (const beat of beats) {
    for (const seconds of [beat.start, beat.duration]) {
      hash = Math.imul(hash ^ Math.round(seconds * 1000), 16777619) >>> 0;
    }
  }
  return `${clampSwingAmount(swingAmount)}:${beats.length}:${hash.toString(16)}`;
}
