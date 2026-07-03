import i18n from "./i18n";

export function translateJobProgress(
  status: string | null | undefined,
  progress: number | null | undefined,
  fallback?: string | null,
): string {
  if (status === "downloading") {
    return i18n.t("common.fetchingAudio");
  }
  if (status === "processing") {
    if (progress === null || progress === undefined || progress < 10) {
      return i18n.t("status.processing");
    }
    if (progress < 90) {
      return i18n.t("status.analyzing");
    }
    return i18n.t("status.wrappingUp");
  }
  if (status === "queued") {
    const aheadMatch = fallback?.match(/(\d{1,9})\s+ahead/i);
    if (aheadMatch) {
      return i18n.t("status.queuedAhead", {
        count: Number(aheadMatch[1]),
      });
    }
    return i18n.t("status.queuedNext");
  }
  return fallback || i18n.t("common.processing");
}
