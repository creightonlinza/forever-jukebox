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

// Only intermittent YouTube 403s get a retry link; bot-check blocks and
// permanent failures would fail again.
const RETRYABLE_FETCH_ERROR_CODES = new Set(["download_unavailable"]);

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
