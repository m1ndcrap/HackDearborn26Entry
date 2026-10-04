import { useMemo, useState } from "react";
import { deviceLanguage, findLanguage, LANGUAGES } from "./languages";

interface Props {
  value: string;
  onChange: (name: string) => void;
  /** "list": searchable list (welcome screens). "select": compact dropdown (Profile). */
  variant?: "list" | "select";
  label?: string;
}

const label = (n: string) => {
  const l = findLanguage(n);
  return l.native === l.name ? l.name : `${l.native} (${l.name})`;
};

export default function LanguagePicker({ value, onChange, variant = "list", label: title }: Props) {
  const current = findLanguage(value).name;
  const [q, setQ] = useState("");

  const options = useMemo(() => {
    const dev = deviceLanguage().name;
    const top = [...new Set([current, dev, "English", "Spanish", "Arabic"])];
    const rest = LANGUAGES.map((l) => l.name).filter((n) => !top.includes(n));
    const all = [...top, ...rest];
    const s = q.trim().toLowerCase();
    return s ? all.filter((n) => n.toLowerCase().includes(s) || findLanguage(n).native.toLowerCase().includes(s)) : all;
  }, [q, current]);

  if (variant === "select") {
    return (
      <label>
        {title}
        <select value={current} onChange={(e) => onChange(e.target.value)} className="notranslate">
          {LANGUAGES.map((l) => (
            <option key={l.name} value={l.name}>
              {label(l.name)}
            </option>
          ))}
        </select>
      </label>
    );
  }

  return (
    <div className="lang-picker">
      {title && <p className="lang-title">{title}</p>}
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search languages" aria-label="Search languages" />
      {/* Language names are shown in their own script, so this list is never translated */}
      <div className="lang-list notranslate" role="listbox" aria-label="Languages">
        {options.map((n) => (
          <button key={n} type="button" role="option" aria-selected={n === current} className={n === current ? "on" : ""} onClick={() => onChange(n)}>
            <span className="lang-native">{findLanguage(n).native}</span>
            {findLanguage(n).native !== n && <span className="lang-en">{n}</span>}
          </button>
        ))}
        {options.length === 0 && <p className="hint">No match. Try the English name.</p>}
      </div>
    </div>
  );
}