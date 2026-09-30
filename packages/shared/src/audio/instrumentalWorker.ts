import {
  MDX_SAMPLE_RATE,
  MODEL_INPUT_SHAPE,
  separateInstrumental,
} from "./instrumentalSeparate";
import {
  createSessions,
  ensureWebGpuAdapter,
  loadModels,
  loadOrt,
  postProgress,
  runSession,
  serveSeparation,
  type SeparateRequest,
} from "./instrumentalRuntime";

const MODEL_FILES = [
  {
    url: "https://huggingface.co/k2-fsa/sherpa-onnx-models/resolve/bee11a0c31f3054fa7e73752e59f50d1e05340af/source-separation-models/UVR-MDX-NET-Inst_HQ_3.onnx",
    bytes: 66_759_522,
  },
] as const;

async function separate(request: SeparateRequest) {
  if (request.sampleRate !== MDX_SAMPLE_RATE) {
    throw new Error(
      `Instrumental mode expects ${MDX_SAMPLE_RATE} Hz audio, got ${request.sampleRate}`,
    );
  }
  const startedAt = performance.now();
  await ensureWebGpuAdapter();
  const ort = await loadOrt();
  const { models, fromCache } = await loadModels(MODEL_FILES);
  const modelsReadyAt = performance.now();
  // No wasm fallback: a single thread takes minutes per minute of audio.
  const { backend, sessions } = await createSessions(ort, models, ["webgpu"]);
  const [session] = sessions;
  const sessionsReadyAt = performance.now();

  postProgress("separate", 0);
  let inferenceMs = 0;
  let chunks = 0;
  const result = await separateInstrumental(
    request.left,
    request.right,
    async (input) => {
      const inferenceStartedAt = performance.now();
      const tensor = new ort.Tensor("float32", input, [...MODEL_INPUT_SHAPE]);
      const estimate = await runSession(session, tensor);
      tensor.dispose();
      inferenceMs += performance.now() - inferenceStartedAt;
      chunks += 1;
      return estimate;
    },
    (progress) => postProgress("separate", progress),
  );
  const separatedAt = performance.now();

  console.info("[instrumental] render complete", {
    backend,
    modelLoadMs: Math.round(modelsReadyAt - startedAt),
    modelsFromCache: fromCache,
    sessionCreateMs: Math.round(sessionsReadyAt - modelsReadyAt),
    separateMs: Math.round(separatedAt - sessionsReadyAt),
    inferenceMs: Math.round(inferenceMs),
    chunks,
    frames: request.left.length,
  });
  return result;
}

serveSeparation(separate);
