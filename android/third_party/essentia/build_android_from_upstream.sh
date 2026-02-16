#!/usr/bin/env bash
set -euo pipefail

# Reproducible helper for building Essentia Android shared libraries from upstream.
# This script does not vendor Essentia; it orchestrates a local build and copies outputs.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK_DIR="${ROOT_DIR}/third_party/essentia/.work"
OUT_DIR="${ROOT_DIR}/third_party/essentia/android"
ESSENTIA_REPO="${WORK_DIR}/essentia"

mkdir -p "${WORK_DIR}" "${OUT_DIR}"

if [[ ! -d "${ESSENTIA_REPO}" ]]; then
  git clone https://github.com/MTG/essentia.git "${ESSENTIA_REPO}"
fi

cd "${ESSENTIA_REPO}"

if [[ -n "${ESSENTIA_REF:-}" ]]; then
  git fetch --tags
  git checkout "${ESSENTIA_REF}"
fi

echo "Running upstream Android build..."
./packaging/android/build_android.sh

echo "Copying outputs into ${OUT_DIR}"
for abi in arm64-v8a armeabi-v7a x86_64; do
  mkdir -p "${OUT_DIR}/${abi}"
  find . -type f -name "libessentia.so" -path "*${abi}*" -print -quit | while read -r so; do
    cp "${so}" "${OUT_DIR}/${abi}/libessentia.so"
  done
done

echo "Done. Verify files exist:"
for abi in arm64-v8a armeabi-v7a x86_64; do
  ls -l "${OUT_DIR}/${abi}/libessentia.so" || true
done
