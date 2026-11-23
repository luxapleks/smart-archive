/**
 * Terugkerende herinnering als agenda-afspraak (.ics). Een add-in kan zelf geen
 * meldingen op de achtergrond geven; een terugkerende afspraak met herinnering in
 * je eigen agenda kan dat wel, en werkt in elke Outlook.
 */

export type ReminderKind = "workday" | "weekly-fri" | "weekly-mon" | "biweekly-fri" | "monthly-lastfri";

export interface ReminderPreset {
  kind: ReminderKind;
  label: string;
  hint: string;
  time: string; // HH:MM
}

export const PRESETS: ReminderPreset[] = [
  { kind: "weekly-fri", label: "Elke vrijdagmiddag", hint: "Week netjes afsluiten", time: "15:30" },
  { kind: "workday", label: "Elke werkdag aan het eind van de dag", hint: "Elke dag een lege inbox", time: "16:45" },
  { kind: "weekly-mon", label: "Elke maandagochtend", hint: "Frisse start van de week", time: "09:00" },
  { kind: "biweekly-fri", label: "Om de week op vrijdag", hint: "Rustig tempo", time: "15:30" },
  { kind: "monthly-lastfri", label: "Laatste vrijdag van de maand", hint: "Maandelijkse opruimronde", time: "15:00" },
];

const RRULE: Record<ReminderKind, string> = {
  workday: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
  "weekly-fri": "FREQ=WEEKLY;BYDAY=FR",
  "weekly-mon": "FREQ=WEEKLY;BYDAY=MO",
  "biweekly-fri": "FREQ=WEEKLY;INTERVAL=2;BYDAY=FR",
  "monthly-lastfri": "FREQ=MONTHLY;BYDAY=-1FR",
};

function atTime(d: Date, time: string): Date {
  const [h, m] = time.split(":").map(Number);
  const r = new Date(d);
  r.setHours(h || 0, m || 0, 0, 0);
  return r;
}

function lastFridayOfMonth(year: number, month: number): Date {
  const d = new Date(year, month + 1, 0); // laatste dag van de maand
  while (d.getDay() !== 5) d.setDate(d.getDate() - 1);
  return d;
}

/** Eerste moment (lokale tijd) vanaf `now` dat bij het schema past. */
export function firstOccurrence(kind: ReminderKind, time: string, now: Date): Date {
  if (kind === "monthly-lastfri") {
    let c = atTime(lastFridayOfMonth(now.getFullYear(), now.getMonth()), time);
    if (c <= now) c = atTime(lastFridayOfMonth(now.getFullYear(), now.getMonth() + 1), time);
    return c;
  }
  const days = kind === "workday" ? [1, 2, 3, 4, 5] : kind === "weekly-mon" ? [1] : [5];
  for (let i = 0; i < 14; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    const c = atTime(d, time);
    if (days.includes(c.getDay()) && c > now) return c;
  }
  return atTime(now, time);
}

const pad = (n: number) => String(n).padStart(2, "0");
const local = (d: Date) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
const utc = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Regels langer dan 75 tekens vouwen (RFC 5545). */
function fold(line: string): string {
  const out: string[] = [];
  let rest = line;
  while (rest.length > 74) {
    out.push(rest.slice(0, 74));
    rest = " " + rest.slice(74);
  }
  out.push(rest);
  return out.join("\r\n");
}

export const REMINDER_SUBJECT = "Archiefmoment met Captain Quality";

export function buildReminderIcs(kind: ReminderKind, time: string, now = new Date()): string {
  const start = firstOccurrence(kind, time, now);
  const end = new Date(start.getTime() + 15 * 60_000);
  const body =
    "Tijd om je mail op te ruimen!\n\n" +
    "Open een mail in Outlook en klik op 'Slim archiveren'. Captain Quality staat klaar om te salueren.\n\n" +
    "Herinnering aanpassen of stoppen? Open deze afspraak en wijzig of verwijder de reeks.";
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Smart archive//Outlook add-in//NL",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VTIMEZONE",
    "TZID:Europe/Amsterdam",
    "BEGIN:STANDARD",
    "DTSTART:19701025T030000",
    "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
    "TZOFFSETFROM:+0200",
    "TZOFFSETTO:+0100",
    "TZNAME:CET",
    "END:STANDARD",
    "BEGIN:DAYLIGHT",
    "DTSTART:19700329T020000",
    "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
    "TZOFFSETFROM:+0100",
    "TZOFFSETTO:+0200",
    "TZNAME:CEST",
    "END:DAYLIGHT",
    "END:VTIMEZONE",
    "BEGIN:VEVENT",
    `UID:smart-archive-${kind}-${now.getTime()}@smart-archive`,
    `DTSTAMP:${utc(now)}`,
    `DTSTART;TZID=Europe/Amsterdam:${local(start)}`,
    `DTEND;TZID=Europe/Amsterdam:${local(end)}`,
    `RRULE:${RRULE[kind]}`,
    `SUMMARY:${esc(REMINDER_SUBJECT)}`,
    `DESCRIPTION:${esc(body)}`,
    "TRANSP:TRANSPARENT",
    "X-MICROSOFT-CDO-BUSYSTATUS:FREE",
    "CLASS:PRIVATE",
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${esc(REMINDER_SUBJECT)}`,
    "TRIGGER:-PT0M",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}
