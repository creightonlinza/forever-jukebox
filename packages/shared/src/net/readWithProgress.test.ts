import { describe, expect, it } from "vitest";
import { readWithProgress } from "./readWithProgress";

function chunked(chunks: number[][], headers: Record<string, string>) {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(new Uint8Array(chunk)));
      controller.close();
    },
  });
  return new Response(body, { headers });
}

describe("readWithProgress", () => {
  it("fills one buffer and reports progress against Content-Length", async () => {
    const progress: number[] = [];
    const buffer = await readWithProgress(chunked([[1, 2], [3, 4]], { "content-length": "4" }), (f) =>
      progress.push(f),
    );
    expect([...new Uint8Array(buffer)]).toEqual([1, 2, 3, 4]);
    expect(progress).toEqual([0.5, 1]);
  });

  it("reports no progress for a compressed body", async () => {
    const progress: number[] = [];
    const response = chunked([[1, 2, 3]], { "content-length": "2", "content-encoding": "gzip" });
    const buffer = await readWithProgress(response, (f) => progress.push(f));
    expect(buffer.byteLength).toBe(3);
    expect(progress).toEqual([]);
  });

  it("rejects a body longer than its Content-Length", async () => {
    const response = chunked([[1, 2], [3]], { "content-length": "2" });
    await expect(readWithProgress(response, () => undefined)).rejects.toThrow("Content-Length");
  });
});
