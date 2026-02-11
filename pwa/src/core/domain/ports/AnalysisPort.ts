import { AnalysisOutput } from "@/shared/analysis-schema";
import { TrackMeta } from "@/shared/jukebox/engine/types";

export type AnalysisProgress = {
  stage: "beats" | "features" | "segments" | "building";
  progress: number;
  message?: string;
};

export interface AnalysisPort {
  analyze(options: {
    channels: Float32Array[];
    sampleRate: number;
    duration: number;
    trackMeta?: TrackMeta;
    onProgress?: (progress: AnalysisProgress) => void;
  }): Promise<AnalysisOutput>;
}
