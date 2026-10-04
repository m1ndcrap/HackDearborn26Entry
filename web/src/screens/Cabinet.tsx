import { useState } from "react";
import type { Routine } from "../schedule";
import type { Medication, Profile } from "../types";
import ManualAdd from "./ManualAdd";

interface Props {
  meds: Medication[];
  profile: Profile;
  routine?: Routine;
  onScan: () => void;
  onBuyCheck: () => void;
  onRemove: (id: string) => void;
  onUpdate: (med: Medication) => void;
}

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

export default function Cabinet({ meds, profile, routine, onScan, onBuyCheck, onRemove, onUpdate }: Props) {
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
          <button className="secondary" onClick={onBuyCheck}>
            Check before buying
          </button>
        </div>
      </section>
    );
  }
  return (
    <section>
      <h2>{profile.name}'s medicines</h2>
      <p className="hint">Tap a medicine to change its dose, how often, or refill and expiry dates.</p>
      <ul className="meds">
        {meds.map((m) => (
          <li key={m.id}>
            <button className="med-main" onClick={() => setEditing(m)} aria-label={`Edit ${m.name}`}>
              <strong>{m.name}</strong> {m.strength}
              <div className="sub">{[m.dose, m.frequency].filter(Boolean).join(" · ") || "No directions yet. Tap to add them."}</div>
              {badges(m).length > 0 && (
                <div className="tags">
                  {badges(m).map((b) => (
                    <span key={b.text} className={`tag date-${b.tone}`}>
                      {b.text}
                    </span>
                  ))}
                </div>
              )}
            </button>
            <button
              className="ghost"
              onClick={() => {
                if (confirm(`Remove ${m.name} from ${profile.name}'s cabinet?`)) onRemove(m.id);
              }}
              aria-label={`Remove ${m.name}`}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <div className="actions">
        <button className="primary" onClick={onScan}>
          Add another
        </button>
        <button className="secondary" onClick={onBuyCheck}>
          Check before buying
        </button>
      </div>
    </section>
  );
}