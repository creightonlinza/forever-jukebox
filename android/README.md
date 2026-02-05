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

## Debug APK build

```bash
./gradlew assembleDebug
```

## Notes

- The native engine/visualization port mirrors the web logic in `web/src/engine` and `web/src/visualization`.
- The header font is bundled locally in `android/app/src/main/res/font/tilt_neon_regular.ttf`.
- Audio/analysis results are cached in the app `cacheDir`; the OS may evict cached
  data under storage pressure.
