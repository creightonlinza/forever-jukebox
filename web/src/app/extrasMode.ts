const branchStatsStorageKey = "fj-branch-stats-enabled";

export function resolveStoredBranchStatsEnabled(): boolean {
  const stored = localStorage.getItem(branchStatsStorageKey);
  return stored === "1" || stored === "true";
}

export function storeBranchStatsEnabled(enabled: boolean) {
  localStorage.setItem(branchStatsStorageKey, enabled ? "1" : "0");
}

const customAnchorStorageKey = "fj-custom-anchor-enabled";

export function resolveStoredCustomAnchorEnabled(): boolean {
  return localStorage.getItem(customAnchorStorageKey) === "1";
}

export function storeCustomAnchorEnabled(enabled: boolean) {
  localStorage.setItem(customAnchorStorageKey, enabled ? "1" : "0");
}
