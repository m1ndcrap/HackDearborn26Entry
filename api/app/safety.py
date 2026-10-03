"""Safety checks. Deterministic code decides WHAT is flagged; Gemini only explains.

Primary source: FDA drug labels (openFDA). For every pair of medicines, we search each label's
interaction-related sections for the other drug's ingredients or drug class (e.g. "NSAIDs"), and
quote the sentence we found. Severity comes from the label's own wording.

Fallback: a small built-in rules table, used when a label can't be fetched (offline, rate limited)
or when the labels don't mention a pair we know is risky.
"""
from __future__ import annotations

import re
from concurrent.futures import ThreadPoolExecutor
from itertools import combinations
from typing import Optional

from . import openfda
from .models import Medication, Profile, SafetyFlag, SafetyReport

# ---------------------------------------------------------------------------
# Drug classes: how labels refer to groups of drugs. Regex fragments, matched case-insensitively.
# ---------------------------------------------------------------------------
CLASSES: dict[str, dict] = {
    "nsaid": {"label": "NSAIDs", "terms": [r"nsaids?", r"non-?steroidal anti-?inflammatory( drugs?)?", r"pain relievers?/fever reducers?"],
              "members": {"ibuprofen", "naproxen", "aspirin", "diclofenac", "celecoxib", "meloxicam", "ketorolac", "indomethacin"}},
    "anticoagulant": {"label": "blood thinners", "terms": [r"anticoagulants?", r"anticoagulation", r"blood[- ]thinn(er|ers|ing)", r"thinning the blood"],
                      "members": {"warfarin", "apixaban", "rivaroxaban", "dabigatran", "edoxaban", "heparin", "enoxaparin"}},
    "antiplatelet": {"label": "antiplatelet drugs", "terms": [r"antiplatelets?( agents?| drugs?)?", r"platelet (aggregation )?inhibitors?"],
                     "members": {"aspirin", "clopidogrel", "prasugrel", "ticagrelor"}},
    "ssri": {"label": "SSRIs", "terms": [r"ssris?", r"(selective )?serotonin reuptake inhibitors?"],
             "members": {"sertraline", "fluoxetine", "paroxetine", "citalopram", "escitalopram"}},
    "snri": {"label": "SNRIs", "terms": [r"snris?", r"serotonin[- ]norepinephrine reuptake inhibitors?"],
             "members": {"duloxetine", "venlafaxine", "desvenlafaxine"}},
    "serotonergic": {"label": "serotonergic drugs", "terms": [r"serotonergic (drugs?|agents?|medications?)"],
                     "members": {"sertraline", "fluoxetine", "paroxetine", "citalopram", "escitalopram", "duloxetine", "venlafaxine", "tramadol", "trazodone", "sumatriptan"}},
    "maoi": {"label": "MAOIs", "terms": [r"maois?", r"monoamine oxidase inhibitors?"],
             "members": {"phenelzine", "tranylcypromine", "selegiline", "isocarboxazid", "rasagiline"}},
    "opioid": {"label": "opioids", "terms": [r"opioids?( analgesics?)?"],
               "members": {"tramadol", "oxycodone", "hydrocodone", "morphine", "codeine", "fentanyl", "methadone"}},
    "benzodiazepine": {"label": "benzodiazepines", "terms": [r"benzodiazepines?"],
                       "members": {"alprazolam", "lorazepam", "diazepam", "clonazepam"}},
    "cns_depressant": {"label": "CNS depressants", "terms": [r"cns depressants?", r"central nervous system depressants?", r"sedatives?"],
                       "members": {"tramadol", "oxycodone", "hydrocodone", "morphine", "codeine", "alprazolam", "lorazepam", "diazepam", "clonazepam", "diphenhydramine", "doxylamine", "zolpidem"}},
    "ace_inhibitor": {"label": "ACE inhibitors", "terms": [r"ace inhibitors?", r"angiotensin[- ]converting enzyme( \(ace\))? inhibitors?"],
                      "members": {"lisinopril", "enalapril", "ramipril", "benazepril", "captopril"}},
    "arb": {"label": "ARBs", "terms": [r"angiotensin (ii )?receptor blockers?", r"\barbs\b"],
            "members": {"losartan", "valsartan", "irbesartan", "olmesartan"}},
    "diuretic": {"label": "diuretics", "terms": [r"diuretics?"],
                 "members": {"furosemide", "hydrochlorothiazide", "chlorthalidone", "spironolactone", "bumetanide"}},
    "statin": {"label": "statins", "terms": [r"statins?", r"hmg-?coa reductase inhibitors?"],
               "members": {"atorvastatin", "simvastatin", "rosuvastatin", "pravastatin", "lovastatin"}},
    "fluoroquinolone": {"label": "fluoroquinolones", "terms": [r"fluoroquinolones?", r"quinolones?"],
                        "members": {"ciprofloxacin", "levofloxacin", "moxifloxacin"}},
    "macrolide": {"label": "macrolide antibiotics", "terms": [r"macrolides?"],
                  "members": {"clarithromycin", "erythromycin", "azithromycin"}},
    "antacid_mineral": {"label": "antacids and mineral supplements",
                        "terms": [r"antacids?", r"calcium(?! channel)( carbonate| supplements?| salts?)?", r"\biron( supplements?| salts?)?", r"ferrous \w+",
                                  r"magnesium(-containing)?( hydroxide| supplements?)?", r"aluminum(-containing)?( hydroxide)?", r"(multivalent|polyvalent) cations?", r"\bzinc\b"],
                        "members": {"calcium carbonate", "calcium", "iron", "ferrous sulfate", "ferrous gluconate", "magnesium", "magnesium hydroxide", "aluminum hydroxide", "zinc"}},
    "thyroid": {"label": "thyroid hormone", "terms": [r"thyroid hormones?", r"levothyroxine"], "members": {"levothyroxine", "liothyronine"}},
    "antihistamine": {"label": "sedating antihistamines", "terms": [r"(sedating )?antihistamines?"], "members": {"diphenhydramine", "doxylamine", "chlorpheniramine"}},
}

# Sections to search for interactions, in order of how authoritative a hit there is.
INTERACTION_SECTIONS = ["boxed_warning", "contraindications", "do_not_use", "drug_interactions",
                        "ask_doctor_or_pharmacist", "warnings_and_cautions", "warnings", "precautions"]
CONDITION_SECTIONS = ["boxed_warning", "contraindications", "do_not_use", "ask_doctor", "ask_doctor_or_pharmacist"]
FOOD_SECTIONS = ["boxed_warning", "warnings", "warnings_and_cautions", "precautions", "drug_interactions", "do_not_use",
                 "ask_doctor", "when_using", "information_for_patients", "patient_counseling_information",
                 "dosage_and_administration", "directions"]

CONDITION_TERMS = {
    "kidney disease": [r"kidney (disease|problems?|failure|impairment)", r"renal (impairment|failure|disease|insufficiency)"],
    "liver disease": [r"liver (disease|cirrhosis|problems?|failure)", r"hepatic (impairment|disease|failure)"],
    "stomach ulcer": [r"(stomach|peptic|gastric) ulcers?", r"stomach bleeding", r"gastrointestinal bleeding"],
    "high blood pressure": [r"high blood pressure", r"hypertension"],
    "heart disease": [r"heart (disease|failure|attack)", r"cardiovascular disease"],
    "asthma": [r"asthma"],
    "diabetes": [r"diabetes"],
    "pregnancy": [r"pregnan(t|cy)"],
}

ALLERGY_CLASSES = {
    "penicillin": {"penicillin", "amoxicillin", "ampicillin", "piperacillin"},
    "nsaid": CLASSES["nsaid"]["members"],
    "sulfa": {"sulfamethoxazole", "sulfasalazine"},
    "aspirin": {"aspirin"},
}

# ---------------------------------------------------------------------------
# Severity from the label's own wording
# ---------------------------------------------------------------------------
HIGH_WORDS = re.compile(r"contraindicat|do not (use|take|administer|coadminister|combine)|\bavoid|\bserious|\bsevere|fatal|life[- ]threatening|"
                        r"\bdeath|major bleeding|serious bleeding|hemorrhag|serotonin syndrome|respiratory depression", re.I)
CAUTION_WORDS = re.compile(r"\bmonitor|may (increase|decrease|reduce|enhance|potentiate|diminish|alter|affect)|increases? the risk|"
                           r"increased risk|\bcaution|\badjust|dose reduction|\bconsider|ask a doctor|\bbleeding|\bseparate|\bspace", re.I)
FOOD_HIGH_WORDS = re.compile(r"contraindicat|do not (use|take|drink)|\bserious|\bsevere|fatal|life[- ]threatening|\bdeath|bleeding|liver damage", re.I)
ORDER = {"high": 0, "caution": 1, "info": 2}


def severity_of(text: str, section: str) -> str:
    if section in ("boxed_warning", "contraindications", "do_not_use") or HIGH_WORDS.search(text):
        return "high"
    if CAUTION_WORDS.search(text):
        return "caution"
    return "info"


# ---------------------------------------------------------------------------
# Text helpers
# ---------------------------------------------------------------------------
_SENT_SPLIT = re.compile(r"(?<=[.;!?])\s+(?=[A-Z0-9•(\[])|\s+•\s+|\s{2,}")


_HEADING = re.compile(r"^(\d+(\.\d+)*\s+)?([A-Z][A-Z0-9,/&()\- ]{3,}\s+)?(\d+(\.\d+)*\s+)?(?=[A-Z])")


def excerpt_around(text: str, start: int, end: int, limit: int = 260) -> str:
    """The sentence containing the match, trimmed to `limit` chars around it."""
    sent_start = 0
    for m in _SENT_SPLIT.finditer(text, 0, min(len(text), start + 1)):  # +1 so the lookahead can see the match
        if m.end() <= start:
            sent_start = m.end()
    nxt = _SENT_SPLIT.search(text, end)
    sent_end = nxt.start() if nxt else len(text)
    s, e = sent_start, sent_end
    if e - s > limit:
        half = (limit - (end - start)) // 2
        s, e = max(s, start - half), min(e, end + half)
        if s > sent_start and " " in text[s:start]:
            s = text.index(" ", s) + 1  # don't start mid-word
        if e < sent_end and " " in text[end:e]:
            e = text.rindex(" ", end, e)
    out = re.sub(r"\s+", " ", text[s:e]).strip()
    if s == sent_start:
        out = _HEADING.sub("", out) or out  # drop "7 DRUG INTERACTIONS 7.1" style numbering
    if s > sent_start:
        out = "…" + out
    if e < sent_end:
        out = out + "…"
    return out


def _pattern(terms: list[str]) -> re.Pattern:
    return re.compile(r"(?<![a-z])(" + "|".join(terms) + r")(?![a-z])", re.I)


# ---------------------------------------------------------------------------
# Medication helpers
# ---------------------------------------------------------------------------
BRAND_FALLBACK = {
    "tylenol": "acetaminophen", "advil": "ibuprofen", "motrin": "ibuprofen", "aleve": "naproxen", "coumadin": "warfarin",
    "zestril": "lisinopril", "zoloft": "sertraline", "ultram": "tramadol", "bayer": "aspirin", "amoxil": "amoxicillin",
    "synthroid": "levothyroxine", "tums": "calcium carbonate", "cipro": "ciprofloxacin", "lipitor": "atorvastatin",
}


def ingredients_of(med: Medication) -> list[str]:
    """All generic ingredients (RxNorm fills med.ingredients on scan; older entries may only have a name)."""
    if med.ingredients:
        return [i.lower().strip() for i in med.ingredients if i.strip()]
    if med.ingredient:
        return [med.ingredient.lower().strip()]
    key = med.name.lower().strip().split()[0] if med.name.strip() else ""
    return [BRAND_FALLBACK.get(key, key)] if key else []


def ingredient_of(med: Medication) -> str:  # kept for older callers
    ings = ingredients_of(med)
    return ings[0] if ings else ""


def classes_of(ingredient: str) -> list[str]:
    return [c for c, spec in CLASSES.items() if ingredient in spec["members"] or any(ingredient.startswith(m + " ") for m in spec["members"])]


def terms_for(ingredients: list[str]) -> list[tuple[str, str]]:
    """(regex, human description) pairs that a label might use to refer to these ingredients."""
    out: list[tuple[str, str]] = []
    for ing in ingredients:
        out.append((re.escape(ing) + r"s?", ing))
        for c in classes_of(ing):
            for t in CLASSES[c]["terms"]:
                out.append((t, CLASSES[c]["label"]))
    return out


# ---------------------------------------------------------------------------
# Label fetching (parallel, failure-tolerant)
# ---------------------------------------------------------------------------
def fetch_labels(ingredients: set[str]) -> tuple[dict[str, dict], set[str]]:
    """Returns (labels by ingredient, ingredients we couldn't check right now)."""
    labels: dict[str, dict] = {}
    unavailable: set[str] = set()

    def one(ing: str):
        try:
            return ing, openfda.get_label(ing), None
        except Exception as e:  # LabelUnavailable, RateLimited, anything unexpected
            return ing, None, e

    if not ingredients:
        return labels, unavailable
    with ThreadPoolExecutor(max_workers=min(6, len(ingredients))) as pool:
        for ing, label, err in pool.map(one, sorted(ingredients)):
            if err is not None:
                unavailable.add(ing)
            elif label and label.get("found"):
                labels[ing] = label
    return labels, unavailable


def _label_source(med_name: str, label: dict, section: str) -> str:
    who = label.get("brand") or label.get("generic") or label.get("ingredient")
    return f"FDA label for {who} ({label.get('ingredient')}), {openfda.SECTION_NAMES.get(section, section)} section"


def best_hit(label: dict, sections: list[str], patterns: list[tuple[re.Pattern, str]]) -> Optional[dict]:
    """Most severe, most authoritative mention of any pattern in the given label sections."""
    best = None
    for rank, section in enumerate(sections):
        text = label["sections"].get(section)
        if not text:
            continue
        for pat, desc in patterns:
            for n, m in enumerate(pat.finditer(text)):
                if n >= 4:
                    break  # a few mentions per section is enough to find the most serious one
                excerpt = excerpt_around(text, m.start(), m.end())
                sev = severity_of(excerpt, section)
                key = (ORDER[sev], rank)
                if best is None or key < best["key"]:
                    best = {"key": key, "severity": sev, "section": section, "excerpt": excerpt, "matched": desc}
    return best


# ---------------------------------------------------------------------------
# Built-in fallback rules (used when labels are unavailable or silent)
# ---------------------------------------------------------------------------
NSAIDS = CLASSES["nsaid"]["members"]
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
BUILTIN_SOURCE = "Built-in safety rule (FDA label not checked)"

FOOD_TOPICS = [
    ("alcohol", r"alcohol(ic)?( drinks?| beverages?| use)?", "Alcohol warning", "caution"),
    ("grapefruit", r"grapefruit( juice)?", "Grapefruit warning", "caution"),
    ("with_food", r"(take|taken|administer(ed)?|give|given)? ?(it )?(with|after) (food|meals?|a meal|milk)", "Take with food", "info"),
    ("empty_stomach", r"empty stomach|before (breakfast|meals?|eating)|\b(30|60) minutes before", "Take on an empty stomach", "info"),
]


# ---------------------------------------------------------------------------
# The report
# ---------------------------------------------------------------------------
def build_report(profile: Profile, meds: list[Medication]) -> SafetyReport:
    flags: list[SafetyFlag] = []

    def add(**kw):
        flags.append(SafetyFlag(id=f"f{len(flags) + 1}", **kw))

    med_ings = {m.id or m.name: (m, ingredients_of(m)) for m in meds}
    labels, unavailable = fetch_labels({i for _, ings in med_ings.values() for i in ings})

    # 1. Duplicates (same ingredient in two products, e.g. Tylenol + NyQuil)
    for (ka, (a, ia)), (kb, (b, ib)) in combinations(med_ings.items(), 2):
        shared = sorted(set(ia) & set(ib))
        if shared:
            add(severity="caution", kind="duplicate", title="Possible duplicate medicine", drugs=[a.name, b.name],
                detail=f"{a.name} and {b.name} both contain {', '.join(shared)}. Taking both can mean taking too much.",
                source="Ingredient comparison (RxNorm)")

    # 2. Drug-drug interactions from labels, both directions; builtin rules fill gaps
    for (ka, (a, ia)), (kb, (b, ib)) in combinations(med_ings.items(), 2):
        if set(ia) & set(ib):
            continue
        candidates = []
        for x, ix, y, iy in ((a, ia, b, ib), (b, ib, a, ia)):
            pats = [(_pattern([t]), d) for t, d in terms_for(iy)]
            for ing in ix:
                label = labels.get(ing)
                if not label:
                    continue
                hit = best_hit(label, INTERACTION_SECTIONS, pats)
                if hit:
                    candidates.append((hit, x, y, label))
        if candidates:
            hit, x, y, label = min(candidates, key=lambda c: c[0]["key"])
            add(severity=hit["severity"], kind="interaction",
                title=f"{x.name} label warns about {hit['matched']}" if hit["matched"] not in ingredients_of(y) else f"{x.name} label warns about {y.name}",
                drugs=[x.name, y.name],
                detail=f"The FDA label for {x.name} mentions {hit['matched']}"
                       + (f", which includes {y.name}" if hit["matched"] not in ingredients_of(y) else "")
                       + ". Ask your pharmacist whether these are safe together.",
                source=_label_source(x.name, label, hit["section"]), excerpt=hit["excerpt"], source_url=label.get("source_url"))
            continue
        for ga, gb, sev, title, detail in DEMO_RULES:
            if any(p in ga for p in ia) and any(q in gb for q in ib) or any(p in gb for p in ia) and any(q in ga for q in ib):
                add(severity=sev, kind="interaction", title=title, drugs=[a.name, b.name], detail=detail, source=BUILTIN_SOURCE)
                break

    # 3. Allergies (ingredient or class match)
    for _, (m, ings) in med_ings.items():
        for allergy in profile.allergies:
            al = allergy.lower().strip()
            related = ALLERGY_CLASSES.get(al.rstrip("s"), set()) | ALLERGY_CLASSES.get(al, set())
            if any(i == al or i in related or al in classes_of(i) for i in ings):
                add(severity="high", kind="allergy", title=f"Allergy alert: {allergy}", drugs=[m.name],
                    detail=f"{profile.name} has a listed {allergy} allergy, and {m.name} ({', '.join(ings)}) is related.",
                    source="Profile allergy list")

    # 4. Health conditions: label warnings first, builtin rules as backup
    for _, (m, ings) in med_ings.items():
        for cond in profile.conditions:
            c = cond.lower().strip()
            terms = CONDITION_TERMS.get(c, [re.escape(c)])
            hit, hit_label = None, None
            for ing in ings:
                label = labels.get(ing)
                if label:
                    h = best_hit(label, CONDITION_SECTIONS, [(_pattern(terms), c)])
                    if h and (hit is None or h["key"] < hit["key"]):
                        hit, hit_label = h, label
            if hit:
                add(severity=hit["severity"] if hit["severity"] != "info" else "caution", kind="condition",
                    title=f"May not suit: {cond}", drugs=[m.name],
                    detail=f"The FDA label for {m.name} has a warning for people with {cond}.",
                    source=_label_source(m.name, hit_label, hit["section"]), excerpt=hit["excerpt"], source_url=hit_label.get("source_url"))
                continue
            rule = CONDITION_RULES.get(c)
            if rule and any(i in rule[0] for i in ings):
                add(severity="caution", kind="condition", title=f"May not suit: {cond}", drugs=[m.name], detail=rule[1], source=BUILTIN_SOURCE)

    # 5. Food and alcohol, one flag per medicine per topic
    for _, (m, ings) in med_ings.items():
        for topic, term, title, floor in FOOD_TOPICS:
            pat = _pattern([term])
            hit, hit_label = None, None
            for ing in ings:
                label = labels.get(ing)
                if not label:
                    continue
                h = best_hit(label, FOOD_SECTIONS, [(pat, topic)])
                if h and topic == "with_food" and re.search(r"with or without (food|meals?)", h["excerpt"], re.I):
                    h = None  # "with or without food" isn't a food requirement
                if h and (hit is None or h["key"] < hit["key"]):
                    hit, hit_label = h, label
            if not hit:
                continue
            if floor == "info":
                sev = "info"  # "take with food" / "empty stomach" are directions, not dangers
            else:
                sev = "high" if FOOD_HIGH_WORDS.search(hit["excerpt"]) else "caution"
            add(severity=sev, kind="food_alcohol", title=f"{title}: {m.name}", drugs=[m.name],
                detail=f"The FDA label for {m.name} mentions {topic.replace('_', ' ')}.",
                source=_label_source(m.name, hit_label, hit["section"]), excerpt=hit["excerpt"], source_url=hit_label.get("source_url"))

    flags.sort(key=lambda f: ORDER[f.severity])
    for i, f in enumerate(flags, 1):
        f.id = f"f{i}"
    unchecked = sorted({m.name for m, ings in med_ings.values() if not ings or any(i in unavailable or i not in labels for i in ings)})
    return SafetyReport(flags=flags, checked=len(meds), unchecked=unchecked)


def fetch_label_section(ingredient: str) -> dict:
    """GET /api/label/{ingredient}: the label sections we use, or why it couldn't be fetched."""
    try:
        return openfda.get_label(ingredient)
    except openfda.RateLimited as e:
        return {"found": False, "ingredient": ingredient, "reason": "rate_limited", "error": str(e)}
    except Exception as e:
        return {"found": False, "ingredient": ingredient, "reason": "unavailable", "error": str(e)}