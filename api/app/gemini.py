"""Gemini calls. Runs in MOCK mode (no key needed) so the frontend can be built before keys are ready."""
import logging
import os
import time
from typing import Optional

import httpx
from dotenv import load_dotenv
from pydantic import create_model

from .models import DischargeMed, ExplainRequest, Medication, ScanResult

load_dotenv()
log = logging.getLogger("uvicorn.error")

# Pinned stable model IDs (no -preview / -latest alias, so behavior can't shift on demo day).
# The fallback runs on separate capacity and takes over when the main model is overloaded.
MODEL = os.getenv("GEMINI_MODEL", "gemini-3.5-flash")
FALLBACK_MODEL = os.getenv("GEMINI_FALLBACK_MODEL", "gemini-3.5-flash-lite")
API_KEY = os.getenv("GEMINI_API_KEY", "")

RETRYABLE = {429, 500, 502, 503, 504}  # rate limit, "high demand", transient server errors

_client = None


class GeminiBusy(Exception):
    """Every attempt hit overload or a network error; trying again in a moment usually works."""


def mock_mode() -> bool:
    return not API_KEY


def _get_client():
    global _client
    if _client is None:
        from google import genai

        _client = genai.Client(api_key=API_KEY)
    return _client


def _generate(**kwargs):
    """generate_content that survives demand spikes and network blips: main model, a short pause,
    main model again, then the fallback model. Returns (model_used, response)."""
    from google.genai import errors

    last: Exception | None = None
    attempts = [(MODEL, 0.0), (MODEL, 1.5)] + ([(FALLBACK_MODEL, 0.0)] if FALLBACK_MODEL and FALLBACK_MODEL != MODEL else [])
    for model, pause in attempts:
        time.sleep(pause)
        try:
            return model, _get_client().models.generate_content(model=model, **kwargs)
        except errors.APIError as e:
            if e.code not in RETRYABLE:
                raise  # bad key, bad request, unknown model: retrying won't help
            last = e
        except (httpx.TransportError, OSError) as e:  # DNS and connection failures
            last = e
        log.warning("gemini %s failed, trying again: %s", model, str(last)[:200])
    raise GeminiBusy(str(last))


SCAN_PROMPT = """You are reading a photo of a medication label: a pharmacy pill bottle or an over-the-counter box.
Extract each medication on it (usually one). Return one entry per medication.

Fields:
- `name`: the drug name as printed, without the strength (e.g. "Warfarin Sodium", "Advil").
- `ingredient`: the generic active ingredient in lowercase, without salt words like sodium, HCl, succinate, ER
  (e.g. "warfarin", "ibuprofen", "sertraline"). Use what is printed ("Generic for ...", "Active ingredient").
  If only a well-known brand is printed, give its generic only if you are certain. Combination products: join with " / ".
- `strength`: amount per tablet/capsule/mL with units, e.g. "5 mg", "200 mg", "10 mg/5 mL".
- `dose`: how much to take at one time, e.g. "1 tablet", "2 capsules", "10 mL".
- `frequency`: when / how often, e.g. "once daily in the evening", "every 6 hours as needed for pain".
  If the label has a dosing chart (morning / midday / evening / bedtime boxes), include the times it marks,
  e.g. "twice daily (morning and evening)".
- `instructions`: other directions that change how to take it (with food, max per day, until finished), or null.
  Do not repeat the dose or frequency, and leave out the route alone ("by mouth", "orally").
- `warnings`: printed warnings or auxiliary stickers, at most 5, each under 15 words.
- `ndc`: the NDC number exactly as printed with its dashes (e.g. "0573-0134-20"), or null. Not the Rx number.
- `confidence` 0-1: how sure you are that name, strength, dose and frequency are read correctly.
  Use below 0.7 if any of them is blurry, cut off, under glare, handwritten, or inferred rather than printed.

Rules:
- Copy values as printed. Never invent or "correct" a dose, strength or frequency. If not visible, use null.
- Ignore patient name, address, pharmacy, prescriber, Rx number, quantity, refills and dates.
- If no medication is readable, return an empty `medications` list and document_type "unknown".
- `document_type`: pill_bottle, otc_box, discharge_sheet or unknown."""

# What Gemini fills in: Medication minus the server-side fields (id, rxcui, verification)
_READ_FIELDS = ["name", "ingredient", "strength", "dose", "frequency", "instructions", "warnings", "confidence", "ndc"]
_LabelMed = create_model("LabelMed", **{k: (Medication.model_fields[k].annotation, Medication.model_fields[k]) for k in _READ_FIELDS})
_LabelRead = create_model(
    "LabelRead",
    document_type=(ScanResult.model_fields["document_type"].annotation, "unknown"),
    medications=(list[_LabelMed], ...),  # type: ignore[valid-type]
)


def extract_medications(image: bytes, mime_type: str) -> ScanResult:
    if mock_mode():
        return ScanResult(
            document_type="pill_bottle",
            medications=[
                Medication(
                    name="Warfarin",
                    ingredient="warfarin",
                    strength="5 mg",
                    dose="1 tablet",
                    frequency="once daily in the evening",
                    instructions="Take at the same time each day.",
                    warnings=["Avoid aspirin and NSAIDs unless your doctor approves"],
                    confidence=0.62,
                ),
                Medication(
                    name="Advil",
                    ingredient="ibuprofen",
                    strength="200 mg",
                    dose="1-2 tablets",
                    frequency="every 4-6 hours as needed",
                    confidence=0.9,
                ),
            ],
        )

    from google.genai import types

    start = time.perf_counter()
    model, resp = _generate(
        contents=[types.Part.from_bytes(data=image, mime_type=mime_type), SCAN_PROMPT],
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=_LabelRead,
            media_resolution=types.MediaResolution.MEDIA_RESOLUTION_HIGH,  # small label text
        ),
    )
    # One line per scan, so extraction can be checked with `docker compose logs -f api`
    log.info("scan model=%s bytes=%d %.1fs -> %s", model, len(image), time.perf_counter() - start, resp.text)
    parsed = resp.parsed
    if parsed is None:
        raise ValueError("Gemini returned no parseable result")
    return ScanResult.model_validate(parsed.model_dump())


DISCHARGE_PROMPT = """You are reading a hospital discharge medication list or after-visit summary.
Return one entry for EVERY medication listed, including ones the patient is told to stop.

For each medication:
- `status`, from the section heading or wording next to it:
  - "start": new medication ("NEW", "START taking", "begin")
  - "change": dose or timing changed ("CHANGED", "take the NEW way", "increase", "decrease")
  - "continue": keep taking as before ("CONTINUE", "no change", "keep taking", "resume")
  - "stop": "STOP taking", "discontinue", "do not take", "hold"
  - "unclear": listed with no instruction about whether to take it
- `name`: the drug name as printed, without strength. If brands follow in parentheses, use the first name:
  "Ibuprofen (Advil, Motrin)" -> "Ibuprofen".
- `ingredient`: generic active ingredient in lowercase without salt words (sodium, HCl, succinate, ER), e.g. "metoprolol".
- `strength`, `dose`, `frequency`: as printed. For "change", use the NEW values.
- `previous`: the old dose if printed (e.g. "was 2.5 mg" -> "2.5 mg"), else null.
- `instructions`: other directions (with food, until finished, check INR), or null.
- `confidence` 0-1: below 0.7 if blurry, handwritten, cut off, or the status had to be guessed.

Rules:
- Copy values as printed. Never invent a dose. Use null when not visible.
- Ignore patient details, dates, appointments, lab values, diet and activity instructions.
- If this is not a medication list, return an empty `medications` list and document_type "unknown".
- `document_type`: discharge_sheet, pill_bottle, otc_box or unknown."""

_DISCHARGE_FIELDS = ["name", "ingredient", "strength", "dose", "frequency", "instructions", "confidence", "status", "previous"]
_SheetMed = create_model("SheetMed", **{k: (DischargeMed.model_fields[k].annotation, DischargeMed.model_fields[k]) for k in _DISCHARGE_FIELDS})
_SheetRead = create_model(
    "SheetRead",
    document_type=(ScanResult.model_fields["document_type"].annotation, "unknown"),
    medications=(list[_SheetMed], ...),  # type: ignore[valid-type]
)


def _mock_discharge() -> tuple[str, list[DischargeMed]]:
    """The demo story: grandpa home after a heart scare (see README)."""
    rows = [
        ("start", "Lisinopril", "lisinopril", "10 mg", "1 tablet", "once daily", None),
        ("start", "Acetaminophen", "acetaminophen", "650 mg", "1 tablet", "every 6 hours as needed for pain", None),
        ("change", "Warfarin", "warfarin", "5 mg", "1 tablet", "once daily in the evening", "2.5 mg"),
        ("continue", "Sertraline", "sertraline", "50 mg", "1 tablet", "every morning", None),
        ("stop", "Ibuprofen", "ibuprofen", None, None, None, None),
    ]
    return "discharge_sheet", [
        DischargeMed(status=s, name=n, ingredient=i, strength=st, dose=d, frequency=f, previous=p, confidence=0.9)
        for s, n, i, st, d, f, p in rows
    ]


def extract_discharge(image: bytes, mime_type: str) -> tuple[str, list[DischargeMed]]:
    """Every medication on a discharge sheet with its start/change/continue/stop status."""
    if mock_mode():
        return _mock_discharge()

    from google.genai import types

    start = time.perf_counter()
    model, resp = _generate(
        contents=[types.Part.from_bytes(data=image, mime_type=mime_type), DISCHARGE_PROMPT],
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=_SheetRead,
            media_resolution=types.MediaResolution.MEDIA_RESOLUTION_HIGH,
        ),
    )
    log.info("discharge model=%s bytes=%d %.1fs -> %s", model, len(image), time.perf_counter() - start, resp.text)
    parsed = resp.parsed
    if parsed is None:
        raise ValueError("Gemini returned no parseable result")
    return parsed.document_type, [DischargeMed.model_validate(m.model_dump()) for m in parsed.medications]


LEVELS = {
    "simple": "a 6th-grade reading level, short sentences, no jargon",
    "standard": "plain language for a general adult audience",
    "clinical": "precise clinical language for a healthcare professional",
}


def explain_flag(req: ExplainRequest) -> str:
    f = req.flag
    if mock_mode():
        return f"[mock, {req.profile.language}] {f.title}: {f.detail} Ask your pharmacist before taking these together."

    prompt = f"""Explain this medication safety flag to the patient.
Write in {req.profile.language}, at {LEVELS[req.profile.reading_level]}.
Use ONLY the facts and label text below. Do not add new medical claims, doses, or diagnoses.
End with one sentence telling them to check with their pharmacist or doctor.
Keep it under 90 words.

Flag: {f.title}
Drugs: {", ".join(f.drugs)}
Facts: {f.detail}
Label text: {f.excerpt or "(none)"}
Source: {f.source}"""
    _, resp = _generate(contents=prompt)
    return (resp.text or "").strip()