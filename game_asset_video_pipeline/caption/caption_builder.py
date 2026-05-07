"""Caption builder for the dataset metadata.

The caption template (from Implementation_plan §7) is:

    [{ASSET_TYPE}] A {style} {subject} {motion_description}.
    The animation is {timing}, centered, and designed for game UI usage.
"""

from __future__ import annotations

from typing import Dict

from lmstudio.prompts import MOTION_DESCRIPTION, MOTION_TIMING


class CaptionValidationError(ValueError):
    """Raised when the produced caption is shorter than the minimum allowed length."""


MIN_CAPTION_LENGTH = 60


def build_caption(spec: Dict) -> str:
    asset_type = spec["asset_type"]
    subject = spec["subject"].strip()
    style = spec.get("style", "polished cartoon game UI").strip()
    motion_preset = spec.get("motion_preset")

    motion_desc = (
        spec.get("motion_description")
        or spec.get("motion")
        or MOTION_DESCRIPTION.get(motion_preset, "performs a clean motion")
    ).strip().rstrip(".")
    timing = spec.get("timing", MOTION_TIMING.get(motion_preset, "smooth")).strip()

    caption = (
        f"[{asset_type.upper()}] A {style} {subject} {motion_desc}. "
        f"The animation is {timing}, centered, and designed for game UI usage."
    )

    if len(caption) < MIN_CAPTION_LENGTH:
        raise CaptionValidationError(
            f"caption too short ({len(caption)} chars < {MIN_CAPTION_LENGTH}): {caption!r}"
        )
    return caption
