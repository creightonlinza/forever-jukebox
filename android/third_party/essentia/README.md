# Essentia Android Integration

This app uses Essentia for Local mode feature extraction (MFCC/HPCP/RMS) by linking a static Essentia library into the existing JNI shared library (`local_analysis_jni`).

## Runtime Approach (No FFmpeg)

- Android audio decode is handled by `MediaExtractor` + `MediaCodec` in Kotlin.
- Essentia is only used on in-memory float mono buffers.
- We do **not** use Essentia audio loader APIs.

## Prebuilt Source Selection

Prebuilt candidates evaluated:

1. `deeeed/rn-essentia-static` (selected)
2. `Tribler/superapp-essentia` (not selected)

Why #2 is not selected:

- Its `libessentia.a` exposes FFmpeg symbol references (`avcodec_*`, `avformat_*`, etc.).

## Active Library Layout

Active artifacts are expected at:

- `android/third_party/essentia/prebuilt/active/<abi>/libessentia.a`
- `android/third_party/essentia/prebuilt/active/include/...`
- `android/third_party/essentia/prebuilt/active/SOURCE.txt`

ABIs:

- `arm64-v8a`
- `armeabi-v7a`
- `x86_64`

## Build Integration

CMake (`android/app/src/main/cpp/CMakeLists.txt`) links static Essentia into `local_analysis_jni`:

- Preferred static path: `android/third_party/essentia/prebuilt/active/<abi>/libessentia.a`
- Fallback static path: `android/third_party/essentia/built/<abi>/libessentia.a`

If no Essentia static artifact exists for the ABI, Essentia JNI methods return a clear runtime error.

## Maintenance Notes

- This repo is pinned to the current Essentia integration layout and does not require regular version churn.
- If artifacts are ever refreshed, keep ABI coverage (`arm64-v8a`, `armeabi-v7a`, `x86_64`) and preserve no-FFmpeg linkage expectations.

## Fallback for non-PIC static builds

If linking static Essentia into `local_analysis_jni.so` fails with relocation/PIC errors:

1. Rebuild Essentia with PIC enabled for Android.
2. Ensure `android/third_party/essentia/built/<abi>/libessentia.a` exists.
3. Rebuild Android native targets.

## Licensing

- Essentia is AGPLv3.
- License text is in `android/third_party/essentia/LICENSES/ESSENTIA-AGPLv3.txt`.
