import { describe, expect, it, beforeEach } from "vitest";
import {
  addFavorite,
  filterFavorites,
  isFavorite,
  loadFavorites,
  loadFavoritesSyncCode,
  maxFavorites,
  removeFavorite,
  saveFavorites,
  saveFavoritesSyncCode,
} from "./favorites";

function setLocalStorage() {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  } as Storage;
  return store;
}

describe("favorites", () => {
  beforeEach(() => {
    setLocalStorage();
  });

  it("loads and saves favorites with sorting", () => {
    const items = [
      {
        uniqueSongId: "2",
        title: "B",
        artist: "C",
        duration: 1,
        sourceType: "youtube" as const,
        tuningParams: "jb=1&d=2",
      },
      {
        uniqueSongId: "1",
        title: "A",
        artist: "Z",
        duration: 2,
        sourceType: "youtube" as const,
      },
    ];
    saveFavorites(items);
    const loaded = loadFavorites();
    expect(loaded[0].uniqueSongId).toBe("1");
    expect(loaded[1].uniqueSongId).toBe("2");
    expect(loaded[1].tuningParams).toBe("jb=1&d=2");
  });

  it("enforces favorite limit and handles duplicates", () => {
    const base = Array.from({ length: maxFavorites() }, (_, i) => ({
      uniqueSongId: `${i}`,
      title: `Track ${i}`,
      artist: "Artist",
      duration: null,
      sourceType: "youtube" as const,
    }));
    const result = addFavorite(base, base[0]);
    expect(result.status).toBe("duplicate");
    const extra = {
      uniqueSongId: "extra",
      title: "Extra",
      artist: "Artist",
      duration: null,
      sourceType: "youtube" as const,
    };
    const limited = addFavorite(base, extra);
    expect(limited.status).toBe("limit");
  });

  it("removes favorites", () => {
    const items = [
      {
        uniqueSongId: "1",
        title: "A",
        artist: "B",
        duration: 1,
        sourceType: "youtube" as const,
      },
    ];
    const next = removeFavorite(items, "1");
    expect(next.length).toBe(0);
  });

  it("filters favorites by title, artist, id, and source", () => {
    const items = [
      {
        uniqueSongId: "yt-123",
        title: "Midnight City",
        artist: "M83",
        duration: 1,
        sourceType: "youtube" as const,
      },
      {
        uniqueSongId: "bandcamp:abc",
        title: "Roads",
        artist: "Portishead",
        duration: 2,
        sourceType: "bandcamp" as const,
      },
      {
        uniqueSongId: "upload-job",
        title: "Local Mix",
        artist: "Unknown",
        duration: null,
        sourceType: "upload" as const,
      },
    ];

    expect(filterFavorites(items, "city").map((item) => item.uniqueSongId)).toEqual([
      "yt-123",
    ]);
    expect(filterFavorites(items, "PORTIS").map((item) => item.uniqueSongId)).toEqual([
      "bandcamp:abc",
    ]);
    expect(filterFavorites(items, "  yt-123  ").map((item) => item.uniqueSongId)).toEqual([
      "yt-123",
    ]);
    expect(filterFavorites(items, "upload").map((item) => item.uniqueSongId)).toEqual([
      "upload-job",
    ]);
    expect(filterFavorites(items, "")).toBe(items);
  });

  it("checks favorite presence", () => {
    expect(isFavorite([], "1")).toBe(false);
  });

  it("preserves tuning params from favorites", () => {
    const items = [
      {
        uniqueSongId: "1",
        title: "A",
        artist: "B",
        duration: 1,
        sourceType: "youtube" as const,
        tuningParams: "ah=1",
      },
      {
        uniqueSongId: "2",
        title: "B",
        artist: "C",
        duration: 1,
        sourceType: "youtube" as const,
        tuningParams: "jb=1&ah=1&d=2,8",
      },
    ];
    saveFavorites(items);
    const loaded = loadFavorites();
    expect(loaded.find((item) => item.uniqueSongId === "1")?.tuningParams).toBe("ah=1");
    expect(loaded.find((item) => item.uniqueSongId === "2")?.tuningParams).toBe("jb=1&ah=1&d=2,8");
  });

  it("handles sync code normalization", () => {
    saveFavoritesSyncCode("  AbC ");
    expect(loadFavoritesSyncCode()).toBe("abc");
  });
});
