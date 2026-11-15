export type PlaybackCounterValues = {
  beatsPlayed: number;
  listenSeconds: number;
  autocanonizerMainSeconds: number;
  autocanonizerOtherSeconds: number;
  wubMachineSeconds: number;
};

export type PlaybackCounters = {
  get: () => PlaybackCounterValues;
  set: (patch: Partial<PlaybackCounterValues>) => void;
  subscribe: (listener: (values: PlaybackCounterValues) => void) => () => void;
};

// Live playback counters kept outside React state; subscribers write them to the DOM.
export function createPlaybackCounters(): PlaybackCounters {
  let values: PlaybackCounterValues = {
    beatsPlayed: 0,
    listenSeconds: 0,
    autocanonizerMainSeconds: 0,
    autocanonizerOtherSeconds: 0,
    wubMachineSeconds: 0,
  };
  const listeners = new Set<(values: PlaybackCounterValues) => void>();
  return {
    get: () => values,
    set: (patch) => {
      const next = { ...values, ...patch };
      const keys = Object.keys(next) as (keyof PlaybackCounterValues)[];
      if (keys.every((key) => next[key] === values[key])) {
        return;
      }
      values = next;
      listeners.forEach((listener) => listener(values));
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
