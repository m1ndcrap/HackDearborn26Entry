import type { Medication, OtcCheckResponse, Profile, SafetyFlag, SafetyReport, ScanResult } from "./types";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = res.statusText;
    try {
      msg = (await res.json()).detail ?? msg;
    } catch {
      /* not JSON */
    }
    throw new Error(msg);
  }
  return res.json();
}

export async function scanImage(file: File): Promise<ScanResult> {
  const body = new FormData();
  body.append("file", file);
  return json(await fetch("/api/scan", { method: "POST", body }));
}

export async function getReport(profile: Profile, medications: Medication[]): Promise<SafetyReport> {
  return json(
    await fetch("/api/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile, medications }),
    }),
  );
}

/** Pre-purchase check: is each candidate OK with the cabinet? Nothing is saved. */
export async function checkOtc(profile: Profile, cabinet: Medication[], candidates: Medication[]): Promise<OtcCheckResponse> {
  return json(
    await fetch("/api/check-otc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile, cabinet, candidates }),
    }),
  );
}

export async function explainFlag(profile: Profile, flag: SafetyFlag): Promise<string> {
  const r = await json<{ text: string }>(
    await fetch("/api/explain", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile, flag }),
    }),
  );
  return r.text;
}

export interface Normalized {
  input: string;
  cleaned: string;
  ingredients: string[];
  rxcui: string | null;
  source: "local" | "rxnorm" | "fallback" | "none";
}

/** Brand or misspelled name -> generic ingredients. Use for manually added medicines. */
export async function normalizeName(name: string): Promise<Normalized> {
  return json(await fetch(`/api/normalize?name=${encodeURIComponent(name)}`));
}

export class TtsUnavailable extends Error {}

/** ElevenLabs audio from the backend. Throws TtsUnavailable when the server has no ElevenLabs key. */
export async function ttsAudio(text: string): Promise<Blob> {
  const res = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (res.status === 503) throw new TtsUnavailable("ElevenLabs isn't configured");
  if (!res.ok) throw new Error(`Voice request failed (${res.status})`);
  return res.blob();
}