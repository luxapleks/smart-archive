import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReminderIcs, firstOccurrence } from "../src/shared/ics.ts";

// Maandag 23 november 2026, 10:16 (lokale tijd van de testomgeving)
const now = new Date(2026, 10, 23, 10, 16);
const ymdhm = (d: Date) => [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()];

test("first occurrences", () => {
  assert.deepEqual(ymdhm(firstOccurrence("weekly-fri", "15:30", now)), [2026, 11, 27, 15, 30]);
  assert.deepEqual(ymdhm(firstOccurrence("workday", "16:45", now)), [2026, 11, 23, 16, 45]); // vandaag nog
  assert.deepEqual(ymdhm(firstOccurrence("weekly-mon", "09:00", now)), [2026, 11, 30, 9, 0]); // vanochtend al voorbij
  assert.deepEqual(ymdhm(firstOccurrence("monthly-lastfri", "15:00", now)), [2026, 11, 27, 15, 0]);
  assert.deepEqual(ymdhm(firstOccurrence("monthly-lastfri", "15:00", new Date(2026, 10, 28))), [2026, 12, 25, 15, 0]); // december
  assert.deepEqual(ymdhm(firstOccurrence("workday", "16:45", new Date(2026, 10, 27, 17, 0))), [2026, 11, 30, 16, 45]); // na vrijdag -> maandag
});

test("ics contains a recurring free event with a reminder", () => {
  const ics = buildReminderIcs("biweekly-fri", "15:30", now);
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /DTSTART;TZID=Europe\/Amsterdam:20261127T153000\r\n/);
  assert.match(ics, /DTEND;TZID=Europe\/Amsterdam:20261127T154500\r\n/);
  assert.match(ics, /RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=FR\r\n/);
  assert.match(ics, /X-MICROSOFT-CDO-BUSYSTATUS:FREE/);
  assert.match(ics, /BEGIN:VALARM[\s\S]*TRIGGER:-PT0M[\s\S]*END:VALARM/);
  for (const line of ics.split("\r\n")) assert.ok(line.length <= 75, line);
  assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
});
