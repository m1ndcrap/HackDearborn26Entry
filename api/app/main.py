import uuid

from fastapi import FastAPI, File, HTTPException, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from . import gemini, openfda, rxnorm, safety, tts
from .models import ExplainRequest, ExplainResponse, Medication, ReportRequest, SafetyReport, ScanResult

app = FastAPI(title="Pocket Apothecary API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.get("/")
def root():
    return {"app": "Pocket Apothecary API", "docs": "/docs", "health": "/health"}


@app.get("/health")
def health():
    return {"ok": True, "gemini_mock_mode": gemini.mock_mode(), "model": gemini.MODEL, "elevenlabs": tts.configured(), "openfda_key": bool(openfda.API_KEY)}


def _apply_normalization(m: Medication) -> None:
    norm = rxnorm.normalize(m.name)
    if norm["source"] == "fallback" and m.ingredient:
        norm = rxnorm.normalize(m.ingredient)
    if norm["ingredients"]:
        m.ingredients = norm["ingredients"]
        m.ingredient = norm["ingredients"][0]


@app.post("/api/scan", response_model=ScanResult)
async def scan(file: UploadFile = File(...)):
    data = await file.read()
    if not data:
        raise HTTPException(400, "Empty upload")
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(413, "Image too large (10 MB max)")
    try:
        result = gemini.extract_medications(data, file.content_type or "image/jpeg")
    except Exception as e:
        raise HTTPException(502, f"Couldn't read that image: {e}")
    for m in result.medications:
        m.id = uuid.uuid4().hex[:8]
        await run_in_threadpool(_apply_normalization, m)
    return result


@app.get("/api/normalize")
def normalize(name: str):
    """Brand/misspelled name -> generic ingredient(s). Use this for manually added medicines too."""
    return rxnorm.normalize(name)


@app.post("/api/report", response_model=SafetyReport)
def report(req: ReportRequest):
    return safety.build_report(req.profile, req.medications)


@app.post("/api/explain", response_model=ExplainResponse)
def explain(req: ExplainRequest):
    try:
        return ExplainResponse(text=gemini.explain_flag(req))
    except Exception as e:
        raise HTTPException(502, f"Couldn't generate an explanation: {e}")


class TTSRequest(BaseModel):
    text: str


@app.post("/api/tts")
def speak(req: TTSRequest):
    if not tts.configured():
        raise HTTPException(503, "ElevenLabs isn't configured")
    if not req.text.strip():
        raise HTTPException(400, "No text to read")
    try:
        audio = tts.synthesize(req.text)
    except Exception as e:
        raise HTTPException(502, f"Voice service failed: {e}")
    return Response(content=audio, media_type="audio/mpeg")


@app.get("/api/label/{ingredient}")
def label(ingredient: str):
    return safety.fetch_label_section(ingredient.lower())