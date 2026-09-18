// Timesheet exports: one person's shifts for a day, week, or month, with totals.
// Shifts are counted on the day they start, so an overnight shift appears once.
import * as time from "./time.js";
import { loadShifts } from "./shifts.js";
import { getSettings } from "./settings.js";

export const PERIODS = ["day", "week", "month"];

const sum = (items, value) => items.reduce((total, item) => total + value(item), 0);

// Reads ?period=day|week|month&date=YYYY-MM-DD. Defaults: the current week.
export function readExportQuery(query) {
  return {
    period: PERIODS.includes(query.period) ? query.period : "week",
    date: time.isValidDate(query.date) ? query.date : time.localDate(),
  };
}

// Everything the export page shows. Shifts with a missing punch are listed but left out of the totals.
export function buildTimesheet(userId, { period, date }) {
  const range = time.periodRange(period, date, getSettings().weekStart);
  const [fromIso, toIso] = time.dayRangeUtc(range.from, range.to);
  const shifts = loadShifts(userId, fromIso, toIso)
    .filter((shift) => shift.date >= range.from && shift.date <= range.to);
  const counted = shifts.filter((shift) => shift.workedMs !== null);

  const days = [...Map.groupBy(shifts, (shift) => shift.date)].map(([dayDate, dayShifts]) => ({
    date: dayDate,
    shifts: dayShifts,
    workedMs: sum(dayShifts, (shift) => shift.workedMs ?? 0),
  }));

  return {
    period,
    date,
    range,
    label: periodLabel(period, range),
    days,
    shiftCount: shifts.length,
    totalMs: sum(counted, (shift) => shift.workedMs),
    breakMs: sum(counted, (shift) => shift.breakMs),
    incompleteCount: shifts.length - counted.length,
    generatedAt: time.nowIso(),
  };
}

// Time worked so far in the week containing `date`, for the Clock page and the
// Manage employee list: { week, workedMs, incompleteCount } (see buildTimesheet).
export function weekSoFar(userId, date = time.localDate()) {
  const sheet = buildTimesheet(userId, { period: "week", date });
  return { week: sheet.range, workedMs: sheet.totalMs, incompleteCount: sheet.incompleteCount };
}

// "timesheet-jdoe-week-2026-08-09.png"
export function exportFilename(user, sheet) {
  return `timesheet-${user.username}-${sheet.period}-${sheet.range.from}.png`;
}

// ===================================================================
// ===== Export all shift data (CSV) =====
// ===================================================================

const CSV_COLUMNS = ["Date", "Clock in", "Clock out", "Breaks", "Break minutes", "Worked hours", "Issues", "Warnings", "Notes"];

// Quotes a CSV cell when needed. Cells starting with = + - @ get a leading ' so
// spreadsheets don't run them as formulas.
function csvCell(value) {
  let text = String(value ?? "");
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

// Local "YYYY-MM-DD HH:MM" for a punch, or "" if it's missing.
const csvTime = (punch) => (punch ? time.toDatetimeLocal(punch.timestamp).replace("T", " ") : "");

// Every shift a user has, oldest first, one row each. Worked hours are blank for shifts
// with a missing punch (as in the timesheet totals).
export function allShiftsCsv(userId) {
  const shifts = loadShifts(userId, "", "9999"); // "" sorts before every ISO timestamp, "9999" after
  const rows = shifts.map((shift) => [
    shift.date,
    csvTime(shift.clockIn),
    csvTime(shift.clockOut),
    shift.breaks.length,
    Math.round(shift.breakMs / 60000),
    shift.workedMs === null ? "" : (shift.workedMs / 3600000).toFixed(2),
    shift.issues.join("; "),
    shift.warnings.join("; "),
    shift.notes.map((note) => `${note.author_name}: ${note.body}`).join(" | "),
  ]);
  // BOM so Excel reads the file as UTF-8.
  return "﻿" + [CSV_COLUMNS, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

// "shifts-jdoe-2026-09-14.csv"
export function allShiftsFilename(user) {
  return `shifts-${user.username}-${time.localDate()}.csv`;
}

function periodLabel(period, range) {
  if (period === "day") return time.formatDay(range.from);
  if (period === "week") return `${time.formatDay(range.from)} – ${time.formatDay(range.to)}`;
  return time.formatMonth(range.from);
}
