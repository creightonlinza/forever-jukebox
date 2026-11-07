export function fnv1a32(buffer: ArrayBuffer): string {
  const data = new Uint8Array(buffer);
  let hash = 0x811c9dc5;
  for (const byte of data) {
    hash ^= byte;
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
