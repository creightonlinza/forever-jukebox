# Engine Test Utilities

## Compare analysis outputs

`compare.py` compares two analysis JSON outputs using the same graph/branching
metrics as the app. It can also run the engine to generate the comparison file.

Run with engine generation:

```bash
python engine/test/compare.py \
  --benchmark /path/to/benchmark.json \
  --audio /path/to/track.m4a \
  --dump
```

Run with two analysis JSON files:

```bash
python engine/test/compare.py \
  --benchmark /path/to/benchmark.json \
  --compare /path/to/analysis.json \
  --dump
```

Notes:
- `--benchmark` is required.
- Pass exactly one of `--audio` or `--compare`.
- Output always prints similarity; `--dump` prints component scores.

## Batch analysis from id list

`batch_analyze.py` runs the analysis engine for a list of ids. Each id is matched
to the first file in the audio folder named `{id}.*`, and output is written to
`{id}.json`.

```bash
python engine/test/batch_analyze.py \
  --audio-dir /path/to/audio \
  --output-dir /path/to/output \
  --id-list /path/to/ids.txt \
  --workers 2
```
