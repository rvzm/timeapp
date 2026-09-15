// Weekly availability: when an employee can be scheduled, as one time window per weekday.
// No rows at all means "not set". Once any day has a window, days without one are unavailable.
import * as db from "./db.js";
import { WEEKDAY_NAMES } from "./time.js";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// A user's week in display order (starting on `weekStart`):
// { isSet, days: [{ weekday, name, start, end }] } where start/end are "HH:MM" or "".
export function availabilityWeek(userId, weekStart) {
  const rows = db.listAvailability(userId);
  const days = [];
  for (let i = 0; i < 7; i++) {
    const weekday = (weekStart + i) % 7;
    const row = rows.find((r) => r.weekday === weekday);
    days.push({ weekday, name: WEEKDAY_NAMES[weekday], start: row?.start_time ?? "", end: row?.end_time ?? "" });
  }
  return { isSet: rows.length > 0, days };
}

// Validates the availability form (fields start_0..start_6 and end_0..end_6, by weekday).
// Returns { windows, week, error }: `week` is the typed values in availabilityWeek's shape,
// for showing the form again.
export function readAvailabilityForm(body, weekStart) {
  const days = [];
  const windows = [];
  let error = null;

  for (let i = 0; i < 7; i++) {
    const weekday = (weekStart + i) % 7;
    const name = WEEKDAY_NAMES[weekday];
    const start = String(body[`start_${weekday}`] ?? "").trim();
    const end = String(body[`end_${weekday}`] ?? "").trim();
    days.push({ weekday, name, start, end });

    if (error || (!start && !end)) continue;
    if (!start || !end) error = `Enter both a start and an end time for ${name}, or leave both blank.`;
    else if (!TIME_RE.test(start) || !TIME_RE.test(end)) error = `Enter times for ${name} as HH:MM.`;
    else if (end <= start) error = `The end time must be after its start time (${name}).`;
    else windows.push({ weekday, start, end });
  }

  return { windows, week: { isSet: windows.length > 0, days }, error };
}
