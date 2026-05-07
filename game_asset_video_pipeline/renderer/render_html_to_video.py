"""End-to-end HTML -> MP4 (and optional WebM) renderer."""

from __future__ import annotations

import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional

from app.config import Settings, get_settings
from renderer.browser_capture import CaptureResult, capture_html


class FFmpegError(RuntimeError):
    """Raised when ffmpeg invocation fails or the binary is missing."""


@dataclass
class RenderedVideo:
    sample_id: str
    mp4_path: Path
    webm_path: Optional[Path]
    capture: CaptureResult


def _ensure_ffmpeg(bin_name: str) -> str:
    resolved = shutil.which(bin_name)
    if resolved:
        return resolved
    # Fallback: imageio-ffmpeg ships a bundled ffmpeg binary on Windows/macOS/Linux.
    try:
        import imageio_ffmpeg  # type: ignore
        bundled = imageio_ffmpeg.get_ffmpeg_exe()
        if bundled and Path(bundled).exists():
            return bundled
    except Exception:
        pass
    raise FFmpegError(
        f"'{bin_name}' was not found on PATH and no bundled ffmpeg is available. "
        "Install ffmpeg (e.g. winget install Gyan.FFmpeg) and re-open the shell, "
        "or `pip install imageio-ffmpeg`, or set FFMPEG_BIN to the full path."
    )


def _run_ffmpeg(args: List[str], *, verbose: bool) -> None:
    proc = subprocess.run(
        args,
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if proc.returncode != 0:
        if verbose:
            sys.stderr.write(proc.stderr.decode("utf-8", errors="replace"))
        raise FFmpegError(
            f"ffmpeg exited with code {proc.returncode}: "
            f"{proc.stderr.decode('utf-8', errors='replace')[-500:]}"
        )


def encode_frames_to_mp4(
    frames_dir: Path,
    out_path: Path,
    *,
    fps: int,
    resolution: int,
    settings: Optional[Settings] = None,
    verbose: bool = False,
) -> Path:
    cfg = settings or get_settings()
    ffmpeg = _ensure_ffmpeg(cfg.ffmpeg_bin)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    args = [
        ffmpeg,
        "-y",
        "-framerate", str(fps),
        "-i", str(frames_dir / "frame_%06d.png"),
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-vf", f"scale={resolution}:{resolution}:flags=lanczos",
        "-r", str(fps),
        "-movflags", "+faststart",
        "-an",
        str(out_path),
    ]
    _run_ffmpeg(args, verbose=verbose)
    return out_path


def encode_frames_to_webm(
    frames_dir: Path,
    out_path: Path,
    *,
    fps: int,
    resolution: int,
    settings: Optional[Settings] = None,
    verbose: bool = False,
) -> Path:
    cfg = settings or get_settings()
    ffmpeg = _ensure_ffmpeg(cfg.ffmpeg_bin)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    args = [
        ffmpeg,
        "-y",
        "-framerate", str(fps),
        "-i", str(frames_dir / "frame_%06d.png"),
        "-c:v", "libvpx-vp9",
        "-pix_fmt", "yuv420p",
        "-b:v", "0",
        "-crf", "32",
        "-vf", f"scale={resolution}:{resolution}:flags=lanczos",
        "-r", str(fps),
        "-an",
        str(out_path),
    ]
    _run_ffmpeg(args, verbose=verbose)
    return out_path


def render_html(
    html_path: Path,
    sample_id: str,
    *,
    duration_s: float,
    fps: int,
    resolution: int,
    also_webm: bool = False,
    keep_frames: bool = False,
    settings: Optional[Settings] = None,
    verbose: bool = False,
) -> RenderedVideo:
    """Capture frames and encode to MP4 (+ optional WebM)."""

    cfg = settings or get_settings()
    capture = capture_html(
        html_path,
        sample_id,
        duration_s=duration_s,
        fps=fps,
        resolution=resolution,
        settings=cfg,
        verbose=verbose,
    )

    mp4_path = cfg.videos_dir / f"{sample_id}.mp4"
    encode_frames_to_mp4(
        capture.frames_dir, mp4_path,
        fps=fps, resolution=resolution, settings=cfg, verbose=verbose,
    )

    webm_path: Optional[Path] = None
    if also_webm:
        webm_path = cfg.videos_dir / f"{sample_id}.webm"
        encode_frames_to_webm(
            capture.frames_dir, webm_path,
            fps=fps, resolution=resolution, settings=cfg, verbose=verbose,
        )

    if not keep_frames:
        shutil.rmtree(capture.frames_dir, ignore_errors=True)

    return RenderedVideo(
        sample_id=sample_id, mp4_path=mp4_path, webm_path=webm_path, capture=capture,
    )
