import { AnalysisPort } from "@/core/domain/ports/AnalysisPort";
import { AnalysisCachePort } from "@/core/domain/ports/AnalysisCachePort";
import { AudioDecoderPort } from "@/core/domain/ports/AudioDecoderPort";
import { AnalysisOutput, validateAnalysis } from "@/shared/analysis-schema";
import { computeFingerprint } from "@/shared/utils/fingerprint";
import { TrackMeta } from "@forever-jukebox/shared/types";

export type AnalyzeStage =
  | "loading"
  | "decoding"
  | "beats"
  | "features"
  | "segments"
  | "building"
  | "ready"
  | "cached";

export type AnalyzeProgress = {
  stage: AnalyzeStage;
  progress: number;
  message?: string;
};

export type AnalyzeAudioResult = {
  analysis: AnalysisOutput;
  audioBuffer: AudioBuffer;
  fingerprint: string;
  fromCache: boolean;
};

export class AnalyzeAudioUseCase {
  constructor(
    private readonly analysisPort: AnalysisPort,
    private readonly cache: AnalysisCachePort,
    private readonly decoder: AudioDecoderPort
  ) {}

  async execute(options: {
    file: File;
    force?: boolean;
    onProgress?: (progress: AnalyzeProgress) => void;
  }): Promise<AnalyzeAudioResult> {
    const { file, force = false, onProgress } = options;
    let lastProgress = 0;
    const reportProgress = (
      stage: AnalyzeStage,
      progress: number,
      message?: string
    ) => {
      const clamped = Math.max(lastProgress, Math.min(100, progress));
      lastProgress = clamped;
      onProgress?.({ stage, progress: clamped, message });
    };

    reportProgress("loading", 0, "Loading file");

    const fingerprint = await computeFingerprint(file);

    const decodePromise = (async () => {
      reportProgress("decoding", 2, "Decoding audio");
      const decoded = await this.decoder.decode(file);
      reportProgress("decoding", 10, "Decoding audio");
      return decoded;
    })();

    if (!force) {
      const cached = await this.cache.get(fingerprint);
      if (cached) {
        try {
          const { audioBuffer } = await decodePromise;
          const analysis = validateAnalysis(cached);
          reportProgress("cached", 100, "Loaded cached analysis");
          return { analysis, audioBuffer, fingerprint, fromCache: true };
        } catch {
          // Fall back to re-analysis if cached data is invalid.
        }
      }
    }

    const decoded = await decodePromise;
    const audioBuffer = decoded.audioBuffer;
    const analysisAudio = decoded.analysisAudio;
    const trackMeta: TrackMeta = {
      title: inferTitle(file.name),
      duration: analysisAudio.duration,
    };

    const analysis = await this.analysisPort.analyze({
      mono22050: analysisAudio.mono22050,
      mono44100: analysisAudio.mono44100,
      duration: analysisAudio.duration,
      trackMeta,
      onProgress: (progress) => {
        const stage = mapStage(progress.stage);
        const message = progress.message;
        const pct = mapToOverallProgress(stage, progress.progress);
        reportProgress(stage, pct, message);
      },
    });

    const validated = validateAnalysis(analysis);
    await this.cache.set(fingerprint, validated);
    reportProgress("ready", 100, "Ready");

    return { analysis: validated, audioBuffer, fingerprint, fromCache: false };
  }
}

function inferTitle(name: string) {
  const dot = name.lastIndexOf(".");
  if (dot > 0) {
    return name.slice(0, dot);
  }
  return name;
}

function mapStage(stage: "beats" | "features" | "segments" | "building"): AnalyzeStage {
  return stage;
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function mapToOverallProgress(stage: AnalyzeStage, progress: number): number {
  const p = clamp01(progress);
  if (stage === "beats") {
    // Worker reports beats stage in [0, 0.4], map it to 10..40.
    const normalized = Math.min(1, p / 0.4);
    return 10 + normalized * 30;
  }
  if (stage === "features" || stage === "segments") {
    return 45 + p * 40;
  }
  if (stage === "building") {
    return 85 + p * 15;
  }
  if (stage === "ready" || stage === "cached") {
    return 100;
  }
  if (stage === "decoding") {
    return p * 10;
  }
  return 0;
}
