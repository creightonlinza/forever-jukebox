export function createSessionSeed(): number {
  if ("crypto" in globalThis && "getRandomValues" in globalThis.crypto) {
    const arr = new Uint32Array(1);
    globalThis.crypto.getRandomValues(arr);
    return arr[0] >>> 0;
  }
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}

export function waitForNextPaint(): Promise<void> {
  if ("requestAnimationFrame" in window) {
    return new Promise((resolve) => {
      window.requestAnimationFrame(() => resolve());
    });
  }
  return Promise.resolve();
}
