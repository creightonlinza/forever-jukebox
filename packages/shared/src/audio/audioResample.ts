export type StereoChannels = [
  Float32Array<ArrayBuffer>,
  Float32Array<ArrayBuffer>,
];

// Resamples with the browser's own converter via an offline graph.
export async function resampleStereo(
  channels: StereoChannels,
  fromRate: number,
  toRate: number,
): Promise<StereoChannels> {
  if (fromRate === toRate) {
    return channels;
  }
  const length = Math.ceil((channels[0].length * toRate) / fromRate);
  const offline = new OfflineAudioContext(channels.length, length, toRate);
  const buffer = offline.createBuffer(
    channels.length,
    channels[0].length,
    fromRate,
  );
  channels.forEach((channel, channelIndex) => {
    buffer.copyToChannel(channel, channelIndex);
  });
  const source = offline.createBufferSource();
  source.buffer = buffer;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  return [
    new Float32Array(rendered.getChannelData(0)),
    new Float32Array(rendered.getChannelData(1)),
  ];
}

// Shapes stereo channels to a source's length and channel count (mono or
// stereo), so a rendered copy keeps the source's geometry and beat times.
export function fitStereoToSource(
  length: number,
  numberOfChannels: number,
  left: Float32Array,
  right: Float32Array,
): Float32Array<ArrayBuffer>[] {
  if (numberOfChannels < 1 || numberOfChannels > 2) {
    throw new Error(
      `Expected mono or stereo audio, got ${numberOfChannels} channels`,
    );
  }
  if (numberOfChannels === 1) {
    const mono = new Float32Array(length);
    const frames = Math.min(length, left.length, right.length);
    for (let idx = 0; idx < frames; idx += 1) {
      mono[idx] = (left[idx] + right[idx]) / 2;
    }
    return [mono];
  }
  return [left, right].map((channel) => {
    const fitted = new Float32Array(length);
    fitted.set(channel.subarray(0, Math.min(length, channel.length)));
    return fitted;
  });
}
