export type PreparedAnalysisAudio = {
  mono22050: Float32Array;
  mono44100: Float32Array;
  duration: number;
};

export type DecodedAudio = {
  audioBuffer: AudioBuffer;
  analysisAudio: PreparedAnalysisAudio;
};

export interface AudioDecoderPort {
  decode(file: File): Promise<DecodedAudio>;
}
