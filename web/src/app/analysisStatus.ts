import type {
  AnalysisComplete,
  AnalysisFailed,
  AnalysisInProgress,
  AnalysisResponse,
} from "./api";

export function isAnalysisComplete(
  response: AnalysisResponse | null,
): response is AnalysisComplete {
  return response?.status === "complete";
}

export function isAnalysisFailed(
  response: AnalysisResponse | null,
): response is AnalysisFailed {
  return response?.status === "failed";
}

// Transient YouTube fetch failures (intermittent 403s and "not a bot"
// unreachable errors) usually succeed on a retry, so they get a retry link
// in the status panel. Permanent failures (video unavailable, age
// restricted, too long) are excluded.
const RETRYABLE_FETCH_ERROR_CODES = new Set([
  "download_unavailable",
  "youtube_unreachable",
]);

export function isRetryableFetchFailure(
  response: AnalysisResponse | null,
): boolean {
  return (
    isAnalysisFailed(response) &&
    typeof response.error_code === "string" &&
    RETRYABLE_FETCH_ERROR_CODES.has(response.error_code) &&
    response.source_provider === "youtube"
  );
}

export function isAnalysisInProgress(
  response: AnalysisResponse | null,
): response is AnalysisInProgress {
  return (
    response?.status === "downloading" ||
    response?.status === "queued" ||
    response?.status === "processing"
  );
}
