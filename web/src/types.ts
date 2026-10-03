// Mirrors api/app/models.py. Keep in sync.
export type Severity = "info" | "caution" | "high";
export type ReadingLevel = "simple" | "standard" | "clinical";

export interface Medication {
  id: string;
  name: string;
  ingredient?: string | null;
  ingredients?: string[]; // all generic ingredients, filled by RxNorm on the server
  strength?: string | null;
  dose?: string | null;
  frequency?: string | null;
  instructions?: string | null;
  warnings: string[];
  confidence: number;
}

export interface ScanResult {
  document_type: "pill_bottle" | "otc_box" | "discharge_sheet" | "unknown";
  medications: Medication[];
}

export interface Profile {
  id: string;
  name: string;
  age?: number | null;
  allergies: string[];
  conditions: string[];
  language: string;
  reading_level: ReadingLevel;
}

export interface SafetyFlag {
  id: string;
  severity: Severity;
  kind: "interaction" | "allergy" | "duplicate" | "condition" | "food_alcohol";
  title: string;
  drugs: string[];
  detail: string;
  source: string; // e.g. "FDA label for COUMADIN (warfarin), Drug Interactions section"
  excerpt?: string | null; // the label sentence this flag came from
  source_url?: string | null; // DailyMed page for that label
}

export interface SafetyReport {
  flags: SafetyFlag[];
  checked: number;
  unchecked?: string[]; // medicine names whose FDA label couldn't be found or fetched
}