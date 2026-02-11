export interface AudioDecoderPort {
  decode(file: File): Promise<AudioBuffer>;
}
