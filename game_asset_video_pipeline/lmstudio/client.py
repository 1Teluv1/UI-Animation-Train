"""LM Studio (OpenAI-compatible) client for HTML animation generation."""

from __future__ import annotations

import re
import sys
import time
from typing import Any, Dict, List, Optional

import requests

from app.config import Settings, get_settings
from lmstudio.prompts import build_messages


class LMStudioGenerationError(RuntimeError):
    """Raised when LM Studio fails to return a valid HTML animation."""


_CODEBLOCK_RE = re.compile(r"```(?:html)?\s*\n(.*?)```", re.DOTALL | re.IGNORECASE)

_VERBOSE_ASSISTANT_PREVIEW_CHARS = 1_600


def _message_content_as_text(message: Dict[str, Any]) -> str:
    """Normalize OpenAI/LM Studio ``message.content`` (str or multimodal list) to plain text."""

    raw = message.get("content")
    if raw is None:
        return ""
    if isinstance(raw, str):
        return raw
    if isinstance(raw, list):
        pieces: List[str] = []
        for item in raw:
            if isinstance(item, dict):
                if item.get("type") == "text" and "text" in item:
                    pieces.append(str(item["text"]))
                elif "text" in item:
                    pieces.append(str(item["text"]))
            elif isinstance(item, str):
                pieces.append(item)
        return "".join(pieces)
    return str(raw)


def _print_inference_fields(
    *,
    data: Dict[str, Any],
    choice0: Dict[str, Any],
    content_text: str,
    cfg: Settings,
    attempt: int,
    max_retries: int,
    log_sample_id: Optional[str],
) -> None:
    """Emit a stable, grep-friendly block so Live Output always shows inference metadata."""

    rid = data.get("id")
    rmodel = data.get("model")
    print("[inference] ---------- chat/completions response ----------", file=sys.stderr, flush=True)
    if log_sample_id:
        print(f"[inference] sample_id: {log_sample_id}", file=sys.stderr, flush=True)
    print(f"[inference] attempt: {attempt}/{max_retries}", file=sys.stderr, flush=True)
    print(f"[inference] response_id: {rid!r}", file=sys.stderr, flush=True)
    print(f"[inference] response_model: {rmodel!r}", file=sys.stderr, flush=True)
    print(f"[inference] request_model: {cfg.lmstudio_model!r}", file=sys.stderr, flush=True)
    fr = choice0.get("finish_reason")
    print(f"[inference] finish_reason: {fr!r}", file=sys.stderr, flush=True)
    usage = data.get("usage")
    if isinstance(usage, dict):
        pt = usage.get("prompt_tokens")
        ct = usage.get("completion_tokens")
        tt = usage.get("total_tokens")
        print(
            f"[inference] usage: prompt_tokens={pt!r} completion_tokens={ct!r} total_tokens={tt!r}",
            file=sys.stderr,
            flush=True,
        )
        extra = {k: v for k, v in usage.items() if k not in ("prompt_tokens", "completion_tokens", "total_tokens")}
        if extra:
            print(f"[inference] usage_extra: {extra}", file=sys.stderr, flush=True)
    else:
        print(
            "[inference] usage: (없음 — 서버가 usage 필드를 보내지 않았을 수 있음 / LM Studio 버전에 따라 다름)",
            file=sys.stderr,
            flush=True,
        )
    msg = choice0.get("message")
    if not isinstance(msg, dict):
        msg = {}
    print(f"[inference] message_role: {msg.get('role')!r}", file=sys.stderr, flush=True)
    print(f"[inference] assistant_text_chars: {len(content_text)}", file=sys.stderr, flush=True)
    print(f"[inference] response_top_level_keys: {sorted(data.keys())}", file=sys.stderr, flush=True)


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
    log_sample_id: Optional[str] = None,
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

    if verbose:
        print(
            f"[inference] POST {url} (chat/completions)",
            file=sys.stderr,
            flush=True,
        )
        if log_sample_id:
            print(f"[inference] sample_id: {log_sample_id}", file=sys.stderr, flush=True)
        print(
            f"[lmstudio] payload: model={cfg.lmstudio_model!r} messages={len(payload['messages'])} "
            f"temperature={cfg.lmstudio_temperature} max_tokens={cfg.lmstudio_max_tokens} "
            f"timeout_s={cfg.lmstudio_timeout}",
            file=sys.stderr,
            flush=True,
        )

    last_error: Optional[str] = None
    for attempt in range(1, cfg.lmstudio_max_retries + 1):
        if verbose:
            print(f"[lmstudio] attempt {attempt}/{cfg.lmstudio_max_retries} …", file=sys.stderr, flush=True)
        try:
            resp = requests.post(url, json=payload, headers=headers, timeout=cfg.lmstudio_timeout)
            resp.raise_for_status()
            data = resp.json()
            choice0 = data["choices"][0]
            raw_msg = choice0.get("message")
            if not isinstance(raw_msg, dict):
                raw_msg = {}
            content = _message_content_as_text(raw_msg)
        except (requests.RequestException, KeyError, ValueError, TypeError) as exc:
            last_error = f"transport: {exc}"
            if verbose:
                print(
                    f"[lmstudio] attempt {attempt}/{cfg.lmstudio_max_retries} transport error: {exc}",
                    file=sys.stderr,
                    flush=True,
                )
            time.sleep(min(2 ** (attempt - 1), 8))
            continue

        if verbose:
            _print_inference_fields(
                data=data,
                choice0=choice0,
                content_text=content,
                cfg=cfg,
                attempt=attempt,
                max_retries=cfg.lmstudio_max_retries,
                log_sample_id=log_sample_id,
            )
            prev = _VERBOSE_ASSISTANT_PREVIEW_CHARS
            print(f"[lmstudio] assistant message preview (up to {prev} chars):", file=sys.stderr, flush=True)
            print(content[:prev], file=sys.stderr, flush=True)
            if len(content) > prev:
                print(
                    f"[lmstudio] … ({len(content) - prev} more chars in message)",
                    file=sys.stderr,
                    flush=True,
                )

        html = _extract_html(content)
        if verbose:
            print(
                f"[lmstudio] extracted HTML length: {len(html)} chars",
                file=sys.stderr,
                flush=True,
            )
        problem = _validate_html(html)
        if problem is None:
            if verbose:
                print("[lmstudio] HTML validation OK", file=sys.stderr, flush=True)
            return html

        last_error = f"validation: {problem}"
        if verbose:
            print(
                f"[lmstudio] attempt {attempt}/{cfg.lmstudio_max_retries} validation failed: {problem}",
                file=sys.stderr,
                flush=True,
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
