"""End-to-end dataset generator: spec -> HTML -> MP4 -> metadata.jsonl.

Sequential by design (per project rule: deterministic, no parallelism).
"""

from __future__ import annotations

import argparse
import json
import sys
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

# Ensure the project root is importable when executed as `python scripts/generate_dataset.py`.
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app.config import Settings, get_settings  # noqa: E402
from caption.caption_builder import build_caption  # noqa: E402
from html_generator.generate_html import GeneratedHTML, generate_for_spec  # noqa: E402
from lmstudio.prompts import ASSET_TYPES, build_spec_grid  # noqa: E402
from renderer.render_html_to_video import RenderedVideo, render_html  # noqa: E402

try:
    from tqdm import tqdm
except ImportError:  # pragma: no cover - tqdm is in requirements but keep graceful fallback
    def tqdm(x, **_kwargs):  # type: ignore
        return x


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _append_jsonl(path: Path, record: Dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")


def _to_relative(path: Path, base: Path) -> str:
    try:
        return str(path.relative_to(base)).replace("\\", "/")
    except ValueError:
        return str(path).replace("\\", "/")


def _build_metadata_record(
    spec: Dict,
    html: GeneratedHTML,
    video: RenderedVideo,
    caption: str,
    cfg: Settings,
) -> Dict:
    return {
        "id": html.sample_id,
        "video": _to_relative(video.mp4_path, cfg.dataset_dir),
        "html": _to_relative(html.html_path, cfg.dataset_dir),
        "webm": _to_relative(video.webm_path, cfg.dataset_dir) if video.webm_path else None,
        "caption": caption,
        "asset_type": spec["asset_type"],
        "subject": spec["subject"],
        "motion_preset": spec.get("motion_preset"),
        "motion": spec.get("motion"),
        "style": spec.get("style"),
        "background": spec.get("background"),
        "duration": float(spec.get("duration", cfg.default_duration)),
        "fps": int(spec.get("fps", cfg.fps)),
        "resolution": f"{cfg.resolution}x{cfg.resolution}",
        "source": "fallback_template" if html.used_fallback else "lm_studio",
        "created_at": _utc_now_iso(),
    }


def _build_failure_record(spec: Dict, sample_id: Optional[str], error: BaseException) -> Dict:
    return {
        "id": sample_id,
        "spec": spec,
        "error": f"{type(error).__name__}: {error}",
        "failed_at": _utc_now_iso(),
    }


def _existing_id_max(metadata_path: Path, category: str) -> int:
    """Return the largest numeric suffix already used for ``category`` in metadata.jsonl."""

    if not metadata_path.exists():
        return -1
    max_idx = -1
    with metadata_path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                continue
            if record.get("asset_type") != category:
                continue
            sample_id = record.get("id", "")
            tail = sample_id.rsplit("_", 1)[-1]
            if tail.isdigit():
                max_idx = max(max_idx, int(tail))
    return max_idx


def run(
    *,
    count: int,
    category: str,
    use_llm: bool,
    also_webm: bool,
    keep_frames: bool,
    seed: int,
    duration: float,
    start_id: Optional[int],
    verbose: bool,
) -> int:
    cfg = get_settings()
    cfg.ensure_dirs()

    if category not in ASSET_TYPES:
        print(
            f"unknown category '{category}'. allowed: {sorted(ASSET_TYPES)}",
            file=sys.stderr,
        )
        return 2

    base_index = start_id if start_id is not None else _existing_id_max(cfg.metadata_path, category) + 1
    specs: List[Dict] = build_spec_grid(
        category=category,
        count=count,
        seed=seed,
        duration=duration,
        fps=cfg.fps,
        resolution=cfg.resolution,
    )

    ok = 0
    fail = 0
    iterator = tqdm(list(enumerate(specs, start=base_index)), desc=f"gen[{category}]", disable=not verbose)
    for index, spec in iterator:
        sample_id: Optional[str] = None
        try:
            html = generate_for_spec(
                spec, index=index, settings=cfg, use_llm=use_llm, verbose=verbose,
            )
            sample_id = html.sample_id

            video = render_html(
                html.html_path, sample_id,
                duration_s=float(spec["duration"]),
                fps=int(spec["fps"]),
                resolution=int(spec["resolution"]),
                also_webm=also_webm,
                keep_frames=keep_frames,
                settings=cfg,
                verbose=verbose,
            )

            caption = build_caption(spec)
            record = _build_metadata_record(spec, html, video, caption, cfg)
            _append_jsonl(cfg.metadata_path, record)
            ok += 1
        except Exception as exc:
            fail += 1
            _append_jsonl(cfg.failed_path, _build_failure_record(spec, sample_id, exc))
            if verbose:
                print(f"[generate] FAILED {sample_id or spec.get('asset_type')}: {exc}", file=sys.stderr)
                traceback.print_exc(file=sys.stderr)

    print(f"done: ok={ok} fail={fail} metadata={cfg.metadata_path}")
    return 0 if ok > 0 else 1


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Generate HTML animation dataset (HTML -> MP4 + metadata.jsonl).")
    p.add_argument("--count", type=int, required=True, help="number of samples to generate")
    p.add_argument("--category", type=str, required=True, choices=list(ASSET_TYPES))
    p.add_argument("--seed", type=int, default=0, help="RNG seed for spec grid")
    p.add_argument("--duration", type=float, default=2.0, help="animation duration in seconds")
    p.add_argument("--start-id", type=int, default=None,
                   help="starting numeric index for sample IDs; default appends after existing metadata")
    p.add_argument("--no-llm", action="store_true",
                   help="skip LM Studio entirely and use bundled HTML templates")
    p.add_argument("--also-webm", action="store_true", help="encode an additional .webm output")
    p.add_argument("--keep-frames", action="store_true", help="do not delete the per-sample PNG frames after encoding")
    p.add_argument("--verbose", action="store_true", help="emit progress + error logs to stderr")
    return p.parse_args(argv)


def main(argv: Optional[List[str]] = None) -> int:
    args = parse_args(argv)
    return run(
        count=args.count,
        category=args.category,
        use_llm=not args.no_llm,
        also_webm=args.also_webm,
        keep_frames=args.keep_frames,
        seed=args.seed,
        duration=args.duration,
        start_id=args.start_id,
        verbose=args.verbose,
    )


if __name__ == "__main__":
    raise SystemExit(main())
