# The Forever Jukebox Audio Analysis Engine

This package generates analysis JSON compatible with `schema.json` and the Forever Jukebox branch logic. It is the analysis engine consumed by the API worker.

## Setup

This engine stack currently targets Python 3.11.

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

If Essentia fails to build locally, install it system-wide and use `--system-site-packages` for the venv:

```bash
python3 -m venv .venv --system-site-packages
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

On macOS you can also install Essentia via Homebrew (`brew install essentia`).

## CLI Usage

```bash
python -m app.main /path/to/audio.m4a -o /path/to/output.json
```

Optional calibration usage:

```bash
python -m app.main /path/to/audio.m4a -o /path/to/output.json --calibration /path/to/calibration.json
```

## Notes

- `ffmpeg` must be installed and available in `PATH` for audio decoding.
- `--calibration` is optional and not used in the default flow.
- Beat/downbeat extraction is provided by `madmom-beats-lite` (installed from GitHub release wheels).
