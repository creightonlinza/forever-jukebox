// Wub Machine dubstep samples (see samples/LICENSE), Opus-encoded.
const SAMPLE_URLS = import.meta.glob("./samples/dubstep/**/*.webm", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

export function dubstepSampleUrl(name: string): string {
  const url = SAMPLE_URLS[`./samples/dubstep/${name}.webm`];
  if (!url) {
    throw new Error(`Unknown dubstep sample: ${name}`);
  }
  return url;
}
