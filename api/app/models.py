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
    strength: Optional[str] = Field(default=None, description="e.g. 500 mg")
    dose: Optional[str] = Field(default=None, description="e.g. 1 tablet")
    frequency: Optional[str] = Field(default=None, description="e.g. twice daily with food")
    instructions: Optional[str] = None
    warnings: list[str] = Field(default_factory=list, description="Warnings printed on the label")
    confidence: float = Field(default=0.5, description="0-1 confidence that the fields above were read correctly")


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
    source: str


class ReportRequest(BaseModel):
    profile: Profile
    medications: list[Medication]


class SafetyReport(BaseModel):
    flags: list[SafetyFlag]
    checked: int


class ExplainRequest(BaseModel):
    profile: Profile
    flag: SafetyFlag


class ExplainResponse(BaseModel):
    text: str
