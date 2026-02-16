import init, {
  analyze_json_with_model_progress,
  default_config_json,
  validate_config_json,
} from "./pkg/rhythm_wasm.js";

let ready = false;
let readyPromise = null;
let modelJson = null;
let modelWeights = null;
let configJson = null;

async function ensureReady() {
  if (ready) return;
  if (!readyPromise) {
    readyPromise = init();
  }
  await readyPromise;
  if (!modelJson) {
    const modelRes = await fetch("./models/downbeats_blstm.json");
    modelJson = await modelRes.text();
  }
  if (!modelWeights) {
    const weightsRes = await fetch("./models/downbeats_blstm_weights.npz");
    const buf = await weightsRes.arrayBuffer();
    modelWeights = new Uint8Array(buf);
  }
  if (!configJson) {
    configJson = default_config_json();
    const validation = validate_config_json(configJson);
    if (validation !== null) {
      throw new Error(
        `Invalid madmom default config: ${JSON.stringify(validation)}`,
      );
    }
  }
  ready = true;
}

self.onmessage = async (event) => {
  if (event.data?.type !== "analyze") return;
  try {
    await ensureReady();
    const { samples, sampleRate } = event.data;
    const progressCb = (stage, progress) => {
      self.postMessage({ type: "progress", stage, progress });
    };
    const raw = analyze_json_with_model_progress(
      samples,
      sampleRate,
      configJson,
      modelJson,
      modelWeights,
      progressCb,
    );
    self.postMessage({ type: "result", payload: raw });
  } catch (err) {
    self.postMessage({ type: "error", message: err.message || String(err) });
  }
};
