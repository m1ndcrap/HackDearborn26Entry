import { useState } from "react";
import type { useAppState } from "../store";
import type { ReadingLevel } from "../types";
import { useInstall } from "../useInstall";
import LanguagePicker from "../LanguagePicker";

const split = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

export default function ProfileScreen({ app }: { app: ReturnType<typeof useAppState> }) {
  const p = app.profile;
  const [newName, setNewName] = useState("");
  const pwa = useInstall();

  return (
    <section>
      <h2>Profile</h2>
      <div className="card">
        <label>
          Name
          <input value={p.name} onChange={(e) => app.updateProfile({ ...p, name: e.target.value })} />
        </label>
        <label>
          Age
          <input inputMode="numeric" value={p.age ?? ""} onChange={(e) => app.updateProfile({ ...p, age: e.target.value ? Number(e.target.value) || null : null })} />
        </label>
        <label>
          Allergies (separate with commas)
          <input defaultValue={p.allergies.join(", ")} key={p.id + "a"} onBlur={(e) => app.updateProfile({ ...p, allergies: split(e.target.value) })} placeholder="penicillin, sulfa" />
        </label>
        <label>
          Health conditions (separate with commas)
          <input defaultValue={p.conditions.join(", ")} key={p.id + "c"} onBlur={(e) => app.updateProfile({ ...p, conditions: split(e.target.value) })} placeholder="kidney disease" />
        </label>
        <div className="row">
          <LanguagePicker variant="select" label="Explanation and voice language" value={p.language} onChange={(language) => app.updateProfile({ ...p, language })} />
          <label>
            Explanations
            <select value={p.reading_level} onChange={(e) => app.updateProfile({ ...p, reading_level: e.target.value as ReadingLevel })}>
              <option value="simple">Simple</option>
              <option value="standard">Standard</option>
              <option value="clinical">Clinical</option>
            </select>
          </label>
        </div>
      </div>
      {app.state.profiles.length > 1 && (
        <div className="actions">
          <button
            className="ghost danger"
            onClick={() => window.confirm(`Remove ${p.name || "this person"} and their medicines from this device?`) && app.removeProfile(p.id)}
          >
            Remove {p.name || "this person"}
          </button>
        </div>
      )}

      <h2>App language</h2>
      <div className="card">
        <LanguagePicker variant="select" label="Language for the app's buttons and screens" value={app.state.uiLanguage} onChange={app.setUiLanguage} />
        <button className="ghost" onClick={app.restartOnboarding}>
          Show the welcome screens again
        </button>
      </div>

      <h2>Add a family member</h2>
      <div className="card row">
        <input aria-label="Name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Mom" />
        <button
          className="secondary"
          onClick={() => {
            if (newName.trim()) {
              app.addProfile(newName.trim());
              setNewName("");
            }
          }}
        >
          Add person
        </button>
      </div>

      {(pwa.canInstall || pwa.showIOSHint) && (
        <>
          <h2>Get the app</h2>
          <div className="card install">
            <p>Add Pocket Apothecary to your home screen. It opens like an app and your cabinet works without a connection.</p>
            {pwa.canInstall ? (
              <button className="primary" onClick={pwa.install}>
                Install app
              </button>
            ) : (
              <p className="hint">
                In Safari, tap the Share button, then <strong>Add to Home Screen</strong>.
              </p>
            )}
          </div>
        </>
      )}
    </section>
  );
}