from typing import Any, Callable, List, Optional, Tuple

import numpy as np
from madmom_beats_lite import ExtractionConfig, extract_beats as extract_beats_lite

_DEFAULT_CONFIG = ExtractionConfig(fps=100, beats_per_bar=(3, 4))


def extract_beats(
    audio: np.ndarray,
    sample_rate: int,
    progress_cb: Optional[Callable[[int, str, str], None]] = None,
) -> Tuple[List[float], List[int], List[float]]:
    """Return beat times and beat numbers (1-based within bar)."""
    signal = np.asarray(audio, dtype=np.float32)

    def on_progress(event: Any) -> None:
        if not progress_cb:
            return
        progress_cb(int(event.percent), str(event.stage), str(event.message))

    try:
        result = extract_beats_lite(
            signal,
            int(sample_rate),
            config=_DEFAULT_CONFIG,
            progress_callback=on_progress if progress_cb else None,
        )
        times = [float(x) for x in result.beat_times]
        beat_numbers = [int(x) for x in result.beat_numbers]
        confidences = [float(x) for x in result.beat_confidences]
        if times:
            return times, beat_numbers, confidences
    except Exception as exc:
        raise RuntimeError(f"madmom-beats-lite extraction failed: {exc}") from exc
    raise RuntimeError("madmom-beats-lite extraction empty")
