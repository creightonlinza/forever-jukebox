import argparse
import json
import os
import sys
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

ENGINE_ROOT = Path(__file__).resolve().parents[1]
if str(ENGINE_ROOT) not in sys.path:
    sys.path.insert(0, str(ENGINE_ROOT))

from app.analysis import analyze_audio  # noqa: E402


def load_ids(path: Path) -> list[str]:
    ids = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            value = line.strip()
            if value:
                ids.append(value)
    return ids


def _set_batch_env() -> None:
    os.environ.setdefault("OMP_NUM_THREADS", "1")
    os.environ.setdefault("MKL_NUM_THREADS", "1")
    os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")
    os.environ.setdefault("NUMEXPR_NUM_THREADS", "1")


def pick_audio(audio_dir: Path, track_id: str) -> Path | None:
    matches = sorted(audio_dir.glob(f"{track_id}.*"))
    if not matches:
        return None
    if len(matches) > 1:
        print(
            f"Multiple audio matches for {track_id}; using {matches[0].name}.",
            file=sys.stderr,
            flush=True,
        )
    return matches[0]


def analyze_to_file(
    task: tuple[str, str, str],
    batch: bool,
) -> str:
    track_id, audio_path, output_path = task
    if batch:
        _set_batch_env()
    data = analyze_audio(audio_path)
    with open(output_path, "w", encoding="utf-8") as handle:
        json.dump(data, handle, sort_keys=True, separators=(",", ":"))
    return track_id


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Batch analyze audio from a list of ids.",
    )
    parser.add_argument("--audio-dir", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--id-list", required=True)
    parser.add_argument("--batch", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--workers", type=int, default=2)
    args = parser.parse_args()

    audio_dir = Path(args.audio_dir)
    output_dir = Path(args.output_dir)
    id_list = Path(args.id_list)

    if not audio_dir.is_dir():
        raise RuntimeError(f"Audio dir not found: {audio_dir}")
    if not id_list.is_file():
        raise RuntimeError(f"ID list not found: {id_list}")

    output_dir.mkdir(parents=True, exist_ok=True)
    ids = load_ids(id_list)
    if not ids:
        raise RuntimeError("No ids found in list.")

    missing = []
    tasks = []
    for track_id in ids:
        audio_path = pick_audio(audio_dir, track_id)
        if not audio_path:
            missing.append(track_id)
            continue
        output_path = output_dir / f"{track_id}.json"
        tasks.append((track_id, str(audio_path), str(output_path)))

    if missing:
        print(f"Missing audio for {len(missing)} ids.", file=sys.stderr, flush=True)
    if not tasks:
        raise RuntimeError("No matching audio files found.")

    total = len(tasks)
    processed = 0
    with ProcessPoolExecutor(max_workers=max(args.workers, 1)) as executor:
        futures = [
            executor.submit(analyze_to_file, task, args.batch)
            for task in tasks
        ]
        for future in as_completed(futures):
            track_id = future.result()
            processed += 1
            print(f"[{processed}/{total}] Completed {track_id}.", flush=True)

    print(f"Completed {processed} analyses.", flush=True)


if __name__ == "__main__":
    main()
