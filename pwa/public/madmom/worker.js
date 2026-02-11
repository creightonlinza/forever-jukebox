import init, { analyze_json_with_model_progress } from './pkg/rhythm_wasm.js';
import { buildBeatEvents, buildEnergy, refineEventTimes } from './refinement.js';

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
    const energy = buildEnergy(activations);
    const beats = refineEventTimes(raw.events?.beats || [], energy, fps);
    const downbeats = refineEventTimes(raw.events?.downbeats || [], energy, fps);
    const events = buildBeatEvents(beats, downbeats, fps);
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
