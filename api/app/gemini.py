"""Gemini calls. Runs in MOCK mode (no key needed) so the frontend can be built before keys are ready."""
import os
from typing import Optional

from dotenv import load_dotenv

from .models import ExplainRequest, Medication, ScanResult

load_dotenv()

MODEL = os.getenv("GEMINI_MODEL", "gemini-3-flash-preview")
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


SCAN_PROMPT = """You are reading a photo of a medication label, an over-the-counter box, or a discharge/prescription sheet.
Extract every medication you can see. Rules:
- Copy values exactly as printed. If a field is not visible, leave it null. Never guess a dose.
- Put the generic active ingredient in `ingredient` only if it is printed or you are certain.
- `confidence` is 0-1: how sure you are the fields were read correctly (blurry, cut off, or glare = low).
- `document_type` is one of pill_bottle, otc_box, discharge_sheet, unknown.
Return JSON matching the schema."""


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

    resp = _get_client().models.generate_content(
        model=MODEL,
        contents=[types.Part.from_bytes(data=image, mime_type=mime_type), SCAN_PROMPT],
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=ScanResult,
            temperature=0,
        ),
    )
    parsed: Optional[ScanResult] = resp.parsed  # type: ignore[assignment]
    if parsed is None:
        raise ValueError("Gemini returned no parseable result")
    return parsed


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