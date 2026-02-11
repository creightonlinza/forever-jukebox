import { AnalysisPort } from "@/core/domain/ports/AnalysisPort";
import { AnalysisCachePort } from "@/core/domain/ports/AnalysisCachePort";
import { AudioDecoderPort } from "@/core/domain/ports/AudioDecoderPort";
import { AnalysisOutput, validateAnalysis } from "@/shared/analysis-schema";
import { computeFingerprint } from "@/shared/utils/fingerprint";
import { TrackMeta } from "@/shared/jukebox/engine/types";

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
    onProgress?.({ stage: "loading", progress: 0, message: "Loading file" });

    const fingerprint = await computeFingerprint(file);

    const decodePromise = (async () => {
      onProgress?.({ stage: "decoding", progress: 0.1, message: "Decoding audio" });
      const buffer = await this.decoder.decode(file);
      onProgress?.({ stage: "decoding", progress: 1, message: "Decoding audio" });
      return buffer;
    })();

    if (!force) {
      const cached = await this.cache.get(fingerprint);
      if (cached) {
        try {
          const audioBuffer = await decodePromise;
          const analysis = validateAnalysis(cached);
          onProgress?.({ stage: "cached", progress: 1, message: "Loaded cached analysis" });
          return { analysis, audioBuffer, fingerprint, fromCache: true };
        } catch {
          // Fall back to re-analysis if cached data is invalid.
        }
      }
    }

    const audioBuffer = await decodePromise;
    const channels = getChannels(audioBuffer);
    const trackMeta: TrackMeta = {
      title: inferTitle(file.name),
      duration: audioBuffer.duration,
    };

    const analysis = await this.analysisPort.analyze({
      channels,
      sampleRate: audioBuffer.sampleRate,
      duration: audioBuffer.duration,
      trackMeta,
      onProgress: (progress) => {
        const stage = mapStage(progress.stage);
        const message = progress.message;
        onProgress?.({ stage, progress: progress.progress, message });
      },
    });

    const validated = validateAnalysis(analysis);
    await this.cache.set(fingerprint, validated);
    onProgress?.({ stage: "ready", progress: 1, message: "Ready" });

    return { analysis: validated, audioBuffer, fingerprint, fromCache: false };
  }
}

function getChannels(buffer: AudioBuffer) {
  const channels: Float32Array[] = [];
  for (let i = 0; i < buffer.numberOfChannels; i += 1) {
    channels.push(buffer.getChannelData(i).slice());
  }
  if (channels.length === 0) {
    channels.push(new Float32Array(buffer.length));
  }
  return channels;
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
