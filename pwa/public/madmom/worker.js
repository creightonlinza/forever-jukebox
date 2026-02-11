import init, { analyze_json_with_model_progress } from './pkg/rhythm_wasm.js';

let ready = false;
let readyPromise = null;
let modelJson = null;
let modelWeights = null;

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
    const fps = 100;
    const activations = raw.activations || { beat: [], downbeat: [] };
    const data = activations.beat.map((b, i) => [b, activations.downbeat[i]]);
    const beats = raw.events?.beats || [];
    const downbeats = raw.events?.downbeats || [];
    const tol = 1 / fps + 1e-6;
    let beatNumber = 1;
    let downbeatIdx = 0;
    const events = beats.map((beat) => {
      if (
        downbeatIdx < downbeats.length &&
        Math.abs(beat.time_sec - downbeats[downbeatIdx].time_sec) <= tol
      ) {
        beatNumber = 1;
        downbeatIdx += 1;
      }
      const out = [beat.time_sec, beatNumber, beat.confidence];
      beatNumber += 1;
      return out;
    });
    const result = {
      activations: { fps, data },
      events,
      meta: { sample_rate: sampleRate },
    };
    self.postMessage({ type: 'result', payload: result });
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message || String(err) });
  }
};
