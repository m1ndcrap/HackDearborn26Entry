import uuid
from concurrent.futures import ThreadPoolExecutor

from fastapi import FastAPI, File, Form, HTTPException, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, TypeAdapter, ValidationError
from starlette.concurrency import run_in_threadpool

from . import gemini, openfda, otc, translate, reconcile, rxnorm, safety, tts, drugs
from .models import (ExplainRequest, ExplainResponse, Medication, OTCCheckRequest, OTCCheckResponse, Profile,
                     ReconcileResponse, ReportRequest, SafetyReport, ScanResult)

GEMINI_BUSY = "Gemini is busy right now. Wait a few seconds and try again."

app = FastAPI(title="Pocket Apothecary API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.get("/")
def root():
    return {"app": "Pocket Apothecary API", "docs": "/docs", "health": "/health"}


@app.get("/health")
def health():
    return {"ok": True, "gemini_mock_mode": gemini.mock_mode(), "model": gemini.MODEL, "fallback_model": gemini.FALLBACK_MODEL, "elevenlabs": tts.configured(), "openfda_key": bool(openfda.API_KEY)}


def _identify(m: Medication) -> None:
    """Database verification first (RxNorm / FDA NDC); simple name normalization only if that found nothing."""
    drugs.verify(m)  # Gemini read it; RxNorm / FDA NDC decide what it is
    if m.verified_by and m.ingredient:
        # Keep every ingredient verify found (Tylenol PM = acetaminophen + diphenhydramine).
        # m.ingredient stays "a / b" because the cabinet duplicate check reads it that way.
        m.ingredients = [i.strip() for i in m.ingredient.split(" / ") if i.strip()]
        return
    norm = rxnorm.normalize(m.name)
    if norm["source"] == "fallback" and m.ingredient:
        norm = rxnorm.normalize(m.ingredient)
    if norm["ingredients"]:
        m.ingredients = norm["ingredients"]
        m.ingredient = " / ".join(norm["ingredients"])


@app.post("/api/scan", response_model=ScanResult)
async def scan(file: UploadFile = File(...)):
    data = await file.read()
    if not data:
        raise HTTPException(400, "Empty upload")
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(413, "Image too large (10 MB max)")
    try:
        # Blocking SDK call: run it on a worker thread so other requests aren't stuck behind it
        result = await run_in_threadpool(gemini.extract_medications, data, file.content_type or "image/jpeg")
    except gemini.GeminiBusy:
        raise HTTPException(503, GEMINI_BUSY)
    except Exception as e:
        raise HTTPException(502, f"Couldn't read that image: {e}")
    for m in result.medications:
        m.id = uuid.uuid4().hex[:8]
        await run_in_threadpool(_identify, m)  # network lookups: keep them off the event loop
    return result


def _identify_all(meds: list[Medication]) -> None:
    with ThreadPoolExecutor(max_workers=min(6, len(meds) or 1)) as pool:
        list(pool.map(_identify, meds))  # a discharge sheet has many lines; look them up in parallel


@app.post("/api/reconcile", response_model=ReconcileResponse)
async def reconcile_sheet(file: UploadFile = File(...), profile: str = Form(...), cabinet: str = Form("[]")):
    """Discharge reconciliation: photo of a discharge sheet + the current cabinet -> new / changed / stopped /
    duplicate / unchanged / not-on-sheet, plus a safety check on the after-discharge cabinet. Nothing is saved.
    Multipart form: `file` (image), `profile` and `cabinet` (JSON strings)."""
    data = await file.read()
    if not data:
        raise HTTPException(400, "Empty upload")
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(413, "Image too large (10 MB max)")
    try:
        prof = Profile.model_validate_json(profile)
        cab = TypeAdapter(list[Medication]).validate_json(cabinet)
    except ValidationError as e:
        raise HTTPException(422, f"Bad profile or cabinet: {e}")
    try:
        doc_type, sheet = await run_in_threadpool(gemini.extract_discharge, data, file.content_type or "image/jpeg")
    except gemini.GeminiBusy:
        raise HTTPException(503, GEMINI_BUSY)
    except Exception as e:
        raise HTTPException(502, f"Couldn't read that discharge sheet: {e}")
    if not sheet:
        raise HTTPException(422, "We couldn't find a medication list in that photo. Try again with the whole page in view.")
    for m in sheet:
        m.id = uuid.uuid4().hex[:8]
    await run_in_threadpool(_identify_all, sheet)
    return await run_in_threadpool(reconcile.reconcile, prof, cab, sheet, doc_type)


@app.get("/api/normalize")
def normalize(name: str):
    """Brand/misspelled name -> generic ingredient(s). Use this for manually added medicines too."""
    return rxnorm.normalize(name)


@app.post("/api/report", response_model=SafetyReport)
def report(req: ReportRequest):
    return safety.build_report(req.profile, req.medications)


@app.post("/api/check-otc", response_model=OTCCheckResponse)
def check_otc(req: OTCCheckRequest):
    """Pre-purchase check: flags between each candidate and the cabinet. Nothing is saved."""
    if not req.candidates:
        raise HTTPException(400, "Nothing to check")
    for c in req.candidates:
        if not c.name.strip():
            raise HTTPException(400, "Each medicine needs a name")
        if not c.id:
            c.id = f"otc-{uuid.uuid4().hex[:6]}"
        if not c.ingredients and not c.ingredient:
            _identify(c)  # typed names: find the ingredients first
    return otc.check(req.profile, req.cabinet, req.candidates)


class TranslateRequest(BaseModel):
    language: str
    texts: list[str]


@app.post("/api/translate")
def translate_ui(req: TranslateRequest):
    """App interface text -> the person's chosen language. Untranslatable strings come back in English."""
    lang = req.language.strip()[:40]
    texts = [t[:400] for t in req.texts[:150]]
    try:
        return {"texts": translate.translate_texts(lang, texts)}
    except Exception:
        return {"texts": texts}  # never break the app over a translation


@app.post("/api/explain", response_model=ExplainResponse)
def explain(req: ExplainRequest):
    try:
        return ExplainResponse(text=gemini.explain_flag(req))
    except gemini.GeminiBusy:
        raise HTTPException(503, GEMINI_BUSY)
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