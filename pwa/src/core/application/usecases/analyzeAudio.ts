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
  // 0..1 within the stage; null when the stage reports no progress.
  progress: number | null;
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
    const reportProgress = (stage: AnalyzeStage, progress: number | null = null) => {
      onProgress?.({ stage, progress });
    };

    reportProgress("loading");

    const fingerprint = await computeFingerprint(file);

    const decodePromise = this.decoder.decode(file);

    if (!force) {
      const cached = await this.cache.get(fingerprint);
      if (cached) {
        try {
          reportProgress("cached");
          const { audioBuffer } = await decodePromise;
          const analysis = validateAnalysis(cached);
          return { analysis, audioBuffer, fingerprint, fromCache: true };
        } catch {
          // Fall back to re-analysis if cached data is invalid.
        }
      }
    }

    reportProgress("decoding");
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
      onProgress: ({ stage, progress }) => {
        // The worker reports the beats stage in [0, 0.4].
        reportProgress(stage, stage === "beats" ? Math.min(1, progress / 0.4) : progress);
      },
    });

    const validated = validateAnalysis(analysis);
    try {
      await this.cache.set(fingerprint, validated);
    } catch (err) {
      // Caching is best-effort; a storage failure must not discard the analysis.
      console.warn(`Analysis cache save failed: ${String(err)}`);
    }
    reportProgress("ready");

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

