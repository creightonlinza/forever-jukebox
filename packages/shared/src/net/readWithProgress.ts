// Reads a response body into one buffer, reporting 0..1 download progress when the size is known.
// A buffer of the announced size keeps peak memory at the file size, which matters on Chromecast.
export async function readWithProgress(
  response: Response,
  onProgress?: (fraction: number) => void,
): Promise<ArrayBuffer> {
  if (!onProgress || !response.body) {
    return response.arrayBuffer();
  }
  const total = Number(response.headers.get("content-length"));
  const encoding = response.headers.get("content-encoding");
  // A compressed body's Content-Length counts encoded bytes, so it cannot measure the decoded stream.
  if (!total || (encoding && encoding !== "identity")) {
    return response.arrayBuffer();
  }
  const bytes = new Uint8Array(total);
  const reader = response.body.getReader();
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (received + value.length > total) {
      await reader.cancel();
      throw new Error("Download is longer than its Content-Length");
    }
    bytes.set(value, received);
    received += value.length;
    onProgress(received / total);
  }
  return received === total ? bytes.buffer : bytes.slice(0, received).buffer;
}
