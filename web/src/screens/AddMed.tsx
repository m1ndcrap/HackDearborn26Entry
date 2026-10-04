import { useEffect, useState } from "react";
import { normalizeName, type Normalized } from "../api";
import { DEFAULT_ACTION, describeMatch, findCabinetMatch, type DupAction } from "../duplicates";
import type { Medication, Profile } from "../types";

const uid = () => Math.random().toString(36).slice(2, 10);

interface Props {
  profile: Profile;
  cabinet: Medication[];
  onSave: (med: Medication, replaceIds: string[]) => void;
  onCancel: () => void;
}

/** Add a medicine without scanning: a torn label, a vitamin, or a bottle that's somewhere else. */
export default function AddMed({ profile, cabinet, onSave, onCancel }: Props) {
  const [name, setName] = useState("");
  const [strength, setStrength] = useState("");
  const [dose, setDose] = useState("");
  const [frequency, setFrequency] = useState("");
  const [lookup, setLookup] = useState<Normalized | null>(null);
  const [looking, setLooking] = useState(false);
  const [choice, setChoice] = useState<DupAction | null>(null);

  // Find the ingredients shortly after typing stops (Advil -> ibuprofen), so safety checks and matching work
  useEffect(() => {
    const n = name.trim();
    setLookup(null);
    if (n.length < 3) return;
    let live = true;
    const t = setTimeout(() => {
      setLooking(true);
      normalizeName(n)
        .then((r) => live && setLookup(r))
        .catch(() => {}) // offline: save with the name only
        .finally(() => live && setLooking(false));
    }, 500);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [name]);

  const known = lookup && (lookup.source === "local" || lookup.source === "rxnorm") ? lookup.ingredients : [];
  const med: Medication = {
    id: "",
    name: name.trim(),
    strength: strength.trim() || null,
    dose: dose.trim() || null,
    frequency: frequency.trim() || null,
    ingredients: known,
    ingredient: known.length ? known.join(" / ") : null, // "a / b" is what the duplicate check reads
    rxcui: lookup?.rxcui ?? null,
    warnings: [],
    confidence: 1, // typed by the family, not read from a photo
  };
  const match = med.name ? findCabinetMatch(med, cabinet) : null;
  const dup = match && describeMatch(match);
  const action: DupAction = match ? (choice ?? DEFAULT_ACTION[match.kind]) : "add";

  function save() {
    if (action === "skip") return onCancel();
    onSave({ ...med, id: uid() }, action === "replace" && match ? [match.existing.id] : []);
  }

  return (
    <section>
      <h2>Add a medicine by hand</h2>
      <p className="hint">For {profile.name}. Copy what's on the label; only the name is required.</p>
      <div className="card">
        <label>
          Name
          <input
            value={name}
            autoFocus
            placeholder="e.g. Advil, metformin, NyQuil"
            onChange={(e) => {
              setName(e.target.value);
              setChoice(null);
            }}
          />
        </label>
        {looking && <p className="hint">Looking it up…</p>}
        {!looking && known.length > 0 && <p className="hint">✓ Contains {known.join(", ")}</p>}
        {!looking && lookup && known.length === 0 && (
          <p className="hint">We couldn't match this to a known medicine. Check the spelling; safety checks may miss it.</p>
        )}
        {match && dup && (
          <fieldset className={"dup " + match.kind}>
            <legend>{dup.message}</legend>
            {dup.options.map((o) => (
              <label key={o.value} className="opt">
                <input type="radio" name="dup-manual" checked={action === o.value} onChange={() => setChoice(o.value)} />
                {o.label}
              </label>
            ))}
          </fieldset>
        )}
        <div className="row">
          <label>
            Strength
            <input value={strength} onChange={(e) => setStrength(e.target.value)} placeholder="e.g. 200 mg" />
          </label>
          <label>
            Dose
            <input value={dose} onChange={(e) => setDose(e.target.value)} placeholder="e.g. 1 tablet" />
          </label>
        </div>
        <label>
          How often
          <input value={frequency} onChange={(e) => setFrequency(e.target.value)} placeholder="e.g. twice daily with food" />
        </label>
      </div>
      <div className="actions">
        <button className="primary" onClick={save} disabled={!med.name || looking}>
          {action === "skip" ? "Done" : "Add to cabinet"}
        </button>
        <button className="ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </section>
  );
}
