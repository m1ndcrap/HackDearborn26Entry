// Calendar export (.ics). Calendar apps fire these alarms even when the app is closed,
// which makes this the most reliable reminder option.
import type { Dose } from "./schedule";

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
const pad = (n: number) => String(n).padStart(2, "0");
const utcStamp = (d: Date) =>
  `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;

function fold(line: string): string {
  const out: string[] = [];
  for (let i = 0; i < line.length; i += 73) out.push((i ? " " : "") + line.slice(i, i + 73));
  return out.join("\r\n");
}

export function buildICS(doses: Dose[], who: string, start = new Date()): string {
  const day = `${start.getFullYear()}${pad(start.getMonth() + 1)}${pad(start.getDate())}`;
  const stamp = utcStamp(new Date());
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Pocket Apothecary//Medication schedule//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  for (const d of doses) {
    const body = [d.detail, d.tags.filter((t) => t !== "moved").join(", "), "Confirm timing with your pharmacist."].filter(Boolean).join("\n");
    lines.push(
      "BEGIN:VEVENT",
      `UID:${d.id}-${stamp}@pocket-apothecary`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${day}T${pad(Math.floor(d.minutes / 60))}${pad(d.minutes % 60)}00`,
      "DURATION:PT10M",
      `RRULE:FREQ=${d.weekly ? "WEEKLY" : "DAILY"}`,
      `SUMMARY:${esc(`${who}: take ${d.name}`)}`,
      `DESCRIPTION:${esc(body)}`,
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `DESCRIPTION:${esc(`Time for ${d.name}`)}`,
      "TRIGGER:PT0M",
      "END:VALARM",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

export function downloadFile(filename: string, text: string, mime: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}