"""Verify what Gemini read against drug databases. Gemini reads the label; these decide what the drug is.

- FDA NDC Directory (openFDA): a printed NDC identifies the exact product, so ingredient AND strength are known.
- RxNorm (NLM RxNav): maps a brand/generic name to its active ingredients and lists the strengths that exist,
  so a misread strength (e.g. "500 mg" sertraline) is caught and a missing one can be picked from real options.

Both are free and keyless. Any network failure leaves the medication unverified instead of failing the scan.
"""
import logging
import re
from difflib import SequenceMatcher
from functools import lru_cache
from typing import Optional

import httpx

from .models import Medication

log = logging.getLogger("uvicorn.error")

RXNAV = "https://rxnav.nlm.nih.gov/REST"
OPENFDA_NDC = "https://api.fda.gov/drug/ndc.json"
UNVERIFIED_CONFIDENCE = 0.6  # below the UI's 0.7 "double-check" threshold
MIN_NAME_SIMILARITY = 0.8  # approximate search will happily match "Happy Pills" to "Happy Cappy"

_STRENGTH = re.compile(r"(\d+(?:\.\d+)?)\s*(MCG|MG|G|MEQ|UNT|%)(?:/(ML|HR|ACTUAT))?", re.I)


def _get(url: str, **params) -> dict:
    try:
        r = httpx.get(url, params=params, timeout=10)  # openFDA sometimes takes ~5 s
        r.raise_for_status()
        return r.json()
    except Exception:
        return {}


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9.]+", " ", s.lower()).strip()


def _norm_strength(s: str) -> str:
    return re.sub(r"\s+", "", s.lower()).replace("µg", "mcg")


@lru_cache(maxsize=512)
def match_rxcui(term: str) -> Optional[str]:
    """RxNorm concept for a printed name, only if the matched name is spelled close to what was read."""
    data = _get(f"{RXNAV}/approximateTerm.json", term=term, maxEntries=5)
    best, best_score = None, 0.0
    for c in data.get("approximateGroup", {}).get("candidate", []):
        if c.get("source") != "RXNORM" or not c.get("name"):
            continue
        score = SequenceMatcher(None, _norm(term), _norm(c["name"])).ratio()
        if score > best_score:
            best, best_score = c["rxcui"], score
    return best if best_score >= MIN_NAME_SIMILARITY else None


def _related(rxcui: str, tty: str) -> list[dict]:
    data = _get(f"{RXNAV}/rxcui/{rxcui}/related.json", tty=tty)
    return [p for g in data.get("relatedGroup", {}).get("conceptGroup", []) for p in g.get("conceptProperties", [])]


@lru_cache(maxsize=512)
def ingredients(rxcui: str) -> tuple[str, ...]:
    """Base active ingredients (e.g. Coumadin -> warfarin, Tylenol PM -> acetaminophen, diphenhydramine)."""
    return tuple(sorted({p["name"].lower() for p in _related(rxcui, "IN")}))


def _strength_of(drug_name: str) -> str:
    """'warfarin sodium 5 MG Oral Tablet' -> '5 mg'; combos join with ' / '."""
    parts = [f"{n} {u.lower()}" + (f"/{per.lower().replace('ml', 'mL')}" if per else "") for n, u, per in _STRENGTH.findall(drug_name)]
    return " / ".join(parts)


@lru_cache(maxsize=512)
def strength_options(ings: tuple[str, ...]) -> tuple[str, ...]:
    """Strengths that exist for this exact ingredient combination, oral forms preferred."""
    concepts = [match_rxcui(i) for i in ings]
    if not concepts or None in concepts:
        return ()
    drugs = [p["name"] for p in _related(concepts[0], "SCD")]
    # Same combination only: every ingredient present, and no extra ones (counted by " / ")
    drugs = [d for d in drugs if all(i in d.lower() for i in ings) and d.count(" / ") == len(ings) - 1]
    oral = [d for d in drugs if "oral" in d.lower() or "chewable" in d.lower()]
    found = {_strength_of(d) for d in (oral or drugs)}
    found.discard("")
    # Tablets/capsules first, then liquids (mg/mL), each in numeric order
    return tuple(sorted(found, key=lambda s: ("/" in s.replace(" / ", ""), [float(x) for x in re.findall(r"\d+(?:\.\d+)?", s)])))


@lru_cache(maxsize=256)
def lookup_ndc(ndc: str) -> Optional[dict]:
    """Exact product from a printed NDC. Accepts '0573-0134-20', '0573-0134' or 10 bare digits."""
    ndc = re.sub(r"[^\d-]", "", ndc)
    if ndc.count("-") == 2:
        query = f'packaging.package_ndc:"{ndc}"'
    elif ndc.count("-") == 1:
        query = f'product_ndc:"{ndc}"'
    elif len(ndc) == 10:  # barcode digits: try the three US NDC layouts
        splits = [(4, 8), (5, 8), (5, 9)]
        query = " OR ".join(f'packaging.package_ndc:"{ndc[:a]}-{ndc[a:b]}-{ndc[b:]}"' for a, b in splits)
    else:
        return None
    results = _get(OPENFDA_NDC, search=query, limit=1).get("results")
    if not results:
        return None
    p = results[0]
    rxcuis = p.get("openfda", {}).get("rxcui", [])
    ings = ingredients(rxcuis[0]) if rxcuis else ()
    if not ings:  # fall back to the label's generic name
        rx = match_rxcui(p.get("generic_name", ""))
        ings = ingredients(rx) if rx else ()
    strength = " / ".join(re.sub(r"/1$", "", a["strength"]) for a in p.get("active_ingredients", []) if a.get("strength"))
    return {"ingredients": ings, "strength": strength, "rxcui": rxcuis[0] if rxcuis else None}


def verify(med: Medication) -> Medication:
    """Fill ingredient/strength from databases and mark how far the read could be verified."""
    rxcui = next((rx for t in (med.name, med.ingredient) if t and (rx := match_rxcui(t))), None)
    ings = ingredients(rxcui) if rxcui else ()

    product = lookup_ndc(med.ndc) if med.ndc else None
    # A misread NDC points at a different drug; only trust it if it agrees with the name (or the name didn't match).
    use_ndc = bool(product and product["ingredients"] and (not ings or set(product["ingredients"]) == set(ings)))
    if use_ndc:
        ings, rxcui = product["ingredients"], product["rxcui"] or rxcui

    if ings:
        med.rxcui = rxcui
        med.ingredient = " / ".join(ings)
        med.verified_by = "FDA NDC Directory" if use_ndc else "RxNorm"
        options = list(strength_options(ings))
        if use_ndc and product["strength"]:
            # Fill a missing strength, but never overwrite a printed one: the FDA lists salt amounts
            # (Advil = "256 mg" ibuprofen sodium) where the box prints "200 mg".
            options = [product["strength"]] + [s for s in options if s != product["strength"]]
            med.strength = med.strength or product["strength"]
        med.strength_options = options
        med.strength_verified = bool(med.strength) and _norm_strength(med.strength) in {_norm_strength(s) for s in options}

    if not med.verified_by or not med.strength_verified:
        med.confidence = min(med.confidence, UNVERIFIED_CONFIDENCE)
    log.info("verify %r ndc=%s -> by=%s rxcui=%s ingredient=%s strength=%s ok=%s confidence=%s options=%s",
             med.name, med.ndc, med.verified_by, med.rxcui, med.ingredient, med.strength,
             med.strength_verified, med.confidence, med.strength_options)
    return med
