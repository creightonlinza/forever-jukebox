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
  await ensureWebGpuAdapter();
  const ort = await loadOrt();
  const { models } = await loadModels(MODEL_FILES);
  // No wasm fallback: a single thread takes minutes per minute of audio.
  const { sessions } = await createSessions(ort, models, ["webgpu"]);
  const [session] = sessions;

  postProgress("separate", 0);
  return separateInstrumental(
    request.left,
    request.right,
    async (input) => {
      const tensor = new ort.Tensor("float32", input, [...MODEL_INPUT_SHAPE]);
      const estimate = await runSession(session, tensor);
      tensor.dispose();
      return estimate;
    },
    (progress) => postProgress("separate", progress),
  );
}

serveSeparation(separate);
