# Forever Jukebox Android

Native Android port (Jetpack Compose) for 1:1 feature parity against the web UI.

## Features

- Native engine + visualization (ported from the TypeScript web engine).
- Spotify search, YouTube match selection, analysis polling, and playback.
- Visualization layouts, edge selection, fullscreen, and tuning controls.
- Theme toggle (system/light/dark).
- Deep links: `https://foreverjukebox.com/listen/{youtubeId}`.
- API base URL configuration stored in DataStore.
- PCM AudioTrack playback for beat-accurate jumping.

## Running

1. Open `android/` in Android Studio.
2. Ensure the API and worker are running.
3. Set the API base URL in the app when prompted (e.g. `http://10.0.2.2:8000` for the emulator).

## Local Mode Native Dependency (Essentia)

Local mode feature extraction requires Essentia native artifacts. If you see an
error about Essentia not being linked into `local_analysis_jni`, fetch prebuilt
Android artifacts:

```bash
cd android
./third_party/essentia/fetch_prebuilt_from_rn_essentia_static.sh
```

This populates:

- `third_party/essentia/prebuilt/active/<abi>/libessentia.a`
- `third_party/essentia/prebuilt/active/include/essentia/...`

The release workflow (`.github/workflows/android-release.yml`) runs this
prebuilt fetch script automatically, so you do not need to commit Essentia
artifacts.

Optional advanced path: build Essentia from upstream source using
`./third_party/essentia/build_android_from_upstream.sh` (requires
`pkg-config` + `eigen3` development headers).

## Debug APK build

```bash
./gradlew assembleDebug
```

## Create a release keystore (one-time)

Keep this file safe and backed up. You must reuse the same keystore for all
future updates of the same Android app signing identity.

```bash
cd android
keytool -genkeypair -v \
  -keystore release.keystore \
  -alias release \
  -keyalg RSA \
  -keysize 4096 \
  -validity 10000
```

## Local release build

1. Copy `keystore.properties.example` to `keystore.properties`.
2. Set the values to match your keystore password + alias.
3. Build release artifacts:

```bash
cd android
./gradlew :app:assembleRelease :app:bundleRelease
```

Outputs:

- APK: `app/build/outputs/apk/release/app-release.apk`
- App Bundle: `app/build/outputs/bundle/release/*.aab`

## GitHub Actions release build

Workflow: `.github/workflows/android-release.yml`

Add these repository secrets:

- `KEY_BASE64`
- `KEYSTORE_PASS`

`KEYSTORE_PASS` is used as both keystore password and key password.
The workflow hardcodes key alias `release`.

Generate `KEY_BASE64` from your local keystore:

```bash
base64 < android/release.keystore | tr -d '\n'
```

Then run the `Build Release APK` workflow from GitHub Actions and provide a
release tag (for example `v2026.02.01`). The workflow creates signing files at
runtime and Gradle signs the release APK directly.

The same tag value is passed into Gradle as `APP_VERSION_TAG`, which becomes
the app `versionName` (for example, `v2026.02.01`).

## Notes

- The native engine/visualization port mirrors the web logic in `web/src/engine` and `web/src/visualization`.
- The header font is bundled locally in `android/app/src/main/res/font/tilt_neon_regular.ttf`.
- Audio/analysis results are cached in the app `cacheDir`; the OS may evict cached
  data under storage pressure.
