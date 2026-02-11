import init, { analyze_json_with_model_progress } from './pkg/rhythm_wasm.js';

let ready = false;
let readyPromise = null;
let modelJson = null;
let modelWeights = null;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function buildEnergy(activations) {
  const beat = Array.isArray(activations?.beat) ? activations.beat : [];
  const downbeat = Array.isArray(activations?.downbeat) ? activations.downbeat : [];
  const count = Math.max(beat.length, downbeat.length);
  const energy = new Array(count);
  for (let i = 0; i < count; i += 1) {
    energy[i] = (beat[i] ?? 0) + (downbeat[i] ?? 0);
  }
  return energy;
}

function refineEventTimes(events, energy, fps) {
  if (!Array.isArray(events) || events.length === 0 || energy.length === 0 || !fps) {
    return Array.isArray(events) ? events : [];
  }

  let minEnergy = energy[0];
  let maxEnergy = energy[0];
  for (let i = 1; i < energy.length; i += 1) {
    if (energy[i] < minEnergy) minEnergy = energy[i];
    if (energy[i] > maxEnergy) maxEnergy = energy[i];
  }
  const range = maxEnergy - minEnergy;

  return events.map((event) => {
    const timeSec = Number(event?.time_sec) || 0;
    const nearest = clamp(Math.round(timeSec * fps), 0, energy.length - 1);

    let peak = nearest;
    if (nearest > 0 && nearest < energy.length - 1) {
      const left = nearest - 1;
      const right = nearest + 1;
      const midVal = energy[nearest];
      if (energy[left] > midVal && energy[left] >= energy[right]) {
        peak = left;
      } else if (energy[right] > midVal && energy[right] > energy[left]) {
        peak = right;
      }
    }

    let refinedFrame = peak;
    if (peak > 0 && peak < energy.length - 1) {
      const y1 = energy[peak - 1];
      const y2 = energy[peak];
      const y3 = energy[peak + 1];
      const denom = y1 - 2 * y2 + y3;
      if (Math.abs(denom) >= 1e-12) {
        const delta = clamp(0.5 * (y1 - y3) / denom, -0.5, 0.5);
        refinedFrame = peak + delta;
      }
    }

    const confidence = range < 1e-6 ? 0.5 : clamp((energy[peak] - minEnergy) / range, 0, 1);
    return {
      ...event,
      time_sec: refinedFrame / fps,
      confidence,
    };
  });
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
    const fps = 100;
    const activations = raw.activations || { beat: [], downbeat: [] };
    const data = activations.beat.map((b, i) => [b, activations.downbeat[i]]);
    const energy = buildEnergy(activations);
    const beats = refineEventTimes(raw.events?.beats || [], energy, fps);
    const downbeats = refineEventTimes(raw.events?.downbeats || [], energy, fps);
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
