#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
import tempfile
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from packaging.tags import sys_tags
from packaging.utils import InvalidWheelFilename, parse_wheel_filename

LATEST_RELEASE_URL = "https://api.github.com/repos/creightonlinza/madmom-beats-lite/releases/latest"
DIST_NAME = "madmom-beats-lite"
CHUNK_SIZE = 1024 * 1024


@dataclass
class InstallOutcome:
    ok: bool
    release_tag: str | None
    asset_name: str | None
    install_status: str
    installed_version: str | None
    error: dict[str, Any] | None

    def to_dict(self) -> dict[str, Any]:
        return {
            "ok": self.ok,
            "release_tag": self.release_tag,
            "asset_name": self.asset_name,
            "install_status": self.install_status,
            "installed_version": self.installed_version,
            "error": self.error,
        }


class ProgressEmitter:
    def __init__(self) -> None:
        self._last_percent = -1

    def emit(self, percent: int, stage: str, message: str) -> None:
        clamped = max(0, min(100, int(percent)))
        if clamped < self._last_percent:
            clamped = self._last_percent
        self._last_percent = clamped
        return


def pick_best_wheel(assets: list[dict[str, Any]]) -> dict[str, Any]:
    rank = {tag: i for i, tag in enumerate(sys_tags())}
    best: dict[str, Any] | None = None
    best_rank = 10**9

    for asset in assets:
        name = str(asset.get("name", ""))
        if not name.endswith(".whl"):
            continue
        try:
            _, _, _, wheel_tags = parse_wheel_filename(name)
        except InvalidWheelFilename:
            continue
        compatible = [rank[t] for t in wheel_tags if t in rank]
        if not compatible:
            continue
        candidate_rank = min(compatible)
        if candidate_rank < best_rank:
            best_rank = candidate_rank
            best = asset

    if best is None:
        raise RuntimeError("NoCompatibleWheel")
    return best


def _fetch_latest_release() -> dict[str, Any]:
    request = urllib.request.Request(
        LATEST_RELEASE_URL,
        headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": "forever-jukebox-madmom-beats-lite-updater",
        },
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def _download_wheel(
    url: str,
    destination: Path,
    total_size: int | None,
    progress: ProgressEmitter,
) -> None:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "forever-jukebox-madmom-beats-lite-updater"},
    )
    downloaded = 0
    with urllib.request.urlopen(request, timeout=60) as response, destination.open("wb") as handle:
        while True:
            chunk = response.read(CHUNK_SIZE)
            if not chunk:
                break
            handle.write(chunk)
            downloaded += len(chunk)

            if total_size and total_size > 0:
                ratio = downloaded / float(total_size)
                ratio = min(max(ratio, 0.0), 1.0)
                stage_percent = 20 + int(ratio * 50)
                message_percent = int(ratio * 100)
                progress.emit(stage_percent, "download", f"downloading wheel ({message_percent}%)")
            else:
                progress.emit(45, "download", f"downloading wheel ({downloaded} bytes)")

    progress.emit(70, "download", "wheel download complete")


def _verify_sha256(path: Path, expected_hex: str, progress: ProgressEmitter) -> None:
    hasher = hashlib.sha256()
    with path.open("rb") as handle:
        while True:
            chunk = handle.read(CHUNK_SIZE)
            if not chunk:
                break
            hasher.update(chunk)
    actual = hasher.hexdigest()
    if actual.lower() != expected_hex.lower():
        raise RuntimeError(f"ChecksumMismatch expected={expected_hex} actual={actual}")
    progress.emit(75, "verify", "sha256 verified")


def _installed_version() -> str | None:
    try:
        from importlib import metadata

        return metadata.version(DIST_NAME)
    except Exception:
        return None


def _release_version_from_tag(tag: str | None) -> str | None:
    if not tag:
        return None
    normalized = str(tag).strip()
    if normalized.startswith(("v", "V")):
        normalized = normalized[1:]
    return normalized or None


def _is_package_importable() -> bool:
    try:
        import madmom_beats_lite  # noqa: F401
    except Exception:
        return False
    return True


def _pip_install(python_executable: str, wheel_path: Path) -> None:
    subprocess.run(
        [
            python_executable,
            "-m",
            "pip",
            "install",
            "--upgrade",
            str(wheel_path),
        ],
        check=True,
    )


def run_install(python_executable: str, download_dir: Path, progress: ProgressEmitter) -> InstallOutcome:
    release_tag: str | None = None
    asset_name: str | None = None
    try:
        release = _fetch_latest_release()
        release_tag = str(release.get("tag_name") or "")
        assets = release.get("assets") or []
        if not isinstance(assets, list):
            raise RuntimeError("InvalidReleaseAssets")
        progress.emit(5, "release", "fetched latest release metadata")
        wheel_assets = [asset for asset in assets if str(asset.get("name", "")).endswith(".whl")]
        if not wheel_assets:
            raise RuntimeError("NoWheelAssets")

        chosen = pick_best_wheel(wheel_assets)
        asset_name = str(chosen.get("name") or "")
        download_url = str(chosen.get("browser_download_url") or "")
        if not download_url:
            raise RuntimeError("MissingBrowserDownloadURL")
        progress.emit(12, "release", f"selected wheel {asset_name}")

        release_version = _release_version_from_tag(release_tag)
        installed_before = _installed_version()
        if (
            release_version
            and installed_before == release_version
            and _is_package_importable()
        ):
            progress.emit(100, "done", "already up to date")
            return InstallOutcome(
                ok=True,
                release_tag=release_tag,
                asset_name=asset_name,
                install_status="up-to-date",
                installed_version=installed_before,
                error=None,
            )

        download_dir.mkdir(parents=True, exist_ok=True)
        wheel_path = download_dir / asset_name
        total_size = chosen.get("size")
        total_size = int(total_size) if isinstance(total_size, int) else None
        _download_wheel(download_url, wheel_path, total_size, progress)

        digest = str(chosen.get("digest") or "")
        if digest.startswith("sha256:"):
            _verify_sha256(wheel_path, digest.split(":", 1)[1], progress)
        else:
            progress.emit(75, "verify", "sha256 digest missing; skipped verification")

        progress.emit(95, "install", "pip install running")
        _pip_install(python_executable, wheel_path)
        version = _installed_version()
        progress.emit(100, "done", "installation complete")
        return InstallOutcome(
            ok=True,
            release_tag=release_tag,
            asset_name=asset_name,
            install_status="installed",
            installed_version=version,
            error=None,
        )
    except Exception as exc:
        progress.emit(100, "done", "installation failed")
        return InstallOutcome(
            ok=False,
            release_tag=release_tag,
            asset_name=asset_name,
            install_status="failed",
            installed_version=_installed_version(),
            error={"type": exc.__class__.__name__, "message": str(exc)},
        )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Install latest compatible madmom-beats-lite wheel from GitHub releases.")
    parser.add_argument(
        "--python",
        default=sys.executable,
        help="Python executable used for pip install (default: current interpreter).",
    )
    parser.add_argument(
        "--download-dir",
        default=str(Path(tempfile.gettempdir()) / "madmom-beats-lite"),
        help="Directory where the selected wheel is downloaded before install.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    progress = ProgressEmitter()
    outcome = run_install(
        python_executable=str(args.python),
        download_dir=Path(args.download_dir),
        progress=progress,
    )
    print(json.dumps(outcome.to_dict(), separators=(",", ":")), flush=True)
    return 0 if outcome.ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
