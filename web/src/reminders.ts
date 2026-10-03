// Dose reminders via the Notifications API.
// Limitation: without a push server, these fire only while the app is open or recently backgrounded.
// The calendar export (.ics) is the reliable option when the app is closed.
import type { Dose } from "./schedule";

let timers: number[] = [];

export const remindersSupported = () => "Notification" in window;
export const permission = (): NotificationPermission | "unsupported" => (remindersSupported() ? Notification.permission : "unsupported");

export async function askPermission(): Promise<NotificationPermission | "unsupported"> {
  if (!remindersSupported()) return "unsupported";
  return Notification.requestPermission();
}

async function show(title: string, body: string, tag: string) {
  try {
    const reg = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
    if (reg) return void (await reg.showNotification(title, { body, tag, icon: "/icon.svg" }));
  } catch {
    /* fall through to page notification */
  }
  new Notification(title, { body, tag, icon: "/icon.svg" });
}

export function clearReminders() {
  timers.forEach((t) => clearTimeout(t));
  timers = [];
}

/** Schedules today's remaining doses for every person, then reschedules itself after midnight. Returns how many were set. */
export function scheduleReminders(people: { who: string; doses: Dose[] }[]): number {
  clearReminders();
  if (permission() !== "granted") return 0;
  const now = new Date();
  const nowMs = (now.getHours() * 60 + now.getMinutes()) * 60_000 + now.getSeconds() * 1000;
  let count = 0;
  for (const { who, doses } of people) {
    for (const d of doses) {
      if (d.weekly) continue; // weekly doses: use the calendar export
      const wait = d.minutes * 60_000 - nowMs;
      if (wait <= 0) continue;
      timers.push(window.setTimeout(() => show(`Time for ${d.name}`, [who, d.detail].filter(Boolean).join(" · "), d.id), wait));
      count++;
    }
  }
  timers.push(window.setTimeout(() => scheduleReminders(people), 86_400_000 - nowMs + 5_000));
  return count;
}

export function sendTestReminder(name = "your medicine") {
  return show(`Time for ${name}`, "This is a test reminder from Pocket Apothecary.", "test");
}