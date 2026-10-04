import { useRef, useState } from "react";
import { checkOtc, scanImage } from "../api";
import { findCabinetMatch } from "../duplicates";
import type { Medication, OtcResult, Profile } from "../types";
import { useOnline } from "../useOnline";
import { Flag } from "./Report";
import { CameraView } from "./Scan";

const canUseLiveCamera = () => window.isSecureContext && !!navigator.mediaDevices?.getUserMedia;

const HEADLINE = {
  avoid: "Don't buy this without asking",
  ask: "Ask the pharmacist first",
  ok: "Looks OK",
  unknown: "Couldn't fully check",
} as const;

interface Props {
  profile: Profile;
  cabinet: Medication[];
  onAdd: (med: Medication) => void;
}

export default function BuyCheck({ profile, cabinet, onAdd }: Props) {
  const online = useOnline();
  const [live, setLive] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [typed, setTyped] = useState("");
  const [results, setResults] = useState<OtcResult[] | null>(null);
  const [added, setAdded] = useState<string[]>([]);
  const libraryRef = useRef<HTMLInputElement>(null);
  const nativeCameraRef = useRef<HTMLInputElement>(null);

  async function run(candidates: Medication[]) {
    setBusy("Checking against " + profile.name + "'s medicines…");
    try {
      const res = await checkOtc(profile, cabinet, candidates);
      setResults(res.results);
      setAdded([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't run the check. Try again.");
    } finally {
      setBusy("");
    }
  }

  async function pick(file?: File) {
    if (!file) return;
    setLive(false);
    setError("");
    setBusy("Reading the box…");
    try {
      const scan = await scanImage(file);
      if (scan.medications.length === 0) {
        setBusy("");
        setError("We couldn't find a medicine in that photo. Try again closer to the front of the box, or type the name.");
        return;
      }
      await run(scan.medications);
    } catch (e) {
      setBusy("");
      setError(e instanceof Error ? e.message : "Couldn't read that photo. Try again.");
    }
  }

  function checkTyped() {
    const name = typed.trim();
    if (!name) return;
    setError("");
    run([{ id: "", name, warnings: [], confidence: 1 }]);
  }

  const useCamera = () => {
    if (canUseLiveCamera()) return setLive(true);
    if (window.matchMedia("(pointer: coarse)").matches) return nativeCameraRef.current?.click();
    setError("The in-app camera needs https or localhost. Choose a photo or type the name instead.");
  };

  function reset() {
    setResults(null);
    setTyped("");
    setError("");
  }

  if (live) return <CameraView onShot={pick} onCancel={() => setLive(false)} />;

  if (results) {
    return (
      <section>
        <h2>Before you buy</h2>
        {results.map((r) => {
          const med = r.medication;
          const deciding = r.flags.filter((f) => f.kind !== "food_alcohol");
          const notes = r.flags.filter((f) => f.kind === "food_alcohol");
          const already = findCabinetMatch(med, cabinet)?.kind === "exact";
          const isAdded = added.includes(med.id);
          return (
            <div key={med.id || med.name} className="buy-result">
              <div className={`verdict ${r.verdict}`} role="status">
                <div className="verdict-label">{HEADLINE[r.verdict]}</div>
                <h3>
                  {med.name} {med.strength}
                </h3>
                <p>{r.summary}</p>
              </div>

              {deciding.map((f) => (
                <Flag key={f.id} flag={f} profile={profile} />
              ))}

              {notes.length > 0 && (
                <>
                  <h3 className="notes-head">Good to know</h3>
                  {notes.map((f) => (
                    <Flag key={f.id} flag={f} profile={profile} />
                  ))}
                </>
              )}

              <div className="actions">
                {already ? (
                  <p className="hint">This is already in {profile.name}'s cabinet.</p>
                ) : isAdded ? (
                  <p className="ok">Added to {profile.name}'s cabinet.</p>
                ) : (
                  <button
                    className={r.verdict === "ok" ? "primary" : "secondary"}
                    onClick={() => {
                      onAdd({ ...med, id: med.id || Math.random().toString(36).slice(2, 10) });
                      setAdded((a) => [...a, med.id]);
                    }}
                  >
                    {r.verdict === "ok" ? "I bought it, add to cabinet" : "Pharmacist said OK, add to cabinet"}
                  </button>
                )}
              </div>
            </div>
          );
        })}
        <div className="actions">
          <button className="ghost" onClick={reset}>
            Check another product
          </button>
        </div>
        <p className="disclaimer">This check uses FDA labels and doesn't cover everything. When in doubt, ask the pharmacist at the counter.</p>
      </section>
    );
  }

  return (
    <section className="empty">
      <h2>Check before you buy</h2>
      <p>
        At the store? Scan an over-the-counter box to see if it's safe with {profile.name}'s {cabinet.length} medicine{cabinet.length === 1 ? "" : "s"}.
        Nothing is added unless you choose to.
      </p>
      <div className="choices">
        <button className="primary" onClick={useCamera} disabled={!!busy || !online}>
          {busy || "Scan the box"}
        </button>
        <button className="secondary" onClick={() => libraryRef.current?.click()} disabled={!!busy || !online}>
          Choose from photo library
        </button>
      </div>
      <div className="typed">
        <label>
          Or type the name
          <div className="row">
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && checkTyped()}
              placeholder="e.g. Advil, NyQuil, Zyrtec"
              disabled={!!busy || !online}
            />
            <button className="secondary" onClick={checkTyped} disabled={!!busy || !online || !typed.trim()}>
              Check
            </button>
          </div>
        </label>
      </div>
      {!online && <p className="hint">The check needs a connection.</p>}
      {cabinet.length === 0 && <p className="hint">{profile.name}'s cabinet is empty, so only allergies and health conditions will be checked.</p>}
      <input ref={libraryRef} type="file" accept="image/*" hidden onChange={(e) => pick(e.target.files?.[0])} />
      <input ref={nativeCameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => pick(e.target.files?.[0])} />
      {error && (
        <p role="alert" className="err">
          {error}
        </p>
      )}
    </section>
  );
}