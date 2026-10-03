import { useState } from "react";
import { useAppState } from "./store";
import Cabinet from "./screens/Cabinet";
import Scan from "./screens/Scan";
import Report from "./screens/Report";
import ProfileScreen from "./screens/ProfileScreen";

type Tab = "cabinet" | "scan" | "report" | "profile";

const TABS: { id: Tab; label: string }[] = [
  { id: "cabinet", label: "Cabinet" },
  { id: "scan", label: "Scan" },
  { id: "report", label: "Check" },
  { id: "profile", label: "Profile" },
];

export default function App() {
  const app = useAppState();
  const [tab, setTab] = useState<Tab>("cabinet");

  return (
    <div className="shell">
      <header className="top">
        <h1>Pocket Apothecary</h1>
        <label className="who">
          <span className="sr">Who is this for</span>
          <select value={app.profile.id} onChange={(e) => app.setActive(e.target.value)}>
            {app.state.profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </header>

      <main>
        {tab === "cabinet" && <Cabinet meds={app.meds} profile={app.profile} onScan={() => setTab("scan")} onRemove={app.removeMed} />}
        {tab === "scan" && (
          <Scan
            onAdd={(meds) => {
              app.addMeds(meds);
              setTab("report");
            }}
          />
        )}
        {tab === "report" && <Report profile={app.profile} meds={app.meds} onScan={() => setTab("scan")} />}
        {tab === "profile" && <ProfileScreen app={app} />}
      </main>

      <nav className="tabs" aria-label="Main">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? "on" : ""} aria-current={tab === t.id ? "page" : undefined} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
