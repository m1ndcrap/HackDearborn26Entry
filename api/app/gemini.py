"""Gemini calls. Runs in MOCK mode (no key needed) so the frontend can be built before keys are ready."""
import logging
import os
import time
from typing import Optional

from dotenv import load_dotenv

from pydantic import create_model

from .models import ExplainRequest, Medication, ScanResult

load_dotenv()
log = logging.getLogger("uvicorn.error")

# Pinned stable model ID (no -preview / -latest alias, so behavior can't shift on demo day)
MODEL = os.getenv("GEMINI_MODEL", "gemini-3.5-flash")
API_KEY = os.getenv("GEMINI_API_KEY", "")

_client = None


def mock_mode() -> bool:
    return not API_KEY


def _get_client():
    global _client
    if _client is None:
        from google import genai

        _client = genai.Client(api_key=API_KEY)
    return _client


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
    resp = _get_client().models.generate_content(
        model=MODEL,
        contents=[types.Part.from_bytes(data=image, mime_type=mime_type), SCAN_PROMPT],
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=_LabelRead,
            media_resolution=types.MediaResolution.MEDIA_RESOLUTION_HIGH,  # small label text
        ),
    )
    # One line per scan, so extraction can be checked with `docker compose logs -f api`
    log.info("scan model=%s bytes=%d %.1fs -> %s", MODEL, len(image), time.perf_counter() - start, resp.text)
    parsed = resp.parsed
    if parsed is None:
        raise ValueError("Gemini returned no parseable result")
    return ScanResult.model_validate(parsed.model_dump())


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
    resp = _get_client().models.generate_content(model=MODEL, contents=prompt)
    return (resp.text or "").strip()