// Time helpers.
// The database stores every timestamp as ISO 8601 UTC text ("2026-09-13T19:08:00.000Z").
// Everything a person sees or types is in the configured timezone. All conversion
// between the two happens in this file.
import { time_config } from "./config.js";

const pad = (n) => String(n).padStart(2, "0");
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// ===================================================================
// ===== Configuration =====
// settings.js calls configureTime() at startup and whenever an admin changes the
// timezone or clock format. Until then the config.js values apply.
// ===================================================================

export let timeZone;
let partsFormatter;
let timeFormatter;
let dateFormatter;
let clockFormatter;

export function isValidTimeZone(zone) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export const serverTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

// timezone: IANA name, or "" for the server's timezone. hour12: 12- or 24-hour clock.
export function configureTime({ timezone = time_config.timezone, hour12 = time_config.hour12 } = {}) {
  const zone = timezone || serverTimeZone;
  if (!isValidTimeZone(zone)) {
    throw new Error(`"${zone}" is not a valid IANA timezone (e.g. "America/Chicago").`);
  }

  timeZone = zone;
  partsFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  timeFormatter = new Intl.DateTimeFormat(time_config.locale, {
    timeZone, hour: "numeric", minute: "2-digit", hour12,
  });
  dateFormatter = new Intl.DateTimeFormat(time_config.locale, {
    timeZone, weekday: "short", month: "short", day: "numeric", year: "numeric",
  });
  // For plain wall-clock times like "13:05" that aren't tied to a date or timezone.
  clockFormatter = new Intl.DateTimeFormat(time_config.locale, {
    timeZone: "UTC", hour: "numeric", minute: "2-digit", hour12,
  });
}

configureTime();

// ===================================================================
// ===== Timezone math =====
// ===================================================================

// Wall-clock parts of a Date in the configured timezone.
function zonedParts(date) {
  const parts = {};
  for (const { type, value } of partsFormatter.formatToParts(date)) {
    if (type !== "literal") parts[type] = Number(value);
  }
  return parts; // { year, month, day, hour, minute, second }
}

// How many milliseconds the configured timezone is ahead of UTC at a given instant.
function offsetMs(date) {
  const p = zonedParts(date);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

// Wall-clock time in the configured timezone -> Date.
// Checks the offset twice so times near a DST change land correctly.
function zonedToDate(year, month, day, hour = 0, minute = 0, second = 0) {
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  let result = wall - offsetMs(new Date(wall));
  const secondOffset = offsetMs(new Date(result));
  if (wall - secondOffset !== result) result = wall - secondOffset;
  return new Date(result);
}

// ===================================================================
// ===== Dates and ranges =====
// ===================================================================

export function nowIso() {
  return new Date().toISOString();
}

// True for a real calendar date in "YYYY-MM-DD" form.
export function isValidDate(str) {
  const m = DATE_RE.exec(String(str ?? ""));
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

// "YYYY-MM-DD" for an ISO timestamp (default: now) in the configured timezone.
export function localDate(iso) {
  const p = zonedParts(iso ? new Date(iso) : new Date());
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

// [startIso, endIso) covering the whole local days fromDate..toDate (inclusive).
// Use it for DB range queries: timestamp >= start AND timestamp < end.
export function dayRangeUtc(fromDate, toDate = fromDate) {
  const [fy, fm, fd] = fromDate.split("-").map(Number);
  const [ty, tm, td] = toDate.split("-").map(Number);
  return [zonedToDate(fy, fm, fd).toISOString(), zonedToDate(ty, tm, td + 1).toISOString()];
}

// "2026-09-13" + 1 -> "2026-09-14"
export function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

// 0 = Sunday ... 6 = Saturday, for a "YYYY-MM-DD" date.
export function weekdayOf(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

// The week containing a date, as { from, to } dates, for weeks starting on `weekStart` (0 = Sunday).
export function weekRange(dateStr, weekStart) {
  const from = addDays(dateStr, -((weekdayOf(dateStr) - weekStart + 7) % 7));
  return { from, to: addDays(from, 6) };
}

// The day, week, or month containing a date, as { from, to } dates.
export function periodRange(period, dateStr, weekStart) {
  if (period === "day") return { from: dateStr, to: dateStr };
  if (period === "week") return weekRange(dateStr, weekStart);
  const [y, m] = dateStr.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(lastDay)}` };
}

// ===================================================================
// ===== <input type="datetime-local"> =====
// ===================================================================

// "YYYY-MM-DDTHH:MM" (local) -> ISO UTC string, or null if malformed.
export function fromDatetimeLocal(value) {
  const m = DATETIME_RE.exec(String(value ?? ""));
  if (!m || !isValidDate(`${m[1]}-${m[2]}-${m[3]}`)) return null;
  const [hour, minute, second] = [+m[4], +m[5], +(m[6] ?? 0)];
  if (hour > 23 || minute > 59 || second > 59) return null;
  return zonedToDate(+m[1], +m[2], +m[3], hour, minute, second).toISOString();
}

// ISO UTC string -> "YYYY-MM-DDTHH:MM" in the configured timezone.
export function toDatetimeLocal(iso) {
  const p = zonedParts(new Date(iso));
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

// ===================================================================
// ===== Display formatting =====
// ===================================================================

export const formatTime = (iso) => timeFormatter.format(new Date(iso));     // "3:05 PM"
export const formatDate = (iso) => dateFormatter.format(new Date(iso));     // "Sun, Sep 13, 2026"
export const formatDateTime = (iso) => `${formatDate(iso)}, ${formatTime(iso)}`;

// "Mon, Sep 14, 2026, 9:00 AM – 5:00 PM" (the end's date is only shown if it's a different day)
export function formatRange(startIso, endIso) {
  const end = localDate(startIso) === localDate(endIso) ? formatTime(endIso) : formatDateTime(endIso);
  return `${formatDateTime(startIso)} – ${end}`;
}

// "YYYY-MM-DD" -> "Sun, Sep 13, 2026"
export function formatDay(dateStr) {
  return formatDate(dayRangeUtc(dateStr)[0]);
}

// Just the time if it's today, otherwise date and time.
export function formatWhen(iso) {
  return localDate(iso) === localDate() ? formatTime(iso) : formatDateTime(iso);
}

// 8100000 -> "2h 15m"
export function formatDuration(ms) {
  const totalMinutes = Math.max(0, Math.floor(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours ? `${hours}h ${pad(minutes)}m` : `${minutes}m`;
}

// "13:05" -> "1:05 PM" (or "13:05" on a 24-hour clock)
export function formatClockTime(hhmm) {
  const [hour, minute] = hhmm.split(":").map(Number);
  return clockFormatter.format(new Date(Date.UTC(2000, 0, 1, hour, minute)));
}

const monthFormatter = new Intl.DateTimeFormat(time_config.locale, { timeZone: "UTC", month: "long", year: "numeric" });

// "2026-08-20" -> "August 2026"
export function formatMonth(dateStr) {
  const [y, m] = dateStr.split("-").map(Number);
  return monthFormatter.format(new Date(Date.UTC(y, m - 1, 1)));
}
