// Copied from web/src/workers/essentia.worker.ts on 2026-02-11, reason: reuse essentia.js analysis worker.
import Essentia from "essentia.js/dist/essentia.js-core.es.js";
import { EssentiaWASM } from "essentia.js/dist/essentia-wasm.es.js";
import wasmUrl from "essentia.js/dist/essentia-wasm.web.wasm?url";
import { zscore1d, zscore2d } from "./essentia/math";
import {
  computeSegments,
  segmentFromNovelty,
} from "./essentia/segments";
import type { Segment, SegmentationConfig } from "./essentia/segments";
import { maybeDeleteVector, vectorToArraySafe } from "./essentia/vectors";

type EssentiaWorkerConfig = {
  frameSize: number;
  hopSize: number;
  sampleRate: number;
  segmentation: SegmentationConfig;
};

type AnalyzeMessage = {
  type: "analyze";
  samples: Float32Array;
  sampleRate: number;
  beats: number[];
  config: EssentiaWorkerConfig;
};

type WorkerResult = {
  segments: Segment[];
};

let essentiaInstance: any = null;

function ensureEssentia() {
  if (essentiaInstance) {
    return essentiaInstance;
  }
  EssentiaWASM.locateFile = () => wasmUrl;
  essentiaInstance = new Essentia(EssentiaWASM);
  return essentiaInstance;
}

self.onmessage = async (event: MessageEvent<AnalyzeMessage>) => {
  if (event.data?.type !== "analyze") {
    return;
  }
  try {
    const essentia = ensureEssentia();
    const { samples, sampleRate: sr, config, beats } = event.data;
    const duration = samples.length / sr;
    const frameSize = config.frameSize;
    const hopSize = config.hopSize;
    const frames = Math.max(1, Math.floor(Math.max(samples.length - frameSize, 0) / hopSize) + 1);
    const mfccs: number[][] = [];
    const hpcps: number[][] = [];
    const rmsDb: number[] = [];
    const frameTimes = new Float32Array(frames);

    for (let i = 0; i < frames; i += 1) {
      const start = i * hopSize;
      const frame = new Float32Array(frameSize);
      frame.set(samples.subarray(start, start + frameSize));
      frameTimes[i] = start / sr;

      const frameVec = essentia.arrayToVector(frame);
      const windowed = essentia.Windowing(frameVec).frame;
      const spectrum = essentia.Spectrum(windowed, frameSize).spectrum;
      const mfcc = essentia.MFCC(
        spectrum,
        undefined,
        11025,
        frameSize / 2 + 1,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        13
      ).mfcc;
      const peaks = essentia.SpectralPeaks(
        spectrum,
        1e-6,
        undefined,
        undefined,
        undefined,
        "magnitude"
      );
      let hpcp: unknown;
      if (typeof peaks.frequencies?.size === "function" && peaks.frequencies.size() === 0) {
        hpcp = new Float32Array(12);
      } else {
        hpcp = essentia.HPCP(
          peaks.frequencies,
          peaks.magnitudes,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          sr,
          12
        ).hpcp;
      }
      const rms = essentia.RMS(frameVec).rms;
      const rmsVal = 20 * Math.log10(rms + 1e-9);

      mfccs.push(vectorToArraySafe(essentia, mfcc));
      hpcps.push(vectorToArraySafe(essentia, hpcp));
      rmsDb.push(rmsVal);

      maybeDeleteVector(frameVec);
      maybeDeleteVector(windowed);
      maybeDeleteVector(spectrum);
      maybeDeleteVector(peaks.frequencies);
      maybeDeleteVector(peaks.magnitudes);
      maybeDeleteVector(hpcp);
      maybeDeleteVector(mfcc);

      if (i % 32 === 0) {
        self.postMessage({
          type: "progress",
          stage: "features",
          progress: Math.min(1, i / frames),
        });
      }
    }

    const mfccNorm = zscore2d(mfccs);
    const hpcpNorm = zscore2d(hpcps);
    const rmsNorm = zscore1d(rmsDb);
    const novelty = new Float32Array(frames);
    novelty[0] = 0;
    for (let i = 1; i < frames; i += 1) {
      let sum = 0;
      const prevMfcc = Array.from(mfccNorm[i - 1] ?? []);
      const prevHpcp = Array.from(hpcpNorm[i - 1] ?? []);
      const curMfcc = Array.from(mfccNorm[i] ?? []);
      const curHpcp = Array.from(hpcpNorm[i] ?? []);
      const vecPrev = prevMfcc.concat(prevHpcp, [rmsNorm[i - 1]]);
      const vecCur = curMfcc.concat(curHpcp, [rmsNorm[i]]);
      for (let j = 0; j < vecCur.length; j += 1) {
        const delta = vecCur[j] - vecPrev[j];
        sum += delta * delta;
      }
      novelty[i] = Math.sqrt(sum);
    }

    self.postMessage({ type: "progress", stage: "segments", progress: 0.5 });

    const boundaries = segmentFromNovelty(
      frameTimes,
      novelty,
      beats,
      config.segmentation,
      duration
    );

    const segments = computeSegments(
      frameTimes,
      mfccs,
      hpcps,
      rmsDb,
      novelty,
      boundaries
    );

    self.postMessage({ type: "progress", stage: "segments", progress: 1 });
    self.postMessage({ type: "result", payload: { segments } satisfies WorkerResult });
  } catch (err) {
    const message =
      err instanceof Error ? err.message || err.toString() : String(err);
    self.postMessage({ type: "error", message });
  }
};
