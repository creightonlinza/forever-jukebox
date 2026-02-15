import { AnalysisOutput } from "../analysis-schema";

export type ExportMetadata = {
  createdAt: string;
  appVersion: string;
  fingerprint: string;
};

export interface ExportBinaryOptions {
  mimeType: string;
  description: string;
  extension: string;
}

type SaveFileHandle = {
  createWritable: () => Promise<{
    write: (data: Uint8Array) => Promise<void>;
    close: () => Promise<void>;
  }>;
};

export function buildExportPayload(
  analysis: AnalysisOutput,
  metadata: ExportMetadata
) {
  return {
    ...analysis,
    metadata,
  };
}

export function formatExportJson(
  analysis: AnalysisOutput,
  metadata: ExportMetadata
) {
  return JSON.stringify(buildExportPayload(analysis, metadata), null, 2);
}

export async function saveExportJson(
  filename: string,
  json: string
): Promise<void> {
  if ("showSaveFilePicker" in window) {
    const handle = await (window as any).showSaveFilePicker({
      suggestedName: filename,
      types: [
        {
          description: "JSON",
          accept: { "application/json": [".json"] },
        },
      ],
    });
    const writable = await handle.createWritable();
    await writable.write(json);
    await writable.close();
    return;
  }
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function saveExportBinary(
  filename: string,
  bytes: Uint8Array,
  options: ExportBinaryOptions,
  handle?: SaveFileHandle | null,
): Promise<void> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);

  if (handle) {
    const writable = await handle.createWritable();
    await writable.write(copy);
    await writable.close();
    return;
  }

  if ("showSaveFilePicker" in window) {
    const handle = await (window as any).showSaveFilePicker({
      suggestedName: filename,
      types: [
        {
          description: options.description,
          accept: { [options.mimeType]: [options.extension] },
        },
      ],
    });
    const writable = await handle.createWritable();
    await writable.write(copy);
    await writable.close();
    return;
  }

  const blob = new Blob([copy.buffer], { type: options.mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function pickBinaryExportFile(
  filename: string,
  options: ExportBinaryOptions,
): Promise<SaveFileHandle | null> {
  if (!("showSaveFilePicker" in window)) {
    return null;
  }
  const handle = await (window as any).showSaveFilePicker({
    suggestedName: filename,
    types: [
      {
        description: options.description,
        accept: { [options.mimeType]: [options.extension] },
      },
    ],
  });
  return handle as SaveFileHandle;
}
