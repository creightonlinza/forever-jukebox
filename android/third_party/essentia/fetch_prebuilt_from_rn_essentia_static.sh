#!/usr/bin/env bash
set -euo pipefail

# Fetches Android Essentia static libraries + headers from rn-essentia-static
# into the repo's expected prebuilt layout.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT_DIR="${ROOT_DIR}/third_party/essentia/prebuilt/active"
WORK_DIR="${ROOT_DIR}/third_party/essentia/.work/rn-essentia-static"
REPO_URL="${ESSENTIA_PREBUILT_REPO:-https://github.com/deeeed/rn-essentia-static.git}"
PINNED_REF="476d5cfa763ad8950bf91f876788e7d6739fdecc"
REPO_REF="${ESSENTIA_PREBUILT_REF:-${PINNED_REF}}"
ABIS=(arm64-v8a armeabi-v7a x86 x86_64)

if ! command -v git >/dev/null 2>&1; then
  echo "git is required." >&2
  exit 1
fi

echo "Fetching Essentia prebuilt repository..."
rm -rf "${WORK_DIR}"
mkdir -p "$(dirname "${WORK_DIR}")"
git -c init.defaultBranch=main init "${WORK_DIR}" >/dev/null
git -C "${WORK_DIR}" remote add origin "${REPO_URL}"
git -C "${WORK_DIR}" fetch --depth 1 origin "${REPO_REF}"
git -C "${WORK_DIR}" checkout --detach FETCH_HEAD >/dev/null

echo "Staging Essentia prebuilt artifacts into ${OUT_DIR}..."
rm -rf "${OUT_DIR}"
mkdir -p "${OUT_DIR}"

for abi in "${ABIS[@]}"; do
  src_lib="${WORK_DIR}/android/jniLibs/${abi}/libessentia.a"
  dst_dir="${OUT_DIR}/${abi}"
  if [[ ! -f "${src_lib}" ]]; then
    echo "Missing prebuilt Essentia library for ABI ${abi}: ${src_lib}" >&2
    exit 1
  fi
  mkdir -p "${dst_dir}"
  cp "${src_lib}" "${dst_dir}/libessentia.a"
done

src_include="${WORK_DIR}/cpp/include/essentia"
dst_include_root="${OUT_DIR}/include"
if [[ ! -d "${src_include}" ]]; then
  echo "Missing Essentia headers: ${src_include}" >&2
  exit 1
fi
mkdir -p "${dst_include_root}"
cp -R "${src_include}" "${dst_include_root}/"

source_file="${OUT_DIR}/SOURCE.txt"
{
  echo "repo=${REPO_URL}"
  echo "ref=${REPO_REF}"
  echo "commit=$(git -C "${WORK_DIR}" rev-parse HEAD)"
  echo "fetched_at_utc=$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
} > "${source_file}"

echo "Done. Staged ABIs:"
for abi in "${ABIS[@]}"; do
  ls -l "${OUT_DIR}/${abi}/libessentia.a"
done
ls -ld "${OUT_DIR}/include/essentia"
echo "Source metadata: ${source_file}"
