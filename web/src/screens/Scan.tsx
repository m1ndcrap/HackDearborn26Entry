import { useState } from "react";
import { scanImage } from "../api";
import type { Medication } from "../types";
import { useOnline } from "../useOnline";

const LOW = 0.7;

export default function Scan({ onAdd }: { onAdd: (meds: Medication[]) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [found, setFound] = useState<Medication[] | null>(null);
  const online = useOnline();

  async function pick(file?: File) {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const res = await scanImage(file);
      setFound(res.medications);
      if (res.medications.length === 0) setError("We couldn't find a medicine in that photo. Try again in better light, closer to the label.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const edit = (id: string, patch: Partial<Medication>) => setFound((f) => f && f.map((m) => (m.id === id ? { ...m, ...patch } : m)));

  if (found && found.length > 0) {
    return (
      <section>
        <h2>Check what we read</h2>
        <p className="hint">Fix anything that looks wrong before adding. Highlighted rows were harder to read.</p>
        {found.map((m) => (
          <div key={m.id} className={"card" + (m.confidence < LOW ? " shaky" : "")}>
            {m.confidence < LOW && <div className="badge">Double-check this one</div>}
            <label>
              Name
              <input value={m.name} onChange={(e) => edit(m.id, { name: e.target.value, ingredient: null })} />
            </label>
            <div className="row">
              <label>
                Strength
                <input value={m.strength ?? ""} onChange={(e) => edit(m.id, { strength: e.target.value })} />
              </label>
              <label>
                Dose
                <input value={m.dose ?? ""} onChange={(e) => edit(m.id, { dose: e.target.value })} />
              </label>
            </div>
            <label>
              How often
              <input value={m.frequency ?? ""} onChange={(e) => edit(m.id, { frequency: e.target.value })} />
            </label>
          </div>
        ))}
        <div className="actions">
          <button className="primary" onClick={() => onAdd(found.filter((m) => m.name.trim()))}>
            Add to cabinet
          </button>
          <button className="ghost" onClick={() => setFound(null)}>
            Scan again
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="empty">
      <h2>Scan a label</h2>
      <p>Take a clear photo of a pill bottle, an over-the-counter box, or a discharge sheet.</p>
      <label className={"primary filebtn" + (busy ? " busy" : "") + (online ? "" : " off")}>
        {busy ? "Reading label…" : online ? "Take a photo" : "Scanning needs a connection"}
        <input type="file" accept="image/*" capture="environment" disabled={busy || !online} onChange={(e) => pick(e.target.files?.[0])} />
      </label>
      {error && (
        <p role="alert" className="err">
          {error}
        </p>
      )}
    </section>
  );
}
