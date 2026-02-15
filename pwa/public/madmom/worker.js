import init, { analyze_json_with_model_progress } from './pkg/rhythm_wasm.js';

let ready = false;
let readyPromise = null;
let modelJson = null;
let modelWeights = null;

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function toBeatEvents(raw) {
  const beatTimes = Array.isArray(raw?.beat_times) ? raw.beat_times : [];
  const beatNumbers = Array.isArray(raw?.beat_numbers) ? raw.beat_numbers : [];
  const beatConfidences = Array.isArray(raw?.beat_confidences)
    ? raw.beat_confidences
    : [];
  const count = beatTimes.length;
  if (beatNumbers.length !== count || beatConfidences.length !== count) {
    throw new Error('Invalid madmom output: beat arrays length mismatch');
  }

  const events = [];
  let lastTime = -Infinity;
  for (let i = 0; i < count; i += 1) {
    const timeSec = Number(beatTimes[i]);
    const beatInBar = Math.max(1, Math.floor(Number(beatNumbers[i]) || 1));
    const confidence = clamp01(Number(beatConfidences[i]));
    if (!Number.isFinite(timeSec)) {
      continue;
    }
    if (timeSec <= lastTime) {
      throw new Error('Invalid madmom output: beat_times must be strictly increasing');
    }
    lastTime = timeSec;
    events.push([timeSec, beatInBar, confidence]);
  }
  return events;
}

async function ensureReady() {
  if (ready) return;
  if (!readyPromise) {
    readyPromise = init();
  }
  await readyPromise;
  if (!modelJson) {
    const modelRes = await fetch('./models/downbeats_blstm.json');
    modelJson = await modelRes.text();
  }
  if (!modelWeights) {
    const weightsRes = await fetch('./models/downbeats_blstm_weights.npz');
    const buf = await weightsRes.arrayBuffer();
    modelWeights = new Uint8Array(buf);
  }
  ready = true;
}

self.onmessage = async (event) => {
  if (event.data?.type !== 'analyze') return;
  try {
    await ensureReady();
    const { samples, sampleRate } = event.data;
    const progressCb = (stage, progress) => {
      self.postMessage({ type: 'progress', stage, progress });
    };
    const raw = analyze_json_with_model_progress(
      samples,
      sampleRate,
      null,
      modelJson,
      modelWeights,
      progressCb
    );
    const fps = Number(raw?.fps) || 100;
    const events = toBeatEvents(raw);
    const result = {
      activations: { fps, data: [] },
      events,
      meta: { sample_rate: sampleRate },
    };
    self.postMessage({ type: 'result', payload: result });
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message || String(err) });
  }
};
