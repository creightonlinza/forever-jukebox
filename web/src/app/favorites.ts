export type FavoriteTrack = {
  uniqueSongId: string;
  title: string;
  artist: string;
  duration: number | null;
  sourceType: "youtube" | "upload";
  tuningParams?: string | null;
};

const FAVORITES_KEY = "fj-favorites";
const FAVORITES_SYNC_KEY = "fj-favorites-sync";
const MAX_FAVORITES = 100;

export function loadFavorites(): FavoriteTrack[] {
  const raw = localStorage.getItem(FAVORITES_KEY);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as FavoriteTrack[];
    if (!Array.isArray(parsed)) {
      return [];
    }
    return sortFavorites(parsed).slice(0, MAX_FAVORITES);
  } catch {
    return [];
  }
}

export function saveFavorites(items: FavoriteTrack[]) {
  const payload = JSON.stringify(items.slice(0, MAX_FAVORITES));
  localStorage.setItem(FAVORITES_KEY, payload);
}

export function isFavorite(items: FavoriteTrack[], uniqueSongId: string) {
  return items.some((item) => item.uniqueSongId === uniqueSongId);
}

export function addFavorite(
  items: FavoriteTrack[],
  track: FavoriteTrack
): { favorites: FavoriteTrack[]; status: "added" | "duplicate" | "limit" } {
  const normalizedTrack = { ...track };
  if (isFavorite(items, normalizedTrack.uniqueSongId)) {
    return { favorites: items, status: "duplicate" };
  }
  if (items.length >= MAX_FAVORITES) {
    return { favorites: items, status: "limit" };
  }
  const next = sortFavorites([...items, normalizedTrack]).slice(0, MAX_FAVORITES);
  return { favorites: next, status: "added" };
}

export function removeFavorite(items: FavoriteTrack[], uniqueSongId: string) {
  const next = items.filter((item) => item.uniqueSongId !== uniqueSongId);
  return sortFavorites(next);
}

export function sortFavorites(items: FavoriteTrack[]) {
  const seen = new Set<string>();
  const deduped = items.filter((item) => {
    if (!item || !item.uniqueSongId || seen.has(item.uniqueSongId)) {
      return false;
    }
    seen.add(item.uniqueSongId);
    return true;
  });
  return deduped.sort((a, b) => {
    const titleA = a.title.toLowerCase();
    const titleB = b.title.toLowerCase();
    if (titleA !== titleB) {
      return titleA.localeCompare(titleB);
    }
    return a.artist.toLowerCase().localeCompare(b.artist.toLowerCase());
  });
}

export function maxFavorites() {
  return MAX_FAVORITES;
}

export function loadFavoritesSyncCode(): string | null {
  const raw = localStorage.getItem(FAVORITES_SYNC_KEY);
  if (!raw) {
    return null;
  }
  const trimmed = raw.trim().toLowerCase();
  return trimmed ? trimmed : null;
}

export function saveFavoritesSyncCode(code: string) {
  const trimmed = code.trim().toLowerCase();
  if (!trimmed) {
    return;
  }
  localStorage.setItem(FAVORITES_SYNC_KEY, trimmed);
}
