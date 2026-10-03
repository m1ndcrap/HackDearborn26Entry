// Last safety report per profile, so the Passport and Check screens work offline.
import type { SafetyReport } from "./types";

const key = (profileId: string) => `apothecary:report:${profileId}`;

export interface CachedReport {
  at: string; // ISO time
  report: SafetyReport;
}

export function saveReport(profileId: string, report: SafetyReport) {
  try {
    localStorage.setItem(key(profileId), JSON.stringify({ at: new Date().toISOString(), report }));
  } catch {
    /* storage full or blocked */
  }
}

export function loadReport(profileId: string): CachedReport | null {
  try {
    const raw = localStorage.getItem(key(profileId));
    return raw ? (JSON.parse(raw) as CachedReport) : null;
  } catch {
    return null;
  }
}