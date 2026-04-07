from __future__ import annotations

from typing import Dict, Any, List, Optional, Callable

import numpy as np

from .audio import decode_audio
from .beats import extract_beats
from .config import AnalysisConfig
from .features import compute_frame_features
from .segmentation import compute_novelty, segment_from_novelty


def _segment_confidence(novelty: np.ndarray, frame_times: np.ndarray, start: float) -> float:
    if novelty.size == 0:
        return 0.5
    idx = np.searchsorted(frame_times, start, side="left")
    idx = min(max(idx, 0), len(novelty) - 1)
    min_n, max_n = float(novelty.min()), float(novelty.max())
    if max_n - min_n < 1e-6:
        return 0.5
    return float((novelty[idx] - min_n) / (max_n - min_n))


def _make_quanta(starts: List[float], duration: float, confidence: Optional[List[float]] = None) -> List[Dict[str, Any]]:
    quanta = []
    for i, start in enumerate(starts):
        end = starts[i + 1] if i + 1 < len(starts) else duration
        q = {
            "start": float(start),
            "duration": float(max(0.0, end - start)),
        }
        if confidence:
            q["confidence"] = float(confidence[i])
        quanta.append(q)
    return quanta


def _zscore(matrix: np.ndarray) -> np.ndarray:
    mean = np.mean(matrix, axis=0)
    std = np.std(matrix, axis=0)
    std[std < 1e-6] = 1.0
    return (matrix - mean) / std


def _smooth(values: np.ndarray, window: int = 3) -> np.ndarray:
    if values.size == 0:
        return values
    if window <= 1:
        return values
    kernel = np.ones(window, dtype=float) / window
    pad = window // 2
    padded = np.pad(values, (pad, pad), mode="edge")
    return np.convolve(padded, kernel, mode="valid")


def _bar_feature_vectors(bars: List[Dict[str, Any]], segments: List[Dict[str, Any]]) -> np.ndarray:
    features = []
    for i, bar in enumerate(bars):
        start = bar["start"]
        end = start + bar["duration"]
        overlaps = [
            seg for seg in segments
            if seg["start"] < end and (seg["start"] + seg["duration"]) > start
        ]
        if not overlaps:
            features.append(np.zeros(25, dtype=float))
            continue
        pitches = np.mean([seg["pitches"] for seg in overlaps], axis=0)
        timbre = np.mean([seg["timbre"] for seg in overlaps], axis=0)
        loudness = np.mean(
            [(seg["loudness_start"] + seg["loudness_max"]) * 0.5 for seg in overlaps]
        )
        vec = np.concatenate([pitches, timbre, np.asarray([loudness])], axis=0)
        features.append(vec.astype(float))
    return np.vstack(features) if features else np.zeros((0, 25), dtype=float)


def _sections_from_bars(
    bars: List[Dict[str, Any]],
    segments: List[Dict[str, Any]],
    duration: float,
) -> List[Dict[str, Any]]:
    if len(bars) <= 1:
        return _make_quanta([0.0], duration, confidence=[1.0])
    bar_vecs = _bar_feature_vectors(bars, segments)
    if bar_vecs.size == 0:
        return _make_quanta([0.0], duration, confidence=[1.0])
    z = _zscore(bar_vecs)
    diffs = np.linalg.norm(np.diff(z, axis=0), axis=1)
    smooth = _smooth(diffs, window=3)

    min_gap = 8
    candidates = []
    for i in range(1, len(smooth) - 1):
        if smooth[i] > smooth[i - 1] and smooth[i] >= smooth[i + 1]:
            candidates.append(i)
    candidates.sort(key=lambda idx: smooth[idx], reverse=True)

    selected = []
    for idx in candidates:
        bar_index = idx + 1
        if all(abs(bar_index - s) >= min_gap for s in selected):
            selected.append(bar_index)
    selected.sort()

    max_sections = 12
    max_boundaries = max_sections - 1
    if len(selected) > max_boundaries:
        selected = sorted(selected, key=lambda idx: smooth[idx - 1], reverse=True)[:max_boundaries]
        selected.sort()

    section_starts = [bars[0]["start"]] + [bars[i]["start"] for i in selected]
    section_confidence = []
    bar_index = 0
    for i, start in enumerate(section_starts):
        end = section_starts[i + 1] if i + 1 < len(section_starts) else duration
        confidences = []
        while bar_index < len(bars) and bars[bar_index]["start"] < end:
            if bars[bar_index]["start"] >= start:
                confidences.append(float(bars[bar_index].get("confidence", 1.0)))
            bar_index += 1
        if confidences:
            section_confidence.append(float(np.mean(confidences)))
        else:
            section_confidence.append(1.0)
    return _make_quanta(section_starts, duration, confidence=section_confidence)


def analyze_audio(
    audio_path: str,
    progress_cb: Optional[Callable[[int, str], None]] = None,
) -> Dict[str, Any]:
    last_reported = -1

    def report(percent: float, stage: str) -> None:
        nonlocal last_reported
        if not progress_cb:
            return
        pct = int(round(percent))
        pct = max(0, min(100, pct))
        if pct <= last_reported:
            return
        last_reported = pct
        progress_cb(pct, stage)

    config = AnalysisConfig()

    report(0, "decode")
    audio, sample_rate = decode_audio(audio_path, sample_rate=config.features.sample_rate)
    duration = len(audio) / sample_rate if sample_rate else 0.0

    report(10, "beats")
    def beat_progress(percent: int, stage: str, message: str) -> None:
        del message
        clamped = max(0, min(100, int(percent)))
        mapped = 10 + int((clamped / 100.0) * 75.0)
        stage_name = f"beats.{stage}" if stage else "beats"
        report(mapped, stage_name)

    beat_times, beat_numbers, beat_confidences = extract_beats(
        audio,
        sample_rate,
        progress_cb=beat_progress if progress_cb else None,
    )
    report(85, "beats")
    if not beat_times:
        beat_times = [0.0]
        beat_numbers = [1]
        beat_confidences = [1.0]

    report(90, "features")
    frame_features = compute_frame_features(audio, config.features)
    novelty = compute_novelty(
        frame_features["mfcc"],
        frame_features["hpcp"],
        frame_features["rms_db"],
    )

    boundaries = segment_from_novelty(
        frame_features["frame_times"],
        novelty,
        beat_times,
        config.segmentation,
        duration,
    )
    if len(boundaries) < 2:
        boundaries = [0.0, float(duration)]

    segments = []
    total_segments = max(len(boundaries) - 1, 1)
    for i in range(total_segments):
        start = boundaries[i]
        end = boundaries[i + 1]
        times = frame_features["frame_times"]
        idx = np.where((times >= start) & (times < end))[0]
        if len(idx) == 0:
            if times.size == 0:
                hpcp_dim = frame_features["hpcp"].shape[1] if frame_features["hpcp"].ndim == 2 else 12
                hpcp = np.zeros(hpcp_dim, dtype=float)
                rms_seq = np.asarray([0.0], dtype=float)
                seg_times = np.asarray([start], dtype=float)
            else:
                candidate = np.searchsorted(times, start, side="left")
                candidate = min(max(int(candidate), 0), len(times) - 1)
                idx = np.array([candidate])
        if len(idx) > 0:
            mfcc_frames = frame_features["mfcc"][idx]
            hpcp_frames = frame_features["hpcp"][idx]
            rms_seq = np.asarray(frame_features["rms_db"][idx], dtype=float)
            seg_times = times[idx]
            if mfcc_frames.ndim == 1:
                mfcc_frames = mfcc_frames[None, :]
            if hpcp_frames.ndim == 1:
                hpcp_frames = hpcp_frames[None, :]
            mfcc_dim = mfcc_frames.shape[1]
            if mfcc_dim < 13:
                mfcc_frames = np.pad(mfcc_frames, ((0, 0), (0, 13 - mfcc_dim)), mode="constant")
            weights = np.power(10.0, rms_seq / 20.0)
            if weights.size > 0:
                p10 = np.percentile(weights, 10)
                p90 = np.percentile(weights, 90)
                weights = np.clip(weights, p10, p90)
                wsum = float(weights.sum())
            else:
                wsum = 0.0
            if wsum > 0.0:
                # Energy-weighted MFCC mean to reduce low-energy frame bias
                timbre = (weights[:, None] * mfcc_frames[:, 1:13]).sum(axis=0) / wsum
            else:
                mfcc_mean = np.mean(mfcc_frames, axis=0)
                timbre = mfcc_mean[1:13]
            hpcp = np.mean(hpcp_frames, axis=0)
        if len(idx) == 0 and times.size == 0:
            timbre = np.zeros(12, dtype=float)
        if hpcp.size == 0:
            pitches = np.zeros(12, dtype=float)
        else:
            max_val = float(np.max(hpcp)) if np.max(hpcp) > 0 else 1.0
            pitches = hpcp / max_val
        rms_seq = np.asarray(rms_seq, dtype=float)
        loudness_start = float(rms_seq[0]) if rms_seq.size > 0 else 0.0
        loudness_max = float(rms_seq.max()) if rms_seq.size > 0 else 0.0
        if rms_seq.size > 0:
            max_idx = int(rms_seq.argmax())
            loudness_max_time = float(seg_times[max_idx] - start)
        else:
            loudness_max_time = 0.0
        confidence = _segment_confidence(novelty, frame_features["frame_times"], start)

        segment = {
            "start": float(start),
            "duration": float(max(0.0, end - start)),
            "confidence": float(confidence),
            "loudness_start": loudness_start,
            "loudness_max": loudness_max,
            "loudness_max_time": loudness_max_time,
            "pitches": pitches.tolist(),
            "timbre": timbre.astype(float).tolist(),
        }
        segments.append(segment)

    beats = _make_quanta(beat_times, duration, confidence=beat_confidences)

    # Bars based on downbeat indices (1-based within bar).
    bar_starts = []
    bar_confidences = []
    for t, num, conf in zip(beat_times, beat_numbers, beat_confidences):
        if num == 1:
            bar_starts.append(t)
            bar_confidences.append(conf)
    if not bar_starts:
        bar_starts = [beat_times[0]]
        bar_confidences = [beat_confidences[0] if beat_confidences else 1.0]
    bars = _make_quanta(bar_starts, duration, confidence=bar_confidences)

    # Tatums derived from beats.
    tatum_starts = []
    tatum_confidences = []
    for i, beat in enumerate(beat_times):
        next_beat = beat_times[i + 1] if i + 1 < len(beat_times) else duration
        beat_duration = max(0.0, next_beat - beat)
        for t in range(config.tatums_per_beat):
            tatum_starts.append(beat + (beat_duration * t / config.tatums_per_beat))
            tatum_confidences.append(beat_confidences[i] if i < len(beat_confidences) else 1.0)
    tatums = _make_quanta(tatum_starts, duration, confidence=tatum_confidences)
    for tatum in tatums:
        tatum["start"] = _round_value(tatum["start"], 3)

    sections = _sections_from_bars(bars, segments, duration)

    tempos = []
    for i in range(len(beat_times) - 1):
        dt = beat_times[i + 1] - beat_times[i]
        if dt > 0:
            tempos.append(60.0 / dt)
    tempo = float(np.median(tempos)) if tempos else 0.0

    analysis = {
        "engine_version": 3,
        "engine_origin": "forever-jukebox",
        "sections": sections,
        "bars": bars,
        "beats": beats,
        "tatums": tatums,
        "segments": segments,
        "track": {
            "duration": float(duration),
            "tempo": float(tempo),
            "time_signature": float(config.time_signature),
        },
    }

    report(100, "features")
    return analysis


def _round_value(value: float, decimals: int) -> float:
    return float(np.round(value, decimals=decimals))
