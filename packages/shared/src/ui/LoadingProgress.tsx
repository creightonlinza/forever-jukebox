import { useCallback, useEffect, useRef, useState } from "react";
import { createRng } from "../engine/random";
import "./LoadingProgress.css";

export type LoadingStepId =
  | "fetch"
  | "queued"
  | "beats"
  | "features"
  | "track"
  | "swing"
  | "remix"
  | "model"
  | "separate";

// Share of the overall percent.
const STEP_WEIGHTS: Record<LoadingStepId, number> = {
  fetch: 10,
  queued: 0,
  beats: 55,
  features: 25,
  track: 10,
  swing: 1,
  remix: 1,
  model: 35,
  separate: 65,
};

// Step order per loading task. Beats include decoding the audio. "track" builds the analysis output and
// cues up the track (audio and branch graph); it ends every analysis and is the whole task for a cached track.
export const LOADING_STEPS = {
  serverAnalysis: ["fetch", "queued", "beats", "features", "track"],
  localAnalysis: ["beats", "features", "track"],
  track: ["track"],
  swing: ["swing"],
  wubmachine: ["remix"],
  instrumental: ["model", "separate"],
} as const satisfies Record<string, readonly LoadingStepId[]>;

export type LoadingTask = keyof typeof LOADING_STEPS;

const MODE_TASKS = new Set<LoadingTask>(["swing", "wubmachine", "instrumental"]);
// Only a real analysis shows the beat ring; a load of an analyzed track ("track") shows as little as possible.
const ANALYSIS_TASKS = new Set<LoadingTask>(["serverAnalysis", "localAnalysis"]);

// What the app reports about one load. `key` identifies the track; `finished` means the real work is done.
export type LiveLoading = {
  task: LoadingTask;
  key: string;
  activeId: LoadingStepId;
  // 0..1 within the active step; null when the step reports no progress.
  progress: number | null;
  message?: string | null;
  finished: boolean;
};

export type LoadingProgressProps = Omit<LiveLoading, "key"> & {
  title: string;
  steps: { id: LoadingStepId; label: string }[];
  // Called once every step has played out on screen after the real work finished.
  onFinished: () => void;
};

const TICK_MS = 50;
// Time to fill a step's bar once its work has ended.
const FILL_MS = 300;
// Shortest time on screen for a step that really ran, and for one that ended between two updates.
const MIN_STEP_MS = 500;
const SKIPPED_STEP_MS = 450;
// The last step of an analysis shows the finished ring at least this long; a short hold then shows its check.
const FINAL_STEP_MS = 800;
const DONE_HOLD_MS = 300;

const DOTS = 72;
const RING_RADIUS = 92;

function ringPoint(index: number) {
  const angle = (index / DOTS) * 2 * Math.PI - Math.PI / 2;
  return [Math.cos(angle) * RING_RADIUS, Math.sin(angle) * RING_RADIUS];
}

// Decoration only: a fixed seed gives the same arcs on every platform.
const BRANCHES = (() => {
  const rng = createRng("seeded", 11);
  return Array.from({ length: 12 }, (_, k) => {
    const a = Math.floor(rng() * DOTS);
    const b = (a + 10 + Math.floor(rng() * (DOTS - 20))) % DOTS;
    const [x1, y1] = ringPoint(a);
    const [x2, y2] = ringPoint(b);
    const path = `M${x1},${y1} Q${(x1 + x2) * 0.18},${(y1 + y2) * 0.18} ${x2},${y2}`;
    // Fraction of the way to the last step at which this arc starts to draw.
    return { path, showAt: 0.6 + k * 0.03, selected: k === 7 };
  });
})();

// Plays out one task at a time: a finished load stays on screen until its steps have played out,
// an audio-mode render for the same track waits behind it, and any other new task replaces it.
export function usePresentedLoading(live: LiveLoading | null) {
  const [shownId, setShownId] = useState<string | null>(null);
  const latest = useRef(live);
  const lastShown = useRef<LiveLoading | null>(null);
  latest.current = live;
  const liveId = live ? `${live.task}:${live.key}` : null;
  let nextId = shownId;
  if (!live) {
    nextId = null;
  } else if (shownId === null || (liveId !== shownId && !MODE_TASKS.has(live.task))) {
    nextId = live.finished ? null : liveId;
  } else if (!shownId.endsWith(`:${live.key}`)) {
    nextId = live.finished ? null : liveId;
  }
  if (nextId !== shownId) {
    setShownId(nextId);
  }
  if (live && liveId === nextId) {
    lastShown.current = live;
  }
  const done = useCallback(() => {
    const next = latest.current;
    setShownId(next && !next.finished ? `${next.task}:${next.key}` : null);
  }, []);
  if (nextId === null || !lastShown.current) {
    return { shown: null, done };
  }
  const shown = liveId === nextId ? lastShown.current : { ...lastShown.current, finished: true };
  return { shown, done };
}

type View = { index: number; fill: number; since: number; doneAt: number | null };
type Real = { index: number; progress: number | null; finished: boolean; seen: Set<number> };

function advanceView(view: View, real: Real, count: number, now: number, dt: number, finalDwellMs: number): View {
  if (view.doneAt !== null) {
    return view;
  }
  if (view.index >= real.index && !real.finished) {
    if (real.progress === null || real.progress <= view.fill) {
      return view;
    }
    return { ...view, fill: view.fill + (real.progress - view.fill) * Math.min(1, dt / 250) };
  }
  const fill = Math.min(1, view.fill + dt / FILL_MS);
  const dwell = Math.max(
    real.seen.has(view.index) ? MIN_STEP_MS : SKIPPED_STEP_MS,
    view.index === count - 1 ? finalDwellMs : 0,
  );
  if (fill < 1 || now - view.since < dwell) {
    return { ...view, fill };
  }
  if (view.index >= count - 1) {
    return { ...view, fill: 1, doneAt: now };
  }
  return { index: view.index + 1, fill: 0, since: now, doneAt: null };
}

// The on-screen step trails the real one so that every step stays visible long enough to read.
function usePacedView(count: number, real: Omit<Real, "seen">, ring: boolean, onFinished: () => void) {
  const [view, setView] = useState<View>(() => ({ index: 0, fill: 0, since: performance.now(), doneAt: null }));
  const realRef = useRef<Real>({ ...real, seen: new Set() });
  realRef.current = { ...real, seen: realRef.current.seen };
  realRef.current.seen.add(real.index);
  const finishedRef = useRef(onFinished);
  finishedRef.current = onFinished;
  useEffect(() => {
    let last = performance.now();
    const id = window.setInterval(() => {
      const now = performance.now();
      const dt = now - last;
      last = now;
      setView((v) => advanceView(v, realRef.current, count, now, dt, ring ? FINAL_STEP_MS : 0));
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [count, ring]);
  useEffect(() => {
    if (view.doneAt === null) {
      return undefined;
    }
    const id = window.setTimeout(() => finishedRef.current(), ring ? DONE_HOLD_MS : 0);
    return () => window.clearTimeout(id);
  }, [view.doneAt, ring]);
  return view;
}

// Real start and end times of each step, for the elapsed timer and the step durations.
function useStepTimes(activeId: LoadingStepId, finished: boolean) {
  const times = useRef(new Map<LoadingStepId, { start: number; end?: number }>());
  const previous = useRef<LoadingStepId | null>(null);
  const current = finished ? null : activeId;
  if (previous.current !== current) {
    const now = performance.now();
    const ended = previous.current && times.current.get(previous.current);
    if (ended) {
      ended.end = now;
    }
    if (current && !times.current.has(current)) {
      times.current.set(current, { start: now });
    }
    previous.current = current;
  }
  return times.current;
}

function useSecondTick(enabled: boolean) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [enabled]);
}

// A finished step shows its check, then slides out to the left while the next one slides in from the right.
const CHECK_MS = 150;
// Matches the row transition in the CSS; with CHECK_MS it fits inside SKIPPED_STEP_MS.
const SLIDE_MS = 300;

function useLeavingStep(index: number) {
  const [current, setCurrent] = useState(index);
  const [leaving, setLeaving] = useState<{ index: number; sliding: boolean } | null>(null);
  if (current !== index) {
    setCurrent(index);
    setLeaving({ index: current, sliding: false });
  }
  useEffect(() => {
    if (!leaving) {
      return undefined;
    }
    const id = window.setTimeout(
      () => setLeaving(leaving.sliding ? null : { ...leaving, sliding: true }),
      leaving.sliding ? SLIDE_MS : CHECK_MS,
    );
    return () => window.clearTimeout(id);
  }, [leaving]);
  return leaving;
}

const CHECK = (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M3.5 8.5l3 3 6-7" />
  </svg>
);

export function LoadingProgress({
  task,
  title,
  steps,
  activeId,
  progress: rawProgress,
  message,
  finished,
  onFinished,
}: LoadingProgressProps) {
  const progress = rawProgress === null ? null : Math.min(1, Math.max(0, rawProgress));
  const realIndex = Math.max(0, steps.findIndex((s) => s.id === activeId));
  const ring = ANALYSIS_TASKS.has(task);
  const view = usePacedView(steps.length, { index: realIndex, progress, finished }, ring, onFinished);
  useEffect(() => {
    if (task === "track" && finished) {
      onFinished();
    }
  }, [task, finished, onFinished]);
  const times = useStepTimes(activeId, finished);
  const sweeping = view.index === realIndex && progress === null && !finished;
  useSecondTick(sweeping);

  const total = steps.reduce((sum, s) => sum + STEP_WEIGHTS[s.id], 0) || 1;
  const weighted = steps.reduce(
    (sum, s, i) => sum + STEP_WEIGHTS[s.id] * (i < view.index ? 1 : i === view.index ? view.fill : 0),
    0,
  );
  const percent = Math.floor((weighted / total) * 100);
  // The arcs finish drawing before the last step starts.
  const lastStepStart = ((total - STEP_WEIGHTS[steps[steps.length - 1].id]) / total) * 100;

  const activeStep = steps[view.index];
  const activeStart = times.get(activeStep.id)?.start;
  const elapsed = sweeping && activeStart !== undefined ? `${Math.floor((performance.now() - activeStart) / 1000)}s` : "";
  const lead = view.doneAt === null ? Math.floor((percent / 100) * DOTS) : DOTS;
  const count = `${view.index + 1} / ${steps.length}${elapsed ? ` · ${elapsed}` : ""}`;
  const done = view.doneAt !== null;
  const leaving = useLeavingStep(view.index);
  const duration = (id: LoadingStepId) => {
    const time = times.get(id);
    return time?.end === undefined ? "" : `${((time.end - time.start) / 1000).toFixed(1)}s`;
  };

  return (
    <div
      className="loading-progress"
      role="progressbar"
      aria-label={title}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-valuetext={`${percent}% ${activeStep.label}`}
    >
      {ring ? (
      <svg className="loading-progress__ring" viewBox="-104 -104 208 208" aria-hidden="true">
        {BRANCHES.map((b) => (
          <path
            key={b.path}
            className={`loading-progress__branch${b.selected ? " is-selected" : ""}${percent >= b.showAt * lastStepStart ? " is-shown" : ""}`}
            pathLength={1}
            d={b.path}
          />
        ))}
        {Array.from({ length: DOTS }, (_, i) => {
          const [cx, cy] = ringPoint(i);
          const state = i === lead ? " is-lead" : i < lead ? " is-on" : "";
          return <circle key={i} className={`loading-progress__dot${state}`} cx={cx} cy={cy} r={3.2} />;
        })}
        <circle className="loading-progress__hub" r={50} />
        <text className="loading-progress__count" y={-30}>
          {count}
        </text>
        <text className="loading-progress__percent" y={6}>
          {percent}%
        </text>
        <text className="loading-progress__step" y={28}>
          {activeStep.label}
        </text>
      </svg>
      ) : null}
      <p className="loading-progress__title">
        {title}
        {!ring && steps.length > 1 ? <span>{`${view.index + 1} / ${steps.length}`}</span> : null}
      </p>
      <div className="loading-progress__slot">
        {leaving ? (
          <div
            key={leaving.index}
            className={`loading-progress__row is-done${leaving.sliding ? " is-leaving" : ""}`}
          >
            <span className="loading-progress__icon">{CHECK}</span>
            <span className="loading-progress__label">{steps[leaving.index].label}</span>
            <span className="loading-progress__meta">{duration(steps[leaving.index].id)}</span>
            <div className="loading-progress__bar">
              <i style={{ transform: "scaleX(1)" }} />
            </div>
          </div>
        ) : null}
        <div
          key={view.index}
          className={`loading-progress__row ${done ? "is-done" : "is-active"}${leaving && !leaving.sliding ? " is-entering" : ""}`}
        >
          <span className="loading-progress__icon">{CHECK}</span>
          <span className="loading-progress__label">{activeStep.label}</span>
          <span className="loading-progress__meta">
            {done ? duration(activeStep.id) : sweeping ? elapsed : `${Math.floor(view.fill * 100)}%`}
          </span>
          {message && view.index === realIndex && !done ? <p className="loading-progress__message">{message}</p> : null}
          <div className={`loading-progress__bar${sweeping ? " is-sweep" : ""}`}>
            <i style={sweeping ? undefined : { transform: `scaleX(${done ? 1 : view.fill})` }} />
          </div>
        </div>
      </div>
    </div>
  );
}
