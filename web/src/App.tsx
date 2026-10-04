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
        <h1>
          <img className="wordmark" src="/logo-wordmark.svg" alt="Pocket Apothecary" />
        </h1>
        <div className="who-group">
          <button className="avatar-btn" aria-label="Profile" aria-current={tab === "profile" ? "page" : undefined} onClick={() => setTab("profile")}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
              <circle cx="12" cy="8.5" r="4" />
              <path d="M4.5 20.5c1.2-3.6 4.1-5.5 7.5-5.5s6.3 1.9 7.5 5.5" />
            </svg>
          </button>
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
        </div>
      </header>

      {!online && (
        <p className="offline no-print" role="status">
          You're offline. Your cabinet, schedule, and passport still work; scanning and new safety checks need a connection.
        </p>
      )}

      <nav className="tabs no-print" aria-label="Main">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? "on" : ""} aria-current={tab === t.id ? "page" : undefined} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>

      <main>
        {tab === "cabinet" && (
          <Cabinet
            meds={app.meds}
            photos={app.state.photos}
            profile={app.profile}
            routine={app.routine}
            onScan={() => setTab("scan")}
            onBuyCheck={() => setTab("buy")}
            onRemove={app.removeMed}
            onUpdate={app.updateMed}
          />
        )}
        {tab === "scan" && (
          <Scan
            cabinet={app.meds}
            routine={app.routine}
            onBuyCheck={() => setTab("buy")}
            onAdd={(meds, replaceIds, photo) => {
              app.addMeds(meds, replaceIds, photo);
              setTab("report");
            }}
          />
        )}
        {tab === "buy" && <BuyCheck profile={app.profile} cabinet={app.meds} onAdd={(med, photo) => app.addMeds([med], [], photo)} />}
        {tab === "report" && <Report profile={app.profile} meds={app.meds} onScan={() => setTab("scan")} />}
        {tab === "schedule" && <Schedule app={app} onScan={() => setTab("scan")} />}
        {tab === "passport" && <Passport app={app} />}
        {tab === "profile" && <ProfileScreen app={app} />}
      </main>
    </div>
  );
}