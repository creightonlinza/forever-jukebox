import { QuantumBase, Segment, TrackAnalysis, TrackMeta } from "./types";

type UnknownRecord = Record<string, unknown>;

function isObject(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function assertObject(value: unknown, path: string): UnknownRecord {
  if (!isObject(value)) {
    throw new Error(`Expected object at ${path}`);
  }
  return value;
}

function assertNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new Error(`Expected number at ${path}`);
  }
  return value;
}

function assertArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`Expected array at ${path}`);
  }
  return value;
}

function parseNumberArray(
  value: unknown,
  path: string,
  minLength: number
): number[] {
  const arr = assertArray(value, path);
  if (arr.length < minLength) {
    throw new Error(`Expected ${minLength}+ numbers at ${path}`);
  }
  return arr.map((item, idx) => assertNumber(item, `${path}[${idx}]`));
}

function parseQuantumList(value: unknown, path: string): QuantumBase[] {
  const list = assertArray(value, path);
  return list.map((item, idx) => {
    const obj = assertObject(item, `${path}[${idx}]`);
    const start = assertNumber(obj.start, `${path}[${idx}].start`);
    const duration = assertNumber(obj.duration, `${path}[${idx}].duration`);
    const confidence =
      obj.confidence === undefined
        ? undefined
        : assertNumber(obj.confidence, `${path}[${idx}].confidence`);
    return {
      start,
      duration,
      confidence,
      which: idx,
      prev: null,
      next: null,
      overlappingSegments: [],
      neighbors: [],
      allNeighbors: [],
    };
  });
}

function parseSegments(value: unknown, path: string): Segment[] {
  const list = assertArray(value, path);
  return list.map((item, idx) => {
    const obj = assertObject(item, `${path}[${idx}]`);
    return {
      start: assertNumber(obj.start, `${path}[${idx}].start`),
      duration: assertNumber(obj.duration, `${path}[${idx}].duration`),
      confidence: assertNumber(obj.confidence, `${path}[${idx}].confidence`),
      loudness_start: assertNumber(
        obj.loudness_start,
        `${path}[${idx}].loudness_start`
      ),
      loudness_max: assertNumber(
        obj.loudness_max,
        `${path}[${idx}].loudness_max`
      ),
      loudness_max_time: assertNumber(
        obj.loudness_max_time,
        `${path}[${idx}].loudness_max_time`
      ),
      pitches: parseNumberArray(obj.pitches, `${path}[${idx}].pitches`, 12),
      timbre: parseNumberArray(obj.timbre, `${path}[${idx}].timbre`, 12),
      which: idx,
    };
  });
}

function parseTrackMeta(value: unknown): TrackMeta | undefined {
  if (!isObject(value)) {
    return undefined;
  }
  const meta: TrackMeta = {};
  if (value.duration !== undefined) {
    meta.duration = assertNumber(value.duration, "track.duration");
  }
  if (value.tempo !== undefined) {
    meta.tempo = assertNumber(value.tempo, "track.tempo");
  }
  if (value.time_signature !== undefined) {
    meta.time_signature = assertNumber(
      value.time_signature,
      "track.time_signature"
    );
  }
  if (value.title !== undefined) {
    meta.title = String(value.title);
  }
  if (value.artist !== undefined) {
    meta.artist = String(value.artist);
  }
  return meta;
}

function resolveAnalysisRoot(data: UnknownRecord): UnknownRecord {
  if (isObject(data.analysis) && data.analysis.beats) {
    return data.analysis as UnknownRecord;
  }
  return data;
}

export function parseAnalysis(input: unknown): TrackAnalysis {
  const data = assertObject(input, "analysis");
  const root = resolveAnalysisRoot(data);

  const sections = parseQuantumList(root.sections, "sections");
  const bars = parseQuantumList(root.bars, "bars");
  const beats = parseQuantumList(root.beats, "beats");
  const tatums = parseQuantumList(root.tatums, "tatums");
  const segments = parseSegments(root.segments, "segments");

  return {
    sections,
    bars,
    beats,
    tatums,
    segments,
    track: parseTrackMeta(data.track),
  };
}

function linkNeighbors(list: QuantumBase[]) {
  for (let i = 0; i < list.length; i += 1) {
    const q = list[i];
    q.which = i;
    q.prev = i > 0 ? list[i - 1] : null;
    q.next = i < list.length - 1 ? list[i + 1] : null;
  }
}

function connectQuanta(parentList: QuantumBase[], childList: QuantumBase[]) {
  let last = 0;
  for (let i = 0; i < parentList.length; i += 1) {
    const parent = parentList[i];
    parent.children = [];
    for (let j = last; j < childList.length; j += 1) {
      const child = childList[j];
      if (
        child.start >= parent.start &&
        child.start < parent.start + parent.duration
      ) {
        child.parent = parent;
        child.indexInParent = parent.children.length;
        parent.children.push(child);
        last = j;
      } else if (child.start > parent.start) {
        break;
      }
    }
  }
}

function connectFirstOverlappingSegment(
  quanta: QuantumBase[],
  segments: Segment[]
) {
  let last = 0;
  for (let i = 0; i < quanta.length; i += 1) {
    const q = quanta[i];
    for (let j = last; j < segments.length; j += 1) {
      const seg = segments[j];
      if (seg.start >= q.start) {
        q.oseg = seg;
        last = j;
        break;
      }
    }
  }
}

function connectAllOverlappingSegments(
  quanta: QuantumBase[],
  segments: Segment[]
) {
  let last = 0;
  for (let i = 0; i < quanta.length; i += 1) {
    const q = quanta[i];
    q.overlappingSegments = [];
    for (let j = last; j < segments.length; j += 1) {
      const seg = segments[j];
      if (seg.start + seg.duration < q.start) {
        continue;
      }
      if (seg.start > q.start + q.duration) {
        break;
      }
      last = j;
      q.overlappingSegments.push(seg);
    }
  }
}

export function normalizeAnalysis(input: unknown): TrackAnalysis {
  const analysis = parseAnalysis(input);
  const { sections, bars, beats, tatums, segments } = analysis;

  linkNeighbors(sections);
  linkNeighbors(bars);
  linkNeighbors(beats);
  linkNeighbors(tatums);

  connectQuanta(sections, bars);
  connectQuanta(bars, beats);
  connectQuanta(beats, tatums);

  connectFirstOverlappingSegment(bars, segments);
  connectFirstOverlappingSegment(beats, segments);
  connectFirstOverlappingSegment(tatums, segments);

  connectAllOverlappingSegments(bars, segments);
  connectAllOverlappingSegments(beats, segments);
  connectAllOverlappingSegments(tatums, segments);

  return analysis;
}
