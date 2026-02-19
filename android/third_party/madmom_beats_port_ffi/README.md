# madmom_beats_port_ffi Android Integration

This app integrates the madmom beats/downbeats Rust FFI artifacts from:

- Source: `https://github.com/creightonlinza/madmom-beats-port/tree/main/rust/madmom_beats_port_ffi`
- Release: `https://github.com/creightonlinza/madmom-beats-port/releases/tag/v4.1.0`
- Android ZIP artifact: `https://github.com/creightonlinza/madmom-beats-port/releases/download/v4.1.0/madmom-beats-port-v4.1.0-android.zip`

## Expected Native Library Layout

ABI `.so` files are fetched from the release ZIP at build time and staged to:

- `android/app/build/generated/madmom_beats_port_ffi/jniLibs/arm64-v8a/libmadmom_beats_port_ffi.so`
- `android/app/build/generated/madmom_beats_port_ffi/jniLibs/armeabi-v7a/libmadmom_beats_port_ffi.so`
- `android/app/build/generated/madmom_beats_port_ffi/jniLibs/x86_64/libmadmom_beats_port_ffi.so`

The Gradle task `prepareMadmomBeatsPortFfiJniLibs` is wired into `preBuild`.

Optional overrides:

- `-PmadmomBeatsPortFfiZipUrl=<custom release zip url>`
- `-PmadmomBeatsPortFfiZipPath=/absolute/path/to/madmom-beats-port-v4.1.0-android.zip`

Header for reference:

- `android/third_party/madmom_beats_port_ffi/include/madmom_beats_port.h`

## Model Files

Bundle model files in assets under:

- `android/app/src/main/assets/madmom_beats_port_models/downbeats_blstm.json`
- `android/app/src/main/assets/madmom_beats_port_models/downbeats_blstm_weights.npz`

At runtime, `MadmomBeatsPortModelExtractor` copies these assets to:

- `<filesDir>/madmom_beats_port_models/`

so native code can open model files by filesystem path.

## Notes

- APK ABI splits are enabled for `arm64-v8a`, `armeabi-v7a`, and `x86_64`.
- Keep fetched `madmom_beats_port_ffi` binaries aligned with the same ABIs.
