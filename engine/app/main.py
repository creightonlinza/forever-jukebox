"""CLI entry point."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Analyze audio into a Spotify-style JSON structure.")
    parser.add_argument("input", help="Path to input audio (wav/mp3/m4a).")
    parser.add_argument("-o", "--output", help="Path to output JSON file.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    from .analysis import analyze_audio

    def progress_printer(percent: int, stage: str) -> None:
        print(f"PROGRESS:{percent}:{stage}", flush=True)

    progress_cb = progress_printer if os.environ.get("ENGINE_PROGRESS") == "true" else None
    analysis_progress = progress_cb

    data = analyze_audio(args.input, progress_cb=analysis_progress)
    output_path = Path(args.output) if args.output else None
    payload = json.dumps(data, sort_keys=True, indent=None, separators=(",", ":"))

    if output_path:
        output_path.write_text(payload, encoding="utf-8")
    else:
        print(payload)
    if progress_cb:
        progress_cb(100, "done")


if __name__ == "__main__":
    main()
