import { useRef, useState } from "react";
import { reconcileDischarge } from "../api";
import type { DischargeMed, Medication, Profile, ReconcileItem, ReconcileKind, ReconcileResponse } from "../types";
import { useOnline } from "../useOnline";
import { Flag } from "./Report";
import { CameraView } from "./Scan";

const canUseLiveCamera = () => window.isSecureContext && !!navigator.mediaDevices?.getUserMedia;

type Choice = "add" | "skip" | "replace" | "keep_both" | "keep" | "remove";

// Most urgent first: what to stop, what changed, what's new, then the rest
const SECTIONS: { kind: ReconcileKind; title: string; label: string }[] = [
  { kind: "stopped", title: "Stopped by the hospital", label: "Stop" },
  { kind: "changed", title: "Dose changed", label: "Changed" },
  { kind: "new", title: "New medicines", label: "New" },
  { kind: "duplicate", title: "Hidden duplicates", label: "Duplicate" },
  { kind: "not_on_sheet", title: "Not on the discharge sheet", label: "Ask" },
  { kind: "unchanged", title: "No change", label: "Same" },
];

function optionsFor(item: ReconcileItem): { value: Choice; label: string }[] {
  switch (item.kind) {
    case "new":
      return [
        { value: "add", label: "Add to cabinet" },
        { value: "skip", label: "Don't add" },
      ];
    case "changed":
      return [
        { value: "replace", label: "Switch to the new dose" },
        { value: "keep_both", label: "Keep both" },
        { value: "keep", label: "Leave the cabinet as is" },
      ];
    case "stopped":
      return item.cabinet
        ? [
            { value: "remove", label: "Remove from cabinet" },
            { value: "keep", label: "Keep it" },
          ]
        : [];
    case "not_on_sheet":
      return [
        { value: "keep", label: "Keep for now" },
        { value: "remove", label: "Remove from cabinet" },
      ];
    default:
      return []; // duplicate and unchanged are information only
  }
}

// Defaults follow the sheet, except a line with no instructions, which waits for the family to ask
function defaultChoice(item: ReconcileItem): Choice | undefined {
  if (item.kind === "new") return item.sheet?.status === "unclear" ? "skip" : "add";
  return optionsFor(item)[0]?.value;
}

const toCabinetMed = ({ status: _s, previous: _p, ...med }: DischargeMed): Medication => med;

function describe(m?: Medication | null) {
  return m ? [m.name, m.strength].filter(Boolean).join(" ") : "";
}

interface Props {
  profile: Profile;
  cabinet: Medication[];
  onApply: (added: Medication[], removeIds: string[]) => void;
}

export default function Discharge({ profile, cabinet, onApply }: Props) {
  const online = useOnline();
  const [live, setLive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ReconcileResponse | null>(null);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const libraryRef = useRef<HTMLInputElement>(null);
  const nativeCameraRef = useRef<HTMLInputElement>(null);

  async function pick(file?: File) {
    if (!file) return;
    setLive(false);
    setError("");
    setBusy(true);
    try {
      setResult(await reconcileDischarge(file, profile, cabinet));
      setChoices({});
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read that discharge sheet. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const useCamera = () => {
    if (canUseLiveCamera()) return setLive(true);
    if (window.matchMedia("(pointer: coarse)").matches) return nativeCameraRef.current?.click();
    setError("The in-app camera needs https or localhost. Choose a photo instead.");
  };

  const choiceFor = (item: ReconcileItem) => choices[item.id] ?? defaultChoice(item);

  function apply() {
    if (!result) return;
    const added: Medication[] = [];
    const removeIds: string[] = [];
    for (const item of result.items) {
      const c = choiceFor(item);
      if (item.sheet && (c === "add" || c === "replace" || c === "keep_both")) added.push(toCabinetMed(item.sheet));
      if (item.cabinet && (c === "replace" || c === "remove")) removeIds.push(item.cabinet.id);
    }
    onApply(added, removeIds);
  }

  if (live) return <CameraView onShot={pick} onCancel={() => setLive(false)} />;

  if (result) {
    const { report, resolved } = result;
    const deciding = report.flags.filter((f) => f.kind !== "food_alcohol");
    const notes = report.flags.filter((f) => f.kind === "food_alcohol");
    return (
      <section>
        <h2>What changed for {profile.name}</h2>
        <p className="hint">
          We compared the discharge sheet with {profile.name}'s {cabinet.length} medicine{cabinet.length === 1 ? "" : "s"} by ingredient, so brand and
          generic names match. Check each item, then apply.
        </p>
        <div className="recon-counts">
          {SECTIONS.map(({ kind, label }) => {
            const n = result.items.filter((i) => i.kind === kind).length;
            return n ? (
              <span key={kind} className={`count ${kind}`}>
                {n} {label}
              </span>
            ) : null;
          })}
        </div>

        {SECTIONS.map(({ kind, title, label }) => {
          const items = result.items.filter((i) => i.kind === kind);
          if (!items.length) return null;
          return (
            <div key={kind}>
              <h3 className="recon-head">{title}</h3>
              {items.map((item) => {
                const opts = optionsFor(item);
                // Stop lines rarely print a strength, which lowers confidence without meaning a bad read
                const shaky = item.sheet && item.kind !== "stopped" && item.sheet.confidence < 0.7;
                return (
                  <article key={item.id} className={`recon ${kind}`}>
                    <div className="stripe">{label}</div>
                    <h3>
                      {item.kind === "changed"
                        ? `${describe(item.cabinet)} → ${describe(item.sheet)}`
                        : item.kind === "duplicate"
                          ? `${describe(item.sheet)} + ${describe(item.cabinet)}`
                          : describe(item.sheet ?? item.cabinet)}
                    </h3>
                    <p>{item.summary}</p>
                    {item.sheet?.instructions && <p className="sub">Sheet says: {item.sheet.instructions}</p>}
                    {shaky && <p className="badge">Hard to read: check this against the sheet</p>}
                    {opts.length > 0 && (
                      <fieldset className="dup">
                        <legend className="sr">What to do with {describe(item.sheet ?? item.cabinet)}</legend>
                        {opts.map((o) => (
                          <label key={o.value} className="opt">
                            <input
                              type="radio"
                              name={`recon-${item.id}`}
                              checked={choiceFor(item) === o.value}
                              onChange={() => setChoices((c) => ({ ...c, [item.id]: o.value }))}
                            />
                            {o.label}
                          </label>
                        ))}
                      </fieldset>
                    )}
                  </article>
                );
              })}
            </div>
          );
        })}

        <h2 className="recon-safety">Safety check after these changes</h2>
        <p className="hint">This checks the cabinet as it will be if you apply the suggested changes.</p>
        {resolved.length > 0 && (
          <div className="ok">
            <strong>
              {resolved.length} problem{resolved.length === 1 ? "" : "s"} in today's cabinet go away:
            </strong>
            <ul>
              {resolved.map((f) => (
                <li key={f.id}>
                  {f.title} ({f.drugs.join(" + ")})
                </li>
              ))}
            </ul>
          </div>
        )}
        {deciding.length === 0 && <p className="ok">No conflicts found in the new medicine list.</p>}
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
        {report.unchecked && report.unchecked.length > 0 && (
          <p className="hint">Couldn't check the FDA label for {report.unchecked.join(", ")}. Ask the pharmacist about these.</p>
        )}

        <div className="actions">
          <button className="primary" onClick={apply}>
            Apply changes to cabinet
          </button>
          <button className="ghost" onClick={() => setResult(null)}>
            Scan again
          </button>
        </div>
        <p className="disclaimer">Pocket Apothecary doesn't give medical advice. Go over the discharge list with the pharmacist or doctor.</p>
      </section>
    );
  }

  return (
    <section className="empty">
      <h2>Home from the hospital?</h2>
      <p>
        Scan the discharge medication list. We'll compare it with {profile.name}'s cabinet and show what's new, what changed, what to stop, and any
        duplicates, then run a safety check on the new list.
      </p>
      <div className="choices">
        <button className="primary" onClick={useCamera} disabled={busy || !online}>
          {busy ? "Reading the sheet…" : "Scan discharge sheet"}
        </button>
        <button className="secondary" onClick={() => libraryRef.current?.click()} disabled={busy || !online}>
          Choose from photo library
        </button>
      </div>
      {busy && <p className="hint">Reading the sheet, matching medicines, and checking FDA labels. This can take 20 seconds.</p>}
      {!online && <p className="hint">This needs a connection.</p>}
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
