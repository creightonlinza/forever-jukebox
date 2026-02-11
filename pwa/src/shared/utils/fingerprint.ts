import { fnv1a32 } from "./hash";

const DEFAULT_BYTES = 65536;

export async function computeFingerprint(file: File, bytes = DEFAULT_BYTES) {
  const headerSlice = file.slice(0, bytes);
  const buffer = typeof headerSlice.arrayBuffer === "function"
    ? await headerSlice.arrayBuffer()
    : await new Response(headerSlice).arrayBuffer();
  const hash = fnv1a32(buffer);
  return [
    "v1",
    sanitizeFingerprintPart(file.name),
    file.size.toString(10),
    file.lastModified.toString(10),
    hash,
  ].join("-");
}

function sanitizeFingerprintPart(value: string) {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "_");
}
