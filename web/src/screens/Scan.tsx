import { useEffect, useRef, useState } from "react";
import { scanImage } from "../api";
import { makeThumbnail } from "../thumbnail";
import { DEFAULT_ACTION, describeMatch, findCabinetMatch, type DupAction } from "../duplicates";
import type { Medication } from "../types";
import ManualAdd from "./ManualAdd";
import type { Routine } from "../schedule";
import { useOnline } from "../useOnline";

const LOW = 0.7;

// Live camera needs a secure context (https or localhost) and getUserMedia support.
const canUseLiveCamera = () => window.isSecureContext && !!navigator.mediaDevices?.getUserMedia;

export function CameraView({ onShot, onCancel }: { onShot: (f: File) => void; onCancel: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 } }, audio: false })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const v = videoRef.current;
        if (v) {
          v.srcObject = stream;
          v.play().catch(() => {});
        }
      })
      .catch((e: DOMException) => {
        if (e.name === "NotAllowedError") setErr("Camera access is blocked. Allow it in your browser's site settings, or choose a photo instead.");
        else if (e.name === "NotFoundError") setErr("No camera found on this device. Choose a photo instead.");
        else setErr("The camera couldn't start. Choose a photo instead.");
      });
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  function snap() {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d")!.drawImage(v, 0, 0);
    c.toBlob((b) => b && onShot(new File([b], "label.jpg", { type: "image/jpeg" })), "image/jpeg", 0.9);
  }

  return (
    <section>
      <h2>Frame the label</h2>
      {err ? (
        <p role="alert" className="err">
          {err}
        </p>
      ) : (
        <div className="camera">
          <video ref={videoRef} playsInline muted onLoadedMetadata={() => setReady(true)} />
        </div>
      )}
      <div className="actions">
        {!err && (
          <button className="primary" onClick={snap} disabled={!ready}>
            Take photo
          </button>
        )}
        <button className="ghost" onClick={onCancel}>
          {err ? "Back" : "Cancel"}
        </button>
      </div>
    </section>
  );
}

interface ScanProps {
  cabinet: Medication[];
  routine?: Routine;
  onAdd: (meds: Medication[], replaceIds: string[], photo: string | null) => void;
  onBuyCheck?: () => void;
}

export default function Scan({ cabinet, routine, onAdd, onBuyCheck }: ScanProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [found, setFound] = useState<Medication[] | null>(null);
  const [photo, setPhoto] = useState<string | null>(null); // thumbnail of the scanned label, shown in the Cabinet
  const [choices, setChoices] = useState<Record<string, DupAction>>({}); // scanned med id -> what to do with its cabinet match
  const online = useOnline();
  const [live, setLive] = useState(false);
  const [typing, setTyping] = useState(false);
  const libraryRef = useRef<HTMLInputElement>(null);
  const nativeCameraRef = useRef<HTMLInputElement>(null);

  async function pick(file?: File) {
    if (!file) return;
    setLive(false);
    setBusy(true);
    setError("");
    try {
      const [res, thumb] = await Promise.all([scanImage(file), makeThumbnail(file)]);
      // One photo of a whole discharge sheet doesn't identify any single medicine, so skip it there
      setPhoto(res.document_type === "discharge_sheet" ? null : thumb);
      setFound(res.medications);
      setChoices({});
      if (res.medications.length === 0) setError("We couldn't find a medicine in that photo. Try again in better light, closer to the label.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const useCamera = () => {
    if (canUseLiveCamera()) return setLive(true);
    if (window.matchMedia("(pointer: coarse)").matches) return nativeCameraRef.current?.click();
    setError("The in-app camera needs https or localhost. Open http://localhost:5173 on this computer, or use your phone.");
  };

  const edit = (id: string, patch: Partial<Medication>) => setFound((f) => f && f.map((m) => (m.id === id ? { ...m, ...patch } : m)));

  if (live) return <CameraView onShot={pick} onCancel={() => setLive(false)} />;

  if (typing) {
    return (
      <ManualAdd
        routine={routine}
        onCancel={() => setTyping(false)}
        onSave={(med) => {
          setTyping(false);
          setPhoto(null);
          if (findCabinetMatch(med, cabinet)) {
            setFound([med]);
            setChoices({});
          } else onAdd([med], [], null);
        }}
      />
    );
  }

  if (found && found.length > 0) {
    // Recomputed every render so it follows edits to the name or strength
    const matches = Object.fromEntries(found.map((m) => [m.id, findCabinetMatch(m, cabinet)]));
    const actionFor = (id: string): DupAction => {
      const match = matches[id];
      return match ? (choices[id] ?? DEFAULT_ACTION[match.kind]) : "add";
    };

    function confirm() {
      const keep = found!.filter((m) => m.name.trim() && actionFor(m.id) !== "skip");
      const replaceIds = keep.filter((m) => actionFor(m.id) === "replace").map((m) => matches[m.id]!.existing.id);
      onAdd(keep, replaceIds, photo);
    }

    return (
      <section>
        <h2>Check what we read</h2>
        <p className="hint">Fix anything that looks wrong before adding. Highlighted rows were harder to read.</p>
        <div className="cards">
          {found.map((m) => {
            const match = matches[m.id];
            const dup = match && describeMatch(match);
            return (
              <div key={m.id} className={"card" + (m.confidence < LOW ? " shaky" : "")}>
                {m.confidence < LOW && <div className="badge">Double-check this one</div>}
                {m.verified_by && (
                  <p className="hint">
                    ✓ {m.ingredient} · matched in {m.verified_by}
                    {m.strength_verified ? "" : " (check the strength)"}
                  </p>
                )}
                {match && dup && (
                  <fieldset className={"dup " + match.kind}>
                    <legend>{dup.message}</legend>
                    {dup.options.map((o) => (
                      <label key={o.value} className="opt">
                        <input
                          type="radio"
                          name={`dup-${m.id}`}
                          checked={actionFor(m.id) === o.value}
                          onChange={() => setChoices((c) => ({ ...c, [m.id]: o.value }))}
                        />
                        {o.label}
                      </label>
                    ))}
                  </fieldset>
                )}
                <label>
                  Name
                  <input value={m.name} onChange={(e) => edit(m.id, { name: e.target.value, ingredient: null, rxcui: null, verified_by: null })} />
                </label>
                <div className="row">
                  <label>
                    Strength
                    <input
                      value={m.strength ?? ""}
                      list={`strengths-${m.id}`}
                      placeholder={m.strength_options?.length ? "Pick or type" : ""}
                      onChange={(e) => edit(m.id, { strength: e.target.value })}
                    />
                    {/* Real strengths from RxNorm, so a missing or misread strength can be picked instead of typed */}
                    <datalist id={`strengths-${m.id}`}>
                      {m.strength_options?.map((s) => <option key={s} value={s} />)}
                    </datalist>
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
            );
          })}
        </div>
        <div className="actions">
          <button className="primary" onClick={confirm}>
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
      <div className="choices">
        <button className="primary" onClick={useCamera} disabled={busy || !online}>
          {busy ? "Reading label…" : "Use camera"}
        </button>
        <button className="secondary" onClick={() => libraryRef.current?.click()} disabled={busy || !online}>
          Choose from photo library
        </button>
        <button className="secondary" onClick={() => setTyping(true)} disabled={busy}>
          Type it in instead
        </button>
      </div>
      {onBuyCheck && (
        <div className="buy-entry">
          <p>At the store?</p>
          <button className="ghost" onClick={onBuyCheck} disabled={busy}>
            Check before buying →
          </button>
        </div>
      )}
      {!online && <p className="hint">Scanning needs a connection. Your cabinet still works offline.</p>}
      {/* Hidden inputs: the library picker has no capture attribute; the native-camera one is the fallback when live camera isn't available (e.g. http on a phone). */}
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