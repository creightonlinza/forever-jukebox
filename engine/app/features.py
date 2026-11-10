from typing import Callable, Dict

import numpy as np

from .config import FeatureConfig


class FeatureExtractionError(RuntimeError):
    pass


def compute_frame_features(
    audio: np.ndarray,
    config: FeatureConfig,
    progress_cb: Callable[[float], None] | None = None,
) -> Dict[str, np.ndarray]:
    try:
        import essentia.standard as es
    except ImportError as exc:
        raise FeatureExtractionError("essentia is required for feature extraction") from exc

    frame_size = config.frame_size
    hop_size = config.hop_size
    sample_rate = config.sample_rate

    window = es.Windowing(type="hann")
    spectrum = es.Spectrum(size=frame_size)
    mfcc = es.MFCC(highFrequencyBound=11025, numberCoefficients=13, inputSize=frame_size // 2 + 1)
    spectral_peaks = es.SpectralPeaks(orderBy="magnitude", magnitudeThreshold=1e-6)
    hpcp = es.HPCP(size=12, sampleRate=sample_rate)
    rms = es.RMS()

    frames = []
    mfccs = []
    hpcps = []
    rms_db = []
    starts = range(0, max(len(audio) - frame_size, 0) + 1, hop_size)
    report_every = max(len(starts) // 50, 1)
    for index, start in enumerate(starts):
        if progress_cb and index % report_every == 0:
            progress_cb(index / len(starts))
        frame = audio[start : start + frame_size]
        if len(frame) < frame_size:
            frame = np.pad(frame, (0, frame_size - len(frame)), mode="constant")
        frames.append(frame)
        windowed = window(frame)
        spec = spectrum(windowed)
        _, mfcc_coeffs = mfcc(spec)
        freqs, mags = spectral_peaks(spec)
        hpcp_vec = hpcp(freqs, mags)
        rms_val = rms(frame)
        rms_db_val = 20.0 * np.log10(rms_val + 1e-9)
        mfccs.append(mfcc_coeffs)
        hpcps.append(hpcp_vec)
        rms_db.append(rms_db_val)

    mfccs = np.asarray(mfccs)
    hpcps = np.asarray(hpcps)
    rms_db = np.asarray(rms_db)
    frame_times = np.arange(len(mfccs)) * (hop_size / sample_rate)

    return {
        "frame_times": frame_times,
        "mfcc": mfccs,
        "hpcp": hpcps,
        "rms_db": rms_db,
    }
