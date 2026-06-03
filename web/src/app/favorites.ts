export type FavoriteTrack = {
  uniqueSongId: string;
  title: string;
  artist: string;
  duration: number | null;
  sourceType: "youtube" | "soundcloud" | "bandcamp" | "upload";
  tuningParams?: string | null;
};

export type FavoritesDisplaySort = {
  key: "title" | "artist";
  direction: "asc" | "desc";
};

const FAVORITES_KEY = "fj-favorites";
const FAVORITES_SYNC_KEY = "fj-favorites-sync";
const DEFAULT_MAX_FAVORITES = 150;
let activeMaxFavorites = DEFAULT_MAX_FAVORITES;

export function configureMaxFavorites(value: number | null | undefined) {
  activeMaxFavorites =
    typeof value === "number" && Number.isInteger(value) && value > 0
      ? value
      : DEFAULT_MAX_FAVORITES;
}

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
    return sortFavorites(parsed).slice(0, maxFavorites());
  } catch {
    return [];
  }
}

export function saveFavorites(items: FavoriteTrack[]) {
  const payload = JSON.stringify(items.slice(0, maxFavorites()));
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
  if (items.length >= maxFavorites()) {
    return { favorites: items, status: "limit" };
  }
  const next = sortFavorites([...items, normalizedTrack]).slice(0, maxFavorites());
  return { favorites: next, status: "added" };
}

export function removeFavorite(items: FavoriteTrack[], uniqueSongId: string) {
  const next = items.filter((item) => item.uniqueSongId !== uniqueSongId);
  return sortFavorites(next);
}

export function filterFavorites(items: FavoriteTrack[], query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return items;
  }
  return items.filter((item) =>
    [item.title, item.artist, item.uniqueSongId, item.sourceType].some((value) =>
      (value ?? "").toLowerCase().includes(normalizedQuery),
    ),
  );
}

export function favoriteDisplayArtist(item: FavoriteTrack) {
  const artist = (item.artist || "").trim();
  return artist !== "" && artist.toLowerCase() !== "unknown" ? artist : "";
}

export function sortFavoritesForDisplay(
  items: FavoriteTrack[],
  sort: FavoritesDisplaySort,
) {
  const direction = sort.direction === "asc" ? 1 : -1;
  return [...items].sort((a, b) => {
    const primary = compareFavoriteDisplayValue(a, b, sort.key);
    if (primary !== 0) {
      return primary * direction;
    }
    const secondaryKey = sort.key === "title" ? "artist" : "title";
    const secondary = compareFavoriteDisplayValue(a, b, secondaryKey);
    if (secondary !== 0) {
      return secondary;
    }
    return a.uniqueSongId.localeCompare(b.uniqueSongId);
  });
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

function compareFavoriteDisplayValue(
  a: FavoriteTrack,
  b: FavoriteTrack,
  key: FavoritesDisplaySort["key"],
) {
  const valueA =
    key === "title" ? (a.title || "Untitled").trim() : favoriteDisplayArtist(a);
  const valueB =
    key === "title" ? (b.title || "Untitled").trim() : favoriteDisplayArtist(b);
  return valueA.toLowerCase().localeCompare(valueB.toLowerCase());
}

export function maxFavorites() {
  return activeMaxFavorites;
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
