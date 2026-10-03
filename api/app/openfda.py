"""openFDA drug label client.

- Looks up the FDA label for a generic ingredient (e.g. "warfarin") and returns its sections as text.
- Handles: no match (404, cached so we don't ask again), rate limits (429, one short retry, never cached),
  and network failures (never cached, callers fall back to built-in rules).
- Caches successful lookups in memory and on disk (LABEL_CACHE_DIR), so repeat checks and the demo
  don't depend on venue Wi-Fi or rate limits. Warm the cache before demoing with check_openfda.py.

Rate limits (per openFDA docs): without a key, 240 requests/minute and 1,000/day per IP.
With a free key (OPENFDA_API_KEY), the daily limit is much higher.
"""
from __future__ import annotations

import json
import os
import re
import threading
import time
from pathlib import Path
from typing import Optional

import httpx
from dotenv import load_dotenv

load_dotenv()

BASE_URL = "https://api.fda.gov/drug/label.json"
API_KEY = os.getenv("OPENFDA_API_KEY", "")
TIMEOUT = 10.0
CACHE_DIR = Path(os.getenv("LABEL_CACHE_DIR", Path(__file__).resolve().parent.parent / ".label_cache"))
CACHE_MAX_AGE = 7 * 24 * 3600  # labels rarely change; a week is plenty

# Label sections we keep (openFDA field -> human name used in citations)
SECTION_NAMES = {
    "boxed_warning": "Boxed Warning",
    "contraindications": "Contraindications",
    "drug_interactions": "Drug Interactions",
    "warnings_and_cautions": "Warnings and Precautions",
    "warnings": "Warnings",
    "precautions": "Precautions",
    "do_not_use": "Do Not Use",
    "ask_doctor": "Ask a Doctor Before Use",
    "ask_doctor_or_pharmacist": "Ask a Doctor or Pharmacist Before Use",
    "stop_use": "Stop Use",
    "when_using": "When Using This Product",
    "dosage_and_administration": "Dosage and Administration",
    "directions": "Directions",
    "information_for_patients": "Information for Patients",
    "patient_counseling_information": "Patient Counseling Information",
}
MAX_SECTION_CHARS = 12000


class RateLimited(Exception):
    pass


class LabelUnavailable(Exception):
    """Network error, server error, or rate limit: try again later, use fallback rules for now."""


_memory: dict[str, dict] = {}
_lock = threading.Lock()


def _cache_path(ingredient: str) -> Path:
    return CACHE_DIR / (re.sub(r"[^a-z0-9]+", "_", ingredient.lower()).strip("_") + ".json")


def _read_disk(ingredient: str) -> Optional[dict]:
    p = _cache_path(ingredient)
    try:
        if p.exists() and time.time() - p.stat().st_mtime < CACHE_MAX_AGE:
            return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        pass
    return None


def _write_disk(ingredient: str, data: dict) -> None:
    try:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        _cache_path(ingredient).write_text(json.dumps(data), encoding="utf-8")
    except Exception:
        pass  # read-only filesystem etc.: memory cache still works


def _request(search: str, limit: int = 5) -> list[dict]:
    """Returns results, [] for no match. Raises RateLimited / LabelUnavailable."""
    params = {"search": search, "limit": limit}
    if API_KEY:
        params["api_key"] = API_KEY
    for attempt in range(2):
        try:
            r = httpx.get(BASE_URL, params=params, timeout=TIMEOUT)
        except httpx.HTTPError as e:
            raise LabelUnavailable(f"network error: {e}") from e
        if r.status_code == 404:
            return []  # openFDA uses 404 for "no matches"
        if r.status_code == 429:
            if attempt == 0:
                wait = min(float(r.headers.get("Retry-After", "1") or 1), 3.0)
                time.sleep(wait)
                continue
            raise RateLimited("openFDA rate limit reached (add OPENFDA_API_KEY for higher limits)")
        if r.status_code >= 400:
            raise LabelUnavailable(f"openFDA error {r.status_code}")
        return r.json().get("results", [])
    raise RateLimited("openFDA rate limit reached")


def _score(doc: dict, ingredient: str) -> int:
    """Prefer single-ingredient labels for this exact ingredient that have interaction text."""
    of = doc.get("openfda") or {}
    generics = [g.lower() for g in of.get("generic_name", [])]
    score = 0
    if any(g == ingredient or g.startswith(ingredient + " ") for g in generics):
        score += 4
    if any(" and " in g or "," in g for g in generics):
        score -= 3  # combination product
    if doc.get("drug_interactions"):
        score += 2
    if doc.get("contraindications") or doc.get("boxed_warning"):
        score += 1
    if doc.get("do_not_use") or doc.get("ask_doctor_or_pharmacist"):
        score += 1  # OTC labels carry their interaction warnings here
    if not of:
        score -= 2
    return score


def _to_label(doc: dict, ingredient: str) -> dict:
    of = doc.get("openfda") or {}
    set_id = doc.get("set_id") or (of.get("spl_set_id") or [None])[0]
    sections = {}
    for key in SECTION_NAMES:
        text = " ".join(doc.get(key) or []).strip()
        if text:
            sections[key] = text[:MAX_SECTION_CHARS]
    return {
        "found": True,
        "ingredient": ingredient,
        "brand": (of.get("brand_name") or [None])[0],
        "generic": (of.get("generic_name") or [ingredient])[0],
        "set_id": set_id,
        "effective_time": doc.get("effective_time"),
        # DailyMed is the public, human-readable copy of the same label
        "source_url": f"https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid={set_id}" if set_id else None,
        "sections": sections,
    }


def get_label(ingredient: str) -> dict:
    """Label for one generic ingredient. Returns {"found": False, ...} when openFDA has no match.
    Raises LabelUnavailable / RateLimited when it can't be checked right now."""
    ing = ingredient.lower().strip()
    if not ing:
        return {"found": False, "ingredient": ing, "reason": "empty"}
    with _lock:
        if ing in _memory:
            return _memory[ing]
    cached = _read_disk(ing)
    if cached is not None:
        with _lock:
            _memory[ing] = cached
        return cached

    quoted = ing.replace('"', "")
    results: list[dict] = []
    for field in ("openfda.generic_name", "openfda.substance_name", "openfda.brand_name"):
        results = _request(f'{field}:"{quoted}"')
        if results:
            break
    if not results:
        data = {"found": False, "ingredient": ing, "reason": "no_match"}
    else:
        best = max(results, key=lambda d: _score(d, ing))
        data = _to_label(best, ing)

    with _lock:
        _memory[ing] = data
    _write_disk(ing, data)
    return data


def clear_memory_cache() -> None:
    with _lock:
        _memory.clear()