import { useEffect, useState } from "react";
import { clearReminders, scheduleReminders } from "./reminders";
import { buildSchedule } from "./schedule";
import { useAppState, type App as AppModel } from "./store";
import { useOnline } from "./useOnline";
import Cabinet from "./screens/Cabinet";
import Passport, { SharedPassport } from "./screens/Passport";
import ProfileScreen from "./screens/ProfileScreen";
import Report from "./screens/Report";
import BuyCheck from "./screens/BuyCheck";
import Scan from "./screens/Scan";
import Schedule from "./screens/Schedule";

type Tab = "cabinet" | "scan" | "report" | "schedule" | "passport" | "profile" | "buy";

const TABS: { id: Tab; label: string }[] = [
  { id: "cabinet", label: "Cabinet" },
  { id: "scan", label: "Scan" },
  { id: "report", label: "Check" },
  { id: "schedule", label: "Schedule" },
  { id: "passport", label: "Passport" },
];

const sharedCode = () => (window.location.hash.startsWith("#passport=") ? window.location.hash.slice("#passport=".length) : "");

function useReminders(app: AppModel) {
  const { state, routineFor } = app;
  useEffect(() => {
    if (!state.remindersOn) {
      clearReminders();
      return;
    }
    const people = state.profiles.map((p) => ({ who: p.name, doses: buildSchedule(state.cabinet[p.id] ?? [], routineFor(p.id)).doses }));
    scheduleReminders(people);
    return clearReminders;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.remindersOn, state.profiles, state.cabinet, state.routine]);
}

export default function App() {
  const [code, setCode] = useState(sharedCode);
  useEffect(() => {
    const onHash = () => setCode(sharedCode());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  if (code) return <SharedPassport code={code} />;
  return <MainApp />;
}

function MainApp() {
  const app = useAppState();
  const [tab, setTab] = useState<Tab>("cabinet");
  const online = useOnline();
  useReminders(app);

  return (
    <div className="shell">
      <header className="top no-print">
        <h1>Pocket Apothecary</h1>
        <div className="who-group">
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
          <button className="profile-btn" aria-current={tab === "profile" ? "page" : undefined} onClick={() => setTab("profile")}>
            Profile
          </button>
        </div>
      </header>

      {!online && (
        <p className="offline no-print" role="status">
          You're offline. Your cabinet, schedule, and passport still work; scanning and new safety checks need a connection.
        </p>
      )}

      <main>
        {tab === "cabinet" && <Cabinet meds={app.meds} profile={app.profile} onScan={() => setTab("scan")} onBuyCheck={() => setTab("buy")} onRemove={app.removeMed} />}
        {tab === "scan" && (
          <Scan
            cabinet={app.meds}
            routine={app.routine}
            onAdd={(meds, replaceIds) => {
              app.addMeds(meds, replaceIds);
              setTab("report");
            }}
          />
        )}
        {tab === "buy" && <BuyCheck profile={app.profile} cabinet={app.meds} onAdd={(med) => app.addMeds([med])} />}
        {tab === "report" && <Report profile={app.profile} meds={app.meds} onScan={() => setTab("scan")} />}
        {tab === "schedule" && <Schedule app={app} onScan={() => setTab("scan")} />}
        {tab === "passport" && <Passport app={app} />}
        {tab === "profile" && <ProfileScreen app={app} />}
      </main>

      <nav className="tabs no-print" aria-label="Main">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? "on" : ""} aria-current={tab === t.id ? "page" : undefined} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}