# SpeexDSP Resampler Integration

This app uses SpeexDSP's resampler implementation for Local mode sample-rate conversion in Android native code.

## Source

- Upstream: `https://github.com/xiph/speexdsp`
- Version: `SpeexDSP-1.2.1`
- Included files (minimal subset):
  - `android/third_party/speexdsp/libspeexdsp/resample.c`
  - `android/third_party/speexdsp/libspeexdsp/arch.h`
  - `android/third_party/speexdsp/include/speex_resampler.h`

## Build wiring

- `android/app/src/main/cpp/CMakeLists.txt` builds the vendored `resample.c` as a static library.
- `local_analysis_jni` links that static library and calls SpeexDSP resampling APIs.

## License

- SpeexDSP resampler is BSD-style licensed.
- License text is included at `android/third_party/speexdsp/LICENSES/SPEEXDSP-BSD.txt`.
