const branchStatsStorageKey = "fj-branch-stats-enabled";

export function resolveStoredBranchStatsEnabled(): boolean {
  const stored = localStorage.getItem(branchStatsStorageKey);
  return stored === "1" || stored === "true";
}

export function storeBranchStatsEnabled(enabled: boolean) {
  localStorage.setItem(branchStatsStorageKey, enabled ? "1" : "0");
}
