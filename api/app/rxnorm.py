"""Drug name normalization: any brand, generic, or misspelled name -> generic ingredient(s).

Order of lookup:
  1. Local brand table (instant, works offline, keeps the demo reliable)
  2. NLM RxNav approximate match (free, no API key) -> ingredient concepts
  3. Fallback: the cleaned name itself (marked source="fallback")

"Coumadin", "coumadin 5mg", "COUMADIN 5 MG TABLET", "cumadin", and "warfarin" all -> ["warfarin"].
"""
import re
from functools import lru_cache

import httpx

RXNAV = "https://rxnav.nlm.nih.gov/REST"
TIMEOUT = 6.0

LOCAL_BRANDS: dict[str, list[str]] = {
    "coumadin": ["warfarin"], "jantoven": ["warfarin"],
    "tylenol": ["acetaminophen"], "panadol": ["acetaminophen"],
    "advil": ["ibuprofen"], "motrin": ["ibuprofen"],
    "aleve": ["naproxen"], "naprosyn": ["naproxen"],
    "bayer": ["aspirin"], "ecotrin": ["aspirin"],
    "zestril": ["lisinopril"], "prinivil": ["lisinopril"],
    "zoloft": ["sertraline"], "ultram": ["tramadol"],
    "synthroid": ["levothyroxine"], "levoxyl": ["levothyroxine"], "unithroid": ["levothyroxine"],
    "cipro": ["ciprofloxacin"], "levaquin": ["levofloxacin"],
    "tums": ["calcium carbonate"], "os-cal": ["calcium carbonate"], "caltrate": ["calcium carbonate"],
    "glucophage": ["metformin"], "lipitor": ["atorvastatin"], "zocor": ["simvastatin"],
    "amoxil": ["amoxicillin"], "plavix": ["clopidogrel"], "eliquis": ["apixaban"], "xarelto": ["rivaroxaban"],
    "prilosec": ["omeprazole"], "nexium": ["esomeprazole"], "lasix": ["furosemide"], "norvasc": ["amlodipine"],
}
KNOWN_GENERICS = {g for gs in LOCAL_BRANDS.values() for g in gs} | {"iron", "ferrous sulfate", "magnesium", "doxycycline"}

_NOISE = re.compile(
    r"""
    \b\d+(?:\.\d+)?\s*(?:mg|mcg|µg|g|ml|iu|units?|%)(?=\W|$)   # strengths: 5mg, 5 mg, 0.5%
    | \b\d+(?:\.\d+)?\b                                       # stray numbers
    | \b(?:tablets?|tabs?|capsules?|caps?|caplets?|softgels?|gelcaps?|liqui-?gels?|oral|solution|
         suspension|liquid|chewables?|film|coated|extended|delayed|release|er|xr|sr|dr|hcl|
         hydrochloride|sodium|potassium|generic|brand|usp|rx|otc|strength|extra|maximum|regular)\b
    """,
    re.X | re.I,
)


def clean(name: str) -> str:
    s = name.lower().replace("®", " ").replace("™", " ")
    s = _NOISE.sub(" ", s)
    s = re.sub(r"[^a-z\s\-]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def _get(path: str, params: dict | None = None) -> dict:
    r = httpx.get(f"{RXNAV}/{path}", params=params or {}, timeout=TIMEOUT)
    r.raise_for_status()
    return r.json()


def _ingredients_for_rxcui(rxcui: str) -> list[str]:
    props = _get(f"rxcui/{rxcui}/properties.json").get("properties") or {}
    if props.get("tty") == "IN" and props.get("name"):
        return [props["name"].lower()]
    data = _get(f"rxcui/{rxcui}/related.json", {"tty": "IN"})
    groups = (data.get("relatedGroup") or {}).get("conceptGroup") or []
    return sorted({c["name"].lower() for g in groups for c in (g.get("conceptProperties") or []) if c.get("name")})


@lru_cache(maxsize=2048)
def _rxnav_lookup(term: str) -> tuple[str | None, tuple[str, ...]]:
    """Raises on network errors (so failures are not cached)."""
    data = _get("approximateTerm.json", {"term": term, "maxEntries": 5})
    candidates = (data.get("approximateGroup") or {}).get("candidate") or []
    seen: set[str] = set()
    for c in sorted(candidates, key=lambda c: int(c.get("rank") or 99)):
        rxcui = c.get("rxcui")
        if not rxcui or rxcui in seen:
            continue
        seen.add(rxcui)
        ings = _ingredients_for_rxcui(rxcui)
        if ings:
            return rxcui, tuple(ings)
        if len(seen) >= 3:
            break
    return None, ()


def normalize(name: str) -> dict:
    cleaned = clean(name)
    out = {"input": name, "cleaned": cleaned, "ingredients": [], "rxcui": None, "source": "none"}
    if not cleaned:
        return out

    words = cleaned.split()
    for key in (cleaned, words[0], "-".join(words[:2])):
        if key in LOCAL_BRANDS:
            return {**out, "ingredients": LOCAL_BRANDS[key], "source": "local"}
    if cleaned in KNOWN_GENERICS:
        return {**out, "ingredients": [cleaned], "source": "local"}

    try:
        rxcui, ings = _rxnav_lookup(cleaned)
        if ings:
            return {**out, "ingredients": list(ings), "rxcui": rxcui, "source": "rxnorm"}
    except Exception:
        pass  # offline or RxNav down: fall through
    return {**out, "ingredients": [cleaned], "source": "fallback"}