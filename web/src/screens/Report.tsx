import { useEffect, useState } from "react";
import { explainFlag, getReport } from "../api";
import { loadReport, saveReport } from "../reportCache";
import { speak } from "../speech";
import type { Medication, Profile, SafetyFlag, SafetyReport } from "../types";
import { useOnline } from "../useOnline";

const LABEL = { high: "Talk to a pharmacist", caution: "Use caution", info: "Good to know" } as const;

/** note: render as a calm "label note" (used under "Good to know"), whatever the label's wording severity. */
export function Flag({ flag, profile, note = false }: { flag: SafetyFlag; profile: Profile; note?: boolean }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const online = useOnline();

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

  async function readAloud() {
    setSpeaking(true);
    try {
      await speak(text, profile.language); // ElevenLabs when configured, browser voice otherwise
    } finally {
      setSpeaking(false);
    }
  }

  return (
    <article className={note ? "flag label-note" : `flag ${flag.severity}`}>
      <div className="stripe">{note ? "Label note" : LABEL[flag.severity]}</div>
      <h3>{flag.title}</h3>
      <p className="drugs">{flag.drugs.join(" + ")}</p>
      <p>{flag.detail}</p>
      {flag.excerpt && <blockquote className="excerpt">“{flag.excerpt}”</blockquote>}
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
        <button className="secondary" onClick={explain} disabled={busy || !online}>
          {busy ? "Explaining…" : text ? "Explain again" : `Explain in ${profile.language}`}
        </button>
        {text && (
          <button className="ghost" onClick={readAloud} disabled={speaking}>
            {speaking ? "Loading voice…" : "Read aloud"}
          </button>
        )}
      </div>
      <p className="src">
        Source:{" "}
        {flag.source_url ? (
          <a href={flag.source_url} target="_blank" rel="noopener noreferrer">
            {flag.source}
          </a>
        ) : (
          flag.source
        )}
      </p>
    </article>
  );
}

export default function Report({ profile, meds, onScan }: { profile: Profile; meds: Medication[]; onScan: () => void }) {
  const [report, setReport] = useState<SafetyReport | null>(null);
  const [error, setError] = useState("");
  const [savedAt, setSavedAt] = useState("");
  const online = useOnline();

  useEffect(() => {
    if (meds.length === 0) {
      setReport(null);
      return;
    }
    const showSaved = (fallbackError?: string) => {
      const cached = loadReport(profile.id);
      if (cached) {
        setReport(cached.report);
        setSavedAt(cached.at);
      } else if (fallbackError) setError(fallbackError);
    };
    if (!online) {
      showSaved(); // offline: show the last saved check; rerun when back online
      return;
    }
    let live = true;
    setError("");
    setSavedAt("");
    getReport(profile, meds)
      .then((r) => {
        saveReport(profile.id, r);
        if (live) setReport(r);
      })
      .catch((e) => live && showSaved(e instanceof Error ? e.message : "Couldn't run the check."));
    return () => {
      live = false;
    };
  }, [profile, meds, online]);

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
      {!report && !error && (
        <p className="hint">{online ? `Checking ${meds.length} medicines…` : "The safety check needs a connection. It will run when you're back online."}</p>
      )}
      {savedAt && <p className="hint">This is the last saved check from {new Date(savedAt).toLocaleString()}. It will refresh when you're back online.</p>}
      {report && report.flags.length === 0 && (
        <p className="ok">No conflicts found among {report.checked} medicines. This check doesn't cover everything, so ask your pharmacist if you're unsure.</p>
      )}
      {report?.unchecked && report.unchecked.length > 0 && (
        <p className="hint">
          Couldn't check the FDA label for {report.unchecked.join(", ")}, so only built-in rules were used for{" "}
          {report.unchecked.length === 1 ? "it" : "them"}. Ask your pharmacist about {report.unchecked.length === 1 ? "this one" : "these"}.
        </p>
      )}
      {report && report.flags.length > 0 && (
        <div className="flags">
          {report.flags.map((f) => (
            <Flag key={f.id} flag={f} profile={profile} />
          ))}
        </div>
      )}
      <p className="disclaimer">Pocket Apothecary doesn't give medical advice. Confirm anything important with your pharmacist or doctor.</p>
    </section>
  );
}