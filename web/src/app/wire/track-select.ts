import type { PlaylistTrack } from "../playlist";

// Module singleton for the Top Tracks "select a track" action (navigate to the
// Listen tab + load the track). The implementation needs the playback flow
// deps assembled in init, so init registers it here and components
// call it without the bridge prop. See web/TECH_DEBT.md item 1 (Phase 3).
export type SelectTrackFn = (
  trackId: string,
  selectedTrack: PlaylistTrack | null,
) => void;

let handler: SelectTrackFn | null = null;

export function setSelectTrack(fn: SelectTrackFn): void {
  handler = fn;
}

export function selectTrack(
  trackId: string,
  selectedTrack: PlaylistTrack | null,
): void {
  handler?.(trackId, selectedTrack);
}
