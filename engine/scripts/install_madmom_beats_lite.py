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

DIST_NAME = "madmom-beats-lite"
CHUNK_SIZE = 1024 * 1024

# Pinned to a fixed release instead of querying the GitHub API for the latest
# one: the anonymous API rate limit (60 req/hour per IP) regularly breaks
# builds on shared CI/builder IPs, and the repo is not expected to change.
# To upgrade, update the tag and asset digests below from
# https://github.com/creightonlinza/madmom-beats-lite/releases
_RELEASE_TAG = "v1.0.3"
_DOWNLOAD_BASE = f"https://github.com/creightonlinza/madmom-beats-lite/releases/download/{_RELEASE_TAG}"
_ASSET_DIGESTS = {
    "madmom_beats_lite-1.0.3-cp310-cp310-macosx_10_9_universal2.whl": "sha256:954393335a7d931c53da8bedb4095aa358352564c9baa2ecda5efc216c8028d7",
    "madmom_beats_lite-1.0.3-cp310-cp310-manylinux_2_17_x86_64.manylinux2014_x86_64.whl": "sha256:69a40994416d45269dbfa9eb583243cd8b3748248f344eb98a697d81d5053f7c",
    "madmom_beats_lite-1.0.3-cp310-cp310-win_amd64.whl": "sha256:478a65a9d3da40196ee686daf5fee16419a08e635f70a79b5669b615a82ce9c9",
    "madmom_beats_lite-1.0.3-cp311-cp311-macosx_10_9_universal2.whl": "sha256:4057462ed3fcb84faad2b5c0442bbd214e2b2e84e35273515ceb8c65726dd249",
    "madmom_beats_lite-1.0.3-cp311-cp311-manylinux_2_17_x86_64.manylinux2014_x86_64.whl": "sha256:10223231614a01250c31e00bc776fc0b87229a457a7d5cab7761fed421536c06",
    "madmom_beats_lite-1.0.3-cp311-cp311-win_amd64.whl": "sha256:d708bc2974dbfa0790b5bbb290965fdd54746b08d99b34d7b9ab364c200c3354",
}
PINNED_RELEASE = {
    "tag_name": _RELEASE_TAG,
    "assets": [
        {
            "name": name,
            "browser_download_url": f"{_DOWNLOAD_BASE}/{name}",
            "digest": digest,
        }
        for name, digest in _ASSET_DIGESTS.items()
    ],
}


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


def _download_wheel(
    url: str,
    destination: Path,
) -> None:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "forever-jukebox-madmom-beats-lite-updater"},
    )
    with urllib.request.urlopen(request, timeout=60) as response, destination.open("wb") as handle:
        while True:
            chunk = response.read(CHUNK_SIZE)
            if not chunk:
                break
            handle.write(chunk)


def _verify_sha256(path: Path, expected_hex: str) -> None:
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


def run_install(python_executable: str, download_dir: Path) -> InstallOutcome:
    release_tag: str | None = None
    asset_name: str | None = None
    try:
        release = PINNED_RELEASE
        release_tag = str(release.get("tag_name") or "")
        assets = release.get("assets") or []
        if not isinstance(assets, list):
            raise RuntimeError("InvalidReleaseAssets")
        wheel_assets = [asset for asset in assets if str(asset.get("name", "")).endswith(".whl")]
        if not wheel_assets:
            raise RuntimeError("NoWheelAssets")

        chosen = pick_best_wheel(wheel_assets)
        asset_name = str(chosen.get("name") or "")
        download_url = str(chosen.get("browser_download_url") or "")
        if not download_url:
            raise RuntimeError("MissingBrowserDownloadURL")

        release_version = _release_version_from_tag(release_tag)
        installed_before = _installed_version()
        if (
            release_version
            and installed_before == release_version
            and _is_package_importable()
        ):
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
        _download_wheel(download_url, wheel_path)

        digest = str(chosen.get("digest") or "")
        if digest.startswith("sha256:"):
            _verify_sha256(wheel_path, digest.split(":", 1)[1])

        _pip_install(python_executable, wheel_path)
        version = _installed_version()
        return InstallOutcome(
            ok=True,
            release_tag=release_tag,
            asset_name=asset_name,
            install_status="installed",
            installed_version=version,
            error=None,
        )
    except Exception as exc:
        return InstallOutcome(
            ok=False,
            release_tag=release_tag,
            asset_name=asset_name,
            install_status="failed",
            installed_version=_installed_version(),
            error={"type": exc.__class__.__name__, "message": str(exc)},
        )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Install the pinned madmom-beats-lite wheel from GitHub releases.")
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
    outcome = run_install(
        python_executable=str(args.python),
        download_dir=Path(args.download_dir),
    )
    print(json.dumps(outcome.to_dict(), separators=(",", ":")), flush=True)
    return 0 if outcome.ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
