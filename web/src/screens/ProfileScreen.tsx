import { useState } from "react";
import type { useAppState } from "../store";
import type { ReadingLevel } from "../types";

const split = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

export default function ProfileScreen({ app }: { app: ReturnType<typeof useAppState> }) {
  const p = app.profile;
  const [newName, setNewName] = useState("");

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
          <label>
            Language
            <select value={p.language} onChange={(e) => app.updateProfile({ ...p, language: e.target.value })}>
              <option>English</option>
              <option>Español</option>
              <option>العربية</option>
            </select>
          </label>
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
    </section>
  );
}
