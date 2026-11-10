import type { LoadingStepId } from "./LoadingProgress";

export type JobStep = {
  activeId: LoadingStepId;
  // 0..1 within the step; null when the step reports no progress.
  progress: number | null;
  // Jobs ahead in the queue when the server message gives the number.
  queuedAhead: number | null;
};

// Maps a server job's status and progress to a server-analysis loading step. Progress comes from the API
// download (0-25), then the engine: decode 0 and beats 10-85 (one step), features 85-95, building the output from 95.
export function jobStep(status: string, progress: number | null, serverMessage?: string | null): JobStep {
  const p = progress ?? 0;
  if (status === "queued") {
    const ahead = serverMessage?.match(/(\d{1,9})\s+ahead/i);
    return { activeId: "queued", progress: null, queuedAhead: ahead ? Number(ahead[1]) : null };
  }
  if (status !== "processing") {
    return { activeId: "fetch", progress: p > 0 ? Math.min(1, p / 25) : null, queuedAhead: null };
  }
  if (p < 85) {
    return { activeId: "beats", progress: p < 10 ? null : (p - 10) / 75, queuedAhead: null };
  }
  return p < 95
    ? { activeId: "features", progress: (p - 85) / 10, queuedAhead: null }
    : { activeId: "track", progress: null, queuedAhead: null };
}
