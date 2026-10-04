import { useState } from "react";
import type { Routine } from "../schedule";
import type { Medication, Profile } from "../types";
import ManualAdd from "./ManualAdd";

interface Props {
  meds: Medication[];
  photos: Record<string, string>; // med id -> label thumbnail
  profile: Profile;
  routine?: Routine;
  onScan: () => void;
  onBuyCheck: () => void;
  onDischarge: () => void;
  onAddByHand: () => void;
  onRemove: (id: string) => void;
  onUpdate: (med: Medication) => void;
}

// Shown when a medicine has no label photo (typed in, discharge sheet, or added before photos existed)
function PillBottleIcon() {
  return (
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" aria-hidden="true">
      <rect x="13" y="6" width="22" height="7" rx="2" />
      <path d="M15 13h18v26a3 3 0 0 1-3 3H18a3 3 0 0 1-3-3z" />
      <path d="M15 21h18v12H15" />
    </svg>
  );
}

const orNot = (v: string | null | undefined, empty: string) => (v && v.trim()) || empty;

const ISO = /^\d{4}-\d{2}-\d{2}$/;
function daysUntil(iso?: string | null): number | null {
  if (!iso || !ISO.test(iso)) return null;
  const [y, m, d] = iso.split("-").map(Number);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((new Date(y, m - 1, d).getTime() - today.getTime()) / 86_400_000);
}
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

function badges(m: Medication) {
  const out: { text: string; tone: "red" | "amber" | "plain" }[] = [];
  const exp = daysUntil(m.expires_on);
  if (exp !== null) {
    if (exp < 0) out.push({ text: "Expired, don't use", tone: "red" });
    else if (exp <= 30) out.push({ text: exp === 0 ? "Expires today" : `Expires in ${plural(exp, "day")}`, tone: "amber" });
  }
  const refill = daysUntil(m.refill_date);
  if (refill !== null) {
    if (refill < 0) out.push({ text: "Refill overdue", tone: "red" });
    else if (refill <= 7) out.push({ text: refill === 0 ? "Refill today" : `Refill in ${plural(refill, "day")}`, tone: "amber" });
    else out.push({ text: `Refill ${new Date(m.refill_date + "T00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })}`, tone: "plain" });
  }
  return out;
}

export default function Cabinet({ meds, photos, profile, routine, onScan, onBuyCheck, onDischarge, onAddByHand, onRemove, onUpdate }: Props) {
  const [editing, setEditing] = useState<Medication | null>(null);

  if (editing) {
    return (
      <ManualAdd
        initial={editing}
        routine={routine}
        submitLabel="Save changes"
        onCancel={() => setEditing(null)}
        onSave={(med) => {
          onUpdate(med);
          setEditing(null);
        }}
      />
    );
  }

  if (meds.length === 0) {
    return (
      <section className="empty">
        <h2>{profile.name}'s cabinet is empty</h2>
        <p>Scan a pill bottle, an over-the-counter box, or a discharge sheet to add medicines.</p>
        <div className="choices">
          <button className="primary" onClick={onScan}>
            Scan a label
          </button>
          <button className="secondary" onClick={onAddByHand}>
            Add by hand
          </button>
          <button className="secondary" onClick={onBuyCheck}>
            Check before buying
          </button>
          <button className="secondary" onClick={onDischarge}>
            Home from the hospital
          </button>
        </div>
      </section>
    );
  }
  return (
    <section>
      <button className="discharge-cta" onClick={onDischarge}>
        <strong>Home from the hospital?</strong>
        <span>Scan the discharge sheet to see what's new, changed, or stopped.</span>
      </button>
      <h2>{profile.name}'s cabinet</h2>
      <p className="hint">Tap a medicine to change its dose, how often, or refill and expiry dates.</p>
      <div className="cabinet-box">
        <ul className="meds">
          {meds.map((m) => {
            const b = badges(m);
            return (
              <li key={m.id}>
                <h3 className="med-name">{m.name}</h3>
                <div className="med-card">
                  {/* The whole card (photo + facts) is one button that opens the edit form */}
                  <button className="med-edit" onClick={() => setEditing(m)} aria-label={`Edit ${m.name}`}>
                    <span className="med-photo">{photos[m.id] ? <img src={photos[m.id]} alt="" /> : <PillBottleIcon />}</span>
                    <span className="med-facts">
                      <span className="fact">
                        Dosage: <span className="fact-val">{orNot([m.strength, m.dose].filter(Boolean).join(" · "), "Not listed")}</span>
                      </span>
                      <span className="fact">
                        Frequency: <span className="fact-val">{orNot(m.frequency, "Not listed")}</span>
                      </span>
                      <span className="fact">
                        Instructions: <span className="fact-val">{orNot(m.instructions, "None")}</span>
                      </span>
                      {b.length > 0 && (
                        <span className="tags med-badges">
                          {b.map((x) => (
                            <span key={x.text} className={`tag date-${x.tone}`}>
                              {x.text}
                            </span>
                          ))}
                        </span>
                      )}
                    </span>
                  </button>
                  <button
                    className="med-remove"
                    onClick={() => {
                      if (confirm(`Remove ${m.name} from ${profile.name}'s cabinet?`)) onRemove(m.id);
                    }}
                    aria-label={`Remove ${m.name}`}
                  >
                    ×
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="actions center">
        <button className="primary" onClick={onScan}>
          Add another
        </button>
        <button className="secondary" onClick={onAddByHand}>
          Add by hand
        </button>
        <button className="secondary" onClick={onBuyCheck}>
          Check before buying
        </button>
      </div>
    </section>
  );
}