export function maybeDeleteVector(value: unknown) {
  if (value && typeof (value as { delete?: () => void }).delete === "function") {
    (value as { delete: () => void }).delete();
  }
}

export function vectorToArraySafe(essentia: any, value: unknown) {
  if (value && typeof (value as { size?: () => number }).size === "function") {
    if (typeof essentia.vectorToArray === "function") {
      return essentia.vectorToArray(value as unknown);
    }
  }
  if (value instanceof Float32Array) {
    return Array.from(value);
  }
  if (Array.isArray(value)) {
    return value.slice();
  }
  try {
    return Array.from(value as Iterable<number>);
  } catch {
    return [];
  }
}
