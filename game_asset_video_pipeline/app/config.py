"""Project-wide settings.

Single source of truth for paths, endpoints, and frame/codec parameters.
Loaded once via :func:`get_settings` and shared across CLI scripts.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional


def _project_root() -> Path:
    return Path(__file__).resolve().parent.parent


def _env_str(key: str, default: str) -> str:
    value = os.environ.get(key)
    return value if value else default


def _env_int(key: str, default: int) -> int:
    value = os.environ.get(key)
    if value is None or value == "":
        return default
    try:
        return int(value)
    except ValueError:
        return default


def _env_float(key: str, default: float) -> float:
    value = os.environ.get(key)
    if value is None or value == "":
        return default
    try:
        return float(value)
    except ValueError:
        return default


@dataclass
class Settings:
    project_root: Path = field(default_factory=_project_root)

    lmstudio_base_url: str = field(
        default_factory=lambda: _env_str("LMSTUDIO_BASE_URL", "http://localhost:1234/v1")
    )
    lmstudio_model: str = field(
        default_factory=lambda: _env_str("LMSTUDIO_MODEL", "local-model")
    )
    lmstudio_api_key: str = field(
        default_factory=lambda: _env_str("LMSTUDIO_API_KEY", "lm-studio")
    )
    lmstudio_timeout: float = field(
        default_factory=lambda: _env_float("LMSTUDIO_TIMEOUT", 180.0)
    )
    lmstudio_max_retries: int = field(
        default_factory=lambda: _env_int("LMSTUDIO_MAX_RETRIES", 3)
    )
    lmstudio_temperature: float = field(
        default_factory=lambda: _env_float("LMSTUDIO_TEMPERATURE", 0.7)
    )
    lmstudio_max_tokens: int = field(
        default_factory=lambda: _env_int("LMSTUDIO_MAX_TOKENS", 4096)
    )

    resolution: int = 512
    fps: int = 24
    default_duration: float = 2.0

    dataset_dir: Path = field(init=False)
    html_dir: Path = field(init=False)
    videos_dir: Path = field(init=False)
    frames_dir: Path = field(init=False)
    processed_dir: Path = field(init=False)
    metadata_path: Path = field(init=False)
    failed_path: Path = field(init=False)
    quality_report_path: Path = field(init=False)

    ffmpeg_bin: str = field(default_factory=lambda: _env_str("FFMPEG_BIN", "ffmpeg"))
    ffprobe_bin: str = field(default_factory=lambda: _env_str("FFPROBE_BIN", "ffprobe"))

    def __post_init__(self) -> None:
        root_override = os.environ.get("DATASET_ROOT")
        self.dataset_dir = Path(root_override) if root_override else self.project_root / "dataset"
        self.html_dir = self.dataset_dir / "html"
        self.videos_dir = self.dataset_dir / "videos"
        self.frames_dir = self.dataset_dir / "frames"
        self.processed_dir = self.dataset_dir / "processed"
        self.metadata_path = self.dataset_dir / "metadata.jsonl"
        self.failed_path = self.dataset_dir / "failed.jsonl"
        self.quality_report_path = self.dataset_dir / "quality_report.jsonl"

    def ensure_dirs(self) -> None:
        for directory in (
            self.dataset_dir,
            self.html_dir,
            self.videos_dir,
            self.frames_dir,
            self.processed_dir,
        ):
            directory.mkdir(parents=True, exist_ok=True)


_SETTINGS: Optional[Settings] = None


def get_settings(refresh: bool = False) -> Settings:
    global _SETTINGS
    if _SETTINGS is None or refresh:
        _SETTINGS = Settings()
    return _SETTINGS
