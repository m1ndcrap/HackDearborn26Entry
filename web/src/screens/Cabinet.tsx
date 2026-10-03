import type { Medication, Profile } from "../types";

interface Props {
  meds: Medication[];
  profile: Profile;
  onScan: () => void;
  onRemove: (id: string) => void;
}

export default function Cabinet({ meds, profile, onScan, onRemove }: Props) {
  if (meds.length === 0) {
    return (
      <section className="empty">
        <h2>{profile.name}'s cabinet is empty</h2>
        <p>Scan a pill bottle, an over-the-counter box, or a discharge sheet to add medicines.</p>
        <button className="primary" onClick={onScan}>
          Scan a label
        </button>
      </section>
    );
  }
  return (
    <section>
      <h2>{profile.name}'s medicines</h2>
      <ul className="meds">
        {meds.map((m) => (
          <li key={m.id}>
            <div>
              <strong>{m.name}</strong> {m.strength}
              <div className="sub">{[m.dose, m.frequency].filter(Boolean).join(" · ") || "No directions added"}</div>
            </div>
            <button className="ghost" onClick={() => onRemove(m.id)} aria-label={`Remove ${m.name}`}>
              Remove
            </button>
          </li>
        ))}
      </ul>
      <button className="primary" onClick={onScan}>
        Scan another
      </button>
    </section>
  );
}
