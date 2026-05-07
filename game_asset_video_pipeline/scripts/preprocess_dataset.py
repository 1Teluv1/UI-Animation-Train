"""Dataset normalization & quality checks.

Reads dataset/metadata.jsonl, validates each video (existence, decode-ability,
resolution, fps, duration), computes a perceptual hash + motion score, drops
duplicates and overly-static clips, and writes:

- dataset/processed/train_metadata.jsonl
- dataset/processed/val_metadata.jsonl
- dataset/quality_report.jsonl
"""

from __future__ import annotations

import argparse
import json
import random
import shutil
import subprocess
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app.config import Settings, get_settings  # noqa: E402

try:
    import cv2  # type: ignore
except ImportError as exc:  # pragma: no cover
    raise SystemExit(
        "opencv-python is required: pip install opencv-python"
    ) from exc

import numpy as np

try:
    from tqdm import tqdm
except ImportError:  # pragma: no cover
    def tqdm(x, **_kwargs):  # type: ignore
        return x


# ---------------------------------------------------------------------------
# ffprobe
# ---------------------------------------------------------------------------

def _resolve_ffprobe(cfg: Settings) -> Optional[str]:
    found = shutil.which(cfg.ffprobe_bin)
    if found:
        return found
    # imageio-ffmpeg only ships ffmpeg, not ffprobe. We can fall back to ffmpeg
    # for duration probing if needed; for now return None and use OpenCV.
    return None


def _probe_with_ffprobe(path: Path, ffprobe_bin: str) -> Optional[Dict[str, Any]]:
    args = [
        ffprobe_bin, "-v", "error", "-print_format", "json",
        "-show_streams", "-show_format", str(path),
    ]
    try:
        proc = subprocess.run(args, capture_output=True, text=True, check=True)
    except (subprocess.CalledProcessError, FileNotFoundError):
        return None
    try:
        data = json.loads(proc.stdout)
    except json.JSONDecodeError:
        return None

    video_stream = next(
        (s for s in data.get("streams", []) if s.get("codec_type") == "video"),
        None,
    )
    if video_stream is None:
        return None

    # fps from r_frame_rate (e.g. "24/1")
    fps = None
    rfr = video_stream.get("r_frame_rate", "")
    if "/" in rfr:
        num, den = rfr.split("/", 1)
        try:
            num_i, den_i = int(num), int(den)
            if den_i:
                fps = num_i / den_i
        except ValueError:
            pass

    duration = None
    fmt = data.get("format") or {}
    if "duration" in fmt:
        try:
            duration = float(fmt["duration"])
        except (TypeError, ValueError):
            pass
    if duration is None and "duration" in video_stream:
        try:
            duration = float(video_stream["duration"])
        except (TypeError, ValueError):
            pass

    return {
        "width": int(video_stream.get("width", 0) or 0),
        "height": int(video_stream.get("height", 0) or 0),
        "fps": float(fps) if fps else None,
        "duration": duration,
        "nb_frames": int(video_stream.get("nb_frames") or 0) or None,
    }


def _probe_with_opencv(path: Path) -> Optional[Dict[str, Any]]:
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        return None
    try:
        w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
        n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        duration = (n / fps) if fps > 0 else None
        return {
            "width": w,
            "height": h,
            "fps": fps if fps > 0 else None,
            "duration": duration,
            "nb_frames": n if n > 0 else None,
        }
    finally:
        cap.release()


# ---------------------------------------------------------------------------
# Frame analysis (perceptual hash + motion score)
# ---------------------------------------------------------------------------

def _dhash_64(gray: np.ndarray) -> str:
    """Difference hash (64-bit) on a 9x8 thumbnail."""
    small = cv2.resize(gray, (9, 8), interpolation=cv2.INTER_AREA)
    diff = small[:, 1:] > small[:, :-1]
    bits = 0
    for v in diff.flatten():
        bits = (bits << 1) | int(bool(v))
    return f"{bits:016x}"


def _hamming_hex(a: str, b: str) -> int:
    return bin(int(a, 16) ^ int(b, 16)).count("1")


def _analyze_frames(
    path: Path,
    expected_frames: Optional[int],
) -> Optional[Dict[str, Any]]:
    """Compute mean motion score (consecutive frame abs-diff on luma) and a
    composite hash made from the first/middle/last frames.
    """

    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        return None
    try:
        diffs: List[float] = []
        frames_gray: List[np.ndarray] = []
        prev: Optional[np.ndarray] = None
        first_gray = mid_gray = last_gray = None

        ok, frame = cap.read()
        idx = 0
        while ok:
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            if prev is not None:
                diffs.append(float(np.mean(np.abs(gray.astype(np.int16) - prev.astype(np.int16)))))
            prev = gray
            if first_gray is None:
                first_gray = gray
            last_gray = gray
            idx += 1
            frames_gray.append(gray) if expected_frames and len(frames_gray) < 4 else None
            ok, frame = cap.read()

        if first_gray is None:
            return None
        # Re-read middle frame deterministically.
        total = idx
        if total > 2:
            cap.set(cv2.CAP_PROP_POS_FRAMES, total // 2)
            ok, mid = cap.read()
            if ok:
                mid_gray = cv2.cvtColor(mid, cv2.COLOR_BGR2GRAY)
        if mid_gray is None:
            mid_gray = first_gray

        composite_hash = (
            _dhash_64(first_gray) + _dhash_64(mid_gray) + _dhash_64(last_gray)  # type: ignore[arg-type]
        )
        motion_score = float(np.mean(diffs)) if diffs else 0.0
        return {
            "frame_count": total,
            "motion_score": motion_score,
            "composite_hash": composite_hash,
        }
    finally:
        cap.release()


def _hashes_are_dupes(a: str, b: str, threshold: int) -> bool:
    if len(a) != len(b) or len(a) % 16 != 0:
        return False
    chunks = [(a[i:i + 16], b[i:i + 16]) for i in range(0, len(a), 16)]
    total = sum(_hamming_hex(x, y) for x, y in chunks)
    return total <= threshold


# ---------------------------------------------------------------------------
# Pipeline
# ---------------------------------------------------------------------------

@dataclass
class SampleReport:
    record: Dict[str, Any]
    passed: bool
    reasons: List[str] = field(default_factory=list)
    metrics: Dict[str, Any] = field(default_factory=dict)


def _read_metadata(path: Path) -> List[Dict[str, Any]]:
    if not path.exists():
        raise FileNotFoundError(f"metadata.jsonl not found: {path}")
    out: List[Dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as f:
        for ln in f:
            ln = ln.strip()
            if not ln:
                continue
            try:
                out.append(json.loads(ln))
            except json.JSONDecodeError:
                continue
    return out


def _abs_video_path(record: Dict[str, Any], cfg: Settings) -> Path:
    rel = record["video"]
    return (cfg.dataset_dir / rel).resolve()


def _validate_record(
    record: Dict[str, Any],
    cfg: Settings,
    *,
    target_resolution: int,
    target_fps: int,
    duration_tolerance_s: float,
    min_motion: float,
    ffprobe_bin: Optional[str],
) -> SampleReport:
    report = SampleReport(record=record, passed=False)
    video_path = _abs_video_path(record, cfg)

    if not video_path.exists():
        report.reasons.append("video file missing")
        return report

    probe = _probe_with_ffprobe(video_path, ffprobe_bin) if ffprobe_bin else None
    if probe is None:
        probe = _probe_with_opencv(video_path)
    if probe is None:
        report.reasons.append("video could not be probed/opened")
        return report
    report.metrics.update(probe)

    if probe.get("width") != target_resolution or probe.get("height") != target_resolution:
        report.reasons.append(
            f"resolution {probe.get('width')}x{probe.get('height')} != {target_resolution}x{target_resolution}"
        )
    fps = probe.get("fps") or 0.0
    if abs(fps - target_fps) > 0.5:
        report.reasons.append(f"fps {fps:.2f} != {target_fps}")

    declared_duration = float(record.get("duration", 0.0))
    actual_duration = probe.get("duration") or 0.0
    if declared_duration > 0 and abs(actual_duration - declared_duration) > duration_tolerance_s:
        report.reasons.append(
            f"duration {actual_duration:.3f}s != declared {declared_duration:.3f}s "
            f"(tol {duration_tolerance_s}s)"
        )

    expected_frames = int(round(declared_duration * target_fps)) if declared_duration > 0 else None
    analysis = _analyze_frames(video_path, expected_frames)
    if analysis is None:
        report.reasons.append("frame analysis failed (decode error)")
        return report
    report.metrics.update(analysis)

    if expected_frames is not None and abs(analysis["frame_count"] - expected_frames) > 1:
        report.reasons.append(
            f"frame_count {analysis['frame_count']} != expected {expected_frames}"
        )

    if analysis["motion_score"] < min_motion:
        report.reasons.append(
            f"motion_score {analysis['motion_score']:.3f} < min {min_motion}"
        )

    report.passed = not report.reasons
    return report


def _stratified_split(
    records: List[Dict[str, Any]],
    val_ratio: float,
    seed: int,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    by_cat: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for r in records:
        by_cat[r.get("asset_type", "unknown")].append(r)

    rng = random.Random(seed)
    train: List[Dict[str, Any]] = []
    val: List[Dict[str, Any]] = []
    for cat, items in by_cat.items():
        items_sorted = sorted(items, key=lambda r: r.get("id", ""))
        rng.shuffle(items_sorted)
        n_val = max(1, int(round(len(items_sorted) * val_ratio))) if len(items_sorted) > 1 else 0
        val.extend(items_sorted[:n_val])
        train.extend(items_sorted[n_val:])
    return train, val


def _write_jsonl(path: Path, records: List[Dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        for r in records:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")


def run(
    *,
    target_resolution: int,
    target_fps: int,
    duration_tolerance_s: float,
    min_motion: float,
    duplicate_threshold: int,
    val_ratio: float,
    seed: int,
    verbose: bool,
) -> int:
    cfg = get_settings()
    cfg.ensure_dirs()
    ffprobe_bin = _resolve_ffprobe(cfg)
    if verbose and ffprobe_bin is None:
        print("[preprocess] ffprobe not found; falling back to OpenCV probing.", file=sys.stderr)

    records = _read_metadata(cfg.metadata_path)
    if not records:
        print(f"no records in {cfg.metadata_path}", file=sys.stderr)
        return 1

    reports: List[SampleReport] = []
    for record in tqdm(records, desc="probe", disable=not verbose):
        rep = _validate_record(
            record, cfg,
            target_resolution=target_resolution,
            target_fps=target_fps,
            duration_tolerance_s=duration_tolerance_s,
            min_motion=min_motion,
            ffprobe_bin=ffprobe_bin,
        )
        reports.append(rep)

    # Duplicate detection across surviving samples (within same asset_type).
    surviving = [r for r in reports if r.passed]
    by_cat: Dict[str, List[SampleReport]] = defaultdict(list)
    for r in surviving:
        by_cat[r.record.get("asset_type", "unknown")].append(r)

    seen_dupes: set[str] = set()
    for items in by_cat.values():
        for i in range(len(items)):
            if items[i].record["id"] in seen_dupes:
                continue
            for j in range(i + 1, len(items)):
                if items[j].record["id"] in seen_dupes:
                    continue
                ha = items[i].metrics.get("composite_hash")
                hb = items[j].metrics.get("composite_hash")
                if ha and hb and _hashes_are_dupes(ha, hb, duplicate_threshold):
                    items[j].passed = False
                    items[j].reasons.append(f"duplicate of {items[i].record['id']}")
                    seen_dupes.add(items[j].record["id"])

    quality_records = []
    for r in reports:
        quality_records.append({
            "id": r.record.get("id"),
            "asset_type": r.record.get("asset_type"),
            "video": r.record.get("video"),
            "passed": r.passed,
            "reasons": r.reasons,
            "metrics": r.metrics,
        })
    _write_jsonl(cfg.quality_report_path, quality_records)

    passed_records = [r.record for r in reports if r.passed]
    if not passed_records:
        print("no samples passed quality checks; check dataset/quality_report.jsonl", file=sys.stderr)
        return 1

    train, val = _stratified_split(passed_records, val_ratio=val_ratio, seed=seed)
    train_path = cfg.processed_dir / "train_metadata.jsonl"
    val_path = cfg.processed_dir / "val_metadata.jsonl"
    _write_jsonl(train_path, train)
    _write_jsonl(val_path, val)

    print(
        f"done: total={len(records)} passed={len(passed_records)} "
        f"train={len(train)} val={len(val)} "
        f"train_path={train_path} val_path={val_path}"
    )
    return 0


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Validate, dedupe, and split the HTML-animation dataset.")
    p.add_argument("--resolution", type=int, default=512)
    p.add_argument("--fps", type=int, default=24)
    p.add_argument("--duration-tolerance", type=float, default=0.05,
                   help="allowed |declared - actual| duration drift in seconds")
    p.add_argument("--min-motion", type=float, default=2.0,
                   help="reject videos whose mean inter-frame luma diff is below this")
    p.add_argument("--duplicate-threshold", type=int, default=8,
                   help="bit-distance threshold on the 192-bit composite hash")
    p.add_argument("--val-ratio", type=float, default=0.1)
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--verbose", action="store_true")
    return p.parse_args(argv)


def main(argv: Optional[List[str]] = None) -> int:
    a = parse_args(argv)
    return run(
        target_resolution=a.resolution,
        target_fps=a.fps,
        duration_tolerance_s=a.duration_tolerance,
        min_motion=a.min_motion,
        duplicate_threshold=a.duplicate_threshold,
        val_ratio=a.val_ratio,
        seed=a.seed,
        verbose=a.verbose,
    )


if __name__ == "__main__":
    raise SystemExit(main())
