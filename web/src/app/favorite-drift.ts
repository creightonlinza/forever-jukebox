import type { JukeboxConfig } from "@forever-jukebox/shared";
import type { FavoriteTrack } from "./favorites";
import { savedTuningParamsEquivalent } from "./tuning";

// Live-vs-snapshot drift for the currently loaded, currently favorited track.
// No persisted dirty flag: restoring the saved tuning clears drift on its own.
// Known residual: a favorite from another client pinning `thresh` to exactly
// this track's auto-computed value reads as drift versus live auto; accepted —
// tap-to-update clears it. Do not special-case the comparison.
export function isFavoriteTuningDrifted(input: {
  favorite: FavoriteTrack | null;
  // False until the track's analysis is loaded and tuning state reflects it.
  ready: boolean;
  livePlayMode: "jukebox" | "autocanonizer";
  liveTuningParams: string | null;
  defaults: JukeboxConfig;
}): boolean {
  if (!input.favorite) {
    return false;
  }
  if (!input.ready) {
    return false;
  }
  const favoritePlayMode = input.favorite.playMode ?? "jukebox";
  if (favoritePlayMode !== input.livePlayMode) {
    return true;
  }
  // Outside jukebox mode no tuning applies, so the mode is the whole
  // comparison and any tuning the favorite carries is left untouched.
  if (input.livePlayMode !== "jukebox") {
    return false;
  }
  return !savedTuningParamsEquivalent(
    input.liveTuningParams,
    input.favorite.tuningParams ?? null,
    input.defaults,
  );
}
