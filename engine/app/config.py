from dataclasses import dataclass, field


@dataclass
class SegmentationConfig:
    min_segment_duration: float = 0.25
    novelty_smoothing: int = 8
    peak_threshold: float = 0.3
    peak_prominence: float = 0.2
    max_segments_per_second: float = 2.5
    beat_snap_tolerance: float = 0.12


@dataclass
class FeatureConfig:
    sample_rate: int = 22050
    frame_size: int = 2048
    hop_size: int = 512


@dataclass
class AnalysisConfig:
    segmentation: SegmentationConfig = field(default_factory=SegmentationConfig)
    features: FeatureConfig = field(default_factory=FeatureConfig)
    tatums_per_beat: int = 2
    time_signature: int = 4
