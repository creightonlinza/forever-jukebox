// Monotonic counter identifying the current track-load session. Every path
// that starts a new track (load, upload continuation, delete) goes through
// resetForNewTrack, which bumps it; async continuations from older loads
// capture their generation and bail once it changes, so a superseded
// download/decode/poll can never publish state, audio, or cache entries
// over the newer track.
let loadGeneration = 0;

export function bumpLoadGeneration(): number {
  loadGeneration += 1;
  return loadGeneration;
}

export function getLoadGeneration(): number {
  return loadGeneration;
}

export function isStaleLoad(generation: number): boolean {
  return generation !== loadGeneration;
}
