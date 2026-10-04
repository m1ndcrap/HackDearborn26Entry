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
type Slot = "wake" | "lunch" | "dinner" | "bed";
type Parsed =
  | { kind: "count"; count: number; food: Food; slot: Slot | null }
  | { kind: "slots"; slots: Slot[]; food: Food } // one dose at each named time: "morning and evening"
  | { kind: "times"; minutes: number[]; food: Food } // exact clock times: "at 11 pm", "8am and 8pm"
  | { kind: "interval"; hours: number; food: Food; at?: number } // at: first dose, if the label gives a clock time
  | { kind: "weekly"; food: Food; at?: number }
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

  const clock = [...new Set(clockTimes(t))].sort((x, y) => x - y);
  if (/once (a|per|every) week|\bweekly\b|every week/.test(t)) return { kind: "weekly", food, at: clock[0] };

  const iv = t.match(/every (\d+)(?:\s*(?:-|to)\s*(\d+))? ?(?:hours?|hrs?|h)\b/) ?? t.match(/\bq(\d+)h\b/);
  if (iv) {
    const hours = Math.max(Number(iv[1]), Number(iv[2] ?? 0));
    if (hours >= 2 && hours <= 24) return { kind: "interval", hours, food, at: clock[0] };
  }

  // Exact clock times win over guesses from words like "evening": "at 11 pm" used to land at dinner (6:30 PM)
  // because only "pm" was read. Ignored if they cover fewer doses than an explicit count ("twice daily at 8 am").
  const explicitCount = /four times|4 times|\b4x\b|\bqid\b/.test(t) ? 4 : /three times|3 times|\b3x\b|\btid\b/.test(t) ? 3 : /twice|two times|2 times|\b2x\b|\bbid\b/.test(t) ? 2 : 0;
  if (clock.length && clock.length >= explicitCount) return { kind: "times", minutes: clock, food };

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

  // "every morning and evening", "1 tablet in the morning and 1 at bedtime": each named time is a dose.
  // Without this only one slot was picked and the other dose silently disappeared.
  const named: Slot[] = [];
  if (/morning|\bam\b|breakfast/.test(t)) named.push("wake");
  if (/noon|lunch|midday/.test(t)) named.push("lunch");
  if (/evening|\bpm\b|supper|dinner/.test(t)) named.push("dinner");
  if (/bedtime|at night|\bqhs\b|before bed/.test(t)) named.push("bed");
  if (named.length >= 2 && !/once|one time|1 time|\b1x\b|\bqd\b/.test(t)) return { kind: "slots", slots: named, food };
  if (/once|one time|1 time|\b1x\b|\bdaily\b|every ?day|each day|a day|\bqd\b|\bqhs\b|bedtime/.test(t) || slot)
    return { kind: "count", count: 1, food, slot };
  return { kind: "unknown" };
}

/** "11 pm", "8am", "9:30 PM", "8:00 a.m." -> minutes after midnight */
function clockTimes(t: string): number[] {
  const out: number[] = [];
  for (const m of t.matchAll(/\b(\d{1,2})(?::([0-5]\d))?\s*([ap])\.?\s?m\b\.?/g)) {
    const h = Number(m[1]);
    if (h < 1 || h > 12) continue;
    out.push(((h % 12) + (m[3] === "p" ? 12 : 0)) * 60 + Number(m[2] ?? 0));
  }
  return out;
}

function baseTimes(p: Parsed, r: Routine): number[] {
  const wake = toMin(r.wake), bfast = toMin(r.breakfast), lunch = toMin(r.lunch), dinner = toMin(r.dinner), bed = toMin(r.bed);
  const meals = [bfast, lunch, dinner];
  const beforeMeal = (m: number) => Math.max(wake, m - 60);
  const spread = (n: number) => Array.from({ length: n }, (_, i) => wake + Math.round(((bed - wake) * i) / (n - 1)));

  // A single dose at a named time of day (or the default morning slot)
  const oneTime = (slot: Slot | null, food: Food) => {
    const at = slot === "bed" ? bed : slot === "dinner" ? dinner : slot === "lunch" ? lunch : food === "with" ? bfast : wake;
    return food === "empty" && slot !== "bed" ? beforeMeal(at === wake ? bfast : at) : at;
  };

  if (p.kind === "weekly") return [p.at ?? (p.food === "with" ? bfast : wake)];
  if (p.kind === "interval") {
    const out: number[] = [];
    const first = p.at ?? wake;
    for (let m = first; m < first + 1440; m += p.hours * 60) out.push(m);
    return out;
  }
  if (p.kind === "slots") return p.slots.map((s) => oneTime(s, p.food));
  if (p.kind === "times") return p.minutes; // the label's own times, used as written
  if (p.kind !== "count") return [];
  const { count, food, slot } = p;
  if (count === 1) return [oneTime(slot, food)];
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

const MIN_SAME_MED_GAP = 120; // minutes between two doses of the same medicine when one has to move
const SLOT_STEP = 30; // minutes between candidate times when looking for room

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
  // Each moved dose gets the first time that clears every rule AND stays MIN_SAME_MED_GAP away from the same
  // medicine's other doses. Moving doses independently to one fixed "safe" time used to stack them
  // (Cipro twice a day + Tums three times a day put two Tums doses at 1:00 PM).
  const byId = new Map(meds.map((m) => [m.id, m]));
  const dayEnd = bed >= wake ? bed : bed + 1440; // bedtime after midnight
  // Measure every dose from wake-up, so a 1:30 AM bedtime dose counts as late tonight, not early this morning
  for (const d of doses) d.minutes = wake + ((((d.minutes - wake) % 1440) + 1440) % 1440);
  const clearOfRules = (b: Dose, t: number) =>
    SEPARATION_RULES.every(
      (rule) =>
        !matches(byId.get(b.medId)!, rule.b) ||
        doses.every((a) => a.medId === b.medId || !matches(byId.get(a.medId)!, rule.a) || t - a.minutes >= rule.after * 60 || t - a.minutes <= -rule.before * 60),
    );
  // Only doses already in a safe spot count: a sibling that still breaks a rule is about to move too
  const clearOfOwnDoses = (b: Dose, t: number) =>
    doses.every((o) => o === b || o.medId !== b.medId || !clearOfRules(o, o.minutes) || Math.abs(o.minutes - t) >= MIN_SAME_MED_GAP);
  const findSlot = (b: Dose, later: number, earlier: number): number | null => {
    // Preferred: just after A, then further after; otherwise just before A, then further before
    for (let t = later; t <= dayEnd; t += SLOT_STEP) if (clearOfRules(b, t) && clearOfOwnDoses(b, t)) return t;
    for (let t = earlier; t >= wake; t -= SLOT_STEP) if (clearOfRules(b, t) && clearOfOwnDoses(b, t)) return t;
    return null;
  };

  const moved = new Map<string, { name: string; doses: Set<Dose>; apart: Set<string>; why: Set<string> }>(); // by medicine
  const stuck = new Map<string, ScheduleNote>(); // one "no room" note per pair of medicines
  for (let pass = 0; pass < 3; pass++) {
    let changed = false;
    for (const rule of SEPARATION_RULES) {
      for (const a of doses.filter((d) => matches(byId.get(d.medId)!, rule.a))) {
        for (const b of doses.filter((d) => d.medId !== a.medId && matches(byId.get(d.medId)!, rule.b))) {
          const gap = b.minutes - a.minutes;
          if (gap >= rule.after * 60 || gap <= -rule.before * 60) continue;
          const target = findSlot(b, a.minutes + rule.after * 60, a.minutes - rule.before * 60);
          if (target === null) {
            stuck.set(`${b.medId}|${a.medId}`, {
              text: `${b.name} and ${a.name} are too close together, and there's no room in the day to separate them. Ask your pharmacist.`,
              why: rule.why,
            });
            continue;
          }
          b.minutes = target;
          if (!b.tags.includes("moved")) b.tags.push("moved");
          b.tags = b.tags.filter((t) => t !== "with food" && t !== "empty stomach");
          const rec = moved.get(b.medId) ?? { name: b.name, doses: new Set<Dose>(), apart: new Set<string>(), why: new Set<string>() };
          rec.doses.add(b);
          rec.apart.add(a.name);
          rec.why.add(rule.why);
          moved.set(b.medId, rec);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  const andList = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}` : xs[0]);
  for (const { name, doses: ds, apart, why } of moved.values()) {
    const times = [...ds].map((d) => d.minutes).sort((x, y) => x - y).map((m) => fmtTime(wrap(m)));
    notes.push({ text: `Moved ${name} to ${andList(times)} to keep it apart from ${andList([...apart])}.`, why: [...why].join(" ") });
  }
  notes.push(...stuck.values());

  for (const d of doses) {
    d.minutes = wrap(d.minutes);
    const inDay = wake <= bed ? d.minutes >= wake && d.minutes <= bed : d.minutes >= wake || d.minutes <= bed;
    if (!inDay && !d.tags.includes("overnight")) d.tags.push("overnight");
  }
  // Sort starting from wake-up time so overnight doses land at the end of the day.
  doses.sort((x, y) => ((x.minutes - wake + 1440) % 1440) - ((y.minutes - wake + 1440) % 1440));
  return { doses, asNeeded, unparsed, notes };
}