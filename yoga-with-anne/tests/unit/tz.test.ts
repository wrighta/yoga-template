import { test } from "node:test";
import assert from "node:assert/strict";
import { zonedToUtc, utcToZoned, fmtDate, fmtTimeRange, generateOccurrences, localDateKey } from "@/lib/tz";

const TZ = "Europe/Dublin";

test("Irish summer time (IST, UTC+1): 19:30 local → 18:30 UTC", () => {
  assert.equal(zonedToUtc(2026, 7, 7, 19, 30, TZ), "2026-07-07T18:30:00.000Z");
});

test("Irish winter time (GMT, UTC+0): 19:30 local → 19:30 UTC", () => {
  assert.equal(zonedToUtc(2026, 11, 3, 19, 30, TZ), "2026-11-03T19:30:00.000Z");
});

test("DST boundary: clocks go back 25 Oct 2026 - evening class is GMT", () => {
  // 25 Oct 2026: 02:00 IST → 01:00 GMT. A 19:30 class that evening is UTC 19:30.
  assert.equal(zonedToUtc(2026, 10, 25, 19, 30, TZ), "2026-10-25T19:30:00.000Z");
  // the day before, still IST (UTC+1)
  assert.equal(zonedToUtc(2026, 10, 24, 19, 30, TZ), "2026-10-24T18:30:00.000Z");
});

test("DST boundary: clocks go forward 29 Mar 2026 - evening class is IST", () => {
  // 29 Mar 2026: 01:00 GMT → 02:00 IST. A 19:30 class that evening is UTC 18:30.
  assert.equal(zonedToUtc(2026, 3, 29, 19, 30, TZ), "2026-03-29T18:30:00.000Z");
  assert.equal(zonedToUtc(2026, 3, 28, 19, 30, TZ), "2026-03-28T19:30:00.000Z");
});

test("round-trip UTC → local preserves the wall clock", () => {
  const iso = zonedToUtc(2026, 10, 6, 19, 30, TZ);
  const p = utcToZoned(iso, TZ);
  assert.deepEqual([p.year, p.month, p.day, p.hour, p.minute], [2026, 10, 6, 19, 30]);
});

test("weekday is computed in local time", () => {
  // 6 Oct 2026 is a Tuesday (ISO 2)
  assert.equal(utcToZoned(zonedToUtc(2026, 10, 6, 19, 30, TZ), TZ).weekday, 2);
  // 4 Oct 2026 is a Sunday (ISO 7)
  assert.equal(utcToZoned(zonedToUtc(2026, 10, 4, 12, 0, TZ), TZ).weekday, 7);
});

test("date formatting uses Irish conventions", () => {
  assert.equal(fmtDate("2026-10-06T18:30:00.000Z", TZ), "Tue 6 Oct");
  assert.equal(fmtDate("2026-10-06T18:30:00.000Z", TZ, true), "Tue 6 Oct 2026");
  assert.equal(fmtTimeRange("2026-10-06T18:30:00.000Z", "2026-10-06T19:30:00.000Z", TZ), "7.30–8.30 pm");
  assert.equal(fmtTimeRange("2026-11-03T19:30:00.000Z", "2026-11-03T20:30:00.000Z", TZ), "7.30–8.30 pm");
  // crossing midday: both suffixes shown
  assert.equal(fmtTimeRange("2026-10-06T10:00:00.000Z", "2026-10-06T11:30:00.000Z", TZ).includes("am"), true);
});

test("localDateKey groups bookings by Irish calendar date", () => {
  // early October is still IST (UTC+1): 23:30 UTC = 00:30 the next day locally
  assert.equal(localDateKey("2026-10-06T23:30:00.000Z", TZ), "2026-10-07");
  // after the clock change (GMT): 23:30 UTC stays on the same local date
  assert.equal(localDateKey("2026-11-03T23:30:00.000Z", TZ), "2026-11-03");
  // summer: 23:30 UTC = 00:30 next day
  assert.equal(localDateKey("2026-07-06T23:30:00.000Z", TZ), "2026-07-07");
});

test("generateOccurrences emits only matching weekdays", () => {
  const slots = generateOccurrences({
    weekdays: [2, 4], // Tue, Thu
    startTime: "19:30",
    endTime: "20:30",
    fromDate: "2026-10-05", // Monday
    toDate: "2026-10-18", // two weeks later
    tz: TZ,
  });
  assert.equal(slots.length, 4); // 2 Tuesdays + 2 Thursdays
  for (const s of slots) {
    const p = utcToZoned(s.startsAt, TZ);
    assert.ok(p.weekday === 2 || p.weekday === 4);
    assert.equal(p.hour, 19);
    assert.equal(p.minute, 30);
  }
});

test("generateOccurrences respects skip dates (blackouts)", () => {
  const slots = generateOccurrences({
    weekdays: [2],
    startTime: "19:30",
    endTime: "20:30",
    fromDate: "2026-10-05",
    toDate: "2026-10-18",
    tz: TZ,
    skipDates: ["2026-10-06"], // blackout the first Tuesday
  });
  assert.equal(slots.length, 1);
  assert.equal(utcToZoned(slots[0].startsAt, TZ).day, 13);
});

test("generateOccurrences handles DST change within the range", () => {
  // 24–31 Oct 2026 spans the clock change: same 19:30 local → different UTC
  const slots = generateOccurrences({
    weekdays: [2, 6],
    startTime: "19:30",
    endTime: "20:30",
    fromDate: "2026-10-24",
    toDate: "2026-10-31",
    tz: TZ,
  });
  // Tue 27 + Sat 31 (Sun-to-Sat weeks aren't enforced here; both Tuesdays within range: 27 only, plus Saturdays 31) → 27 Oct (GMT) 19:30Z, 31 Oct (GMT) 19:30Z
  const tuesdays = slots.filter((s) => utcToZoned(s.startsAt, TZ).weekday === 2);
  assert.equal(tuesdays.length, 1);
  assert.equal(tuesdays[0].startsAt, "2026-10-27T19:30:00.000Z");
});
