const anchorHighlightStorageKey = "fj-highlight-anchor-branch";

export function resolveStoredAnchorHighlight(): boolean {
  const stored = localStorage.getItem(anchorHighlightStorageKey);
  return stored === "1" || stored === "true";
}

export function storeAnchorHighlight(enabled: boolean) {
  localStorage.setItem(anchorHighlightStorageKey, enabled ? "1" : "0");
}
