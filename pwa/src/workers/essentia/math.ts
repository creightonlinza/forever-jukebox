export function smooth(values: Float32Array, window: number) {
  if (window <= 1 || values.length === 0) {
    return values.slice();
  }
  const windowSize = Math.max(1, window);
  const out = new Float32Array(values.length);
  const half = Math.floor(windowSize / 2);
  const denom = windowSize;
  for (let i = 0; i < values.length; i += 1) {
    let acc = 0;
    for (let j = 0; j < windowSize; j += 1) {
      const idx = Math.min(values.length - 1, Math.max(0, i - half + j));
      acc += values[idx];
    }
    out[i] = acc / denom;
  }
  return out;
}

export function zscore2d(values: number[][]) {
  if (values.length === 0) {
    return values;
  }
  const dim = values[0].length;
  const mean = new Array(dim).fill(0);
  const std = new Array(dim).fill(0);
  for (const row of values) {
    for (let i = 0; i < dim; i += 1) {
      mean[i] += row[i];
    }
  }
  for (let i = 0; i < dim; i += 1) {
    mean[i] /= values.length;
  }
  for (const row of values) {
    for (let i = 0; i < dim; i += 1) {
      const delta = row[i] - mean[i];
      std[i] += delta * delta;
    }
  }
  for (let i = 0; i < dim; i += 1) {
    std[i] = Math.sqrt(std[i] / values.length);
    if (std[i] < 1e-6) {
      std[i] = 1;
    }
  }
  return values.map((row) => row.map((value, idx) => (value - mean[idx]) / std[idx]));
}

export function zscore1d(values: number[]) {
  if (values.length === 0) {
    return values;
  }
  const mean = values.reduce((acc, v) => acc + v, 0) / values.length;
  let variance = 0;
  for (const v of values) {
    variance += (v - mean) ** 2;
  }
  const std = Math.sqrt(variance / values.length) || 1;
  return values.map((v) => (v - mean) / std);
}

export function findPeaks(
  values: Float32Array,
  height: number,
  prominence: number
) {
  const peaks: number[] = [];
  for (let i = 1; i < values.length - 1; i += 1) {
    if (values[i] <= values[i - 1] || values[i] < values[i + 1]) {
      continue;
    }
    if (values[i] < height) {
      continue;
    }
    let leftMin = values[i];
    for (let j = i - 1; j >= 0; j -= 1) {
      leftMin = Math.min(leftMin, values[j]);
      if (values[j] > values[i]) {
        break;
      }
    }
    let rightMin = values[i];
    for (let j = i + 1; j < values.length; j += 1) {
      rightMin = Math.min(rightMin, values[j]);
      if (values[j] > values[i]) {
        break;
      }
    }
    const prom = values[i] - Math.max(leftMin, rightMin);
    if (prom >= prominence) {
      peaks.push(i);
    }
  }
  return peaks;
}
