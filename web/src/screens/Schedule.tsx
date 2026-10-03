import { useMemo, useState } from "react";
import { buildICS, downloadFile } from "../ics";
import { askPermission, permission, sendTestReminder } from "../reminders";
import { buildSchedule, fmtTime, type Routine } from "../schedule";
import type { App } from "../store";

const ROUTINE_FIELDS: { key: keyof Routine; label: string }[] = [
  { key: "wake", label: "Wake up" },
  { key: "breakfast", label: "Breakfast" },
  { key: "lunch", label: "Lunch" },
  { key: "dinner", label: "Dinner" },
  { key: "bed", label: "Bedtime" },
];

export default function Schedule({ app, onScan }: { app: App; onScan: () => void }) {
  const { profile, meds, routine } = app;
  const plan = useMemo(() => buildSchedule(meds, routine), [meds, routine]);
  const [perm, setPerm] = useState(permission());
  const [msg, setMsg] = useState("");

  if (meds.length === 0) {
    return (
      <section className="empty">
        <h2>No schedule yet</h2>
        <p>Add {profile.name}'s medicines and we'll turn the label directions into a daily plan.</p>
        <button className="primary" onClick={onScan}>
          Scan a label
        </button>
      </section>
    );
  }

  // Group doses that share a time.
  const groups: { minutes: number; doses: typeof plan.doses }[] = [];
  for (const d of plan.doses) {
    const g = groups.at(-1);
    if (g && g.minutes === d.minutes) g.doses.push(d);
    else groups.push({ minutes: d.minutes, doses: [d] });
  }

  async function toggleReminders() {
    if (app.state.remindersOn) {
      app.setRemindersOn(false);
      setMsg("Reminders are off.");
      return;
    }
    const p = await askPermission();
    setPerm(p);
    if (p === "granted") {
      app.setRemindersOn(true);
      setMsg("Reminders are on. They work while the app is open; add the schedule to your calendar for reminders when it's closed.");
    } else if (p === "denied") setMsg("Notifications are blocked. Allow them in your browser's site settings, or add the schedule to your calendar instead.");
    else if (p === "unsupported") setMsg("This browser can't show reminders. Add the schedule to your calendar instead.");
  }

  return (
    <section>
      <h2>{profile.name}'s daily schedule</h2>

      {plan.doses.length > 0 && (
        <ol className="timeline">
          {groups.map((g) => (
            <li key={g.minutes}>
              <time>{fmtTime(g.minutes)}</time>
              <div>
                {g.doses.map((d) => (
                  <div key={d.id} className="dose">
                    <strong>{d.name}</strong>
                    {d.detail && <span className="sub"> {d.detail}</span>}
                    {d.tags.length > 0 && (
                      <div className="tags">
                        {d.tags.map((t) => (
                          <span key={t} className={`tag ${t.replace(" ", "-")}`}>
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </li>
          ))}
        </ol>
      )}

      {plan.notes.map((n) => (
        <div key={n.text} className="note">
          <p>
            <strong>{n.text}</strong>
          </p>
          <p className="sub">{n.why}</p>
        </div>
      ))}

      {plan.asNeeded.length > 0 && (
        <>
          <h3>Only when needed</h3>
          <ul className="plain">
            {plan.asNeeded.map((m) => (
              <li key={m.id}>
                <strong>{m.name}</strong> <span className="sub">{m.frequency}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {plan.unparsed.length > 0 && (
        <>
          <h3>Couldn't set a time</h3>
          <p className="hint">These labels don't say how often to take them. Check with your pharmacist, then edit the directions in the cabinet.</p>
          <ul className="plain">
            {plan.unparsed.map((m) => (
              <li key={m.id}>
                <strong>{m.name}</strong> <span className="sub">{m.frequency || "No directions"}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="actions">
        <button
          className="primary"
          disabled={plan.doses.length === 0}
          onClick={() => downloadFile(`${profile.name}-medicines.ics`, buildICS(plan.doses, profile.name), "text/calendar")}
        >
          Add to calendar
        </button>
        <button className="secondary" onClick={toggleReminders} disabled={perm === "unsupported"}>
          {app.state.remindersOn ? "Turn off reminders" : "Turn on reminders"}
        </button>
        {app.state.remindersOn && (
          <button className="ghost" onClick={() => sendTestReminder(plan.doses[0]?.name)}>
            Send a test reminder
          </button>
        )}
      </div>
      {msg && <p className="hint">{msg}</p>}

      <details className="routine">
        <summary>Adjust {profile.name}'s daily routine</summary>
        <div className="routine-grid">
          {ROUTINE_FIELDS.map((f) => (
            <label key={f.key}>
              {f.label}
              <input type="time" value={routine[f.key]} onChange={(e) => e.target.value && app.setRoutine({ ...routine, [f.key]: e.target.value })} />
            </label>
          ))}
        </div>
      </details>

      <p className="disclaimer">Times are suggestions based on label directions. Confirm timing with your pharmacist or doctor.</p>
    </section>
  );
}