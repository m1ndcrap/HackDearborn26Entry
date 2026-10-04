"""Discharge reconciliation: line up a discharge sheet with the medicines already at home.

Matching is by ingredient, never by name: the sheet says "ibuprofen", the bottle at home says "Advil".
Every sheet line and every cabinet entry lands in one bucket (new, changed, stopped, duplicate, unchanged,
not on the sheet). The proposed after-discharge cabinet then gets the normal safety check, and flags that
today's cabinet has but the new one doesn't are reported as resolved.

Nothing here changes the cabinet; the family confirms each change in the app.
"""
from __future__ import annotations

import re

from . import safety
from .models import DischargeMed, Medication, Profile, ReconcileItem, ReconcileResponse, SafetyFlag, SafetyReport


def _ings(m: Medication) -> frozenset[str]:
    return frozenset(safety.ingredients_of(m))


def _strength(s: str | None) -> str:
    return re.sub(r"\s+", "", (s or "").lower())


def _label(m: Medication) -> str:
    return " ".join(x for x in (m.name, m.strength) if x)


def _as_cabinet_med(s: DischargeMed) -> Medication:
    return Medication.model_validate(s.model_dump(exclude={"status", "previous"}))


def reconcile(profile: Profile, cabinet: list[Medication], sheet: list[DischargeMed], document_type: str) -> ReconcileResponse:
    items: list[ReconcileItem] = []

    def add(kind, summary, sheet_med=None, cab=None, shared=()):
        items.append(ReconcileItem(id=f"r{len(items) + 1}", kind=kind, sheet=sheet_med, cabinet=cab, shared=sorted(shared), summary=summary))

    cab = [(c, _ings(c)) for c in cabinet]
    mentioned: set[str] = set()  # cabinet entries the sheet accounts for
    remove: set[str] = set()  # cabinet entries the suggested changes take out
    incoming: list[DischargeMed] = []  # sheet lines the suggested changes add

    for s in sheet:
        si = _ings(s)
        same = [c for c, ci in cab if ci and ci == si]
        overlap = [(c, si & ci) for c, ci in cab if ci != si and si & ci]
        mentioned.update(c.id for c in same)

        if s.status == "stop":
            hits = [(c, si) for c in same] + overlap
            for c, shared in hits:
                mentioned.add(c.id)
                remove.add(c.id)
                why = "Stop taking it" if c.name.lower() == s.name.lower() else f"Your {_label(c)} contains {' and '.join(sorted(shared))}, so stop taking it"
                add("stopped", f"The hospital stopped {s.name}. {why} and set the bottle aside.", s, c, shared)
            if not hits:
                add("stopped", f"The hospital stopped {s.name}. It isn't in the cabinet; don't restart it unless a doctor says so.", s)
            continue

        if same:
            c = same[0]
            new_strength = _strength(s.strength) and _strength(c.strength) and _strength(s.strength) != _strength(c.strength)
            if new_strength or s.status == "change":
                remove.add(c.id)
                incoming.append(s)
                if new_strength:
                    add("changed", f"Same medicine as your {_label(c)}, new dose: {s.strength}. Use the new directions and set the old bottle aside.", s, c, si)
                else:
                    how = " ".join(x for x in (s.dose, s.frequency) if x) or "see the sheet"
                    add("changed", f"The hospital changed how to take {s.name}: {how}.", s, c, si)
            else:
                alias = "" if c.name.lower() == s.name.lower() else f" (same medicine as {s.name})"
                add("unchanged", f"Already in the cabinet as {_label(c)}{alias}. Keep taking it.", s, c, si)
        else:
            incoming.append(s)
            when = f", {s.frequency}" if s.frequency else ""
            if s.status == "unclear":
                add("new", f"{_label(s)} is on the sheet without instructions. Ask whether to take it before adding it.", s)
            elif s.status == "continue":
                add("new", f"The sheet says to keep taking {_label(s)}{when}, but it isn't in the cabinet yet.", s)
            else:
                add("new", f"New from the hospital: {_label(s)}{when}.", s)

        # Same ingredient hiding in a different product, e.g. new acetaminophen + NyQuil at home
        for c, shared in overlap:
            mentioned.add(c.id)
            add("duplicate", f"{_label(c)} also contains {' and '.join(sorted(shared))}. Taking it with {s.name} can mean taking too much.", s, c, shared)

    for c, _ in cab:
        if c.id not in mentioned:
            add("not_on_sheet", f"{_label(c)} isn't on the discharge sheet. Ask the doctor or pharmacist whether to keep taking it.", cab=c)

    after = [c for c in cabinet if c.id not in remove] + [_as_cabinet_med(s) for s in incoming]
    report = safety.build_report(profile, after) if after else SafetyReport(flags=[], checked=0)
    before = safety.build_report(profile, cabinet) if cabinet else SafetyReport(flags=[], checked=0)
    return ReconcileResponse(document_type=document_type, items=items, after=after, report=report,
                             resolved=_resolved(before.flags, report.flags, cabinet + after))


def _resolved(before: list[SafetyFlag], after: list[SafetyFlag], meds: list[Medication]) -> list[SafetyFlag]:
    """Flags in today's cabinet with no counterpart after discharge. Compared by ingredient, since names change
    (a "Coumadin + Advil" flag isn't resolved just because the sheet calls it "Warfarin")."""
    ings = {m.name: frozenset(safety.ingredients_of(m)) for m in meds}

    def key(f: SafetyFlag):
        # Interaction titles contain drug names; food, condition and allergy titles name the topic
        topic = f.title.split(":")[0] if f.kind in ("food_alcohol", "condition", "allergy") else ""
        return f.kind, topic, frozenset(ings.get(d, frozenset({d.lower()})) for d in f.drugs)

    still = {key(f) for f in after}
    # Food and alcohol notes are advice, not problems, so they don't count as "resolved"
    return [f for f in before if f.kind != "food_alcohol" and key(f) not in still]
