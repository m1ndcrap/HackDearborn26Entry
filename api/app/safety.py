"""Safety checks. Deterministic rules decide WHAT is flagged; Gemini only explains.

DEMO_RULES is a tiny hand-written table so the app works end to end on day one.
Next step: replace/extend it with openFDA label lookups (see fetch_label_section) and RxNorm normalization.
"""
from functools import lru_cache
from itertools import combinations

import httpx

from .models import Medication, Profile, SafetyFlag, SafetyReport

BRAND_TO_INGREDIENT = {
    "tylenol": "acetaminophen", "advil": "ibuprofen", "motrin": "ibuprofen", "aleve": "naproxen",
    "coumadin": "warfarin", "zestril": "lisinopril", "zoloft": "sertraline", "ultram": "tramadol",
    "bayer": "aspirin", "amoxil": "amoxicillin",
}

ALLERGY_CLASSES = {
    "penicillin": {"penicillin", "amoxicillin", "ampicillin"},
    "nsaid": {"ibuprofen", "naproxen", "aspirin"},
    "sulfa": {"sulfamethoxazole"},
}

NSAIDS = {"ibuprofen", "naproxen", "aspirin"}

# (group A, group B, severity, title, detail): flagged when one drug is in A and the other in B
DEMO_RULES = [
    ({"warfarin"}, NSAIDS, "high", "Higher bleeding risk",
     "Warfarin together with NSAIDs or aspirin can raise the risk of serious bleeding."),
    ({"sertraline"}, {"tramadol"}, "high", "Serotonin syndrome risk",
     "Sertraline with tramadol can cause dangerously high serotonin levels."),
    ({"lisinopril"}, NSAIDS, "caution", "May reduce effect and strain kidneys",
     "NSAIDs can weaken lisinopril's blood pressure effect and add stress on the kidneys."),
]

CONDITION_RULES = {
    "kidney disease": (NSAIDS, "NSAIDs can worsen kidney problems."),
    "stomach ulcer": (NSAIDS, "NSAIDs can irritate the stomach lining and cause bleeding."),
}


def ingredient_of(med: Medication) -> str:
    if med.ingredient:
        return med.ingredient.lower().strip()
    key = med.name.lower().strip().split()[0]
    return BRAND_TO_INGREDIENT.get(key, key)


def _flag(i: int, severity, kind, title, drugs, detail, source) -> SafetyFlag:
    return SafetyFlag(id=f"f{i}", severity=severity, kind=kind, title=title, drugs=drugs, detail=detail, source=source)


def build_report(profile: Profile, meds: list[Medication]) -> SafetyReport:
    flags: list[SafetyFlag] = []
    n = 0
    ings = {m.name: ingredient_of(m) for m in meds}
    src = "Demo rules (replace with FDA label lookup)"

    for (na, a), (nb, b) in combinations(ings.items(), 2):
        if a == b:
            n += 1
            flags.append(_flag(n, "caution", "duplicate", "Possible duplicate medicine", [na, nb],
                               f"{na} and {nb} both contain {a}. Taking both can mean taking too much.", src))
            continue
        for ga, gb, sev, title, detail in DEMO_RULES:
            if (a in ga and b in gb) or (a in gb and b in ga):
                n += 1
                flags.append(_flag(n, sev, "interaction", title, [na, nb], detail, src))

    for name, ing in ings.items():
        for allergy in profile.allergies:
            a = allergy.lower().strip()
            if a == ing or ing in ALLERGY_CLASSES.get(a, set()):
                n += 1
                flags.append(_flag(n, "high", "allergy", f"Allergy alert: {allergy}", [name],
                                   f"{profile.name} has a listed {allergy} allergy, and {name} ({ing}) is related.", src))
        for cond in profile.conditions:
            rule = CONDITION_RULES.get(cond.lower().strip())
            if rule and ing in rule[0]:
                n += 1
                flags.append(_flag(n, "caution", "condition", f"May not suit: {cond}", [name], rule[1], src))

    order = {"high": 0, "caution": 1, "info": 2}
    flags.sort(key=lambda f: order[f.severity])
    return SafetyReport(flags=flags, checked=len(meds))


@lru_cache(maxsize=256)
def fetch_label_section(ingredient: str) -> dict:
    """UNTESTED starter: pull FDA label text for an ingredient from openFDA (free; add api_key for higher limits)."""
    url = "https://api.fda.gov/drug/label.json"
    params = {"search": f'openfda.generic_name:"{ingredient}"', "limit": 1}
    try:
        r = httpx.get(url, params=params, timeout=10)
        r.raise_for_status()
        doc = r.json()["results"][0]
    except Exception as e:  # network, 404 (no match), rate limit
        return {"ingredient": ingredient, "error": str(e)}
    pick = lambda k: (doc.get(k) or [""])[0][:2000]
    return {
        "ingredient": ingredient,
        "drug_interactions": pick("drug_interactions"),
        "warnings": pick("warnings"),
        "adverse_reactions": pick("adverse_reactions"),
        "source": "openFDA drug label",
    }
