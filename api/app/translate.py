"""Translates app interface text into the language the person picked (any language Gemini knows).

The frontend sends English UI strings in batches; results are cached here and on the device,
so each string is only translated once per language.
"""
from __future__ import annotations

import threading

from . import gemini

_cache: dict[tuple[str, str], str] = {}
_lock = threading.Lock()

PROMPT = """You translate the interface of a medication-safety app called Pocket Apothecary.
Translate each English string below into {language}.
Rules:
- Keep the same order and return exactly {n} strings.
- Keep medicine names, brand names, numbers, doses, units (mg, mL), times, and symbols (✓ → ×) unchanged.
- Use short, plain, friendly wording suitable for older adults and caregivers.
- Keep the person's names unchanged.
Strings (JSON):
{strings}"""


def translate_texts(language: str, texts: list[str]) -> list[str]:
    lang = language.strip()
    if not texts or lang.lower() in ("english", "en", ""):
        return texts
    with _lock:
        missing = [t for t in dict.fromkeys(texts) if (lang, t) not in _cache]
    if missing and not gemini.mock_mode():
        import json

        from google.genai import types

        for i in range(0, len(missing), 80):
            chunk = missing[i : i + 80]
            resp = gemini._get_client().models.generate_content(
                model=gemini.MODEL,
                contents=PROMPT.format(language=lang, n=len(chunk), strings=json.dumps(chunk, ensure_ascii=False)),
                config=types.GenerateContentConfig(response_mime_type="application/json", response_schema=list[str], temperature=0),
            )
            out = resp.parsed if isinstance(resp.parsed, list) else []
            if len(out) != len(chunk):
                continue  # model returned the wrong count: leave these in English rather than misalign
            with _lock:
                for src, dst in zip(chunk, out):
                    _cache[(lang, src)] = str(dst)
    with _lock:
        return [_cache.get((lang, t), t) for t in texts]