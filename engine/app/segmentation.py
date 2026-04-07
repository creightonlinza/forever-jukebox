from typing import List

import numpy as np
from scipy.ndimage import uniform_filter1d
from scipy.signal import find_peaks

from .config import SegmentationConfig


def compute_novelty(mfcc: np.ndarray, hpcp: np.ndarray, rms_db: np.ndarray) -> np.ndarray:
    mfcc_norm = (mfcc - mfcc.mean(axis=0)) / (mfcc.std(axis=0) + 1e-6)
    hpcp_norm = (hpcp - hpcp.mean(axis=0)) / (hpcp.std(axis=0) + 1e-6)
    rms_norm = (rms_db - rms_db.mean()) / (rms_db.std() + 1e-6)
    feat = np.concatenate([mfcc_norm, hpcp_norm, rms_norm[:, None]], axis=1)
    diff = np.diff(feat, axis=0)
    novelty = np.linalg.norm(diff, axis=1)
    novelty = np.concatenate([[0.0], novelty])
    return novelty


def segment_from_novelty(frame_times: np.ndarray,
                          novelty: np.ndarray,
                          beats: List[float],
                          config: SegmentationConfig,
                          duration: float) -> List[float]:
    smooth = uniform_filter1d(novelty, size=max(1, config.novelty_smoothing))
    peaks, props = find_peaks(
        smooth,
        height=config.peak_threshold,
        prominence=config.peak_prominence,
    )
    peak_times = set(frame_times[peaks].tolist())

    boundaries = [0.0]
    for t in sorted(peak_times):
        boundaries.append(float(t))
    boundaries.append(duration)

    # Snap boundaries to nearest beat to keep segments beat-aware.
    snapped = [0.0]
    for t in boundaries[1:-1]:
        nearest = min(beats, key=lambda b: abs(b - t)) if beats else t
        if abs(nearest - t) <= config.beat_snap_tolerance:
            snapped.append(float(nearest))
        else:
            snapped.append(float(t))
    snapped.append(duration)

    snapped = sorted(set(snapped))

    # Enforce minimum duration by merging.
    merged = [snapped[0]]
    for t in snapped[1:]:
        if t - merged[-1] < config.min_segment_duration:
            continue
        merged.append(t)

    if merged[-1] != duration:
        merged.append(duration)
    if len(merged) == 1:
        merged.append(duration)

    # Cap segment count.
    max_segments = int(max(1, duration * config.max_segments_per_second))
    if len(merged) - 1 > max_segments:
        boundary_count = max_segments + 1
        idx = np.linspace(0, len(merged) - 1, num=boundary_count, dtype=int)
        merged = [merged[int(i)] for i in idx]
        merged[-1] = duration

    return merged
