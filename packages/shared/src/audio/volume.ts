// Shared by web and pwa, which read the same key when co-hosted on one origin.
export const VOLUME_STORAGE_KEY = "fj-volume";
export const DEFAULT_VOLUME_PCT = 100;

export function parseStoredVolumePct(raw: string | null): number {
  if (raw === null) {
    return DEFAULT_VOLUME_PCT;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_VOLUME_PCT;
  }
  return Math.max(0, Math.min(100, parsed));
}

// Clamps a gain to 0..1. AudioParam throws on non-finite values, so those
// keep `current` instead.
export function clampVolume(value: number, current: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : current;
}
