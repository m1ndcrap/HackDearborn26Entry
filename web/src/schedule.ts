// Turns label directions ("twice daily with food") into clock times, then spaces out
// medicines that labels say to separate. Pure functions: no React, easy to test.
import type { Medication } from "./types";

export interface Routine {
  wake: string;
  breakfast: string;
  lunch: string;
  dinner: string;
  bed: string;
}

export const DEFAULT_ROUTINE: Routine = { wake: "07:00", breakfast: "08:00", lunch: "12:30", dinner: "18:30", bed: "22:00" };

export interface Dose {
  id: string;
  medId: string;
  name: string;
  detail: string; // "1 tablet · 5 mg"
  minutes: number; // minutes after midnight, 0-1439
  tags: string[]; // "with food", "empty stomach", "overnight", "moved", "weekly"
  weekly?: boolean;
}

export interface ScheduleNote {
  text: string;
  why: string;
}

export interface Schedule {
  doses: Dose[];
  asNeeded: Medication[];
  unparsed: Medication[];
  notes: ScheduleNote[];
}

export const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};
const wrap = (m: number) => ((Math.round(m) % 1440) + 1440) % 1440;

export function fmtTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

type Food = "with" | "empty" | null;
type Parsed =
  | { kind: "count"; count: number; food: Food; slot: "wake" | "lunch" | "dinner" | "bed" | null }
  | { kind: "interval"; hours: number; food: Food }
  | { kind: "weekly"; food: Food }
  | { kind: "prn" }
  | { kind: "unknown" };

export function parseDirections(text: string): Parsed {
  const t = ` ${text.toLowerCase().replace(/\s+/g, " ")} `;
  if (/as needed|\bprn\b|when needed|if needed/.test(t)) return { kind: "prn" };

  const food: Food = /empty stomach|before (breakfast|meals?|eating|food)|\b(30|60) minutes before|1 hour before|\bac\b/.test(t)
    ? "empty"
    : /with (food|meals?|a meal|breakfast|lunch|dinner|milk)|after (meals?|eating|food)|\bpc\b/.test(t)
      ? "with"
      : null;

  if (/once (a|per|every) week|\bweekly\b|every week/.test(t)) return { kind: "weekly", food };

  const iv = t.match(/every (\d+)(?:\s*(?:-|to)\s*(\d+))? ?(?:hours?|hrs?|h)\b/) ?? t.match(/\bq(\d+)h\b/);
  if (iv) {
    const hours = Math.max(Number(iv[1]), Number(iv[2] ?? 0));
    if (hours >= 2 && hours <= 24) return { kind: "interval", hours, food };
  }

  const slot = /bedtime|at night|\bqhs\b|before bed/.test(t)
    ? "bed"
    : /evening|\bpm\b|supper|dinner/.test(t)
      ? "dinner"
      : /noon|lunch|midday/.test(t)
        ? "lunch"
        : /morning|\bam\b|breakfast/.test(t)
          ? "wake"
          : null;

  if (/four times|4 times|\b4x\b|\bqid\b/.test(t)) return { kind: "count", count: 4, food, slot: null };
  if (/three times|3 times|\b3x\b|\btid\b/.test(t)) return { kind: "count", count: 3, food, slot: null };
  if (/twice|two times|2 times|\b2x\b|\bbid\b/.test(t)) return { kind: "count", count: 2, food, slot: null };
  if (/once|one time|1 time|\b1x\b|\bdaily\b|every day|each day|a day|\bqd\b|\bqhs\b|bedtime/.test(t) || slot)
    return { kind: "count", count: 1, food, slot };
  return { kind: "unknown" };
}

function baseTimes(p: Parsed, r: Routine): number[] {
  const wake = toMin(r.wake), bfast = toMin(r.breakfast), lunch = toMin(r.lunch), dinner = toMin(r.dinner), bed = toMin(r.bed);
  const meals = [bfast, lunch, dinner];
  const beforeMeal = (m: number) => Math.max(wake, m - 60);
  const spread = (n: number) => Array.from({ length: n }, (_, i) => wake + Math.round(((bed - wake) * i) / (n - 1)));

  if (p.kind === "weekly") return [p.food === "with" ? bfast : wake];
  if (p.kind === "interval") {
    const out: number[] = [];
    for (let m = wake; m < wake + 1440; m += p.hours * 60) out.push(m);
    return out;
  }
  if (p.kind !== "count") return [];
  const { count, food, slot } = p;
  if (count === 1) {
    const at = slot === "bed" ? bed : slot === "dinner" ? dinner : slot === "lunch" ? lunch : food === "with" ? bfast : wake;
    return [food === "empty" && slot !== "bed" ? beforeMeal(at === wake ? bfast : at) : at];
  }
  if (food === "empty") return (count === 4 ? [...meals, bed] : count === 3 ? meals : [bfast, dinner]).map((m, i, a) => (i === a.length - 1 && count === 4 ? m : beforeMeal(m)));
  if (count === 2) return food === "with" ? [bfast, dinner] : [wake, Math.min(wake + 720, bed)];
  if (count === 3) return food === "with" ? meals : spread(3);
  return food === "with" ? [...meals, bed] : spread(4);
}

// Demo separation rules from common label guidance. Person 1 can feed label text in here later.
// B doses must be at least `after` hours after A, or `before` hours before A.
interface SepRule {
  a: string[];
  b: string[];
  before: number;
  after: number;
  why: string;
}
const MINERALS = ["calcium", "iron", "ferrous", "magnesium", "aluminum", "antacid", "zinc", "multivitamin"];
const SEPARATION_RULES: SepRule[] = [
  { a: ["levothyroxine"], b: MINERALS, before: 4, after: 4, why: "Calcium, iron, and antacids can block levothyroxine from being absorbed. Labels advise keeping them about 4 hours apart." },
  { a: ["ciprofloxacin"], b: MINERALS, before: 2, after: 6, why: "Minerals and antacids bind to ciprofloxacin. Its label advises taking it 2 hours before or 6 hours after them." },
  { a: ["levofloxacin", "doxycycline", "tetracycline"], b: MINERALS, before: 2, after: 2, why: "Minerals and antacids can stop this antibiotic from being absorbed. Keep them about 2 hours apart." },
];

const ingredientsOf = (m: Medication) =>
  (m.ingredients?.length ? m.ingredients : [m.ingredient || m.name]).map((s) => s.toLowerCase());
const matches = (m: Medication, terms: string[]) => ingredientsOf(m).some((i) => terms.some((t) => i.includes(t)));

export function buildSchedule(meds: Medication[], routine: Routine = DEFAULT_ROUTINE): Schedule {
  const wake = toMin(routine.wake), bed = toMin(routine.bed);
  const doses: Dose[] = [];
  const asNeeded: Medication[] = [];
  const unparsed: Medication[] = [];
  const notes: ScheduleNote[] = [];

  for (const m of meds) {
    const p = parseDirections([m.frequency, m.instructions].filter(Boolean).join(" "));
    if (p.kind === "prn") { asNeeded.push(m); continue; }
    const times = baseTimes(p, routine);
    if (times.length === 0) { unparsed.push(m); continue; }
    const food = "food" in p ? p.food : null;
    times.forEach((t, i) => {
      const tags: string[] = [];
      if (food === "with") tags.push("with food");
      if (food === "empty") tags.push("empty stomach");
      if (p.kind === "weekly") tags.push("weekly");
      doses.push({
        id: `${m.id}-${i}`,
        medId: m.id,
        name: m.name,
        detail: [m.dose, m.strength].filter(Boolean).join(" · "),
        minutes: t,
        tags,
        weekly: p.kind === "weekly",
      });
    });
  }

  // Space out separated pairs by moving the B dose (usually the supplement or antacid).
  const byId = new Map(meds.map((m) => [m.id, m]));
  const moved = new Map<string, { dose: Dose; apart: Set<string>; why: Set<string> }>();
  for (let pass = 0; pass < 3; pass++) {
    let changed = false;
    for (const rule of SEPARATION_RULES) {
      for (const a of doses.filter((d) => matches(byId.get(d.medId)!, rule.a))) {
        for (const b of doses.filter((d) => d.medId !== a.medId && matches(byId.get(d.medId)!, rule.b))) {
          const gap = b.minutes - a.minutes;
          if (gap >= rule.after * 60 || gap <= -rule.before * 60) continue;
          const later = a.minutes + rule.after * 60;
          const earlier = a.minutes - rule.before * 60;
          const target = later <= bed ? later : earlier >= wake ? earlier : null;
          if (target === null) {
            notes.push({ text: `${b.name} and ${a.name} are too close together, and there's no room in the day to separate them. Ask your pharmacist.`, why: rule.why });
            continue;
          }
          b.minutes = target;
          if (!b.tags.includes("moved")) b.tags.push("moved");
          b.tags = b.tags.filter((t) => t !== "with food" && t !== "empty stomach");
          const rec = moved.get(b.id) ?? { dose: b, apart: new Set<string>(), why: new Set<string>() };
          rec.apart.add(a.name);
          rec.why.add(rule.why);
          moved.set(b.id, rec);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  for (const { dose, apart, why } of moved.values()) {
    const names = [...apart];
    const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0];
    notes.push({ text: `Moved ${dose.name} to ${fmtTime(wrap(dose.minutes))} to keep it apart from ${list}.`, why: [...why].join(" ") });
  }

  for (const d of doses) {
    d.minutes = wrap(d.minutes);
    const inDay = wake <= bed ? d.minutes >= wake && d.minutes <= bed : d.minutes >= wake || d.minutes <= bed;
    if (!inDay && !d.tags.includes("overnight")) d.tags.push("overnight");
  }
  // Sort starting from wake-up time so overnight doses land at the end of the day.
  doses.sort((x, y) => ((x.minutes - wake + 1440) % 1440) - ((y.minutes - wake + 1440) % 1440));
  return { doses, asNeeded, unparsed, notes };
}