import { AnalysisOutput } from "../analysis-schema";

export type ExportMetadata = {
  createdAt: string;
  appVersion: string;
  fingerprint: string;
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
