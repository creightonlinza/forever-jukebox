import { AnalysisOutput } from "@/shared/analysis-schema";
import { TrackMeta } from "@forever-jukebox/shared/types";

export type AnalysisProgress = {
  stage: "beats" | "features" | "segments" | "building";
  progress: number;
  message?: string;
};

export interface AnalysisPort {
  analyze(options: {
    mono22050: Float32Array;
    mono44100: Float32Array;
    duration: number;
    trackMeta?: TrackMeta;
    onProgress?: (progress: AnalysisProgress) => void;
  }): Promise<AnalysisOutput>;
}
