"""PyTorch Dataset for Wan2.2 LoRA training.

Reads dataset/processed/train_metadata.jsonl, decodes each video to a
(C, T, H, W) tensor in [-1, 1], resizes to `resolution`, and pads/crops to
exactly `num_frames` along T.
"""

from __future__ import annotations

import json
import random
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import torch
from torch.utils.data import Dataset

# --- video reader ---------------------------------------------------------

_DECORD_AVAILABLE = False
try:
    import decord  # type: ignore
    decord.bridge.set_bridge("native")
    _DECORD_AVAILABLE = True
except Exception:  # pragma: no cover
    decord = None  # type: ignore


def _read_video_frames(path: Path, target_size: int) -> np.ndarray:
    """Return (T, H, W, 3) uint8 RGB array, resized to target_size on shorter side via center-crop."""

    if _DECORD_AVAILABLE:
        try:
            vr = decord.VideoReader(str(path), width=target_size, height=target_size)  # type: ignore
            arr = vr.get_batch(range(len(vr))).asnumpy()
            return arr
        except Exception:
            pass

    # Fallback: torchvision.io.read_video
    try:
        from torchvision.io import read_video
        video, _, _ = read_video(str(path), pts_unit="sec")
        arr = video.numpy()  # (T, H, W, 3) uint8
    except Exception:
        # Last-resort fallback: OpenCV.
        import cv2  # type: ignore
        cap = cv2.VideoCapture(str(path))
        frames = []
        ok, f = cap.read()
        while ok:
            frames.append(cv2.cvtColor(f, cv2.COLOR_BGR2RGB))
            ok, f = cap.read()
        cap.release()
        if not frames:
            raise RuntimeError(f"failed to decode any frame from {path}")
        arr = np.stack(frames, axis=0)

    if arr.shape[1] != target_size or arr.shape[2] != target_size:
        import cv2  # type: ignore
        resized = np.empty((arr.shape[0], target_size, target_size, arr.shape[3]), dtype=arr.dtype)
        for i in range(arr.shape[0]):
            resized[i] = cv2.resize(arr[i], (target_size, target_size), interpolation=cv2.INTER_AREA)
        arr = resized
    return arr


def _adjust_temporal(frames: np.ndarray, num_frames: int, rng: random.Random) -> np.ndarray:
    """Pad with last frame if too few; randomly crop if too many."""

    t = frames.shape[0]
    if t == num_frames:
        return frames
    if t > num_frames:
        start = rng.randint(0, t - num_frames)
        return frames[start:start + num_frames]
    pad = num_frames - t
    last = frames[-1:].repeat(pad, axis=0)
    return np.concatenate([frames, last], axis=0)


@dataclass
class WanDatasetConfig:
    metadata_path: Path
    dataset_root: Path
    resolution: int = 512
    num_frames: int = 49
    seed: int = 42


class WanLoraDataset(Dataset):
    """jsonl-driven Dataset returning normalized (C, T, H, W) float tensors."""

    def __init__(self, cfg: WanDatasetConfig):
        self.cfg = cfg
        if not cfg.metadata_path.exists():
            raise FileNotFoundError(
                f"metadata not found: {cfg.metadata_path}. Run scripts/preprocess_dataset.py first."
            )
        self.records: List[Dict[str, Any]] = []
        with cfg.metadata_path.open("r", encoding="utf-8") as f:
            for ln in f:
                ln = ln.strip()
                if not ln:
                    continue
                self.records.append(json.loads(ln))
        if not self.records:
            raise RuntimeError(f"no usable records in {cfg.metadata_path}")
        self._rng = random.Random(cfg.seed)

    def __len__(self) -> int:
        return len(self.records)

    def _resolve_video(self, record: Dict[str, Any]) -> Path:
        rel = record["video"]
        return (self.cfg.dataset_root / rel).resolve()

    def __getitem__(self, idx: int) -> Dict[str, Any]:
        record = self.records[idx]
        path = self._resolve_video(record)
        frames = _read_video_frames(path, self.cfg.resolution)
        frames = _adjust_temporal(frames, self.cfg.num_frames, self._rng)

        # (T, H, W, C) uint8 -> (C, T, H, W) float32 in [-1, 1]
        tensor = torch.from_numpy(frames).float()
        tensor = tensor.permute(3, 0, 1, 2).contiguous()
        tensor = tensor / 127.5 - 1.0

        return {
            "video": tensor,
            "caption": record.get("caption", ""),
            "id": record.get("id", ""),
        }


def collate(batch: List[Dict[str, Any]]) -> Dict[str, Any]:
    videos = torch.stack([b["video"] for b in batch], dim=0)
    captions = [b["caption"] for b in batch]
    ids = [b["id"] for b in batch]
    return {"video": videos, "caption": captions, "id": ids}


def build_dataset(cfg_dict: Dict[str, Any], split: str = "train") -> Tuple[WanLoraDataset, WanDatasetConfig]:
    """Build a dataset from the YAML 'dataset' subtree."""

    key = "train_metadata_path" if split == "train" else "val_metadata_path"
    metadata_path = Path(cfg_dict[key]).resolve()
    dataset_root = Path(cfg_dict.get("dataset_root", "./dataset")).resolve()
    cfg = WanDatasetConfig(
        metadata_path=metadata_path,
        dataset_root=dataset_root,
        resolution=int(cfg_dict.get("resolution", 512)),
        num_frames=int(cfg_dict.get("num_frames", 49)),
        seed=int(cfg_dict.get("seed", 42)),
    )
    return WanLoraDataset(cfg), cfg
