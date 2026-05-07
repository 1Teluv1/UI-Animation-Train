"""Prompt builders and spec-grid generator for HTML animation requests."""

from __future__ import annotations

import random
from dataclasses import dataclass
from typing import Dict, List, Sequence

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

# Subject pools per category. Kept small/curated so the resulting captions stay
# coherent with the asset_type tag.
_SUBJECT_POOLS: Dict[str, List[str]] = {
    "ui_reward": [
        "gold coin icon",
        "blue gem icon",
        "ruby crystal icon",
        "treasure chest icon",
        "star badge icon",
        "trophy icon",
        "diamond icon",
        "level up banner icon",
    ],
    "emoji_motion": [
        "smiling yellow emoji",
        "winking emoji",
        "laughing emoji",
        "heart eyes emoji",
        "sleepy emoji",
        "fire emoji",
        "thumbs up emoji",
        "party popper emoji",
    ],
    "game_vfx": [
        "blue magic burst",
        "fire impact ring",
        "lightning shock",
        "energy shockwave",
        "ice crystal burst",
        "smoke puff",
        "holy light pillar",
        "shadow swirl",
    ],
    "item_showcase": [
        "legendary sword icon",
        "magic potion bottle",
        "spell book icon",
        "wooden shield",
        "armor helmet icon",
        "rune stone",
        "crossbow icon",
        "magic wand icon",
    ],
    "button_motion": [
        "green play button",
        "red close button",
        "blue confirm button",
        "yellow upgrade button",
        "orange shop button",
        "purple settings button",
        "white pause button",
        "gold premium button",
    ],
}

_STYLE_BY_CATEGORY: Dict[str, str] = {
    "ui_reward": "polished mobile game UI icon, cartoon, glossy",
    "emoji_motion": "cute cartoon emoji, smooth flat shading",
    "game_vfx": "stylized cartoon VFX, vibrant colors, rim glow",
    "item_showcase": "high quality game item icon, crisp outline, painterly",
    "button_motion": "clean mobile UI button, soft shadow, modern",
}

_BACKGROUND_CHOICES: List[str] = [
    "solid dark background",
    "solid charcoal background",
    "solid navy background",
    "solid deep purple background",
]

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


SYSTEM_PROMPT = """You are an expert front-end engineer who writes self-contained HTML animation files for a game UI dataset.

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


def build_user_prompt(spec: Dict) -> str:
    """Render a spec dict into a natural-language user prompt for the LLM."""

    motion_preset = spec.get("motion_preset")
    motion_description = spec.get("motion") or MOTION_DESCRIPTION.get(
        motion_preset, "performs a clean, looping motion"
    )
    duration = float(spec.get("duration", 2.0))
    resolution = int(spec.get("resolution", 512))
    fps = int(spec.get("fps", 24))

    return (
        "Generate a single self-contained HTML animation that meets ALL of the system rules.\n\n"
        f"- asset_type: {spec['asset_type']}\n"
        f"- subject: {spec['subject']}\n"
        f"- motion_preset: {motion_preset}\n"
        f"- motion description: {motion_description}\n"
        f"- style: {spec.get('style', _STYLE_BY_CATEGORY.get(spec['asset_type'], 'cartoon game UI'))}\n"
        f"- background: {spec.get('background', 'solid dark background')}\n"
        f"- canvas size: {resolution}x{resolution} px\n"
        f"- duration: {duration} seconds\n"
        f"- target fps: {fps}\n\n"
        "Important: the animation MUST visibly move and complete within the duration. "
        "Center the subject. No external resources. No text overlays. Output ONLY the HTML."
    )


def build_messages(spec: Dict) -> List[Dict[str, str]]:
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": build_user_prompt(spec)},
    ]


@dataclass
class SpecGridConfig:
    category: str
    count: int
    seed: int = 0
    duration: float = 2.0
    fps: int = 24
    resolution: int = 512


def build_spec_grid(
    category: str,
    count: int,
    seed: int = 0,
    duration: float = 2.0,
    fps: int = 24,
    resolution: int = 512,
) -> List[Dict]:
    """Generate `count` spec dicts for a given category.

    Subjects and motion presets are sampled deterministically from the pools so
    runs with the same `seed` reproduce the same dataset.
    """

    if category not in _SUBJECT_POOLS:
        raise ValueError(
            f"Unknown category '{category}'. Allowed: {sorted(_SUBJECT_POOLS)}"
        )

    rng = random.Random(seed)
    subjects = _SUBJECT_POOLS[category]
    style = _STYLE_BY_CATEGORY[category]

    specs: List[Dict] = []
    for _ in range(count):
        subject = rng.choice(subjects)
        motion_preset = rng.choice(list(MOTION_PRESETS))
        background = rng.choice(_BACKGROUND_CHOICES)
        specs.append(
            {
                "asset_type": category,
                "subject": subject,
                "motion_preset": motion_preset,
                "motion": MOTION_DESCRIPTION[motion_preset],
                "style": style,
                "background": background,
                "duration": duration,
                "fps": fps,
                "resolution": resolution,
            }
        )
    return specs
