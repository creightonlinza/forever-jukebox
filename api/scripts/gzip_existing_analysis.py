#!/usr/bin/env python3
"""One-time conversion of stored analysis files from .json to .json.gz.

Idempotent and safe to re-run: files that already have a .json.gz sibling are
skipped, each conversion is verified by a decompress round-trip before the
plain file is removed, and unreadable/invalid files are left untouched and
reported.

Usage:
    python api/scripts/gzip_existing_analysis.py [storage_root]

Defaults to the storage root next to this script (api/storage).
"""

from __future__ import annotations

import gzip
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_STORAGE_ROOT = APP_ROOT / "storage"


@dataclass
class ConversionSummary:
    converted: int = 0
    skipped: int = 0
    bytes_before: int = 0
    bytes_after: int = 0
    errors: list[str] = field(default_factory=list)


def convert_file(plain_path: Path) -> tuple[bool, str | None]:
    """Convert one .json file to .json.gz. Returns (converted, error)."""
    gz_path = plain_path.with_name(plain_path.name + ".gz")
    if gz_path.exists():
        return False, None
    original = plain_path.read_bytes()
    try:
        json.loads(original)
    except ValueError:
        return False, f"{plain_path.name}: not valid JSON, left untouched"
    tmp_path = gz_path.with_name(gz_path.name + ".tmp")
    with gzip.open(tmp_path, "wb") as handle:
        handle.write(original)
    if gzip.decompress(tmp_path.read_bytes()) != original:
        tmp_path.unlink()
        return False, f"{plain_path.name}: round-trip verification failed"
    tmp_path.replace(gz_path)
    plain_path.unlink()
    return True, None


def convert_directory(analysis_dir: Path) -> ConversionSummary:
    summary = ConversionSummary()
    for plain_path in sorted(analysis_dir.glob("*.json")):
        size_before = plain_path.stat().st_size
        converted, error = convert_file(plain_path)
        if error:
            summary.errors.append(error)
        elif converted:
            gz_path = plain_path.with_name(plain_path.name + ".gz")
            summary.converted += 1
            summary.bytes_before += size_before
            summary.bytes_after += gz_path.stat().st_size
        else:
            summary.skipped += 1
    return summary


def main(argv: list[str]) -> int:
    storage_root = Path(argv[1]) if len(argv) > 1 else DEFAULT_STORAGE_ROOT
    analysis_dir = storage_root / "analysis"
    if not analysis_dir.is_dir():
        print(f"No analysis directory at {analysis_dir}")
        return 1
    summary = convert_directory(analysis_dir)
    print(
        f"Converted {summary.converted} file(s): "
        f"{summary.bytes_before:,} -> {summary.bytes_after:,} bytes"
    )
    if summary.skipped:
        print(f"Skipped {summary.skipped} file(s) already converted")
    for error in summary.errors:
        print(f"WARNING: {error}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
