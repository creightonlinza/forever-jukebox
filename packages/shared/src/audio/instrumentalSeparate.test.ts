import { describe, expect, it, vi } from "vitest";
import {
  MDX_SAMPLE_RATE,
  MODEL_INPUT_LENGTH,
  STEP_SAMPLES,
  countChunks,
  separateInstrumental,
  type RunMdxModel,
} from "./instrumentalSeparate";

function sine(frequency: number, length: number, amplitude = 0.5) {
  const samples = new Float32Array(length);
  for (let idx = 0; idx < length; idx += 1) {
    samples[idx] =
      amplitude * Math.sin((2 * Math.PI * frequency * idx) / MDX_SAMPLE_RATE);
  }
  return samples;
}

function maxError(actual: Float32Array, expected: Float32Array) {
  let max = 0;
  for (let idx = 0; idx < expected.length; idx += 1) {
    max = Math.max(max, Math.abs(actual[idx] - expected[idx]));
  }
  return max;
}

const keepEverything: RunMdxModel = async (input) => input;

describe("separateInstrumental", () => {
  it("reconstructs the input when the model keeps everything", async () => {
    const length = MDX_SAMPLE_RATE;
    const left = sine(440, length);
    const right = sine(3_000, length, 0.3);

    const result = await separateInstrumental(
      left,
      right,
      keepEverything,
      vi.fn(),
    );

    expect(result.left).toHaveLength(length);
    expect(result.right).toHaveLength(length);
    expect(maxError(result.left, left)).toBeLessThan(1e-4);
    expect(maxError(result.right, right)).toBeLessThan(1e-4);
  });

  it("is continuous across chunk boundaries", async () => {
    const length = STEP_SAMPLES + MDX_SAMPLE_RATE;
    const left = sine(440, length);
    const runModel = vi.fn(keepEverything);
    const onProgress = vi.fn();

    const result = await separateInstrumental(
      left,
      left,
      runModel,
      onProgress,
    );

    expect(countChunks(length)).toBe(2);
    expect(runModel).toHaveBeenCalledTimes(2);
    expect(runModel.mock.calls[0][0]).toHaveLength(MODEL_INPUT_LENGTH);
    expect(onProgress.mock.calls.map(([value]) => value)).toEqual([0.5, 1]);
    expect(maxError(result.left, left)).toBeLessThan(1e-4);
  });

  it("outputs silence when the model keeps nothing", async () => {
    const left = sine(440, MDX_SAMPLE_RATE);
    const result = await separateInstrumental(
      left,
      left,
      async () => new Float32Array(MODEL_INPUT_LENGTH),
      vi.fn(),
    );
    expect(maxError(result.left, new Float32Array(left.length))).toBe(0);
  });

  it("rejects model output of the wrong size", async () => {
    const left = sine(440, MDX_SAMPLE_RATE);
    await expect(
      separateInstrumental(
        left,
        left,
        async () => new Float32Array(4),
        vi.fn(),
      ),
    ).rejects.toThrow(/unexpected output size/);
  });
});
