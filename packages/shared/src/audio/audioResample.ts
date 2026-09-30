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
