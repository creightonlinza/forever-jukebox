type ErrorLike = Error & {
  code?: string;
};

export type ErrorDisplayOptions = {
  sourceProvider?: string | null;
  errorCode?: string | null;
  fallback?: string;
};

const GENERIC_ERROR_MESSAGE =
  "Something went wrong. Please try again or report an issue on GitHub.";

const FETCH_FAILURE_CODES = new Set([
  "download_unavailable",
  "youtube_unavailable",
  "youtube_unreachable",
]);

const FETCH_FAILURE_MESSAGES = new Set([
  "request failed",
  "unable to download video data.",
  "this video is not available on youtube.",
  "unable to reach youtube",
  GENERIC_ERROR_MESSAGE.toLowerCase(),
]);

const SOURCE_LABELS: Record<string, string> = {
  youtube: "YouTube",
  soundcloud: "SoundCloud",
  bandcamp: "Bandcamp",
};

function errorMessage(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (value instanceof Error) {
    return value.message;
  }
  if (typeof value === "string") {
    return value;
  }
  return String(value);
}

function errorCode(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const code = (value as ErrorLike).code;
  return typeof code === "string" && code.trim() ? code.trim() : null;
}

export function cleanErrorMessage(value: unknown, fallback = "Loading failed."): string {
  let message = errorMessage(value).replace(/\s+/g, " ").trim();
  while (/^error:\s*/i.test(message)) {
    message = message.replace(/^error:\s*/i, "").trim();
  }
  return message || fallback;
}

function sourceLabel(sourceProvider: string | null | undefined): string | null {
  if (!sourceProvider) {
    return null;
  }
  return SOURCE_LABELS[sourceProvider.toLowerCase()] ?? null;
}

function isSourceFetchFailure(message: string, code: string | null): boolean {
  if (code && FETCH_FAILURE_CODES.has(code)) {
    return true;
  }
  const normalized = message.toLowerCase();
  if (FETCH_FAILURE_MESSAGES.has(normalized)) {
    return true;
  }
  return normalized.startsWith("request failed (");
}

export function formatErrorForDisplay(
  value: unknown,
  options: ErrorDisplayOptions = {},
): string {
  const message = cleanErrorMessage(value, options.fallback);
  const code = options.errorCode ?? errorCode(value);
  const label = sourceLabel(options.sourceProvider);
  if (label && isSourceFetchFailure(message, code)) {
    return `${label} fetch failed.`;
  }
  return message;
}

export function inferSourceProviderFromUrl(value: string): string | null {
  const trimmed = value.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return "youtube";
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  if (host === "youtu.be" || host.endsWith("youtube.com")) {
    return "youtube";
  }
  if (host.endsWith("soundcloud.com")) {
    return "soundcloud";
  }
  if (host.endsWith("bandcamp.com")) {
    return "bandcamp";
  }
  return null;
}
