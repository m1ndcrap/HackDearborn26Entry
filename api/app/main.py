import uuid

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from . import gemini, safety
from .models import ExplainRequest, ExplainResponse, ReportRequest, SafetyReport, ScanResult

app = FastAPI(title="Pocket Apothecary API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.get("/health")
def health():
    return {"ok": True, "gemini_mock_mode": gemini.mock_mode(), "model": gemini.MODEL}


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
    return result


@app.post("/api/report", response_model=SafetyReport)
def report(req: ReportRequest):
    return safety.build_report(req.profile, req.medications)


@app.post("/api/explain", response_model=ExplainResponse)
def explain(req: ExplainRequest):
    try:
        return ExplainResponse(text=gemini.explain_flag(req))
    except Exception as e:
        raise HTTPException(502, f"Couldn't generate an explanation: {e}")


@app.get("/api/label/{ingredient}")
def label(ingredient: str):
    return safety.fetch_label_section(ingredient.lower())
