export function fnv1a32(buffer: ArrayBuffer): string {
  const data = new Uint8Array(buffer);
  let hash = 0x811c9dc5;
  for (let i = 0; i < data.length; i += 1) {
    hash ^= data[i];
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
