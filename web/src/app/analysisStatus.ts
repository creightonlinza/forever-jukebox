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
  return response?.status === "failed" || response?.status === "download_retryable";
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
