"""HTML asset generation: LM Studio first, fallback to bundled templates."""

from __future__ import annotations

import hashlib
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Optional, Tuple

from app.config import Settings, get_settings
from lmstudio.client import LMStudioGenerationError, generate_html_animation

TEMPLATES_DIR = Path(__file__).resolve().parent / "templates"

# Curated palette per asset_type. Used by the fallback templates AND remembered
# in the saved HTML so the rendered video has consistent coloring across runs.
_PALETTE: Dict[str, Dict[str, str]] = {
    "ui_reward":     {"primary": "#ffcc33", "accent": "#fff5b8"},
    "emoji_motion":  {"primary": "#ffd23f", "accent": "#fff2a8"},
    "game_vfx":      {"primary": "#3aa0ff", "accent": "#a8e1ff"},
    "item_showcase": {"primary": "#9b6bff", "accent": "#d6c0ff"},
    "button_motion": {"primary": "#28b463", "accent": "#7be0a3"},
}

_BG_COLORS: Dict[str, str] = {
    "solid dark background":         "#0a0a14",
    "solid charcoal background":     "#1c1c22",
    "solid navy background":         "#0a1224",
    "solid deep purple background":  "#160826",
}

_SLUG_RE = re.compile(r"[^a-z0-9]+")


def slugify(text: str) -> str:
    return _SLUG_RE.sub("_", text.lower()).strip("_")[:48] or "asset"


def make_sample_id(spec: Dict, index: int) -> str:
    asset = spec["asset_type"]
    subj = slugify(spec["subject"])
    return f"{asset}_{subj}_{index:04d}"


@dataclass
class GeneratedHTML:
    sample_id: str
    html_path: Path
    used_fallback: bool


def _resolve_bg(spec: Dict) -> str:
    name = spec.get("background", "solid dark background")
    if name in _BG_COLORS:
        return _BG_COLORS[name]
    if name.startswith("#") and len(name) in (4, 7):
        return name
    return _BG_COLORS["solid dark background"]


def _render_template(spec: Dict) -> str:
    asset_type = spec["asset_type"]
    template_path = TEMPLATES_DIR / f"{asset_type}.html"
    if not template_path.exists():
        raise FileNotFoundError(f"no fallback template for asset_type={asset_type}")

    palette = _PALETTE.get(asset_type, _PALETTE["ui_reward"])
    duration_s = float(spec.get("duration", 2.0))

    html = template_path.read_text(encoding="utf-8")
    replacements = {
        "__BG_COLOR__":    _resolve_bg(spec),
        "__PRIMARY__":     palette["primary"],
        "__ACCENT__":      palette["accent"],
        "__DURATION_S__":  f"{duration_s:.3f}s",
        "__DURATION_MS__": f"{int(round(duration_s * 1000))}",
    }
    for key, value in replacements.items():
        html = html.replace(key, value)
    return html


def _validate_external_refs(html: str) -> Optional[str]:
    """Reject HTML that pulls remote resources (rule violation)."""

    lowered = html.lower()
    forbidden = ("http://", "https://", "//cdn", "<iframe", "<video", "<audio", "fetch(")
    for needle in forbidden:
        if needle in lowered:
            # Allow only schema URIs that are meta-only (xmlns declarations).
            if needle in ("http://", "https://"):
                idx = 0
                while True:
                    pos = lowered.find(needle, idx)
                    if pos == -1:
                        break
                    surrounding = lowered[max(0, pos - 20): pos + len(needle) + 20]
                    if "xmlns" in surrounding or "w3.org" in surrounding:
                        idx = pos + len(needle)
                        continue
                    return f"external reference: {needle}"
                continue
            return f"forbidden tag: {needle}"
    return None


def generate_for_spec(
    spec: Dict,
    index: int,
    settings: Optional[Settings] = None,
    *,
    use_llm: bool = True,
    verbose: bool = False,
) -> GeneratedHTML:
    """Generate (or render-from-template) the HTML file for a single spec."""

    cfg = settings or get_settings()
    cfg.ensure_dirs()
    sample_id = make_sample_id(spec, index)
    out_path = cfg.html_dir / f"{sample_id}.html"

    used_fallback = False
    html: Optional[str] = None
    if use_llm:
        try:
            html = generate_html_animation(spec, cfg, verbose=verbose)
            problem = _validate_external_refs(html)
            if problem is not None:
                if verbose:
                    print(
                        f"[html_generator] LLM output rejected ({problem}); falling back to template",
                        file=sys.stderr,
                    )
                html = None
        except LMStudioGenerationError as exc:
            if verbose:
                print(f"[html_generator] LLM failed: {exc}; falling back to template", file=sys.stderr)
            html = None

    if html is None:
        html = _render_template(spec)
        used_fallback = True

    out_path.write_text(html, encoding="utf-8")
    return GeneratedHTML(sample_id=sample_id, html_path=out_path, used_fallback=used_fallback)


def html_content_hash(path: Path) -> str:
    return hashlib.sha1(path.read_bytes()).hexdigest()[:12]


def list_templates() -> Tuple[str, ...]:
    return tuple(sorted(p.stem for p in TEMPLATES_DIR.glob("*.html")))
