import { describe, expect, it } from "vitest";
import { createFft, createHannWindow } from "./fft";

function naiveDft(real: Float64Array, imag: Float64Array) {
  const size = real.length;
  const outReal = new Float64Array(size);
  const outImag = new Float64Array(size);
  for (let bin = 0; bin < size; bin += 1) {
    for (let idx = 0; idx < size; idx += 1) {
      const angle = (-2 * Math.PI * bin * idx) / size;
      outReal[bin] += real[idx] * Math.cos(angle) - imag[idx] * Math.sin(angle);
      outImag[bin] += real[idx] * Math.sin(angle) + imag[idx] * Math.cos(angle);
    }
  }
  return { real: outReal, imag: outImag };
}

function signal(size: number) {
  const real = new Float64Array(size);
  const imag = new Float64Array(size);
  for (let idx = 0; idx < size; idx += 1) {
    real[idx] = Math.sin(idx * 0.37) + 0.25 * Math.cos(idx * 1.9);
    imag[idx] = 0.5 * Math.sin(idx * 0.11);
  }
  return { real, imag };
}

describe("createFft", () => {
  it.each([8, 64, 12, 48, 96])("matches a direct DFT at size %i", (size) => {
    const { real, imag } = signal(size);
    const expected = naiveDft(real, imag);
    createFft(size).transform(real, imag);
    for (let bin = 0; bin < size; bin += 1) {
      expect(real[bin]).toBeCloseTo(expected.real[bin], 9);
      expect(imag[bin]).toBeCloseTo(expected.imag[bin], 9);
    }
  });

  it.each([4096, 6144])("round-trips at size %i", (size) => {
    const { real, imag } = signal(size);
    const original = Float64Array.from(real);
    const fft = createFft(size);
    fft.transform(real, imag);
    fft.transform(real, imag, true);
    for (let idx = 0; idx < size; idx += 97) {
      expect(real[idx] / size).toBeCloseTo(original[idx], 9);
    }
  });

  it("puts a bin-centred sine in its bin at size 6144", () => {
    const size = 6144;
    const real = new Float64Array(size);
    const imag = new Float64Array(size);
    for (let idx = 0; idx < size; idx += 1) {
      real[idx] = Math.sin((2 * Math.PI * 100 * idx) / size);
    }
    createFft(size).transform(real, imag);
    expect(Math.hypot(real[100], imag[100])).toBeCloseTo(size / 2, 6);
    expect(Math.hypot(real[101], imag[101])).toBeCloseTo(0, 6);
  });

  it("rejects unsupported sizes", () => {
    expect(() => createFft(5120)).toThrow(/Unsupported FFT size/);
  });
});

describe("createHannWindow", () => {
  it("has overlapped squares that sum to a constant", () => {
    const size = 6144;
    const hop = 1024;
    const window = createHannWindow(size);
    for (const offset of [0, 1, 500, 1023]) {
      let sum = 0;
      for (let idx = offset; idx < size; idx += hop) {
        sum += window[idx] ** 2;
      }
      expect(sum).toBeCloseTo(2.25, 9);
    }
  });
});
