import { useEffect, useState } from "react";
import { explainFlag, getReport } from "../api";
import type { Medication, Profile, SafetyFlag, SafetyReport } from "../types";

const VOICE: Record<string, string> = { English: "en-US", Español: "es-ES", العربية: "ar-SA" };
const LABEL = { high: "Talk to a pharmacist", caution: "Use caution", info: "Good to know" } as const;

function Flag({ flag, profile }: { flag: SafetyFlag; profile: Profile }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function explain() {
    setBusy(true);
    setErr("");
    try {
      setText(await explainFlag(profile, flag));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't explain this one. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function speak() {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = VOICE[profile.language] ?? "en-US";
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }

  return (
    <article className={`flag ${flag.severity}`}>
      <div className="stripe">{LABEL[flag.severity]}</div>
      <h3>{flag.title}</h3>
      <p className="drugs">{flag.drugs.join(" + ")}</p>
      <p>{flag.detail}</p>
      {text && (
        <p className="explain" dir="auto">
          {text}
        </p>
      )}
      {err && (
        <p role="alert" className="err">
          {err}
        </p>
      )}
      <div className="actions">
        <button className="secondary" onClick={explain} disabled={busy}>
          {busy ? "Explaining…" : text ? "Explain again" : `Explain in ${profile.language}`}
        </button>
        {text && (
          <button className="ghost" onClick={speak}>
            Read aloud
          </button>
        )}
      </div>
      <p className="src">Source: {flag.source}</p>
    </article>
  );
}

export default function Report({ profile, meds, onScan }: { profile: Profile; meds: Medication[]; onScan: () => void }) {
  const [report, setReport] = useState<SafetyReport | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (meds.length === 0) {
      setReport(null);
      return;
    }
    let live = true;
    setError("");
    getReport(profile, meds)
      .then((r) => live && setReport(r))
      .catch((e) => live && setError(e instanceof Error ? e.message : "Couldn't run the check."));
    return () => {
      live = false;
    };
  }, [profile, meds]);

  if (meds.length === 0) {
    return (
      <section className="empty">
        <h2>Nothing to check yet</h2>
        <p>Add medicines to the cabinet first.</p>
        <button className="primary" onClick={onScan}>
          Scan a label
        </button>
      </section>
    );
  }

  return (
    <section>
      <h2>Safety check for {profile.name}</h2>
      {error && (
        <p role="alert" className="err">
          {error}
        </p>
      )}
      {!report && !error && <p className="hint">Checking {meds.length} medicines…</p>}
      {report && report.flags.length === 0 && (
        <p className="ok">No conflicts found among {report.checked} medicines. This check doesn't cover everything, so ask your pharmacist if you're unsure.</p>
      )}
      {report?.flags.map((f) => <Flag key={f.id} flag={f} profile={profile} />)}
      <p className="disclaimer">Pocket Apothecary doesn't give medical advice. Confirm anything important with your pharmacist or doctor.</p>
    </section>
  );
}
