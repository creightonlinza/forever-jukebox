from typing import List, Tuple

import collections
import collections.abc
import math
import warnings

import numpy as np
from madmom_beats_lite._shared import ensure_madmom_importable
from scipy import signal as scipy_signal

_CACHED = {}
_DOWNBEAT_FPS = 100


def _refine_beat_indices(indices: np.ndarray, activations: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    if activations.ndim > 1:
        energy = activations.sum(axis=1)
    else:
        energy = activations
    count = energy.shape[0]
    refined = np.empty(len(indices), dtype=float)
    peaks = np.empty(len(indices), dtype=int)
    for i, idx in enumerate(indices):
        idx = int(idx)
        if idx <= 0 or idx >= count - 1:
            refined[i] = float(idx)
            peaks[i] = idx
            continue
        left = max(idx - 1, 0)
        right = min(idx + 1, count - 1)
        peak = left + int(np.argmax(energy[left:right + 1]))
        peaks[i] = peak
        if peak <= 0 or peak >= count - 1:
            refined[i] = float(peak)
            continue
        y1, y2, y3 = energy[peak - 1], energy[peak], energy[peak + 1]
        denom = (y1 - 2 * y2 + y3)
        if abs(denom) < 1e-12:
            refined[i] = float(peak)
            continue
        delta = 0.5 * (y1 - y3) / denom
        if delta < -0.5:
            delta = -0.5
        elif delta > 0.5:
            delta = 0.5
        refined[i] = float(peak) + float(delta)
    return refined, peaks


def _madmom_downbeats(proc, activations: np.ndarray) -> np.ndarray:
    first = 0
    if proc.threshold:
        idx = np.nonzero(activations >= proc.threshold)[0]
        if idx.any():
            first = max(first, int(np.min(idx)))
            last = min(len(activations), int(np.max(idx)) + 1)
        else:
            last = first
        activations = activations[first:last]
    if not activations.any():
        return np.empty((0, 3))

    results = [hmm.viterbi(activations) for hmm in proc.hmms]
    best = int(np.argmax([float(r[1]) for r in results]))
    path, _ = results[best]
    st = proc.hmms[best].transition_model.state_space
    om = proc.hmms[best].observation_model
    positions = st.state_positions[path]
    beat_numbers = positions.astype(int) + 1
    if proc.correct:
        beats = np.empty(0, dtype=int)
        beat_range = om.pointers[path] >= 1
        idx = np.nonzero(np.diff(beat_range.astype(int)))[0] + 1
        if beat_range[0]:
            idx = np.r_[0, idx]
        if beat_range[-1]:
            idx = np.r_[idx, beat_range.size]
        if idx.any():
            for left, right in idx.reshape((-1, 2)):
                peak = np.argmax(activations[left:right]) // 2 + left
                beats = np.hstack((beats, peak))
    else:
        beats = np.nonzero(np.diff(beat_numbers))[0] + 1
    if beats.size == 0:
        return np.empty((0, 3))
    refined, peaks = _refine_beat_indices(beats, activations)
    times = (refined + float(first)) / float(proc.fps)
    if activations.ndim > 1:
        energy = activations.sum(axis=1)
    else:
        energy = activations
    min_e = float(energy.min()) if energy.size else 0.0
    max_e = float(energy.max()) if energy.size else 0.0
    if max_e - min_e < 1e-6:
        conf = np.full_like(refined, 0.5, dtype=float)
    else:
        conf = (energy[peaks] - min_e) / (max_e - min_e)
        conf = np.clip(conf, 0.0, 1.0)
    return np.vstack((times, beat_numbers[beats], conf)).T


def _get_downbeat_processors():
    proc = _CACHED.get("downbeat_proc")
    tracker = _CACHED.get("downbeat_tracker")
    if proc is None or tracker is None:
        ensure_madmom_importable()
        from madmom.features.downbeats import DBNDownBeatTrackingProcessor, RNNDownBeatProcessor
        proc = RNNDownBeatProcessor(fps=_DOWNBEAT_FPS)
        tracker = DBNDownBeatTrackingProcessor(beats_per_bar=[3, 4], fps=_DOWNBEAT_FPS)
        _CACHED["downbeat_proc"] = proc
        _CACHED["downbeat_tracker"] = tracker
    return proc, tracker


def extract_beats(
    audio: np.ndarray,
    sample_rate: int,
    batch: bool = False,
) -> Tuple[List[float], List[int], List[float]]:
    """Return beat times and beat numbers (1-based within bar)."""
    if not hasattr(collections, "MutableSequence"):
        collections.MutableSequence = collections.abc.MutableSequence
    if not hasattr(collections, "MutableMapping"):
        collections.MutableMapping = collections.abc.MutableMapping
    if not hasattr(collections, "MutableSet"):
        collections.MutableSet = collections.abc.MutableSet
    # Avoid NumPy deprecation warnings by checking the module dict directly.
    if "float" not in np.__dict__:
        np.float = float
    if "int" not in np.__dict__:
        np.int = int
    if "bool" not in np.__dict__:
        np.bool = bool
    if "complex" not in np.__dict__:
        np.complex = complex
    warnings.filterwarnings(
        "ignore",
        message="pkg_resources is deprecated as an API.*",
        category=UserWarning,
        module="madmom",
    )
    madmom_sr = 44100
    signal = np.asarray(audio, dtype=np.float32)
    if sample_rate != madmom_sr and signal.size:
        g = math.gcd(int(sample_rate), madmom_sr)
        up = madmom_sr // g
        down = int(sample_rate) // g
        signal = scipy_signal.resample_poly(signal, up, down).astype(np.float32)
    if batch:
        proc, tracker = _get_downbeat_processors()
    else:
        ensure_madmom_importable()
        from madmom.features.downbeats import DBNDownBeatTrackingProcessor, RNNDownBeatProcessor
        proc = RNNDownBeatProcessor(fps=_DOWNBEAT_FPS)
        tracker = DBNDownBeatTrackingProcessor(beats_per_bar=[3, 4], fps=_DOWNBEAT_FPS)
    act = proc(signal)
    try:
        downbeats = _madmom_downbeats(tracker, act)
        times = downbeats[:, 0].tolist()
        beat_numbers = downbeats[:, 1].astype(int).tolist()
        confidences = downbeats[:, 2].tolist() if downbeats.shape[1] > 2 else [1.0] * len(times)
        if times:
            return times, beat_numbers, confidences
    except Exception as exc:
        raise RuntimeError("madmom downbeats failed") from exc
    raise RuntimeError("madmom downbeats empty")
