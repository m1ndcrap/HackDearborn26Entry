"""Shared data contract. Keep web/src/types.ts in sync with this file."""
from typing import Literal, Optional
from pydantic import BaseModel, Field

Severity = Literal["info", "caution", "high"]
FlagKind = Literal["interaction", "allergy", "duplicate", "condition", "food_alcohol"]
ReadingLevel = Literal["simple", "standard", "clinical"]


class Medication(BaseModel):
    id: str = ""
    name: str = Field(description="Drug name exactly as printed (brand or generic)")
    ingredient: Optional[str] = Field(default=None, description="Generic active ingredient if known")
    ingredients: list[str] = Field(default_factory=list, description="All generic active ingredients (filled by RxNorm on the server)")
    strength: Optional[str] = Field(default=None, description="e.g. 500 mg")
    dose: Optional[str] = Field(default=None, description="e.g. 1 tablet")
    frequency: Optional[str] = Field(default=None, description="e.g. twice daily with food")
    instructions: Optional[str] = None
    warnings: list[str] = Field(default_factory=list, description="Warnings printed on the label")
    confidence: float = Field(default=0.5, description="0-1 confidence that the fields above were read correctly")
    ndc: Optional[str] = Field(default=None, description="NDC number exactly as printed, e.g. 0573-0134-20")
    # Filled by drugs.verify, not by Gemini
    rxcui: Optional[str] = None
    verified_by: Optional[str] = None  # "FDA NDC Directory" | "RxNorm" | None (no database match)
    strength_verified: bool = False
    strength_options: list[str] = Field(default_factory=list)


class ScanResult(BaseModel):
    document_type: Literal["pill_bottle", "otc_box", "discharge_sheet", "unknown"] = "unknown"
    medications: list[Medication] = Field(default_factory=list)


class Profile(BaseModel):
    id: str
    name: str
    age: Optional[int] = None
    allergies: list[str] = Field(default_factory=list)
    conditions: list[str] = Field(default_factory=list)
    language: str = "English"
    reading_level: ReadingLevel = "simple"


class SafetyFlag(BaseModel):
    id: str
    severity: Severity
    kind: FlagKind
    title: str
    drugs: list[str]
    detail: str
    source: str  # human-readable citation, e.g. "FDA label for Coumadin (warfarin), Drug Interactions section"
    excerpt: Optional[str] = None  # the label sentence this flag came from
    source_url: Optional[str] = None  # DailyMed page for that label


class ReportRequest(BaseModel):
    profile: Profile
    medications: list[Medication]


class SafetyReport(BaseModel):
    flags: list[SafetyFlag]
    checked: int
    unchecked: list[str] = Field(default_factory=list)  # medicine names whose FDA label couldn't be found or fetched


class ExplainRequest(BaseModel):
    profile: Profile
    flag: SafetyFlag


class ExplainResponse(BaseModel):
    text: str


class OTCCheckRequest(BaseModel):
    profile: Profile
    cabinet: list[Medication]  # what the person already takes
    candidates: list[Medication]  # what they're thinking of buying (scanned or typed)


class OTCResult(BaseModel):
    medication: Medication  # the candidate, with ingredients filled in by the server
    verdict: Literal["ok", "ask", "avoid", "unknown"]
    summary: str
    flags: list[SafetyFlag]  # only flags that involve this candidate


class OTCCheckResponse(BaseModel):
    results: list[OTCResult]
    checked_against: int