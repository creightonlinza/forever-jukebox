export type Fft = {
  size: number;
  // In place; the inverse is unscaled, so divide by `size` afterwards.
  transform(real: Float64Array, imag: Float64Array, inverse?: boolean): void;
};

type Radix2Tables = {
  size: number;
  bitReversal: Uint32Array;
  cos: Float64Array;
  sin: Float64Array;
};

function isPowerOfTwo(value: number) {
  return value > 0 && (value & (value - 1)) === 0;
}

function createRadix2Tables(size: number): Radix2Tables {
  const bits = Math.log2(size);
  const bitReversal = new Uint32Array(size);
  for (let idx = 0; idx < size; idx += 1) {
    let reversed = 0;
    for (let bit = 0; bit < bits; bit += 1) {
      reversed = (reversed << 1) | ((idx >> bit) & 1);
    }
    bitReversal[idx] = reversed;
  }
  const cos = new Float64Array(size / 2);
  const sin = new Float64Array(size / 2);
  for (let idx = 0; idx < size / 2; idx += 1) {
    cos[idx] = Math.cos((2 * Math.PI * idx) / size);
    sin[idx] = Math.sin((2 * Math.PI * idx) / size);
  }
  return { size, bitReversal, cos, sin };
}

function transformRadix2(
  tables: Radix2Tables,
  real: Float64Array,
  imag: Float64Array,
  inverse: boolean,
) {
  const { size, bitReversal, cos, sin } = tables;
  for (let idx = 0; idx < size; idx += 1) {
    const swap = bitReversal[idx];
    if (swap > idx) {
      const swapReal = real[idx];
      real[idx] = real[swap];
      real[swap] = swapReal;
      const swapImag = imag[idx];
      imag[idx] = imag[swap];
      imag[swap] = swapImag;
    }
  }
  const sign = inverse ? 1 : -1;
  for (let span = 2; span <= size; span *= 2) {
    const half = span / 2;
    const step = size / span;
    for (let start = 0; start < size; start += span) {
      for (let idx = 0; idx < half; idx += 1) {
        const twiddleCos = cos[idx * step];
        const twiddleSin = sign * sin[idx * step];
        const even = start + idx;
        const odd = even + half;
        const oddReal = real[odd] * twiddleCos - imag[odd] * twiddleSin;
        const oddImag = real[odd] * twiddleSin + imag[odd] * twiddleCos;
        real[odd] = real[even] - oddReal;
        imag[odd] = imag[even] - oddImag;
        real[even] += oddReal;
        imag[even] += oddImag;
      }
    }
  }
}

// Splits the input into three interleaved sequences, transforms each at a
// third of the size, and recombines them with one twiddle per output bin.
function createRadix3Fft(size: number): Fft {
  const third = size / 3;
  const tables = createRadix2Tables(third);
  const partReal = [0, 1, 2].map(() => new Float64Array(third));
  const partImag = [0, 1, 2].map(() => new Float64Array(third));
  const cos = new Float64Array(size);
  const sin = new Float64Array(size);
  for (let idx = 0; idx < size; idx += 1) {
    cos[idx] = Math.cos((2 * Math.PI * idx) / size);
    sin[idx] = Math.sin((2 * Math.PI * idx) / size);
  }
  return {
    size,
    transform(real, imag, inverse = false) {
      for (let idx = 0; idx < third; idx += 1) {
        for (let part = 0; part < 3; part += 1) {
          partReal[part][idx] = real[3 * idx + part];
          partImag[part][idx] = imag[3 * idx + part];
        }
      }
      for (let part = 0; part < 3; part += 1) {
        transformRadix2(tables, partReal[part], partImag[part], inverse);
      }
      const sign = inverse ? 1 : -1;
      for (let bin = 0; bin < size; bin += 1) {
        const source = bin % third;
        const firstCos = cos[bin];
        const firstSin = sign * sin[bin];
        const second = (2 * bin) % size;
        const secondCos = cos[second];
        const secondSin = sign * sin[second];
        real[bin] =
          partReal[0][source] +
          partReal[1][source] * firstCos -
          partImag[1][source] * firstSin +
          partReal[2][source] * secondCos -
          partImag[2][source] * secondSin;
        imag[bin] =
          partImag[0][source] +
          partReal[1][source] * firstSin +
          partImag[1][source] * firstCos +
          partReal[2][source] * secondSin +
          partImag[2][source] * secondCos;
      }
    },
  };
}

// Supports sizes of the form 2^k and 3 * 2^k.
export function createFft(size: number): Fft {
  if (isPowerOfTwo(size)) {
    const tables = createRadix2Tables(size);
    return {
      size,
      transform(real, imag, inverse = false) {
        transformRadix2(tables, real, imag, inverse);
      },
    };
  }
  if (size % 3 === 0 && isPowerOfTwo(size / 3)) {
    return createRadix3Fft(size);
  }
  throw new Error(`Unsupported FFT size ${size}`);
}

// Periodic Hann window: overlapped squares sum to a constant.
export function createHannWindow(size: number): Float64Array {
  const window = new Float64Array(size);
  for (let idx = 0; idx < size; idx += 1) {
    window[idx] = 0.5 - 0.5 * Math.cos((2 * Math.PI * idx) / size);
  }
  return window;
}
