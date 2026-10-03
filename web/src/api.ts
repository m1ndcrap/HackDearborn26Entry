import type { Medication, Profile, SafetyFlag, SafetyReport, ScanResult } from "./types";

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
