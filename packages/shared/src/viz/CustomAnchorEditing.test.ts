import { afterEach, describe, expect, it, vi } from "vitest";
import type { CustomAnchor } from "../engine/selection";
import type { QuantumBase } from "../engine/types";
import { CustomAnchorEditing, type CustomAnchorEditHost } from "./CustomAnchorEditing";
import type { AnchorEditState } from "./JukeboxViz";

// Four-beat bars; every beat shares its segment features, so snap distances only differ by bar position.
function makeBeats(count: number): QuantumBase[] {
  const bars = Array.from({ length: Math.ceil(count / 4) }, (_, which) => ({
    which,
    children: [] as QuantumBase[],
  }));
  return Array.from({ length: count }, (_, which) => {
    const bar = bars[Math.floor(which / 4)];
    const beat = {
      which,
      start: which,
      duration: 1,
      prev: null,
      next: null,
      parent: bar as unknown as QuantumBase,
      indexInParent: which % 4,
      overlappingSegments: [
        {
          start: which,
          duration: 1,
          confidence: 1,
          loudness_start: -20,
          loudness_max: -10,
          loudness_max_time: 0,
          pitches: new Array(12).fill(0.5),
          timbre: new Array(12).fill(1),
          which,
        },
      ],
      neighbors: [],
      allNeighbors: [],
    } as QuantumBase;
    bar.children.push(beat);
    return beat;
  });
}

function makeHost(active: CustomAnchor | null = { src: 20, dest: 4 }, beatCount = 32) {
  let edit: AnchorEditState | null = null;
  const beats = makeBeats(beatCount);
  const engine = {
    active,
    getActiveAnchor: vi.fn(() => engine.active),
    setCustomAnchor: vi.fn((src: number, dest: number) => {
      engine.active = { src, dest };
      return true;
    }),
    setUserAnchorEdge: vi.fn(() => {
      engine.active = null;
    }),
  };
  const host: CustomAnchorEditHost = {
    engine: engine as unknown as CustomAnchorEditHost["engine"],
    beats: () => beats,
    getEdit: () => edit,
    setEdit: vi.fn((state: AnchorEditState | null) => {
      edit = state;
    }),
    onAnchorChanged: vi.fn(),
  };
  return { host, engine, current: () => edit };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("CustomAnchorEditing", () => {
  it("opens on the anchor in force, or the widest loop without one, and refuses a short track", () => {
    const editing = new CustomAnchorEditing();
    const pinned = makeHost();
    expect(editing.start(pinned.host)).toBe(true);
    expect(pinned.current()).toEqual({ src: 20, dest: 4, active: "src" });

    const none = makeHost(null);
    editing.start(none.host);
    expect(none.current()).toEqual({ src: 31, dest: 0, active: "src" });

    const short = makeHost(null, 4);
    expect(editing.start(short.host)).toBe(false);
    expect(short.current()).toBeNull();
  });

  it("keeps the anchor in force when a drag ends where it started", () => {
    const editing = new CustomAnchorEditing();
    const { host, engine } = makeHost();
    editing.start(host);
    editing.dragCommitted(host, { src: 20, dest: 4, active: "src" });
    expect(engine.setCustomAnchor).not.toHaveBeenCalled();
    expect(host.onAnchorChanged).not.toHaveBeenCalled();

    editing.dragCommitted(host, { src: 22, dest: 4, active: "src" });
    expect(engine.setCustomAnchor).toHaveBeenCalledWith(22, 4);
    expect(host.onAnchorChanged).toHaveBeenCalledTimes(1);
  });

  it("ignores drag events once the editor is closed", () => {
    const editing = new CustomAnchorEditing();
    const { host, engine, current } = makeHost();
    editing.dragChanged(host, { src: 22, dest: 4, active: "src" });
    editing.dragCommitted(host, { src: 22, dest: 4, active: "src" });
    expect(current()).toBeNull();
    expect(engine.setCustomAnchor).not.toHaveBeenCalled();
  });

  it("commits key nudges once they settle, and a bar step uses the bar length", () => {
    vi.useFakeTimers();
    const editing = new CustomAnchorEditing();
    const { host, engine, current } = makeHost();
    editing.start(host);
    editing.nudge(host, 1, false);
    editing.nudge(host, 1, true);
    expect(current()).toMatchObject({ src: 25, dest: 4 });
    expect(engine.setCustomAnchor).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(engine.setCustomAnchor).toHaveBeenCalledTimes(1);
    expect(engine.setCustomAnchor).toHaveBeenCalledWith(25, 4);
  });

  it("stops a nudge at the minimum gap and at the track ends", () => {
    const editing = new CustomAnchorEditing();
    const { host, current } = makeHost({ src: 8, dest: 4 });
    editing.start(host);
    editing.nudge(host, -1, false);
    expect(current()).toMatchObject({ src: 8, dest: 4 });
    editing.selectEnd(host, "dest");
    editing.nudge(host, -1, true);
    editing.nudge(host, -1, true);
    expect(current()).toMatchObject({ src: 8, dest: 0 });
  });

  it("lands a pending nudge on exit and drops it on discard", () => {
    vi.useFakeTimers();
    const editing = new CustomAnchorEditing();
    const exited = makeHost();
    editing.start(exited.host);
    editing.nudge(exited.host, 1, false);
    editing.exit(exited.host);
    expect(exited.engine.setCustomAnchor).toHaveBeenCalledWith(21, 4);
    expect(exited.current()).toBeNull();

    const discarded = makeHost();
    editing.start(discarded.host);
    editing.nudge(discarded.host, 1, false);
    editing.discard(discarded.host);
    vi.advanceTimersByTime(300);
    expect(discarded.engine.setCustomAnchor).not.toHaveBeenCalled();
    expect(discarded.current()).toBeNull();
  });

  it("cancels a pending nudge on dispose", () => {
    vi.useFakeTimers();
    const editing = new CustomAnchorEditing();
    const { host, engine } = makeHost();
    editing.start(host);
    editing.nudge(host, 1, false);
    editing.dispose();
    vi.advanceTimersByTime(300);
    expect(engine.setCustomAnchor).not.toHaveBeenCalled();
  });

  it("snaps an off-beat end back onto the same beat of the bar and commits it", () => {
    const editing = new CustomAnchorEditing();
    const { host, engine, current } = makeHost({ src: 20, dest: 5 });
    editing.start(host);
    editing.selectEnd(host, "dest");
    editing.snap(host);
    expect(current()?.dest).toBe(4);
    expect(engine.setCustomAnchor).toHaveBeenCalledWith(20, 4);
  });

  it("resets to the default anchor and stays open on it", () => {
    const editing = new CustomAnchorEditing();
    const { host, engine, current } = makeHost();
    editing.start(host);
    editing.reset(host);
    expect(engine.setUserAnchorEdge).toHaveBeenCalledWith(null);
    expect(host.onAnchorChanged).toHaveBeenCalled();
    expect(current()).toEqual({ src: 31, dest: 0, active: "src" });
  });
});
