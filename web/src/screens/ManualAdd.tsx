import { useMemo, useState } from "react";
import { normalizeName, type Normalized } from "../api";
import { DEFAULT_CHOICE, fromDirections, HOW_OFTEN_OPTIONS, toDirections, type FrequencyChoice } from "../frequency";
import { buildSchedule, DEFAULT_ROUTINE, fmtTime, parseDirections, type Routine } from "../schedule";
import type { Medication } from "../types";
import { useOnline } from "../useOnline";

const DOSE_PICKS = ["1 tablet", "2 tablets", "1 capsule", "½ tablet", "5 mL", "1 puff"];
const HOUR_PICKS = [4, 6, 8, 12];

interface Props {
  initial?: Medication; // pass an existing medicine to edit it
  routine?: Routine;
  submitLabel?: string;
  onSave: (med: Medication) => void;
  onCancel: () => void;
}

/** Big, simple form for adding (or editing) a medicine without scanning. */
export default function ManualAdd({ initial, routine = DEFAULT_ROUTINE, submitLabel = "Add to cabinet", onSave, onCancel }: Props) {
  const online = useOnline();
  const [name, setName] = useState(initial?.name ?? "");
  const [strength, setStrength] = useState(initial?.strength ?? "");
  const [dose, setDose] = useState(initial?.dose ?? "1 tablet");
  const [choice, setChoice] = useState<FrequencyChoice>(() => (initial ? fromDirections(initial.frequency) : DEFAULT_CHOICE));
  const [refill, setRefill] = useState(initial?.refill_date ?? "");
  const [expires, setExpires] = useState(initial?.expires_on ?? "");
  const [match, setMatch] = useState<Normalized | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");

  // Editing keeps the label's own wording until a button is tapped: converting "every 4 to 6 hours as needed"
  // to the buttons would drop the 4-6 hour limit, and an entry with no directions would get "once daily" invented.
  const [touched, setTouched] = useState(!initial);
  const knownOriginal = !initial || parseDirections(initial.frequency ?? "").kind !== "unknown";
  const showChoice = touched || knownOriginal; // don't highlight a guessed button for directions we couldn't read
  const set = (patch: Partial<FrequencyChoice>) => {
    setTouched(true);
    setChoice((c) => ({ ...c, ...patch }));
  };
  const directions = touched ? toDirections(choice) : initial?.frequency?.trim() ?? "";

  // Live preview of when this would be scheduled, using the person's own routine
  const preview = useMemo(() => {
    const plan = buildSchedule([{ id: "preview", name: name || "This medicine", frequency: directions, warnings: [], confidence: 1 }], routine);
    if (plan.asNeeded.length) return "Not scheduled. Taken only when needed.";
    const times = [...new Set(plan.doses.map((d) => fmtTime(d.minutes)))];
    return times.length ? `Scheduled at ${times.join(", ")}${choice.howOften === "weekly" ? " once a week" : ""}` : "";
  }, [name, directions, routine, choice.howOften]);

  async function lookUp(n = name): Promise<Normalized | null> {
    const q = n.trim();
    if (!q || !online) return null;
    setChecking(true);
    try {
      const r = await normalizeName(q);
      setMatch(r);
      return r;
    } catch {
      return null; // add as typed
    } finally {
      setChecking(false);
    }
  }

  async function save() {
    const n = name.trim();
    if (!n) {
      setError("Type the medicine's name first.");
      return;
    }
    setError("");
    const sameName = !!initial && initial.name.trim().toLowerCase() === n.toLowerCase();
    // Editing without renaming: keep what we already know instead of looking it up again
    const norm = sameName && initial?.ingredient ? null : match && match.input === n ? match : await lookUp(n);
    const known = norm && norm.source !== "fallback" && norm.source !== "none" ? norm.ingredients : [];
    const keepOld = sameName && !known.length; // renamed to something unknown: drop the old ingredients
    onSave({
      ...(initial ?? { warnings: [] }),
      id: initial?.id || Math.random().toString(36).slice(2, 10),
      name: n,
      strength: strength.trim() || null,
      dose: dose.trim() || null,
      frequency: directions || null,
      ingredients: known.length ? known : keepOld ? initial?.ingredients : undefined,
      ingredient: known.length ? known.join(" / ") : keepOld ? (initial?.ingredient ?? null) : null,
      rxcui: known.length ? norm!.rxcui : keepOld ? (initial?.rxcui ?? null) : null,
      verified_by: known.length ? (norm!.source === "rxnorm" ? "RxNorm" : "Pocket Apothecary") : keepOld ? (initial?.verified_by ?? null) : null,
      refill_date: refill || null,
      expires_on: expires || null,
      warnings: initial?.warnings ?? [],
      confidence: 1,
    });
  }

  return (
    <section className="manual">
      <h2>{initial ? `Edit ${initial.name}` : "Type in a medicine"}</h2>

      <label>
        Medicine name
        <input
          value={name}
          autoFocus={!initial}
          autoComplete="off"
          placeholder="e.g. Coumadin, metformin, Tylenol"
          onChange={(e) => {
            setName(e.target.value);
            setMatch(null);
          }}
          onBlur={() => name.trim() && lookUp()}
        />
      </label>
      {checking && <p className="hint">Checking the name…</p>}
      {!checking && match && match.input === name.trim() && (
        <p className={match.source === "fallback" ? "hint" : "hint good"}>
          {match.source === "fallback"
            ? "We didn't recognize that name, so it will be added as typed. Check the spelling to get safety checks."
            : `✓ ${match.ingredients.join(" + ")}`}
        </p>
      )}

      <div className="row">
        <label>
          Strength
          <input value={strength} onChange={(e) => setStrength(e.target.value)} placeholder="e.g. 5 mg" />
        </label>
        <label>
          Each dose
          <input value={dose} onChange={(e) => setDose(e.target.value)} list="dose-picks" />
          <datalist id="dose-picks">
            {DOSE_PICKS.map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
        </label>
      </div>

      <fieldset className="seg-group">
        <legend>How often?</legend>
        <div className="seg">
          {HOW_OFTEN_OPTIONS.map((o) => (
            <button key={o.value} type="button" aria-pressed={showChoice && choice.howOften === o.value} onClick={() => set({ howOften: o.value })}>
              {o.label}
            </button>
          ))}
        </div>
      </fieldset>

      {showChoice && choice.howOften === "hours" && (
        <fieldset className="seg-group">
          <legend>Every how many hours?</legend>
          <div className="seg">
            {HOUR_PICKS.map((h) => (
              <button key={h} type="button" aria-pressed={choice.everyHours === h} onClick={() => set({ everyHours: h })}>
                {h} hours
              </button>
            ))}
          </div>
        </fieldset>
      )}

      {showChoice && choice.howOften === "once" && (
        <fieldset className="seg-group">
          <legend>What time of day?</legend>
          <div className="seg">
            {(["morning", "evening", "bedtime"] as const).map((t) => (
              <button key={t} type="button" aria-pressed={choice.timeOfDay === t} onClick={() => set({ timeOfDay: t })}>
                {t[0].toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </fieldset>
      )}

      {showChoice && choice.howOften !== "prn" && (
        <fieldset className="seg-group">
          <legend>Food</legend>
          <div className="seg">
            {(
              [
                ["any", "Doesn't matter"],
                ["with", "With food"],
                ["empty", "Empty stomach"],
              ] as const
            ).map(([v, label]) => (
              <button key={v} type="button" aria-pressed={choice.food === v} onClick={() => set({ food: v })}>
                {label}
              </button>
            ))}
          </div>
        </fieldset>
      )}

      <details className="more" open={!!(initial?.refill_date || initial?.expires_on)}>
        <summary>Refill and expiry dates (optional)</summary>
        <div className="row">
          <label>
            Refill by
            <input type="date" value={refill} onChange={(e) => setRefill(e.target.value)} />
          </label>
          <label>
            Expires
            <input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
          </label>
        </div>
      </details>

      <div className="preview">
        <p>
          <strong>Directions:</strong> {[dose.trim(), directions].filter(Boolean).join(", ")}
        </p>
        {preview && <p className="sub">{preview}</p>}
      </div>

      {error && (
        <p role="alert" className="err">
          {error}
        </p>
      )}
      <div className="actions">
        <button className="primary" onClick={save} disabled={checking}>
          {submitLabel}
        </button>
        <button className="ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
      {!online && <p className="hint">You're offline, so the name can't be checked. It will be added as typed.</p>}
    </section>
  );
}