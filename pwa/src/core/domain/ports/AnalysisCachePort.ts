import { AnalysisOutput } from "@/shared/analysis-schema";

export interface AnalysisCachePort {
  get(fingerprint: string): Promise<AnalysisOutput | null>;
  set(fingerprint: string, analysis: AnalysisOutput): Promise<void>;
  clear(fingerprint: string): Promise<void>;
}
