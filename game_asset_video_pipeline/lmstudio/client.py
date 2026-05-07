"""LM Studio (OpenAI-compatible) client for HTML animation generation."""

from __future__ import annotations

import re
import sys
import time
from typing import Dict, Optional

import requests

from app.config import Settings, get_settings
from lmstudio.prompts import build_messages


class LMStudioGenerationError(RuntimeError):
    """Raised when LM Studio fails to return a valid HTML animation."""


_CODEBLOCK_RE = re.compile(r"```(?:html)?\s*\n(.*?)```", re.DOTALL | re.IGNORECASE)


def _extract_html(raw: str) -> str:
    """Pull the HTML out of a code block if present, else return raw stripped."""

    match = _CODEBLOCK_RE.search(raw)
    if match:
        return match.group(1).strip()
    return raw.strip()


def _validate_html(html: str) -> Optional[str]:
    """Lightweight structural validation. Returns an error string on failure."""

    if "<html" not in html.lower():
        return "missing <html> tag"
    if "</html>" not in html.lower():
        return "missing </html> tag"
    has_style = "<style" in html.lower()
    has_script = "<script" in html.lower()
    has_svg_anim = "<animate" in html.lower() or "animatetransform" in html.lower()
    if not (has_style or has_script or has_svg_anim):
        return "no <style>, <script>, or SVG animation found"
    if len(html) < 400:
        return f"html too short ({len(html)} chars)"
    return None


def generate_html_animation(
    spec: Dict,
    settings: Optional[Settings] = None,
    *,
    verbose: bool = False,
) -> str:
    """Call LM Studio chat completions and return validated HTML.

    Retries up to ``settings.lmstudio_max_retries`` on network or validation
    failures. Raises :class:`LMStudioGenerationError` on permanent failure.
    """

    cfg = settings or get_settings()
    url = cfg.lmstudio_base_url.rstrip("/") + "/chat/completions"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {cfg.lmstudio_api_key}",
    }
    payload = {
        "model": cfg.lmstudio_model,
        "messages": build_messages(spec),
        "temperature": cfg.lmstudio_temperature,
        "max_tokens": cfg.lmstudio_max_tokens,
        "stream": False,
    }

    last_error: Optional[str] = None
    for attempt in range(1, cfg.lmstudio_max_retries + 1):
        try:
            resp = requests.post(url, json=payload, headers=headers, timeout=cfg.lmstudio_timeout)
            resp.raise_for_status()
            data = resp.json()
            content = data["choices"][0]["message"]["content"]
        except (requests.RequestException, KeyError, ValueError) as exc:
            last_error = f"transport: {exc}"
            if verbose:
                print(
                    f"[lmstudio] attempt {attempt}/{cfg.lmstudio_max_retries} transport error: {exc}",
                    file=sys.stderr,
                )
            time.sleep(min(2 ** (attempt - 1), 8))
            continue

        html = _extract_html(content)
        problem = _validate_html(html)
        if problem is None:
            return html

        last_error = f"validation: {problem}"
        if verbose:
            print(
                f"[lmstudio] attempt {attempt}/{cfg.lmstudio_max_retries} validation failed: {problem}",
                file=sys.stderr,
            )
        time.sleep(0.5)

    raise LMStudioGenerationError(
        f"failed to generate valid HTML after {cfg.lmstudio_max_retries} attempts; last_error={last_error}"
    )


def ping(settings: Optional[Settings] = None, *, verbose: bool = False) -> bool:
    """Best-effort liveness check against LM Studio's /models endpoint."""

    cfg = settings or get_settings()
    url = cfg.lmstudio_base_url.rstrip("/") + "/models"
    try:
        resp = requests.get(
            url,
            headers={"Authorization": f"Bearer {cfg.lmstudio_api_key}"},
            timeout=5.0,
        )
        return resp.status_code == 200
    except requests.RequestException as exc:
        if verbose:
            print(f"[lmstudio] ping failed: {exc}", file=sys.stderr)
        return False
