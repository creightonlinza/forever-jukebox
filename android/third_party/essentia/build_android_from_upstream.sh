#!/usr/bin/env bash
set -euo pipefail

# Reproducible helper for building Essentia Android shared libraries from upstream.
# This script does not vendor Essentia; it orchestrates a local build and copies outputs.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK_DIR="${ROOT_DIR}/third_party/essentia/.work"
OUT_DIR="${ROOT_DIR}/third_party/essentia/android"
ESSENTIA_REPO="${WORK_DIR}/essentia"

mkdir -p "${WORK_DIR}" "${OUT_DIR}"

if ! command -v pkg-config >/dev/null 2>&1; then
  echo "pkg-config is required to build Essentia from upstream." >&2
  exit 1
fi

if ! pkg-config --exists eigen3; then
  echo "eigen3 development headers are required (pkg-config name: eigen3)." >&2
  echo "Install eigen3, then rerun this script." >&2
  exit 1
fi

if [[ ! -d "${ESSENTIA_REPO}" ]]; then
  git clone https://github.com/MTG/essentia.git "${ESSENTIA_REPO}"
fi

cd "${ESSENTIA_REPO}"

if [[ -n "${ESSENTIA_REF:-}" ]]; then
  git fetch --tags
  git checkout "${ESSENTIA_REF}"
fi

echo "Running upstream Android build..."
if [[ -x "./packaging/android/build_android.sh" ]]; then
  ./packaging/android/build_android.sh
elif [[ -x "./build_android.sh" ]]; then
  ./build_android.sh
else
  echo "Unable to find an upstream Android build script in ${ESSENTIA_REPO}" >&2
  exit 1
fi

echo "Copying outputs into ${OUT_DIR}"
missing_abis=()
for abi in arm64-v8a armeabi-v7a x86_64; do
  mkdir -p "${OUT_DIR}/${abi}"
  so_path="$(find . -type f -name "libessentia.so" -path "*${abi}*" -print -quit || true)"
  if [[ -z "${so_path}" ]]; then
    missing_abis+=("${abi}")
    continue
  fi
  cp "${so_path}" "${OUT_DIR}/${abi}/libessentia.so"
done

if [[ "${#missing_abis[@]}" -gt 0 ]]; then
  echo "Missing libessentia.so for ABI(s): ${missing_abis[*]}" >&2
  echo "Upstream build finished without producing expected Android artifacts." >&2
  exit 1
fi

mkdir -p "${OUT_DIR}/include"
rm -rf "${OUT_DIR}/include/essentia"
if [[ ! -d "${ESSENTIA_REPO}/src/essentia" ]]; then
  echo "Missing Essentia headers at ${ESSENTIA_REPO}/src/essentia" >&2
  exit 1
fi
cp -R "${ESSENTIA_REPO}/src/essentia" "${OUT_DIR}/include/"

echo "Done. Verify files exist:"
for abi in arm64-v8a armeabi-v7a x86_64; do
  ls -l "${OUT_DIR}/${abi}/libessentia.so" || true
done
ls -ld "${OUT_DIR}/include/essentia" || true
