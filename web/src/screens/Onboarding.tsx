import { useState } from "react";
import AboutNote from "../AboutNote";
import LanguagePicker from "../LanguagePicker";
import TextSizePicker from "../TextSizePicker";
import type { App } from "../store";
import type { ReadingLevel } from "../types";

const split = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

/** First-run welcome: app language, then who the medicines are for, then explanation language. */
export default function Onboarding({ app }: { app: App }) {
  const p = app.profile;
  const [step, setStep] = useState(0);
  const [name, setName] = useState(p.name === "Me" ? "" : p.name);
  const [age, setAge] = useState(p.age ? String(p.age) : "");
  const [allergies, setAllergies] = useState(p.allergies.join(", "));
  const [conditions, setConditions] = useState(p.conditions.join(", "));
  const [sameLang, setSameLang] = useState(true);
  const [explainLang, setExplainLang] = useState(app.state.uiLanguage);
  const [level, setLevel] = useState<ReadingLevel>(p.reading_level);

  const finish = () =>
    app.finishOnboarding({
      name: name.trim() || "Me",
      age: age ? Number(age) || null : null,
      allergies: split(allergies),
      conditions: split(conditions),
      language: sameLang ? app.state.uiLanguage : explainLang,
      reading_level: level,
    });

  return (
    <div className="onboard">
      <header className="onboard-top">
        <img className="wordmark" src="/logo-wordmark.svg" alt="Pocket Apothecary" />
        <ol className="steps" aria-label="Setup steps">
          {[0, 1, 2].map((i) => (
            <li key={i} className={i === step ? "on" : i < step ? "done" : ""} aria-current={i === step ? "step" : undefined} />
          ))}
        </ol>
      </header>

      <main className="onboard-main">
        {step === 0 && (
          <section>
            <h2>Welcome to Pocket Apothecary</h2>
            <p>Scan your medicines, catch risky combinations, and understand every warning in your own language.</p>
            <ul className="onboard-points">
              <li>Checks your medicines against FDA drug labels</li>
              <li>Explains warnings in plain words, and reads them aloud</li>
              <li>Builds a daily schedule and an emergency medication passport</li>
            </ul>
            <LanguagePicker label="Choose the app's language" value={app.state.uiLanguage} onChange={app.setUiLanguage} />
            <TextSizePicker value={app.state.textSize} onChange={app.setTextSize} />
            <AboutNote />
            <div className="actions">
              <button className="primary" onClick={() => setStep(1)}>
                Continue
              </button>
              <button className="ghost" onClick={() => app.finishOnboarding()}>
                Skip setup
              </button>
            </div>
          </section>
        )}

        {step === 1 && (
          <section>
            <h2>Who are these medicines for?</h2>
            <p className="hint">You can add family members later. Everything stays on this device.</p>
            <div className="card">
              <label>
                Name
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name, or Mom, Dad…" autoFocus />
              </label>
              <label>
                Age (optional)
                <input inputMode="numeric" value={age} onChange={(e) => setAge(e.target.value.replace(/\D/g, "").slice(0, 3))} />
              </label>
              <label>
                Allergies (separate with commas)
                <input value={allergies} onChange={(e) => setAllergies(e.target.value)} placeholder="penicillin, sulfa" />
              </label>
              <label>
                Health conditions (separate with commas)
                <input value={conditions} onChange={(e) => setConditions(e.target.value)} placeholder="kidney disease, high blood pressure" />
              </label>
            </div>
            <div className="actions">
              <button className="primary" onClick={() => setStep(2)}>
                Continue
              </button>
              <button className="ghost" onClick={() => setStep(0)}>
                Back
              </button>
            </div>
          </section>
        )}

        {step === 2 && (
          <section>
            <h2>Explanations and voice</h2>
            <p className="hint">Safety warnings can be explained and read aloud in any of these languages.</p>
            <label className="check">
              <input type="checkbox" checked={sameLang} onChange={(e) => setSameLang(e.target.checked)} />
              Use the same language as the app
            </label>
            {!sameLang && <LanguagePicker label="Explanation and voice language" value={explainLang} onChange={setExplainLang} />}
            <fieldset className="seg-group">
              <legend>How detailed should explanations be?</legend>
              <div className="seg">
                {(
                  [
                    ["simple", "Simple"],
                    ["standard", "Standard"],
                    ["clinical", "Clinical"],
                  ] as const
                ).map(([v, l]) => (
                  <button key={v} type="button" aria-pressed={level === v} onClick={() => setLevel(v)}>
                    {l}
                  </button>
                ))}
              </div>
            </fieldset>
            <p className="disclaimer">
              By continuing, you understand Pocket Apothecary doesn't give medical advice. Check with a pharmacist or doctor before changing any medicine.
            </p>
            <div className="actions">
              <button className="primary" onClick={finish}>
                Start using the app
              </button>
              <button className="ghost" onClick={() => setStep(1)}>
                Back
              </button>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}