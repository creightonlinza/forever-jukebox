import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict, List

import numpy as np

ENGINE_ROOT = Path(__file__).resolve().parents[1]
if str(ENGINE_ROOT) not in sys.path:
    sys.path.insert(0, str(ENGINE_ROOT))

from app.analysis import analyze_audio  # noqa: E402

TIMBRE_WEIGHT = 1
PITCH_WEIGHT = 10
LOUD_START_WEIGHT = 1
LOUD_MAX_WEIGHT = 1
DURATION_WEIGHT = 100
CONFIDENCE_WEIGHT = 1

MAX_BRANCHES = 4
MAX_BRANCH_THRESHOLD = 80


def preprocess_track(analysis: Dict[str, Any]) -> Dict[str, Any]:
    track = {"analysis": analysis}
    types = ["sections", "bars", "beats", "tatums", "segments"]
    for t in types:
        qlist = analysis.get(t, [])
        for idx, q in enumerate(qlist):
            q["track"] = track
            q["which"] = idx
            q["prev"] = qlist[idx - 1] if idx > 0 else None
            q["next"] = qlist[idx + 1] if idx + 1 < len(qlist) else None

    connect_quanta(track, "sections", "bars")
    connect_quanta(track, "bars", "beats")
    connect_quanta(track, "beats", "tatums")
    connect_quanta(track, "tatums", "segments")

    connect_all_overlapping_segments(track, "bars")
    connect_all_overlapping_segments(track, "beats")
    connect_all_overlapping_segments(track, "tatums")

    return track


def connect_quanta(track: Dict[str, Any], parent: str, child: str) -> None:
    last = 0
    qparents = track["analysis"].get(parent, [])
    qchildren = track["analysis"].get(child, [])

    for qparent in qparents:
        qparent["children"] = []
        for j in range(last, len(qchildren)):
            qchild = qchildren[j]
            if qchild["start"] >= qparent["start"] and qchild["start"] < qparent["start"] + qparent["duration"]:
                qchild["parent"] = qparent
                qchild["indexInParent"] = len(qparent["children"])
                qparent["children"].append(qchild)
                last = j
            elif qchild["start"] > qparent["start"]:
                break


def connect_all_overlapping_segments(track: Dict[str, Any], quanta_name: str) -> None:
    last = 0
    quanta = track["analysis"].get(quanta_name, [])
    segs = track["analysis"].get("segments", [])

    for q in quanta:
        q["overlappingSegments"] = []
        for j in range(last, len(segs)):
            qseg = segs[j]
            if (qseg["start"] + qseg["duration"]) < q["start"]:
                continue
            if qseg["start"] > (q["start"] + q["duration"]):
                break
            last = j
            q["overlappingSegments"].append(qseg)


def euclidean_distance(v1: List[float], v2: List[float]) -> float:
    arr1 = np.asarray(v1, dtype=float)
    arr2 = np.asarray(v2, dtype=float)
    delta = arr2 - arr1
    return float(np.sqrt(np.sum(delta * delta)))


def seg_distance(seg1: Dict[str, Any], seg2: Dict[str, Any], field: str) -> float:
    return euclidean_distance(seg1[field], seg2[field])


def get_seg_distance(seg1: Dict[str, Any], seg2: Dict[str, Any]) -> float:
    timbre = seg_distance(seg1, seg2, "timbre")
    pitch = seg_distance(seg1, seg2, "pitches")
    sloud_start = abs(seg1["loudness_start"] - seg2["loudness_start"])
    sloud_max = abs(seg1["loudness_max"] - seg2["loudness_max"])
    duration = abs(seg1["duration"] - seg2["duration"])
    confidence = abs(seg1["confidence"] - seg2["confidence"])
    distance = (
        timbre * TIMBRE_WEIGHT
        + pitch * PITCH_WEIGHT
        + sloud_start * LOUD_START_WEIGHT
        + sloud_max * LOUD_MAX_WEIGHT
        + duration * DURATION_WEIGHT
        + confidence * CONFIDENCE_WEIGHT
    )
    return float(distance)


def calculate_nearest_neighbors_for_quantum(
    q1: Dict[str, Any],
    all_quanta: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    edges = []
    for q2 in all_quanta:
        if q2["which"] == q1["which"]:
            continue
        if not q1.get("overlappingSegments"):
            continue
        sum_dist = 0.0
        for j, seg1 in enumerate(q1["overlappingSegments"]):
            distance = 100.0
            if j < len(q2.get("overlappingSegments", [])):
                seg2 = q2["overlappingSegments"][j]
                if seg1.get("which") == seg2.get("which"):
                    distance = 100.0
                else:
                    distance = get_seg_distance(seg1, seg2)
            sum_dist += distance
        pdistance = 0.0 if q1.get("indexInParent") == q2.get("indexInParent") else 100.0
        total_distance = sum_dist / len(q1["overlappingSegments"]) + pdistance
        if total_distance < MAX_BRANCH_THRESHOLD:
            edges.append(
                {
                    "src": q1,
                    "dest": q2,
                    "distance": total_distance,
                    "deleted": False,
                }
            )

    edges.sort(key=lambda e: e["distance"])
    return edges[:MAX_BRANCHES]


def precalculate_nearest_neighbors(quanta: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    all_edges = []
    for q1 in quanta:
        q1["all_neighbors"] = calculate_nearest_neighbors_for_quantum(q1, quanta)
        for edge in q1["all_neighbors"]:
            edge["id"] = len(all_edges)
            all_edges.append(edge)
    return all_edges


def collect_nearest_neighbors(quanta: List[Dict[str, Any]], threshold: float) -> int:
    branching_count = 0
    for q in quanta:
        neighbors = [e for e in q.get("all_neighbors", []) if not e["deleted"] and e["distance"] <= threshold]
        q["neighbors"] = neighbors
        if neighbors:
            branching_count += 1
    return branching_count


def compute_branch_stats(analysis: Dict[str, Any]) -> Dict[str, Any]:
    track = preprocess_track(analysis)
    beats = track["analysis"].get("beats", [])
    if not beats:
        return {
            "computed_threshold": 0,
            "branching_fraction": 0.0,
            "neighbor_hist": [1.0, 0.0, 0.0, 0.0, 0.0],
            "median_distance": 0.0,
        }

    precalculate_nearest_neighbors(beats)

    target_branch_count = len(beats) / 6.0
    computed_threshold = MAX_BRANCH_THRESHOLD
    count = 0
    for threshold in range(10, MAX_BRANCH_THRESHOLD, 5):
        count = collect_nearest_neighbors(beats, threshold)
        if count >= target_branch_count:
            computed_threshold = threshold
            break

    branching_fraction = count / len(beats) if beats else 0.0

    hist = [0, 0, 0, 0, 0]
    distances = []
    for beat in beats:
        n = len(beat.get("neighbors", []))
        n = min(n, 4)
        hist[n] += 1
        for edge in beat.get("neighbors", []):
            distances.append(edge["distance"])

    total = sum(hist) if hist else 1
    hist_norm = [h / total for h in hist]
    median_distance = float(np.median(distances)) if distances else 0.0

    return {
        "computed_threshold": computed_threshold,
        "branching_fraction": branching_fraction,
        "neighbor_hist": hist_norm,
        "median_distance": median_distance,
    }


def clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


def compare_analysis(gold: Dict[str, Any], generated: Dict[str, Any]) -> Dict[str, Any]:
    gold_stats = compute_branch_stats(gold)
    gen_stats = compute_branch_stats(generated)

    tg = gold_stats["computed_threshold"]
    tr = gen_stats["computed_threshold"]
    bg = gold_stats["branching_fraction"]
    br = gen_stats["branching_fraction"]
    hg = np.asarray(gold_stats["neighbor_hist"], dtype=float)
    hr = np.asarray(gen_stats["neighbor_hist"], dtype=float)
    mg = gold_stats["median_distance"]
    mr = gen_stats["median_distance"]

    score_thresh = 1.0 - clamp(abs(tg - tr) / 20.0, 0.0, 1.0)
    score_branch = 1.0 - clamp(abs(bg - br) / 0.25, 0.0, 1.0)
    score_hist = 1.0 - clamp(float(np.sum(np.abs(hg - hr))) / 2.0, 0.0, 1.0)
    score_edges = 1.0 - clamp(abs(mg - mr) / 40.0, 0.0, 1.0)

    similarity = 100.0 * (
        0.35 * score_hist
        + 0.25 * score_branch
        + 0.25 * score_thresh
        + 0.15 * score_edges
    )

    return {
        "similarity": similarity,
        "scores": {
            "threshold": score_thresh,
            "branching": score_branch,
            "histogram": score_hist,
            "edges": score_edges,
        },
        "gold": gold_stats,
        "generated": gen_stats,
    }


def load_analysis(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    if "analysis" in data:
        return data["analysis"]
    if "result" in data:
        return data["result"]
    return data


def generate_analysis(audio_path: Path) -> dict:
    return analyze_audio(str(audio_path))


def main() -> None:
    parser = argparse.ArgumentParser(description="Compare analysis outputs")
    parser.add_argument("--benchmark", required=True, help="Path to benchmark analysis JSON")
    parser.add_argument("--audio", help="Path to audio file to analyze and compare")
    parser.add_argument("--compare", help="Path to analysis JSON to compare (skip engine)")
    parser.add_argument("--dump", action="store_true", help="Print component scores")
    args = parser.parse_args()

    benchmark_path = Path(args.benchmark)
    if args.audio and args.compare:
        raise SystemExit("Pass either --audio or --compare, not both.")
    if not args.audio and not args.compare:
        raise SystemExit("Pass --audio or --compare.")

    benchmark = load_analysis(benchmark_path)
    if args.compare:
        compare_path = Path(args.compare)
        generated = load_analysis(compare_path)
    else:
        audio_path = Path(args.audio)
        generated = generate_analysis(audio_path)

    result = compare_analysis(benchmark, generated)

    print(f"similarity={result['similarity']:.2f}%")
    if args.dump:
        print(f"threshold score={result['scores']['threshold']:.3f}")
        print(f"branching score={result['scores']['branching']:.3f}")
        print(f"histogram score={result['scores']['histogram']:.3f}")
        print(f"edges score={result['scores']['edges']:.3f}")
        print(f"gold threshold={result['gold']['computed_threshold']}")
        print(f"gen threshold={result['generated']['computed_threshold']}")
        print(f"gold branching={result['gold']['branching_fraction']:.3f}")
        print(f"gen branching={result['generated']['branching_fraction']:.3f}")
        print(f"gold hist={result['gold']['neighbor_hist']}")
        print(f"gen hist={result['generated']['neighbor_hist']}")
        print(f"gold median distance={result['gold']['median_distance']:.3f}")
        print(f"gen median distance={result['generated']['median_distance']:.3f}")


if __name__ == "__main__":
    main()
