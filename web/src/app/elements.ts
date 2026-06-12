// All panels are React-owned as of checkpoint 8e; no legacy element
// queries remain. This module (and AppContext.elements) is deleted in the
// Phase 5 cleanup.
export type Elements = Record<string, never>;

export function getElements(): Elements {
  return {};
}
