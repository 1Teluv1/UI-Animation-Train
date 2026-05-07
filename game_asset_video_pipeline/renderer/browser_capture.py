"""Headless browser frame capture using Playwright (sync API)."""

from __future__ import annotations

import shutil
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from app.config import Settings, get_settings


class FrameCaptureError(RuntimeError):
    """Raised when frame capture fails (browser launch, navigation, screenshot)."""


@dataclass
class CaptureResult:
    frames_dir: Path
    frame_count: int
    duration_s: float
    fps: int
    resolution: int


def _frames_dir_for(sample_id: str, cfg: Settings) -> Path:
    return cfg.frames_dir / sample_id


def reset_frames_dir(sample_id: str, cfg: Optional[Settings] = None) -> Path:
    cfg = cfg or get_settings()
    cfg.ensure_dirs()
    target = _frames_dir_for(sample_id, cfg)
    if target.exists():
        shutil.rmtree(target)
    target.mkdir(parents=True, exist_ok=True)
    return target


def capture_html(
    html_path: Path,
    sample_id: str,
    *,
    duration_s: float,
    fps: int,
    resolution: int,
    settings: Optional[Settings] = None,
    verbose: bool = False,
) -> CaptureResult:
    """Render an HTML file in a 512x512 chromium tab and screenshot each frame.

    Capture is wall-clock based: we sleep ``1/fps`` seconds between screenshots.
    This is simple and reproducible enough for short (1~3s) clips. A more
    accurate fast-forward approach (overriding ``performance.now`` and
    ``Date.now``) is possible but skipped for the MVP per the plan.
    """

    try:
        from playwright.sync_api import sync_playwright  # type: ignore
    except ImportError as exc:
        raise FrameCaptureError(
            "playwright is not installed. Run: pip install playwright && playwright install chromium"
        ) from exc

    cfg = settings or get_settings()
    target = reset_frames_dir(sample_id, cfg)
    total_frames = max(1, int(round(duration_s * fps)))
    frame_interval = 1.0 / fps

    if verbose:
        print(
            f"[capture] {sample_id}: duration={duration_s}s fps={fps} frames={total_frames}",
            file=sys.stderr,
        )

    file_uri = html_path.resolve().as_uri()

    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(
                headless=True,
                args=["--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars"],
            )
            try:
                context = browser.new_context(
                    viewport={"width": resolution, "height": resolution},
                    device_scale_factor=1,
                    reduced_motion="no-preference",
                    color_scheme="dark",
                )
                page = context.new_page()
                page.goto(file_uri, wait_until="load")
                page.evaluate(
                    "() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))"
                )

                t0 = time.perf_counter()
                for i in range(total_frames):
                    target_t = t0 + i * frame_interval
                    now = time.perf_counter()
                    if target_t > now:
                        time.sleep(target_t - now)
                    out = target / f"frame_{i + 1:06d}.png"
                    page.screenshot(
                        path=str(out),
                        clip={"x": 0, "y": 0, "width": resolution, "height": resolution},
                        omit_background=False,
                        type="png",
                    )
            finally:
                browser.close()
    except FrameCaptureError:
        raise
    except Exception as exc:
        raise FrameCaptureError(f"playwright capture failed: {exc}") from exc

    written = sorted(target.glob("frame_*.png"))
    if len(written) != total_frames:
        raise FrameCaptureError(
            f"expected {total_frames} frames, got {len(written)} in {target}"
        )

    return CaptureResult(
        frames_dir=target,
        frame_count=len(written),
        duration_s=duration_s,
        fps=fps,
        resolution=resolution,
    )
