"""Sample inference using a trained Wan2.2 LoRA.

Loads the diffusers Wan pipeline, attaches the LoRA weights, generates one
clip per prompt, and writes them to outputs/icon_lora/final/sample_videos/.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import List, Optional

import torch
import yaml

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from train.wan_loader import _import_wan_pipeline, _resolve_dtype  # noqa: E402

DEFAULT_PROMPTS: List[str] = [
    "[UI_REWARD] A shiny gold coin icon pops upward, spins once, emits small sparkles, then settles down. Clean mobile game UI animation.",
    "[EMOJI_MOTION] A cute yellow emoji smiles widely, bounces twice, sparkles around its face, then gently returns to the center.",
    "[GAME_VFX] A stylized blue magic burst appears at the center, expands outward, releases tiny glowing particles, and fades away.",
]


def _load_yaml(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def _save_video(frames, path: Path, fps: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        from diffusers.utils import export_to_video
        export_to_video(frames, str(path), fps=fps)
        return
    except Exception:
        pass
    # Fallback: use imageio.
    import imageio
    imageio.mimsave(str(path), frames, fps=fps)


def main(argv: Optional[List[str]] = None) -> int:
    p = argparse.ArgumentParser(description="Generate sample videos using a trained Wan2.2 LoRA.")
    p.add_argument("--config", type=Path, default=PROJECT_ROOT / "train" / "lora_config.yaml")
    p.add_argument("--lora", type=Path, required=False,
                   help="path to a trained LoRA dir or .safetensors. If omitted, runs the base model only.")
    p.add_argument("--out-dir", type=Path,
                   default=None,
                   help="where to write sample mp4s (default: <output_dir>/final/sample_videos)")
    p.add_argument("--prompts", type=Path,
                   help="optional text file, one prompt per line; overrides the built-in 3 prompts")
    p.add_argument("--seed", type=int, default=None)
    p.add_argument("--verbose", action="store_true")
    args = p.parse_args(argv)

    cfg_path = args.config.resolve()
    if not cfg_path.exists():
        print(f"config not found: {cfg_path}", file=sys.stderr)
        return 2
    cfg = _load_yaml(cfg_path)

    base_path = Path(cfg["model"]["base_model_path"]).resolve()
    if not base_path.exists():
        print(f"Wan2.2 base model dir not found: {base_path}", file=sys.stderr)
        return 2

    dtype = _resolve_dtype(cfg.get("train", {}).get("mixed_precision", "bf16"))
    PipelineCls = _import_wan_pipeline()
    pipe = PipelineCls.from_pretrained(str(base_path), torch_dtype=dtype)

    if torch.cuda.is_available():
        pipe.to("cuda")

    if args.lora is not None:
        lora_path = args.lora.resolve()
        if not lora_path.exists():
            print(f"lora path not found: {lora_path}", file=sys.stderr)
            return 2
        if hasattr(pipe, "load_lora_weights"):
            pipe.load_lora_weights(str(lora_path))
        else:
            print("[sample] pipe.load_lora_weights unavailable; LoRA NOT applied.", file=sys.stderr)

    out_dir = (args.out_dir or Path(cfg["train"]["output_dir"]) / "final" / "sample_videos").resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    if args.prompts:
        prompts = [ln.strip() for ln in args.prompts.read_text(encoding="utf-8").splitlines() if ln.strip()]
    else:
        prompts = DEFAULT_PROMPTS

    inf = cfg.get("inference", {})
    num_steps = int(inf.get("num_inference_steps", 30))
    guidance = float(inf.get("guidance_scale", 5.0))
    negative = inf.get("negative_prompt", "")
    seed = args.seed if args.seed is not None else int(inf.get("seed", 0))
    fps = int(cfg.get("dataset", {}).get("fps", 24))
    num_frames = int(cfg.get("dataset", {}).get("num_frames", 49))
    res = int(cfg.get("dataset", {}).get("resolution", 512))

    generator = torch.Generator(device="cuda" if torch.cuda.is_available() else "cpu").manual_seed(seed)

    for i, prompt in enumerate(prompts, start=1):
        if args.verbose:
            print(f"[sample] {i}/{len(prompts)}: {prompt}")
        result = pipe(
            prompt=prompt,
            negative_prompt=negative,
            num_inference_steps=num_steps,
            guidance_scale=guidance,
            num_frames=num_frames,
            height=res,
            width=res,
            generator=generator,
        )
        frames = getattr(result, "frames", None)
        if frames is None and hasattr(result, "videos"):
            frames = result.videos
        if frames is None:
            print(f"[sample] pipeline returned no frames for prompt #{i}", file=sys.stderr)
            continue
        # WanPipeline returns a list of frame-batches; pick the first.
        if isinstance(frames, list) and frames and not isinstance(frames[0], (bytes, bytearray)):
            frames = frames[0]
        out_path = out_dir / f"sample_{i:02d}.mp4"
        _save_video(frames, out_path, fps=fps)
        if args.verbose:
            print(f"[sample] wrote {out_path}")

    print(f"done: {len(prompts)} samples -> {out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
