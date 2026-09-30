import { resampleStereo, type StereoChannels } from "./audioResample";
import {
  readInstrumentalTrack,
  writeInstrumentalTrack,
} from "./instrumentalTrackCache";

export type InstrumentalProgress = {
  phase: "download" | "separate";
  progress: number;
};

type ProgressListener = (progress: InstrumentalProgress) => void;

type WorkerMessage =
  | { type: "progress"; phase: InstrumentalProgress["phase"]; progress: number }
  | { type: "result"; left: Float32Array; right: Float32Array }
  | { type: "error"; message: string };

type Job = {
  cancelled: boolean;
  downloading: boolean;
  worker: Worker | null;
  reject: ((err: Error) => void) | null;
};

const MAX_CHANNELS = 2;
// Rate the separation worker requires.
const SEPARATOR_SAMPLE_RATE = 44_100;
const CANCELLED_MESSAGE = "Instrumental render cancelled";

// Single entry: holds the pending promise so a repeated request for the same
// source joins the render in flight. Dropped on cancel; a stored track covers
// re-selection.
let cached: { source: AudioBuffer; promise: Promise<AudioBuffer> } | null =
  null;
let activeJob: Job | null = null;
let progressListener: ProgressListener | null = null;

// Chromium reports mobile directly; elsewhere the user agent decides, with
// touch points telling an iPad apart from the Mac it claims to be.
function isMobileDevice(): boolean {
  const hints = (navigator as { userAgentData?: { mobile?: boolean } })
    .userAgentData;
  if (hints?.mobile === true) {
    return true;
  }
  const userAgent = navigator.userAgent ?? "";
  return (
    /Android|iPhone|iPad|iPod/i.test(userAgent) ||
    (/Macintosh/i.test(userAgent) && navigator.maxTouchPoints > 1)
  );
}

// Desktop with WebGPU only: the model exhausts memory on phones and tablets
// and takes several times the track's length without a GPU.
export function isInstrumentalModeAvailable(): boolean {
  return (
    typeof navigator !== "undefined" &&
    "gpu" in navigator &&
    !isMobileDevice()
  );
}

// The separator may return a few frames more or fewer than it was given;
// the result must match the source geometry so beat times stay valid.
export function fitInstrumentalChannels(
  length: number,
  numberOfChannels: number,
  left: Float32Array,
  right: Float32Array,
): Float32Array<ArrayBuffer>[] {
  if (numberOfChannels < 1 || numberOfChannels > MAX_CHANNELS) {
    throw new Error(
      `Instrumental mode supports mono or stereo audio, got ${numberOfChannels} channels`,
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

function runSeparation(
  job: Job,
  [left, right]: StereoChannels,
): Promise<StereoChannels> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./instrumentalWorker.ts", import.meta.url), {
      type: "module",
    });
    job.worker = worker;
    job.reject = reject;
    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const message = event.data;
      if (message.type === "progress") {
        job.downloading =
          message.phase === "download" && message.progress < 1;
        if (activeJob === job) {
          progressListener?.({
            phase: message.phase,
            progress: message.progress,
          });
        }
        return;
      }
      worker.terminate();
      if (message.type === "result") {
        resolve([
          message.left as Float32Array<ArrayBuffer>,
          message.right as Float32Array<ArrayBuffer>,
        ]);
        return;
      }
      reject(new Error(message.message));
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || "Instrumental worker failed to load"));
    };
    worker.postMessage(
      { type: "separate", left, right, sampleRate: SEPARATOR_SAMPLE_RATE },
      [left.buffer, right.buffer],
    );
  });
}

// A model download in progress is left to finish and be stored; the worker
// is dropped as soon as it reports anything else.
function terminateAfterDownload(worker: Worker) {
  worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
    const message = event.data;
    if (
      message.type !== "progress" ||
      message.phase !== "download" ||
      message.progress >= 1
    ) {
      worker.terminate();
    }
  };
  worker.onerror = () => worker.terminate();
}

function throwIfCancelled(job: Job) {
  if (job.cancelled) {
    throw new Error(CANCELLED_MESSAGE);
  }
}

// Reuses the track's stored instrumental when there is one; otherwise runs
// the separator and stores its result. Storage failures never fail a render.
async function separate(
  job: Job,
  channels: StereoChannels,
  trackId: string | null,
): Promise<StereoChannels> {
  const frames = channels[0].length;
  if (trackId) {
    const stored = await readInstrumentalTrack(
      trackId,
      frames,
      SEPARATOR_SAMPLE_RATE,
    ).catch(() => null);
    throwIfCancelled(job);
    if (stored) {
      return stored;
    }
  }
  const separated = await runSeparation(job, channels);
  if (trackId && separated[0].length === frames) {
    writeInstrumentalTrack(trackId, separated, SEPARATOR_SAMPLE_RATE).catch((err: unknown) => {
      console.warn(`Instrumental cache save failed: ${String(err)}`);
    });
  }
  return separated;
}

async function render(
  sourceBuffer: AudioBuffer,
  trackId: string | null,
  job: Job,
): Promise<AudioBuffer> {
  const { length, numberOfChannels, sampleRate } = sourceBuffer;
  if (numberOfChannels > MAX_CHANNELS) {
    throw new Error(
      `Instrumental mode supports mono or stereo audio, got ${numberOfChannels} channels`,
    );
  }
  let channels: StereoChannels = [
    new Float32Array(sourceBuffer.getChannelData(0)),
    new Float32Array(
      sourceBuffer.getChannelData(numberOfChannels > 1 ? 1 : 0),
    ),
  ];
  if (sampleRate !== SEPARATOR_SAMPLE_RATE) {
    channels = await resampleStereo(channels, sampleRate, SEPARATOR_SAMPLE_RATE);
    throwIfCancelled(job);
  }
  let separated = await separate(job, channels, trackId);
  if (sampleRate !== SEPARATOR_SAMPLE_RATE) {
    separated = await resampleStereo(
      separated,
      SEPARATOR_SAMPLE_RATE,
      sampleRate,
    );
    throwIfCancelled(job);
  }
  const fitted = fitInstrumentalChannels(
    length,
    numberOfChannels,
    separated[0],
    separated[1],
  );
  const renderedBuffer = new AudioBuffer({
    length,
    numberOfChannels,
    sampleRate,
  });
  fitted.forEach((channel, channelIndex) => {
    renderedBuffer.copyToChannel(channel, channelIndex);
  });
  return renderedBuffer;
}

// `trackId` keys the stored instrumental; null skips storage.
export function renderInstrumentalBuffer(
  sourceBuffer: AudioBuffer,
  trackId: string | null,
  onProgress: ProgressListener,
): Promise<AudioBuffer> {
  if (cached?.source === sourceBuffer) {
    progressListener = onProgress;
    return cached.promise;
  }
  cancelInstrumentalRender();
  progressListener = onProgress;
  const job: Job = {
    cancelled: false,
    downloading: false,
    worker: null,
    reject: null,
  };
  activeJob = job;
  const promise = render(sourceBuffer, trackId, job)
    .finally(() => {
      if (activeJob === job) {
        activeJob = null;
      }
    })
    .catch((err: unknown) => {
      if (cached?.promise === promise) {
        cached = null;
      }
      throw err;
    });
  cached = { source: sourceBuffer, promise };
  return promise;
}

// Stops a render in flight and forgets any finished render.
export function cancelInstrumentalRender() {
  progressListener = null;
  cached = null;
  const job = activeJob;
  activeJob = null;
  if (!job) {
    return;
  }
  job.cancelled = true;
  if (job.worker) {
    if (job.downloading) {
      terminateAfterDownload(job.worker);
    } else {
      job.worker.terminate();
    }
  }
  job.reject?.(new Error(CANCELLED_MESSAGE));
}
