import { describe, expect, it } from "vitest";
import { DEFAULT_JUKEBOX_CONFIG } from "@forever-jukebox/shared";
import { isFavoriteTuningDrifted } from "./favorite-drift";
import type { FavoriteTrack } from "./favorites";

function favorite(overrides: Partial<FavoriteTrack> = {}): FavoriteTrack {
  return {
    uniqueSongId: "a3f3c0dc73c6476c9db95c227f9206f2",
    title: "Song",
    artist: "Artist",
    duration: 123,
    sourceType: "youtube",
    ...overrides,
  };
}

function drifted(input: {
  favorite: FavoriteTrack | null;
  ready?: boolean;
  livePlayMode?: "jukebox" | "autocanonizer";
  liveTuningParams?: string | null;
}) {
  return isFavoriteTuningDrifted({
    favorite: input.favorite,
    ready: input.ready ?? true,
    livePlayMode: input.livePlayMode ?? "jukebox",
    liveTuningParams: input.liveTuningParams ?? null,
    defaults: { ...DEFAULT_JUKEBOX_CONFIG },
  });
}

describe("isFavoriteTuningDrifted", () => {
  it("is false without a matched favorite", () => {
    expect(drifted({ favorite: null, liveTuningParams: "jb=1" })).toBe(false);
  });

  it("is false until the track has loaded", () => {
    expect(
      drifted({
        favorite: favorite({ tuningParams: "jb=1" }),
        ready: false,
      }),
    ).toBe(false);
  });

  it("treats an absent favorite play mode as jukebox", () => {
    expect(drifted({ favorite: favorite() })).toBe(false);
    expect(
      drifted({ favorite: favorite(), livePlayMode: "autocanonizer" }),
    ).toBe(true);
  });

  it("drifts on a play mode mismatch alone", () => {
    expect(
      drifted({
        favorite: favorite({ playMode: "autocanonizer" }),
        livePlayMode: "jukebox",
      }),
    ).toBe(true);
  });

  it("compares only the mode outside jukebox", () => {
    expect(
      drifted({
        favorite: favorite({ playMode: "autocanonizer" }),
        livePlayMode: "autocanonizer",
        liveTuningParams: "jb=1",
      }),
    ).toBe(false);
  });

  it("ignores tuning an autocanonizer favorite still carries", () => {
    expect(
      drifted({
        favorite: favorite({
          playMode: "autocanonizer",
          tuningParams: "jb=1&thresh=45",
        }),
        livePlayMode: "autocanonizer",
        liveTuningParams: null,
      }),
    ).toBe(false);
  });

  it("drifts when live tuning differs from the snapshot", () => {
    expect(
      drifted({
        favorite: favorite({ tuningParams: "thresh=30" }),
        liveTuningParams: "thresh=45",
      }),
    ).toBe(true);
    expect(
      drifted({ favorite: favorite(), liveTuningParams: "jb=1" }),
    ).toBe(true);
  });

  it("equates foreign spellings of the same tuning", () => {
    expect(
      drifted({
        favorite: favorite({ tuningParams: "ah=1&thresh=45&jb=1&am=off" }),
        liveTuningParams: "jb=1&thresh=45",
      }),
    ).toBe(false);
    expect(
      drifted({
        favorite: favorite({ tuningParams: "" }),
        liveTuningParams: null,
      }),
    ).toBe(false);
  });
});
