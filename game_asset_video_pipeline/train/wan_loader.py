"""Wan2.2 component loader (transformer / VAE / text_encoder / scheduler).

Backed by the diffusers WanPipeline. We deliberately import lazily so that
this module can be inspected even when diffusers does not yet ship Wan2.2
support: a clear, actionable error is raised with the exact pip command.
"""

from __future__ import annotations

import importlib
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Optional

import torch


class WanModelError(RuntimeError):
    """Raised when the Wan2.2 components cannot be loaded."""


@dataclass
class WanComponents:
    transformer: Any
    vae: Any
    text_encoder: Any
    tokenizer: Any
    scheduler: Any
    pipeline: Optional[Any] = None
    dtype: torch.dtype = torch.bfloat16


_DTYPE_MAP = {
    "bf16": torch.bfloat16,
    "bfloat16": torch.bfloat16,
    "fp16": torch.float16,
    "float16": torch.float16,
    "fp32": torch.float32,
    "float32": torch.float32,
}


def _resolve_dtype(name: str) -> torch.dtype:
    return _DTYPE_MAP.get(name.lower(), torch.bfloat16)


def _import_wan_pipeline():
    """Try a few diffusers names for the Wan pipeline (API has been renamed)."""

    try:
        diffusers = importlib.import_module("diffusers")
    except ImportError as exc:
        raise WanModelError(
            "diffusers is required. Install with: pip install -U diffusers"
        ) from exc

    for name in ("WanPipeline", "WanVideoPipeline", "Wan22Pipeline"):
        if hasattr(diffusers, name):
            return getattr(diffusers, name)

    raise WanModelError(
        "diffusers does not expose a Wan pipeline class. "
        "Upgrade diffusers (pip install -U diffusers>=0.32) or check the Wan2.2 release notes."
    )


def load_wan2_components(
    config: Dict[str, Any],
    *,
    device: Optional[str] = None,
    verbose: bool = False,
) -> WanComponents:
    """Load Wan2.2 model components from a local diffusers-format checkpoint.

    Expected ``config`` shape::

        {
          "model": {"base_model_path": "./models/Wan2.2-TI2V-5B"},
          "train": {"mixed_precision": "bf16"},
        }
    """

    model_cfg = config.get("model", {})
    train_cfg = config.get("train", {})
    base_path = Path(model_cfg.get("base_model_path", ""))
    if not base_path.exists():
        raise WanModelError(
            f"Wan2.2 model directory not found: {base_path}\n"
            "Download the diffusers-format checkpoint (e.g. Wan-AI/Wan2.2-TI2V-5B-Diffusers) "
            "and update model.base_model_path in lora_config.yaml."
        )

    dtype = _resolve_dtype(train_cfg.get("mixed_precision", "bf16"))
    device = device or ("cuda" if torch.cuda.is_available() else "cpu")

    PipelineCls = _import_wan_pipeline()
    if verbose:
        import sys as _sys
        print(f"[wan_loader] using {PipelineCls.__name__} from diffusers", file=_sys.stderr)

    pipeline = PipelineCls.from_pretrained(str(base_path), torch_dtype=dtype)

    transformer = getattr(pipeline, "transformer", None)
    vae = getattr(pipeline, "vae", None)
    text_encoder = getattr(pipeline, "text_encoder", None)
    tokenizer = getattr(pipeline, "tokenizer", None)
    scheduler = getattr(pipeline, "scheduler", None)

    missing = [
        name for name, obj in (
            ("transformer", transformer),
            ("vae", vae),
            ("text_encoder", text_encoder),
            ("tokenizer", tokenizer),
            ("scheduler", scheduler),
        )
        if obj is None
    ]
    if missing:
        raise WanModelError(
            f"loaded pipeline is missing component(s): {missing}. "
            "The Wan2.2 pipeline may use different attribute names in this diffusers build."
        )

    if vae is not None:
        vae.requires_grad_(False)
        vae.eval()
    if text_encoder is not None:
        text_encoder.requires_grad_(False)
        text_encoder.eval()

    if device != "cpu":
        try:
            transformer.to(device)
            vae.to(device)
            text_encoder.to(device)
        except Exception as exc:
            raise WanModelError(
                f"failed to move components to {device}: {exc}. "
                "Try mixed_precision: bf16 or run on CPU for the smoke test."
            ) from exc

    return WanComponents(
        transformer=transformer,
        vae=vae,
        text_encoder=text_encoder,
        tokenizer=tokenizer,
        scheduler=scheduler,
        pipeline=pipeline,
        dtype=dtype,
    )
