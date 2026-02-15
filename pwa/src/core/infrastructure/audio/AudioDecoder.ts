import type {
  AudioDecoderPort,
  DecodedAudio,
} from "@/core/domain/ports/AudioDecoderPort";
import { prepareAudioWithFfmpeg } from "./ffmpegAudio";

export class AudioDecoder implements AudioDecoderPort {
  private context: AudioContext;

  constructor(context?: AudioContext) {
    this.context = context ?? new AudioContext();
  }

  async decode(file: File): Promise<DecodedAudio> {
    const prepared = await prepareAudioWithFfmpeg(file);
    const wavBuffer = new Uint8Array(prepared.playbackWav.byteLength);
    wavBuffer.set(prepared.playbackWav);
    const audioBuffer = await this.context.decodeAudioData(wavBuffer.buffer);
    return {
      audioBuffer,
      analysisAudio: {
        mono22050: prepared.mono22050,
        mono44100: prepared.mono44100,
        duration: prepared.duration,
      },
    };
  }

  getContext(): AudioContext {
    return this.context;
  }
}
