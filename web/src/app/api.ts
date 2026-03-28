import type { TrackMeta } from "../engine/types";
import type { FavoriteTrack } from "./favorites";
import { maxFavorites } from "./favorites";

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null;
}

type AnalysisBase = {
  youtube_id?: string;
  created_at?: string;
  is_user_supplied?: boolean;
};

export type AnalysisInProgress = AnalysisBase & {
  status: "downloading" | "queued" | "processing";
  id: string;
  progress?: number;
  message?: string;
};

export type AnalysisResult = Record<string, unknown> & {
  track?: TrackMeta;
};

export type AnalysisComplete = AnalysisBase & {
  status: "complete";
  id: string;
  result: AnalysisResult;
  track?: TrackMeta;
};

export type AnalysisFailed = AnalysisBase & {
  status: "failed";
  id?: string;
  error?: string;
  error_code?: string;
};

export type AnalysisResponse =
  | AnalysisInProgress
  | AnalysisComplete
  | AnalysisFailed;

export type SpotifySearchItem = {
  id?: string;
  name?: string;
  artist?: string;
  duration?: number;
};

export type YoutubeSearchItem = {
  id?: string;
  title?: string;
  duration?: number;
};

export type TopSongItem = {
  title?: string;
  artist?: string;
  youtube_id?: string;
};

export type RecentSongItem = TopSongItem;

export type AppConfig = {
  allow_user_upload: boolean;
  allow_user_youtube: boolean;
  allow_favorites_sync?: boolean;
  max_upload_size?: number | null;
  allowed_upload_exts?: string[] | null;
  max_track_length?: number | null;
};

export type FavoritesSyncResponse = {
  code?: string;
  count?: number;
  favorites?: FavoriteTrack[];
};

export type FavoritesSyncPayload = {
  favorites?: FavoriteTrack[];
};

async function fetchJson(url: string, options?: RequestInit) {
  const response = await fetch(url, options);
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    let code: string | undefined;
    try {
      const payload = await response.json();
      const extracted = extractApiError(payload);
      if (extracted) {
        message = extracted.message;
        code = extracted.code;
      }
    } catch {
      // Ignore non-JSON error payloads.
    }
    const error = new Error(message);
    const extended = error as Error & { status?: number; code?: string };
    extended.status = response.status;
    extended.code = code;
    throw error;
  }
  return response.json();
}

function extractApiError(data: unknown): { message: string; code?: string } | null {
  if (!isRecord(data)) {
    return null;
  }
  const detail = data.detail;
  if (typeof detail === "string") {
    return { message: detail };
  }
  if (isRecord(detail)) {
    const message = typeof detail.message === "string" ? detail.message : null;
    const code = typeof detail.error_code === "string" ? detail.error_code : undefined;
    if (message) {
      return { message, code };
    }
  }
  return null;
}

function parseAnalysisResponse(data: unknown): AnalysisResponse | null {
  if (!isRecord(data)) {
    return null;
  }
  const status = typeof data.status === "string" ? data.status : null;
  const id = typeof data.id === "string" ? data.id : undefined;
  const youtubeId =
    typeof data.youtube_id === "string" ? data.youtube_id : undefined;
  const createdAt =
    typeof data.created_at === "string" ? data.created_at : undefined;
  const progress = typeof data.progress === "number" ? data.progress : undefined;
  const message = typeof data.message === "string" ? data.message : undefined;
  let isUserSupplied: boolean | undefined;
  if (typeof data.is_user_supplied === "boolean") {
    isUserSupplied = data.is_user_supplied;
  } else if (typeof data.is_user_supplied === "number") {
    isUserSupplied = data.is_user_supplied !== 0;
  }
  if (status === "downloading" || status === "queued" || status === "processing") {
    if (!id) {
      return null;
    }
    return {
      status,
      id,
      progress,
      message,
      youtube_id: youtubeId,
      created_at: createdAt,
      is_user_supplied: isUserSupplied,
    };
  }
  if (status === "failed") {
    return {
      status,
      id,
      youtube_id: youtubeId,
      created_at: createdAt,
      is_user_supplied: isUserSupplied,
      error: typeof data.error === "string" ? data.error : undefined,
      error_code: typeof data.error_code === "string" ? data.error_code : undefined,
    };
  }
  if (status === "complete") {
    if (!id || data.result === undefined) {
      return null;
    }
    return {
      status,
      id,
      result: data.result as AnalysisResult,
      youtube_id: youtubeId,
      created_at: createdAt,
      is_user_supplied: isUserSupplied,
      track: isRecord(data.track) ? (data.track as TrackMeta) : undefined,
    };
  }
  if (id && data.result !== undefined) {
    return {
      status: "complete",
      id,
      result: data.result as AnalysisResult,
      youtube_id: youtubeId,
      created_at: createdAt,
      is_user_supplied: isUserSupplied,
      track: isRecord(data.track) ? (data.track as TrackMeta) : undefined,
    };
  }
  return null;
}

async function maybeRepairMissing(response: AnalysisResponse | null) {
  if (!response || response.status !== "failed") {
    return response;
  }
  if (response.error !== "Analysis missing" || !response.id) {
    return response;
  }
  try {
    return await repairJob(response.id);
  } catch {
    return response;
  }
}

export async function fetchAnalysis(jobId: string, signal?: AbortSignal) {
  const response = await fetch(`/api/analysis/${encodeURIComponent(jobId)}`, {
    signal,
  });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    const error = new Error(`Request failed (${response.status})`);
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }
  const data = await response.json();
  return parseAnalysisResponse(data);
}

export async function fetchAudio(jobId: string, signal?: AbortSignal) {
  const response = await fetch(`/api/audio/${encodeURIComponent(jobId)}`, {
    signal,
  });
  if (!response.ok) {
    const error = new Error(`Audio download failed (${response.status})`);
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }
  return response.arrayBuffer();
}

export async function repairJob(jobId: string, signal?: AbortSignal) {
  const response = await fetch(`/api/repair/${encodeURIComponent(jobId)}`, {
    method: "POST",
    signal,
  });
  if (!response.ok) {
    const error = new Error(`Repair failed (${response.status})`);
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }
  const data = await response.json();
  return parseAnalysisResponse(data);
}

export async function startYoutubeAnalysis(payload: {
  youtube_id: string;
  title?: string;
  artist?: string;
  is_user_supplied?: boolean;
}) {
  const data = await fetchJson("/api/analysis/youtube", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseAnalysisResponse(data);
}

export async function uploadAudio(file: File) {
  const body = new FormData();
  body.append("file", file);
  const response = await fetch("/api/upload", { method: "POST", body });
  if (!response.ok) {
    let message = `Upload failed (${response.status})`;
    let code: string | undefined;
    try {
      const payload = await response.json();
      const extracted = extractApiError(payload);
      if (extracted) {
        message = extracted.message;
        code = extracted.code;
      }
    } catch {
      // Ignore non-JSON error payloads.
    }
    const error = new Error(message);
    const extended = error as Error & { status?: number; code?: string };
    extended.status = response.status;
    extended.code = code;
    throw error;
  }
  const data = await response.json();
  return parseAnalysisResponse(data);
}

export async function searchSpotify(query: string) {
  const data = await fetchJson(
    `/api/search/spotify?q=${encodeURIComponent(query)}`
  );
  return Array.isArray(data?.items) ? (data.items as SpotifySearchItem[]) : [];
}

export async function searchYoutube(query: string, duration: number) {
  const data = await fetchJson(
    `/api/search/youtube?q=${encodeURIComponent(
      query
    )}&target_duration=${encodeURIComponent(duration)}`
  );
  return Array.isArray(data?.items) ? (data.items as YoutubeSearchItem[]) : [];
}

export async function fetchTopSongs(limit: number) {
  const data = await fetchJson(`/api/top?limit=${encodeURIComponent(limit)}`);
  return Array.isArray(data?.items) ? (data.items as TopSongItem[]) : [];
}

export async function fetchTrendingSongs() {
  const data = await fetchJson("/api/trending?limit=25");
  return Array.isArray(data?.items) ? (data.items as TopSongItem[]) : [];
}

export async function fetchRecentSongs(limit: number) {
  const data = await fetchJson(`/api/recent?limit=${encodeURIComponent(limit)}`);
  return Array.isArray(data?.items) ? (data.items as RecentSongItem[]) : [];
}

export async function fetchAppConfig(): Promise<AppConfig> {
  const data = await fetchJson("/api/app-config");
  return data as AppConfig;
}

export async function recordPlay(jobId: string) {
  const response = await fetch(`/api/plays/${encodeURIComponent(jobId)}`, {
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(`Play count failed (${response.status})`);
  }
}

export async function deleteJob(jobId: string) {
  const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    const error = new Error(`Delete failed (${response.status})`);
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }
}

export async function fetchJobByYoutube(
  youtubeId: string
): Promise<AnalysisResponse | null> {
  const response = await fetch(
    `/api/jobs/by-youtube/${encodeURIComponent(youtubeId)}`
  );
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Lookup failed (${response.status})`);
  }
  const data = await response.json();
  return maybeRepairMissing(parseAnalysisResponse(data));
}

export async function fetchJobByTrack(
  title: string,
  artist: string
): Promise<AnalysisResponse | null> {
  const params = new URLSearchParams({ title, artist });
  const response = await fetch(`/api/jobs/by-track?${params.toString()}`);
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Lookup failed (${response.status})`);
  }
  const data = await response.json();
  return maybeRepairMissing(parseAnalysisResponse(data));
}

export async function createFavoritesSync(favorites: FavoriteTrack[]) {
  const payload = { favorites: favorites.slice(0, maxFavorites()) };
  const data = await fetchJson("/api/favorites/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return data as FavoritesSyncResponse;
}

export async function updateFavoritesSync(code: string, favorites: FavoriteTrack[]) {
  const payload = { favorites: favorites.slice(0, maxFavorites()) };
  const data = await fetchJson(
    `/api/favorites/sync/${encodeURIComponent(code)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );
  return data as FavoritesSyncResponse;
}

export async function fetchFavoritesSync(code: string) {
  const data = await fetchJson(
    `/api/favorites/sync/${encodeURIComponent(code)}`
  );
  const payload = data as FavoritesSyncPayload;
  return Array.isArray(payload.favorites)
    ? (payload.favorites as FavoriteTrack[])
    : [];
}
