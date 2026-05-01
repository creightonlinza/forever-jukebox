import {
  RubberBandInterface,
  RubberBandOption,
} from "rubberband-wasm";
import rubberBandWasmUrl from "rubberband-wasm/dist/rubberband.wasm?url";

type StretchRequest = {
  type: "stretch";
  id: number;
  channels: Float32Array[];
  sampleRate: number;
  targetFrameCount: number;
};

type StretchResponse =
  | {
      type: "result";
      id: number;
      channels: Float32Array[];
    }
  | {
      type: "error";
      id: number;
      message: string;
    };

type WorkerScope = {
  onmessage: ((event: MessageEvent<StretchRequest>) => void) | null;
  postMessage(message: StretchResponse, transfer?: Transferable[]): void;
};

const workerSelf = self as unknown as WorkerScope;
let rubberBandPromise: Promise<RubberBandInterface> | null = null;

async function getRubberBand() {
  rubberBandPromise ??= loadRubberBand();
  return rubberBandPromise;
}

async function loadRubberBand() {
  const response = await fetch(rubberBandWasmUrl);
  const module = await WebAssembly.compile(await response.arrayBuffer());
  return RubberBandInterface.initialize(module);
}

function fitChannelsToFrameCount(
  channels: Float32Array[],
  targetFrameCount: number,
): Float32Array[] {
  return channels.map((channel) => {
    if (channel.length === targetFrameCount) {
      return channel;
    }
    const fitted = new Float32Array(targetFrameCount);
    fitted.set(channel.subarray(0, targetFrameCount));
    if (channel.length > 0 && channel.length < targetFrameCount) {
      fitted.fill(channel[channel.length - 1] ?? 0, channel.length);
    }
    return fitted;
  });
}

async function stretchSegment(request: StretchRequest): Promise<Float32Array[]> {
  const inputFrames = request.channels[0]?.length ?? 0;
  if (
    inputFrames === 0 ||
    request.targetFrameCount <= 0 ||
    request.channels.length === 0
  ) {
    return request.channels.map(() => new Float32Array(0));
  }
  if (inputFrames === request.targetFrameCount) {
    return request.channels.map((channel) => new Float32Array(channel));
  }

  const rbApi = await getRubberBand();
  const options =
    RubberBandOption.RubberBandOptionProcessOffline |
    RubberBandOption.RubberBandOptionStretchPrecise |
    RubberBandOption.RubberBandOptionTransientsCrisp |
    RubberBandOption.RubberBandOptionDetectorCompound |
    RubberBandOption.RubberBandOptionPhaseLaminar |
    RubberBandOption.RubberBandOptionPitchHighQuality |
    RubberBandOption.RubberBandOptionChannelsTogether;
  const timeRatio = request.targetFrameCount / inputFrames;
  const rbState = rbApi.rubberband_new(
    request.sampleRate,
    request.channels.length,
    options,
    timeRatio,
    1,
  );
  let channelArrayPtr = 0;
  let channelDataPtrs: number[] = [];

  try {
    rbApi.rubberband_set_expected_input_duration(rbState, inputFrames);
    rbApi.rubberband_set_time_ratio(rbState, timeRatio);
    rbApi.rubberband_set_pitch_scale(rbState, 1);

    const chunkFrames = Math.max(1, rbApi.rubberband_get_samples_required(rbState));
    channelArrayPtr = rbApi.malloc(request.channels.length * 4);
    channelDataPtrs = request.channels.map((channel, index) => {
      const ptr = rbApi.malloc(Math.max(chunkFrames, channel.length) * 4);
      rbApi.memWritePtr(channelArrayPtr + index * 4, ptr);
      return ptr;
    });

    const chunks = request.channels.map(() => [] as Float32Array[]);
    const retrieve = (final: boolean) => {
      for (;;) {
        const available = rbApi.rubberband_available(rbState);
        if (available < 1) {
          break;
        }
        if (!final && available < chunkFrames) {
          break;
        }
        const wanted = Math.min(chunkFrames, available);
        const received = rbApi.rubberband_retrieve(
          rbState,
          channelArrayPtr,
          wanted,
        );
        channelDataPtrs.forEach((ptr, channelIndex) => {
          chunks[channelIndex]?.push(new Float32Array(rbApi.memReadF32(ptr, received)));
        });
      }
    };

    for (let read = 0; read < inputFrames;) {
      const remaining = Math.min(chunkFrames, inputFrames - read);
      request.channels.forEach((channel, channelIndex) => {
        rbApi.memWrite(
          channelDataPtrs[channelIndex] as number,
          channel.subarray(read, read + remaining),
        );
      });
      read += remaining;
      rbApi.rubberband_study(
        rbState,
        channelArrayPtr,
        remaining,
        read < inputFrames ? 0 : 1,
      );
    }

    for (let read = 0; read < inputFrames;) {
      const remaining = Math.min(chunkFrames, inputFrames - read);
      request.channels.forEach((channel, channelIndex) => {
        rbApi.memWrite(
          channelDataPtrs[channelIndex] as number,
          channel.subarray(read, read + remaining),
        );
      });
      read += remaining;
      rbApi.rubberband_process(
        rbState,
        channelArrayPtr,
        remaining,
        read < inputFrames ? 0 : 1,
      );
      retrieve(false);
    }
    retrieve(true);

    const stretched = chunks.map((channelChunks) => {
      const length = channelChunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const merged = new Float32Array(length);
      let offset = 0;
      for (const chunk of channelChunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }
      return merged;
    });
    return fitChannelsToFrameCount(stretched, request.targetFrameCount);
  } finally {
    channelDataPtrs.forEach((ptr) => rbApi.free(ptr));
    if (channelArrayPtr !== 0) {
      rbApi.free(channelArrayPtr);
    }
    rbApi.rubberband_delete(rbState);
  }
}

workerSelf.onmessage = (event: MessageEvent<StretchRequest>) => {
  const request = event.data;
  if (request.type !== "stretch") {
    return;
  }
  stretchSegment(request)
    .then((channels) => {
      const response: StretchResponse = {
        type: "result",
        id: request.id,
        channels,
      };
      workerSelf.postMessage(
        response,
        channels.map((channel) => channel.buffer) as Transferable[],
      );
    })
    .catch((err: unknown) => {
      const response: StretchResponse = {
        type: "error",
        id: request.id,
        message: err instanceof Error ? err.message : String(err),
      };
      workerSelf.postMessage(response);
    });
};
