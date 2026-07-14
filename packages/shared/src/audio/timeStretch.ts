export interface TimeStretchAdapter {
  stretchSegment(
    channels: Float32Array[],
    sampleRate: number,
    targetFrameCount: number,
  ): Promise<Float32Array[]>;
}
