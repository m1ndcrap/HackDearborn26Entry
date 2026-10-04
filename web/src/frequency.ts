// Structured "how often" choices <-> the plain-English directions the schedule parser understands.
// Typed medicines use this, so their schedules are exact instead of guessed from label text.
import { parseDirections } from "./schedule";

export type HowOften = "once" | "twice" | "three" | "four" | "hours" | "prn" | "weekly";
export type TimeOfDay = "morning" | "evening" | "bedtime";
export type Food = "any" | "with" | "empty";

export interface FrequencyChoice {
  howOften: HowOften;
  everyHours: number; // used when howOften === "hours"
  timeOfDay: TimeOfDay; // used when howOften === "once"
  food: Food;
}

export const DEFAULT_CHOICE: FrequencyChoice = { howOften: "once", everyHours: 8, timeOfDay: "morning", food: "any" };

export const HOW_OFTEN_OPTIONS: { value: HowOften; label: string }[] = [
  { value: "once", label: "Once a day" },
  { value: "twice", label: "Twice a day" },
  { value: "three", label: "3 times a day" },
  { value: "four", label: "4 times a day" },
  { value: "hours", label: "Every few hours" },
  { value: "prn", label: "Only when needed" },
  { value: "weekly", label: "Once a week" },
];

export function toDirections(c: FrequencyChoice): string {
  const base = {
    once: c.timeOfDay === "bedtime" ? "once daily at bedtime" : `once daily in the ${c.timeOfDay}`,
    twice: "twice daily",
    three: "three times daily",
    four: "four times daily",
    hours: `every ${c.everyHours} hours`,
    prn: "as needed",
    weekly: "once weekly",
  }[c.howOften];
  if (c.howOften === "prn") return base;
  const food = c.food === "with" ? " with food" : c.food === "empty" ? " on an empty stomach" : "";
  return base + food;
}

/** Best-effort reverse, so an existing entry can be edited with the same buttons. */
export function fromDirections(text?: string | null): FrequencyChoice {
  const t = (text ?? "").toLowerCase();
  const p = parseDirections(t);
  const food: Food = /empty stomach|before (breakfast|meals?)/.test(t) ? "empty" : /with (food|meals?|a meal)/.test(t) ? "with" : "any";
  const timeOfDay: TimeOfDay = /bedtime|at night|before bed/.test(t) ? "bedtime" : /evening|dinner|night/.test(t) ? "evening" : "morning";
  switch (p.kind) {
    case "prn":
      return { ...DEFAULT_CHOICE, howOften: "prn" };
    case "weekly":
      return { ...DEFAULT_CHOICE, howOften: "weekly", food };
    case "interval":
      return { ...DEFAULT_CHOICE, howOften: "hours", everyHours: p.hours, food };
    case "count":
      return { ...DEFAULT_CHOICE, howOften: (["once", "twice", "three", "four"] as const)[Math.min(p.count, 4) - 1], timeOfDay, food };
    default:
      return DEFAULT_CHOICE;
  }
}