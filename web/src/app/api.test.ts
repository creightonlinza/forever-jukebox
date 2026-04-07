import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchAnalysis,
  fetchTopSongs,
  fetchTrendingSongs,
  fetchRecentSongs,
  fetchAppConfig,
  fetchFavoritesSync,
  updateFavoritesSync,
  fetchJobByTrack,
  fetchJobByYoutube,
  fetchAudio,
  startYoutubeAnalysis,
} from "./api";

function createResponse(
  status: number,
  body: unknown,
  ok = status >= 200 && status < 300,
) {
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

describe("api", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  it("returns null on 404 analysis", async () => {
    (fetch as any).mockResolvedValue(createResponse(404, {}));
    const result = await fetchAnalysis("missing");
    expect(result).toBeNull();
  });

  it("parses analysis in progress", async () => {
    (fetch as any).mockResolvedValue(
      createResponse(200, {
        status: "processing",
        id: "job1",
        progress: 50,
        message: "Working",
      }),
    );
    const result = await fetchAnalysis("job1");
    expect(result?.status).toBe("processing");
    if (result?.status === "processing") {
      expect(result.progress).toBe(50);
    }
  });

  it("parses analysis complete", async () => {
    (fetch as any).mockResolvedValue(
      createResponse(200, {
        status: "complete",
        id: "job2",
        result: { track: { title: "Hi" } },
      }),
    );
    const result = await fetchAnalysis("job2");
    expect(result?.status).toBe("complete");
    if (result?.status === "complete") {
      expect(result.id).toBe("job2");
    }
  });

  it("throws on non-ok response", async () => {
    (fetch as any).mockResolvedValue(createResponse(500, {}, false));
    await expect(fetchAnalysis("err")).rejects.toThrow("Request failed");
  });

  it("fetches top songs", async () => {
    (fetch as any).mockResolvedValue(
      createResponse(200, { items: [{ title: "Song" }] }),
    );
    const result = await fetchTopSongs(3);
    expect(result.length).toBe(1);
  });

  it("fetches recent songs", async () => {
    (fetch as any).mockResolvedValue(
      createResponse(200, { items: [{ title: "Song" }] }),
    );
    const result = await fetchRecentSongs(3);
    expect(result.length).toBe(1);
  });

  it("fetches trending songs", async () => {
    (fetch as any).mockResolvedValue(
      createResponse(200, { items: [{ title: "Song" }] }),
    );
    const result = await fetchTrendingSongs();
    expect(result.length).toBe(1);
    expect(fetch).toHaveBeenCalledWith("/api/trending?limit=25", undefined);
  });

  it("fetches and updates favorites sync", async () => {
    (fetch as any)
      .mockResolvedValueOnce(createResponse(200, { favorites: [] }))
      .mockResolvedValueOnce(createResponse(200, { count: 1 }));
    const sync = await fetchFavoritesSync("abc");
    expect(Array.isArray(sync)).toBe(true);
    const updated = await updateFavoritesSync("abc", []);
    expect(updated.count).toBe(1);
  });

  it("returns empty favorites sync when payload missing", async () => {
    (fetch as any).mockResolvedValue(createResponse(200, { nope: true }));
    const sync = await fetchFavoritesSync("abc");
    expect(sync).toEqual([]);
  });

  it("fetches app config", async () => {
    (fetch as any).mockResolvedValue(
      createResponse(200, { allow_user_upload: true, allow_user_youtube: false }),
    );
    const config = await fetchAppConfig();
    expect(config.allow_user_upload).toBe(true);
  });

  it("surfaces youtube start validation errors", async () => {
    (fetch as any).mockResolvedValue(
      createResponse(
        422,
        {
          detail: {
            error_code: "track_too_long",
            message: "Error: Sorry, the max track length for this server is 12 minutes.",
          },
        },
        false,
      ),
    );
    await expect(
      startYoutubeAnalysis({ youtube_id: "dQw4w9WgXcQ", is_user_supplied: true }),
    ).rejects.toMatchObject({
      message: "Error: Sorry, the max track length for this server is 12 minutes.",
      code: "track_too_long",
      status: 422,
    });
  });

  it("returns failed lookup response without client-side repair", async () => {
    (fetch as any).mockResolvedValue(
      createResponse(200, {
        status: "failed",
        id: "job1",
        error: "Analysis missing",
      }),
    );
    const result = await fetchJobByTrack("Song", "Artist");
    expect(result?.status).toBe("failed");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("parses queued lookup response from by-youtube", async () => {
    (fetch as any).mockResolvedValue(
      createResponse(202, {
        status: "queued",
        id: "job-q",
        message: "Queued • Next in line",
      }),
    );
    const result = await fetchJobByYoutube("yt-q");
    expect(result?.status).toBe("queued");
    if (result?.status === "queued") {
      expect(result.id).toBe("job-q");
    }
  });

  it("parses downloading lookup response from by-youtube", async () => {
    (fetch as any).mockResolvedValue(
      createResponse(202, {
        status: "downloading",
        id: "job-d",
        message: "Fetching audio",
      }),
    );
    const result = await fetchJobByYoutube("yt-d");
    expect(result?.status).toBe("downloading");
    if (result?.status === "downloading") {
      expect(result.id).toBe("job-d");
    }
  });

  it("returns null for missing track lookup", async () => {
    (fetch as any).mockResolvedValue(createResponse(404, {}));
    const result = await fetchJobByTrack("Song", "Artist");
    expect(result).toBeNull();
  });

  it("returns null for missing by-youtube lookup", async () => {
    (fetch as any).mockResolvedValue(createResponse(404, {}));
    const result = await fetchJobByYoutube("missing");
    expect(result).toBeNull();
  });

  it("fetches audio and throws on failure", async () => {
    (fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      arrayBuffer: async () => new ArrayBuffer(3),
    });
    const buffer = await fetchAudio("job1");
    expect(buffer.byteLength).toBe(3);

    (fetch as any).mockResolvedValueOnce(createResponse(500, {}, false));
    await expect(fetchAudio("job1")).rejects.toThrow("Audio download failed");
  });
});
