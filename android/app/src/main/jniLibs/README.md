# Native Libraries

This folder is intentionally source-controlled without ABI `.so` binaries.

`libmadmom_beats_port_ffi.so` is staged at build time by `prepareMadmomBeatsPortFfiJniLibs` into:

- `app/build/generated/madmom_beats_port_ffi/jniLibs/<abi>/libmadmom_beats_port_ffi.so`

That generated directory is added to `jniLibs.srcDirs` in `app/build.gradle.kts`.
