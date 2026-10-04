"""Pre-purchase check: is this over-the-counter product OK with what this person already takes?

Runs the normal safety report on cabinet + candidate, then keeps only the flags that involve the
candidate. Nothing is saved; the person decides whether to buy it.
"""
from __future__ import annotations

from . import safety
from .models import Medication, OTCCheckResponse, OTCResult, Profile

RANK = {"high": 0, "caution": 1, "info": 2}


def check(profile: Profile, cabinet: list[Medication], candidates: list[Medication]) -> OTCCheckResponse:
    report = safety.build_report(profile, cabinet + candidates)
    results: list[OTCResult] = []
    for c in candidates:
        flags = [f for f in report.flags if c.name in f.drugs]
        # The verdict answers "is it OK with what they take and their health?" Alcohol, grapefruit, and
        # food notes are still shown, but they're lifestyle advice, not a reason to put the box back.
        deciding = [f for f in flags if f.kind != "food_alcohol"]
        worst = min((RANK[f.severity] for f in deciding), default=3)
        unchecked = c.name in report.unchecked
        who = profile.name
        if worst == 0:
            verdict = "avoid"
            summary = f"Don't use {c.name} with {who}'s current medicines unless a pharmacist or doctor says it's OK."
        elif worst == 1:
            verdict = "ask"
            summary = f"Ask the pharmacist before buying {c.name}. There's something to check with {who}'s medicines."
        elif unchecked:
            verdict = "unknown"
            summary = f"We couldn't find the FDA label for {c.name}, so only basic checks ran. Ask the pharmacist before buying."
        else:
            verdict = "ok"
            n = len(cabinet)
            summary = (f"No conflicts found between {c.name} and {who}'s {n} medicine{'s' if n != 1 else ''}."
                       if n else f"No conflicts found for {c.name}. {who}'s cabinet is empty, so only the profile was checked.")
        results.append(OTCResult(medication=c, verdict=verdict, summary=summary, flags=flags))
    return OTCCheckResponse(results=results, checked_against=len(cabinet))