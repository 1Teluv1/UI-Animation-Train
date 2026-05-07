"""Wan2.2 5B LoRA training skeleton.

This module is intentionally a *runnable skeleton* per the plan:
- Wires up accelerate + peft + a Wan2.2 component bundle.
- Exposes a clean train loop with cache-latents and gradient-checkpointing hooks.
- Encodes captions / videos through the (frozen) text_encoder + VAE.
- Trains LoRA-injected modules of the DiT (transformer) only.

Where Wan-specific call signatures differ (e.g., the exact transformer forward
keyword names), explicit ``# TODO[wan]`` markers are left so the user can
adapt them once the target diffusers Wan2.2 release is pinned.
"""

from __future__ import annotations

import json
import math
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional

import torch
import torch.nn.functional as F
from torch.utils.data import DataLoader

try:
    import yaml
except ImportError as exc:  # pragma: no cover
    raise SystemExit("pyyaml is required: pip install pyyaml") from exc

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from train.dataset_loader import build_dataset, collate  # noqa: E402
from train.wan_loader import WanComponents, WanModelError, load_wan2_components  # noqa: E402


# ---------------------------------------------------------------------------
# Config dataclass
# ---------------------------------------------------------------------------

@dataclass
class TrainCtx:
    cfg: Dict[str, Any]
    components: WanComponents
    output_dir: Path
    device: torch.device
    dtype: torch.dtype


def load_config(config_path: Path) -> Dict[str, Any]:
    with config_path.open("r", encoding="utf-8") as f:
        return yaml.safe_load(f)


# ---------------------------------------------------------------------------
# LoRA injection
# ---------------------------------------------------------------------------

def _inject_lora(transformer: torch.nn.Module, lora_cfg: Dict[str, Any]) -> torch.nn.Module:
    try:
        from peft import LoraConfig, get_peft_model
    except ImportError as exc:
        raise RuntimeError("peft is required: pip install peft>=0.13") from exc

    config = LoraConfig(
        r=int(lora_cfg.get("rank", 64)),
        lora_alpha=int(lora_cfg.get("alpha", 64)),
        lora_dropout=float(lora_cfg.get("dropout", 0.0)),
        target_modules=list(lora_cfg.get("target_modules", [])),
        bias="none",
    )
    return get_peft_model(transformer, config)


def _trainable_parameters(module: torch.nn.Module) -> List[torch.nn.Parameter]:
    return [p for p in module.parameters() if p.requires_grad]


def _build_optimizer(params: List[torch.nn.Parameter], train_cfg: Dict[str, Any]) -> torch.optim.Optimizer:
    lr = float(train_cfg.get("learning_rate", 2e-4))
    wd = float(train_cfg.get("weight_decay", 0.01))
    optim_name = str(train_cfg.get("optim", "adamw")).lower()
    if optim_name == "adamw_8bit":
        try:
            import bitsandbytes as bnb  # type: ignore
            return bnb.optim.AdamW8bit(params, lr=lr, weight_decay=wd)
        except ImportError:
            print("[train] bitsandbytes unavailable, falling back to torch.optim.AdamW", file=sys.stderr)
    return torch.optim.AdamW(params, lr=lr, weight_decay=wd)


# ---------------------------------------------------------------------------
# Encoding helpers
# ---------------------------------------------------------------------------

@torch.no_grad()
def _encode_video_to_latents(vae: torch.nn.Module, video: torch.Tensor) -> torch.Tensor:
    """Encode (B, C, T, H, W) in [-1, 1] to VAE latents.

    The Wan VAE returns a `posterior` whose `.sample()` (or `.latent_dist.sample()`)
    is the latent. We try both APIs.
    """

    out = vae.encode(video)
    if hasattr(out, "latent_dist"):
        latents = out.latent_dist.sample()
    elif hasattr(out, "sample"):
        latents = out.sample()
    else:
        latents = out  # type: ignore[assignment]
    scale = getattr(getattr(vae, "config", object()), "scaling_factor", 1.0) or 1.0
    return latents * scale


@torch.no_grad()
def _encode_text(
    components: WanComponents, captions: List[str], device: torch.device
) -> torch.Tensor:
    tokens = components.tokenizer(
        captions,
        padding="max_length",
        max_length=256,
        truncation=True,
        return_tensors="pt",
    ).to(device)
    out = components.text_encoder(**tokens)
    if hasattr(out, "last_hidden_state"):
        return out.last_hidden_state
    if hasattr(out, "hidden_states") and out.hidden_states:
        return out.hidden_states[-1]
    return out  # type: ignore[return-value]


# ---------------------------------------------------------------------------
# Train step
# ---------------------------------------------------------------------------

def _diffusion_step(
    components: WanComponents,
    latents: torch.Tensor,
    text_embeds: torch.Tensor,
    device: torch.device,
) -> torch.Tensor:
    """One denoising step. Returns the loss tensor."""

    scheduler = components.scheduler
    bsz = latents.shape[0]

    # Sample timesteps uniformly across the schedule.
    num_train_timesteps = getattr(scheduler.config, "num_train_timesteps", 1000)
    timesteps = torch.randint(
        0, num_train_timesteps, (bsz,), device=device, dtype=torch.long,
    )

    noise = torch.randn_like(latents)
    noisy = scheduler.add_noise(latents, noise, timesteps)

    # TODO[wan]: confirm exact forward kwargs for the loaded Wan transformer.
    # Recent diffusers Wan transformers accept (hidden_states=, timestep=, encoder_hidden_states=).
    pred = components.transformer(
        hidden_states=noisy,
        timestep=timesteps,
        encoder_hidden_states=text_embeds,
        return_dict=False,
    )[0]

    pred_type = getattr(scheduler.config, "prediction_type", "epsilon")
    if pred_type == "v_prediction":
        target = scheduler.get_velocity(latents, noise, timesteps)
    elif pred_type == "sample":
        target = latents
    else:  # "epsilon"
        target = noise

    return F.mse_loss(pred.float(), target.float(), reduction="mean")


# ---------------------------------------------------------------------------
# Checkpoint
# ---------------------------------------------------------------------------

def _save_lora(transformer: torch.nn.Module, out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    if hasattr(transformer, "save_pretrained"):
        transformer.save_pretrained(str(out_dir))
        return
    state = {k: v for k, v in transformer.state_dict().items() if "lora" in k.lower()}
    try:
        from safetensors.torch import save_file
        save_file(state, str(out_dir / "lora.safetensors"))
    except ImportError:
        torch.save(state, out_dir / "lora.pt")


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------

def main(
    config_path: Path,
    *,
    smoke_test: bool = False,
    verbose: bool = False,
) -> int:
    cfg = load_config(config_path)
    train_cfg = cfg.get("train", {})
    output_dir = Path(train_cfg.get("output_dir", "./outputs/icon_lora")).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    seed = int(train_cfg.get("seed", 42))
    torch.manual_seed(seed)

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    try:
        components = load_wan2_components(cfg, device=str(device), verbose=verbose)
    except WanModelError as exc:
        print(f"[train] cannot load Wan2.2 components: {exc}", file=sys.stderr)
        return 2

    if train_cfg.get("gradient_checkpointing", False):
        if hasattr(components.transformer, "enable_gradient_checkpointing"):
            components.transformer.enable_gradient_checkpointing()
        elif hasattr(components.transformer, "gradient_checkpointing_enable"):
            components.transformer.gradient_checkpointing_enable()

    transformer = _inject_lora(components.transformer, cfg.get("lora", {}))
    components.transformer = transformer
    transformer.train()

    trainable = _trainable_parameters(transformer)
    if not trainable:
        print("[train] no trainable parameters after LoRA injection!", file=sys.stderr)
        return 3
    optimizer = _build_optimizer(trainable, train_cfg)

    train_ds, _ = build_dataset(cfg["dataset"], split="train")
    loader = DataLoader(
        train_ds,
        batch_size=int(train_cfg.get("batch_size", 1)),
        shuffle=True,
        num_workers=int(cfg["dataset"].get("num_workers", 0)),
        collate_fn=collate,
    )

    grad_accum = int(train_cfg.get("gradient_accumulation_steps", 1))
    max_grad_norm = float(train_cfg.get("max_grad_norm", 1.0))
    save_every = int(train_cfg.get("save_every_steps", 500))
    log_every = int(train_cfg.get("log_every_steps", 10))
    epochs = 1 if smoke_test else int(train_cfg.get("epochs", 1))

    autocast_dtype = components.dtype if device.type == "cuda" else torch.float32

    global_step = 0
    optimizer.zero_grad(set_to_none=True)
    for epoch in range(epochs):
        for micro_step, batch in enumerate(loader):
            video = batch["video"].to(device, dtype=autocast_dtype)
            captions = batch["caption"]

            with torch.autocast(device_type=device.type, dtype=autocast_dtype, enabled=device.type == "cuda"):
                latents = _encode_video_to_latents(components.vae, video)
                text_embeds = _encode_text(components, captions, device)
                loss = _diffusion_step(components, latents, text_embeds, device)

            (loss / grad_accum).backward()

            if (micro_step + 1) % grad_accum == 0:
                torch.nn.utils.clip_grad_norm_(trainable, max_grad_norm)
                optimizer.step()
                optimizer.zero_grad(set_to_none=True)
                global_step += 1

                if verbose and global_step % log_every == 0:
                    print(f"[train] epoch={epoch} step={global_step} loss={loss.item():.4f}")

                if save_every > 0 and global_step % save_every == 0:
                    ckpt_dir = output_dir / f"checkpoint-{global_step:06d}"
                    _save_lora(transformer, ckpt_dir)
                    if verbose:
                        print(f"[train] saved checkpoint -> {ckpt_dir}")

                if smoke_test:
                    final_dir = output_dir / "final"
                    _save_lora(transformer, final_dir)
                    print(f"[train] smoke test ok: 1 optimizer step, loss={loss.item():.4f}")
                    return 0

    final_dir = output_dir / "final"
    _save_lora(transformer, final_dir)
    print(f"[train] done: total_steps={global_step} final={final_dir}")
    return 0
