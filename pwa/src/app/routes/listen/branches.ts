import type { TFunction } from "i18next";
import type { Edge } from "@forever-jukebox/shared";
import { formatDuration } from "@/shared/utils/format";

export type BranchStats = {
  id: Edge["id"];
  start: string;
  end: string;
  delta: string;
  startBeat: string;
  endBeat: string;
  beatDelta: string;
  direction: string;
  similarity: string;
};

export function toSimilarityPercent(distance: number, maxDistance: number) {
  if (!Number.isFinite(distance) || maxDistance <= 0) {
    return 0;
  }
  const normalized = 1 - distance / maxDistance;
  return Math.round(Math.max(0, Math.min(1, normalized)) * 100);
}

export function nextEdgeIndex(currentIndex: number, direction: number, edgeCount: number) {
  if (currentIndex >= 0) {
    return (currentIndex + direction + edgeCount) % edgeCount;
  }
  return direction > 0 ? 0 : edgeCount - 1;
}

export function branchDirection(edge: Edge, t: TFunction) {
  if (edge.dest.which < edge.src.which) {
    return t("listen.backward");
  }
  if (edge.dest.which > edge.src.which) {
    return t("listen.forward");
  }
  return t("listen.sameBeat");
}

export function deriveBranchStats(
  edge: Edge,
  maxDistance: number,
  t: TFunction,
): BranchStats {
  const startSeconds = Math.max(0, edge.src.start);
  const endSeconds = Math.max(0, edge.dest.start);
  const startDisplaySeconds = Math.floor(startSeconds);
  const endDisplaySeconds = Math.floor(endSeconds);
  const deltaSeconds = endDisplaySeconds - startDisplaySeconds;
  const signedDelta =
    `${deltaSeconds >= 0 ? "+" : "-"}${formatDuration(Math.abs(deltaSeconds))}`;
  const beatDelta = edge.dest.which - edge.src.which;
  return {
    id: edge.id,
    start: formatDuration(startDisplaySeconds),
    end: formatDuration(endDisplaySeconds),
    delta: signedDelta,
    startBeat: String(edge.src.which),
    endBeat: String(edge.dest.which),
    beatDelta: `${beatDelta >= 0 ? "+" : "-"}${Math.abs(beatDelta)}`,
    direction: branchDirection(edge, t),
    similarity: `${toSimilarityPercent(edge.distance, maxDistance)}%`,
  };
}
