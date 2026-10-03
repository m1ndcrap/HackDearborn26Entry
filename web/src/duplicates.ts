import type { Medication } from "./types";

// How a newly scanned medicine relates to one already in the cabinet. Matched by ingredient, not name:
// the dangerous duplicates are different names for the same drug (Tylenol + Tylenol PM).
export type MatchKind = "exact" | "strength" | "overlap";
export type DupAction = "replace" | "add" | "skip";

export interface CabinetMatch {
  kind: MatchKind;
  existing: Medication;
  shared: string[]; // ingredients both contain
}

// "acetaminophen / diphenhydramine" -> both. Unverified scans have no ingredient, so fall back to the name.
const ingredientsOf = (m: Medication): string[] =>
  (m.ingredient || m.name)
    .toLowerCase()
    .split(" / ")
    .map((s) => s.trim())
    .filter(Boolean);

const normStrength = (s?: string | null) => (s ?? "").toLowerCase().replace(/\s+/g, "");

const RANK: Record<MatchKind, number> = { exact: 0, strength: 1, overlap: 2 };

export function findCabinetMatch(scanned: Medication, cabinet: Medication[]): CabinetMatch | null {
  const mine = ingredientsOf(scanned);
  let best: CabinetMatch | null = null;
  for (const existing of cabinet) {
    const theirs = ingredientsOf(existing);
    const shared = mine.filter((i) => theirs.includes(i));
    const sameName = scanned.name.trim().toLowerCase() === existing.name.trim().toLowerCase();
    if (shared.length === 0 && !sameName) continue;
    const sameDrug = sameName || (shared.length === mine.length && shared.length === theirs.length);
    const a = normStrength(scanned.strength);
    const b = normStrength(existing.strength);
    // A missing strength on either side can't prove a dose change, so treat it as the same medicine
    const kind: MatchKind = !sameDrug ? "overlap" : a && b && a !== b ? "strength" : "exact";
    if (!best || RANK[kind] < RANK[best.kind]) best = { kind, existing, shared };
  }
  return best;
}

// Exact copy: probably a refill. Different strength: the dose probably changed and the old bottle is the risk.
export const DEFAULT_ACTION: Record<MatchKind, DupAction> = { exact: "replace", strength: "replace", overlap: "add" };

export function describeMatch(m: CabinetMatch): { message: string; options: { value: DupAction; label: string }[] } {
  const old = [m.existing.name, m.existing.strength].filter(Boolean).join(" ");
  switch (m.kind) {
    case "exact":
      return {
        message: `Already in your cabinet: ${old}.`,
        options: [
          { value: "replace", label: "Update the existing one" },
          { value: "add", label: "Add as a second entry" },
          { value: "skip", label: "Don't add" },
        ],
      };
    case "strength":
      return {
        message: `You already have ${old}. Did the dose change?`,
        options: [
          { value: "replace", label: "Replace the old one" },
          { value: "add", label: "Keep both" },
          { value: "skip", label: "Don't add" },
        ],
      };
    case "overlap":
      return {
        message: `${old} also contains ${m.shared.join(" and ")}. Taking both can mean taking too much.`,
        options: [
          { value: "add", label: "Add anyway" },
          { value: "skip", label: "Don't add" },
        ],
      };
  }
}
