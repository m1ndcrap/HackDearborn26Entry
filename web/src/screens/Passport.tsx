import QRCode from "qrcode";
import { useEffect, useMemo, useState } from "react";
import { getReport } from "../api";
import { decodePassport, encodePassport, passportUrl, type PassportData } from "../passportLink";
import { loadReport, saveReport } from "../reportCache";
import type { App } from "../store";
import type { SafetyReport } from "../types";

const SEVERITY = { high: "Talk to a pharmacist", caution: "Use caution", info: "Good to know" } as const;

// "Advil label warns about Coumadin" already names both; "May not suit: kidney disease" names neither
function withDrugs(title: string, drugs: string[]) {
  const missing = drugs.filter((d) => !title.toLowerCase().includes(d.toLowerCase()));
  return missing.length ? `${title} (${drugs.join(" + ")})` : title;
}

function PassportCard({ data, qr }: { data: PassportData; qr?: string }) {
  return (
    <article className="passport">
      <header>
        <div>
          <h2>Medication Passport</h2>
          <p className="who">
            {data.n}
            {data.a ? `, ${data.a}` : ""}
          </p>
        </div>
        {qr && <img src={qr} alt="QR code that opens this passport" width={132} height={132} />}
      </header>

      <div className="allergies">
        <h3>Allergies</h3>
        <p>{data.al.length ? data.al.join(", ") : "None listed"}</p>
      </div>

      <h3>Health conditions</h3>
      <p>{data.c.length ? data.c.join(", ") : "None listed"}</p>

      <h3>Current medicines</h3>
      {data.m.length ? (
        <table>
          <thead>
            <tr>
              <th>Medicine</th>
              <th>Dose</th>
              <th>How often</th>
            </tr>
          </thead>
          <tbody>
            {data.m.map((m, i) => (
              <tr key={i}>
                <td>
                  <strong>{m.n}</strong> {m.s}
                </td>
                <td>{m.d || "—"}</td>
                <td>{m.f || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p>None listed</p>
      )}

      {data.fl.length > 0 && (
        <>
          <h3>Safety flags</h3>
          <ul className="plain">
            {data.fl.map((f, i) => (
              <li key={i}>
                <span className={`pill ${f.s}`}>{SEVERITY[f.s]}</span> {withDrugs(f.t, f.d)}
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="disclaimer">
        Updated {new Date(data.at).toLocaleString()}. Made with Pocket Apothecary from information the person entered. Confirm with the person or their pharmacy before
        making treatment decisions.
      </p>
    </article>
  );
}

export default function Passport({ app }: { app: App }) {
  const { profile, meds } = app;
  const [report, setReport] = useState<SafetyReport | null>(() => loadReport(profile.id)?.report ?? null);
  const [qr, setQr] = useState("");
  const [qrError, setQrError] = useState("");
  const [link, setLink] = useState("");

  useEffect(() => {
    setReport(loadReport(profile.id)?.report ?? null);
    if (meds.length === 0 || !navigator.onLine) return;
    let live = true;
    getReport(profile, meds)
      .then((r) => {
        saveReport(profile.id, r);
        if (live) setReport(r);
      })
      .catch(() => {}); // offline or server down: keep the saved report
    return () => {
      live = false;
    };
  }, [profile, meds]);

  const data: PassportData = useMemo(
    () => ({
      v: 1,
      n: profile.name,
      a: profile.age ?? null,
      al: profile.allergies,
      c: profile.conditions,
      m: meds.map((m) => ({ n: m.name, s: m.strength, d: m.dose, f: m.frequency })),
      // Emergency card: interactions, allergies, conditions, duplicates. Food and alcohol notes stay on the Check screen.
      fl: (report?.flags ?? []).filter((f) => f.kind !== "food_alcohol").map((f) => ({ s: f.severity, t: f.title, d: f.drugs })),
      at: new Date().toISOString(),
    }),
    [profile, meds, report],
  );

  useEffect(() => {
    let live = true;
    setQrError("");
    encodePassport(data)
      .then((code) => {
        const url = passportUrl(code);
        if (live) setLink(url);
        return QRCode.toDataURL(url, { errorCorrectionLevel: "L", margin: 1, width: 264 });
      })
      .then((img) => live && setQr(img))
      .catch(() => {
        if (live) {
          setQr("");
          setQrError("Too much information for one QR code. Print the passport instead.");
        }
      });
    return () => {
      live = false;
    };
  }, [data]);

  const isLocal = /localhost|127\.0\.0\.1/.test(link);

  return (
    <section>
      <PassportCard data={data} qr={qr} />
      <div className="actions no-print">
        <button className="primary" onClick={() => window.print()}>
          Print or save as PDF
        </button>
        {link && navigator.share && (
          <button className="secondary" onClick={() => navigator.share({ title: `${profile.name}'s Medication Passport`, url: link }).catch(() => {})}>
            Share link
          </button>
        )}
      </div>
      <div className="no-print">
        {qrError && <p className="err">{qrError}</p>}
        <p className="hint">
          Show the QR code to a nurse, pharmacist, or new doctor. It holds the passport itself, so nothing is stored on a server, and this page works offline.
        </p>
        {isLocal && <p className="hint">This QR code points to localhost, so it only opens on this computer. It'll work on other phones once the app is deployed.</p>}
      </div>
    </section>
  );
}

export function SharedPassport({ code }: { code: string }) {
  const [data, setData] = useState<PassportData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    decodePassport(code)
      .then(setData)
      .catch(() => setError("This passport link is damaged or incomplete. Ask the person to show their QR code again."));
  }, [code]);

  return (
    <main className="shared">
      {error && <p className="err">{error}</p>}
      {data && (
        <>
          <p className="banner no-print">This is a snapshot shared on {new Date(data.at).toLocaleDateString()}. Ask the person if anything has changed.</p>
          <PassportCard data={data} />
          <div className="actions no-print">
            <button className="primary" onClick={() => window.print()}>
              Print
            </button>
            <button className="ghost" onClick={() => (window.location.href = "/")}>
              Open Pocket Apothecary
            </button>
          </div>
        </>
      )}
    </main>
  );
}