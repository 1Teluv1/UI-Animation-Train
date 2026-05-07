"""HTML asset generation using LM Studio only."""

from __future__ import annotations

import hashlib
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Optional

from app.config import Settings, get_settings
from lmstudio.client import LMStudioGenerationError, generate_html_animation

# Max characters of final HTML echoed to stderr when ``verbose=True`` (UI live log).
_VERBOSE_HTML_MAX_CHARS = 14_000


def _log_html_to_stderr(label: str, html: str, *, max_chars: int = _VERBOSE_HTML_MAX_CHARS) -> None:
    n = len(html)
    print(f"[html] --- {label} ({n} chars) ---", file=sys.stderr, flush=True)
    if n <= max_chars:
        print(html, file=sys.stderr, flush=True)
    else:
        print(html[:max_chars], file=sys.stderr, flush=True)
        print(f"[html] ... truncated for log ({n - max_chars} more chars)", file=sys.stderr, flush=True)

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
    verbose: bool = False,
) -> GeneratedHTML:
    """Generate the HTML file for a single spec via LM Studio."""

    cfg = settings or get_settings()
    cfg.ensure_dirs()
    sample_id = make_sample_id(spec, index)
    out_path = cfg.html_dir / f"{sample_id}.html"

    if verbose:
        spec_keys = ("asset_type", "subject", "motion_preset", "motion", "style", "background", "duration")
        mini = {k: spec.get(k) for k in spec_keys if k in spec}
        print(
            f"[html_generator] build sample_id={sample_id} spec={json.dumps(mini, ensure_ascii=False)}",
                file=sys.stderr,
                flush=True,
            )

    try:
        html = generate_html_animation(spec, cfg, verbose=verbose, log_sample_id=sample_id)
    except LMStudioGenerationError as exc:
        raise RuntimeError(f"LM Studio generation failed for {sample_id}: {exc}") from exc

    problem = _validate_external_refs(html)
    if problem is not None:
        raise RuntimeError(f"LLM output rejected for {sample_id}: {problem}")

    out_path.write_text(html, encoding="utf-8")
    if verbose:
        print(
            f"[html_generator] wrote {out_path} source=prompt_bank",
            file=sys.stderr,
            flush=True,
        )
        _log_html_to_stderr(f"{sample_id} (prompt_bank)", html)
    return GeneratedHTML(sample_id=sample_id, html_path=out_path)


def html_content_hash(path: Path) -> str:
    return hashlib.sha1(path.read_bytes()).hexdigest()[:12]


