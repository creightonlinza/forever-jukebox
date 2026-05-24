import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFavoritesSync,
  deleteJob,
  fetchAnalysis,
  searchSpotify,
  searchYoutube,
  fetchTopSongs,
  fetchTrendingSongs,
  fetchRecentSongs,
  fetchAppConfig,
  fetchFavoritesSync,
  updateFavoritesSync,
  fetchJobByTrack,
  fetchJobBySource,
  fetchAudio,
  recordPlay,
  startYoutubeAnalysis,
  startUrlAnalysis,
  uploadAudio,
} from "./api";
import { configureMaxFavorites } from "./favorites";

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

function createFavorite(index: number) {
  return {
    uniqueSongId: `youtube:${index}`,
    title: `Track ${index}`,
    artist: "Artist",
    duration: 123,
    sourceType: "youtube" as const,
  };
}

describe("api", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
    configureMaxFavorites(null);
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

  it("creates favorites sync", async () => {
    (fetch as any).mockResolvedValue(createResponse(200, { code: "sync123" }));
    const created = await createFavoritesSync([
      {
        uniqueSongId: "mvJjmWTg7Qo",
        title: "Track",
        artist: "Artist",
        duration: 123,
        sourceType: "youtube",
        tuningParams: "jb=1&ah=1",
      },
    ]);
    expect(created.code).toBe("sync123");
    expect(fetch).toHaveBeenCalledWith(
      "/api/favorites/sync",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          favorites: [
            {
              uniqueSongId: "mvJjmWTg7Qo",
              title: "Track",
              artist: "Artist",
              duration: 123,
              sourceType: "youtube",
              tuningParams: "jb=1&ah=1",
            },
          ],
        }),
      }),
    );
  });

  it("trims favorites sync create payloads to 150 items", async () => {
    (fetch as any).mockResolvedValue(createResponse(200, { code: "sync123" }));

    await createFavoritesSync(
      Array.from({ length: 151 }, (_, index) => createFavorite(index)),
    );

    const [, options] = (fetch as any).mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.favorites).toHaveLength(150);
  });

  it("trims favorites sync update payloads to 150 items", async () => {
    (fetch as any).mockResolvedValue(createResponse(200, { count: 150 }));

    await updateFavoritesSync(
      "sync123",
      Array.from({ length: 151 }, (_, index) => createFavorite(index)),
    );

    const [, options] = (fetch as any).mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.favorites).toHaveLength(150);
  });

  it("trims favorites sync payloads to the configured max", async () => {
    configureMaxFavorites(2);
    (fetch as any).mockResolvedValue(createResponse(200, { code: "sync123" }));

    await createFavoritesSync(
      Array.from({ length: 3 }, (_, index) => createFavorite(index)),
    );

    const [, options] = (fetch as any).mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.favorites).toHaveLength(2);
  });

  it("returns empty favorites sync when payload missing", async () => {
    (fetch as any).mockResolvedValue(createResponse(200, { nope: true }));
    const sync = await fetchFavoritesSync("abc");
    expect(sync).toEqual([]);
  });

  it("fetches app config", async () => {
    (fetch as any).mockResolvedValue(
      createResponse(200, { allow_user_upload: true, allow_user_url: false }),
    );
    const config = await fetchAppConfig();
    expect(config.allow_user_upload).toBe(true);
  });

  it("searches spotify", async () => {
    (fetch as any).mockResolvedValue(
      createResponse(200, { items: [{ name: "Song", artist: "Artist" }] }),
    );
    const items = await searchSpotify("query");
    expect(items.length).toBe(1);
    expect(fetch).toHaveBeenCalledWith("/api/search/spotify?q=query", undefined);
  });

  it("searches youtube with target duration", async () => {
    (fetch as any).mockResolvedValue(
      createResponse(200, { items: [{ id: "abc123def45", title: "Song" }] }),
    );
    const items = await searchYoutube("query", 180);
    expect(items.length).toBe(1);
    expect(fetch).toHaveBeenCalledWith(
      "/api/search/youtube?q=query&target_duration=180",
      undefined,
    );
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
      startYoutubeAnalysis({
        youtube_id: "dQw4w9WgXcQ",
      }),
    ).rejects.toMatchObject({
      message: "Error: Sorry, the max track length for this server is 12 minutes.",
      code: "track_too_long",
      status: 422,
    });
  });

  it("starts analysis from URL endpoint", async () => {
    (fetch as any).mockResolvedValue(
      createResponse(202, {
        status: "downloading",
        id: "job-url",
        source_provider: "soundcloud",
      }),
    );
    const result = await startUrlAnalysis({
      url: "https://soundcloud.com/artist/track",
    });
    expect(result?.status).toBe("downloading");
    if (result?.status === "downloading") {
      expect(result.source_id).toBeUndefined();
      expect(result.source_provider).toBe("soundcloud");
    }
    expect(fetch).toHaveBeenCalledWith(
      "/api/analysis/url",
      expect.objectContaining({ method: "POST" }),
    );
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

  it("parses queued lookup response from by-source", async () => {
    (fetch as any).mockResolvedValue(
      createResponse(202, {
        status: "queued",
        id: "job-q",
        message: "Queued • Next in line",
      }),
    );
    const result = await fetchJobBySource("youtube", "yt-q");
    expect(result?.status).toBe("queued");
    if (result?.status === "queued") {
      expect(result.id).toBe("job-q");
    }
  });

  it("parses downloading lookup response from by-source", async () => {
    (fetch as any).mockResolvedValue(
      createResponse(202, {
        status: "downloading",
        id: "job-d",
        message: "Fetching audio",
      }),
    );
    const result = await fetchJobBySource("youtube", "yt-d");
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

  it("returns null for missing by-source lookup", async () => {
    (fetch as any).mockResolvedValue(createResponse(404, {}));
    const result = await fetchJobBySource("youtube", "missing");
    expect(result).toBeNull();
  });

  it("looks up job by source id", async () => {
    (fetch as any).mockResolvedValue(
      createResponse(202, {
        status: "queued",
        id: "job-src",
        source_id: "xyz",
        source_provider: "bandcamp",
      }),
    );
    const result = await fetchJobBySource("bandcamp", "xyz");
    expect(result?.status).toBe("queued");
    expect(fetch).toHaveBeenCalledWith("/api/jobs/by-source/bandcamp/xyz");
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

  it("records play and throws on failure", async () => {
    (fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
    });
    await expect(recordPlay("job1")).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledWith("/api/plays/job1", { method: "POST" });

    (fetch as any).mockResolvedValueOnce(createResponse(500, {}, false));
    await expect(recordPlay("job1")).rejects.toThrow("Play count failed");
  });

  it("deletes job and throws on failure", async () => {
    (fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
    });
    await expect(deleteJob("job1")).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledWith("/api/jobs/job1", { method: "DELETE" });

    (fetch as any).mockResolvedValueOnce(createResponse(403, {}, false));
    await expect(deleteJob("job1")).rejects.toMatchObject({
      message: "Delete failed (403)",
      status: 403,
    });
  });

  it("uploads audio file", async () => {
    (fetch as any).mockResolvedValue(
      createResponse(202, {
        status: "queued",
        id: "job-upload",
      }),
    );
    const file = new File(["abc"], "clip.mp3", { type: "audio/mpeg" });
    const result = await uploadAudio(file);
    expect(result?.status).toBe("queued");
    expect(fetch).toHaveBeenCalledWith(
      "/api/upload",
      expect.objectContaining({
        method: "POST",
        body: expect.any(FormData),
      }),
    );
  });
});
