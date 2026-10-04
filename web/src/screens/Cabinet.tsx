import type { Medication, Profile } from "../types";

interface Props {
  meds: Medication[];
  photos: Record<string, string>; // med id -> label thumbnail
  profile: Profile;
  onScan: () => void;
  onBuyCheck: () => void;
  onRemove: (id: string) => void;
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

export default function Cabinet({ meds, photos, profile, onScan, onBuyCheck, onRemove }: Props) {
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
      <h2>{profile.name}'s cabinet</h2>
      <div className="cabinet-box">
        <ul className="meds">
          {meds.map((m) => (
            <li key={m.id}>
              <h3 className="med-name">{m.name}</h3>
              <div className="med-card">
                <div className="med-photo">{photos[m.id] ? <img src={photos[m.id]} alt="" /> : <PillBottleIcon />}</div>
                <dl className="med-facts">
                  <div>
                    <dt>Dosage:</dt> <dd>{orNot([m.strength, m.dose].filter(Boolean).join(" · "), "Not listed")}</dd>
                  </div>
                  <div>
                    <dt>Frequency:</dt> <dd>{orNot(m.frequency, "Not listed")}</dd>
                  </div>
                  <div>
                    <dt>Instructions:</dt> <dd>{orNot(m.instructions, "None")}</dd>
                  </div>
                </dl>
                <button className="med-remove" onClick={() => onRemove(m.id)} aria-label={`Remove ${m.name}`}>
                  ×
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
      <div className="actions center">
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
