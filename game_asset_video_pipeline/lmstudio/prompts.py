"""Prompt bank loader and message builders for HTML animation requests."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Sequence

ASSET_TYPES: Sequence[str] = (
    "ui_reward",
    "emoji_motion",
    "game_vfx",
    "item_showcase",
    "button_motion",
)

MOTION_PRESETS: Sequence[str] = (
    "pop_up",
    "bounce",
    "spin_once",
    "shake",
    "pulse_glow",
    "sparkle_burst",
    "float_loop",
    "reward_burst",
    "scale_in",
    "drop_and_land",
    "wiggle",
    "rotate_tilt",
)

PROMPT_BANK_PATH = Path(__file__).resolve().parent / "data" / "user_prompt_bank.json"

# Human-readable description fragments used both for the HTML user prompt and
# the caption_builder so they stay in sync.
MOTION_DESCRIPTION: Dict[str, str] = {
    "pop_up": "pops upward sharply from the center and settles back down",
    "bounce": "bounces up and down twice with a soft squash and stretch",
    "spin_once": "spins around once smoothly and stops facing forward",
    "shake": "shakes left and right rapidly then settles in the center",
    "pulse_glow": "pulses with a soft glow expanding and contracting around it",
    "sparkle_burst": "emits small sparkles outward and gently rotates back",
    "float_loop": "floats up and down gently in a continuous loop",
    "reward_burst": "scales up with a bright burst, releases tiny stars, and settles",
    "scale_in": "scales in from zero with a slight overshoot and settles",
    "drop_and_land": "drops from the top, lands at the center with a small bounce",
    "wiggle": "wiggles side to side playfully and returns to the center",
    "rotate_tilt": "tilts left, then right, then returns to upright smoothly",
}

MOTION_TIMING: Dict[str, str] = {
    "pop_up": "snappy",
    "bounce": "bouncy",
    "spin_once": "smooth",
    "shake": "energetic",
    "pulse_glow": "rhythmic",
    "sparkle_burst": "lively",
    "float_loop": "gentle",
    "reward_burst": "celebratory",
    "scale_in": "snappy",
    "drop_and_land": "weighty",
    "wiggle": "playful",
    "rotate_tilt": "smooth",
}


SYSTEM_PROMPT_HTML = """You are an expert front-end engineer who writes self-contained HTML animation files for a game UI dataset.

You MUST follow ALL of these rules without exception:
- Output ONE complete HTML file. No prose, no explanation.
- The whole document must be a single .html file. No external CDN, no external network requests, no remote fonts.
- Use ONLY plain HTML, CSS, and vanilla JavaScript. No frameworks, no libraries.
- The visible canvas is exactly 512x512 pixels. Center the animation in it.
- body { margin: 0; padding: 0; overflow: hidden; } and the page background must be a single solid color (or transparent feel) as requested.
- The animation duration must equal the requested duration in seconds. Loop or end exactly at that time.
- Style: polished cartoon / mobile game UI icon. No photorealism.
- Do NOT include any watermark, logo, brand name, copyright text, or unrelated text.
- The motion must be visually obvious and match the requested motion description.
- Prefer CSS animations and transforms; SVG is allowed; <canvas> 2D is allowed for particles.
- Do NOT use <iframe>, <video>, <audio>, or fetch().

Return ONLY the raw HTML, optionally wrapped in a single ```html code block."""

SYSTEM_PROMPT_PROMPT_BANK = """Create JSON-only prompt-bank entries for game UI animation generation.
Each object MUST include:
- prompt_id (unique string)
- asset_type (one of: ui_reward, emoji_motion, game_vfx, item_showcase, button_motion)
- subject (short lowercase label)
- user_prompt (full prompt text for the HTML generator)

Optional fields:
- motion_preset, motion, style, background, duration, fps, resolution

Return a JSON array only."""

PROMPT_BANK_SCHEMA: Dict[str, Any] = {
    "required": ("prompt_id", "asset_type", "subject", "user_prompt"),
    "optional": (
        "motion_preset",
        "motion",
        "style",
        "background",
        "duration",
        "fps",
        "resolution",
    ),
}

def _validate_prompt_entry(entry: Dict[str, Any], index: int) -> None:
    for key in PROMPT_BANK_SCHEMA["required"]:
        if key not in entry:
            raise ValueError(f"prompt bank entry #{index} missing required key: {key}")

    asset_type = str(entry["asset_type"])
    if asset_type not in ASSET_TYPES:
        raise ValueError(
            f"prompt bank entry #{index} has invalid asset_type={asset_type!r}; allowed={list(ASSET_TYPES)}"
        )

    if not str(entry["user_prompt"]).strip():
        raise ValueError(f"prompt bank entry #{index} has empty user_prompt")

    motion_preset = entry.get("motion_preset")
    if motion_preset is not None and motion_preset not in MOTION_PRESETS:
        raise ValueError(
            f"prompt bank entry #{index} has invalid motion_preset={motion_preset!r}; allowed={list(MOTION_PRESETS)}"
        )


def load_prompt_bank(path: Path = PROMPT_BANK_PATH) -> List[Dict[str, Any]]:
    if not path.exists():
        raise FileNotFoundError(f"prompt bank not found: {path}")

    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, list):
        raise ValueError(f"prompt bank must be a JSON array: {path}")

    entries: List[Dict[str, Any]] = []
    seen_prompt_ids = set()
    for i, item in enumerate(raw):
        if not isinstance(item, dict):
            raise ValueError(f"prompt bank entry #{i} must be an object")
        entry = dict(item)
        _validate_prompt_entry(entry, i)
        prompt_id = str(entry["prompt_id"])
        if prompt_id in seen_prompt_ids:
            raise ValueError(f"duplicate prompt_id in prompt bank: {prompt_id}")
        seen_prompt_ids.add(prompt_id)
        entries.append(entry)

    return entries


def build_messages(spec: Dict) -> List[Dict[str, str]]:
    user_prompt = str(spec["user_prompt"]).strip()
    return [
        {"role": "system", "content": SYSTEM_PROMPT_HTML},
        {"role": "user", "content": user_prompt},
    ]
