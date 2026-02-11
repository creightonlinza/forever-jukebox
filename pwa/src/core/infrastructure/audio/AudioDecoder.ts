import { AudioDecoderPort } from "@/core/domain/ports/AudioDecoderPort";

export class AudioDecoder implements AudioDecoderPort {
  private context: AudioContext;

  constructor(context?: AudioContext) {
    this.context = context ?? new AudioContext();
  }

  async decode(file: File): Promise<AudioBuffer> {
    const buffer = await file.arrayBuffer();
    return this.context.decodeAudioData(buffer.slice(0));
  }

  getContext(): AudioContext {
    return this.context;
  }
}
