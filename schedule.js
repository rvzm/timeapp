// Mandatory shifts: a manager assigns an employee a start and end time. Attendance is
// worked out by comparing each assignment with the shifts actually punched, using the
// lateGraceMinutes setting. Nothing about attendance is stored.
import * as db from "./db.js";
import * as time from "./time.js";
import { getSettings } from "./settings.js";
import { loadShifts } from "./shifts.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOTE_MAX = 200;

// ===================================================================
// ===== Attendance =====
// ===================================================================

// Adds `attendance` to each of one user's assignments:
//   { state: "upcoming" | "in_progress" | "done", clockedIn, missed, late, lateMs, leftEarly, earlyMs, onTime }
export function withAttendance(userId, assignments, now = Date.now()) {
  if (assignments.length === 0) return assignments;

  // Load the worked shifts around the assignments (a day either side catches early starts and late finishes).
  const from = new Date(Math.min(...assignments.map((a) => Date.parse(a.start_at))) - DAY_MS).toISOString();
  const to = new Date(Math.max(...assignments.map((a) => Date.parse(a.end_at))) + DAY_MS).toISOString();
  const worked = loadShifts(userId, from, to).map((shift) => ({
    start: Date.parse((shift.clockIn ?? shift.punches[0]).timestamp),
    end: shift.clockOut ? Date.parse(shift.clockOut.timestamp)
      : shift.inProgress ? now
      : Date.parse(shift.punches.at(-1).timestamp),
    clockedOut: Boolean(shift.clockOut),
  }));

  const graceMs = getSettings().lateGraceMinutes * 60000;
  return assignments.map((assignment) => ({ ...assignment, attendance: attendanceFor(assignment, worked, now, graceMs) }));
}

function attendanceFor(assignment, worked, now, graceMs) {
  const start = Date.parse(assignment.start_at);
  const end = Date.parse(assignment.end_at);
  const overlapping = worked.filter((shift) => shift.start < end && shift.end > start);
  const state = now < start ? "upcoming" : now < end ? "in_progress" : "done";
  const clockedIn = overlapping.length > 0;

  const missed = state === "done" && !clockedIn;
  // Late: clocked in after the start, or (while it's running) still not clocked in.
  const lateMs = clockedIn ? overlapping[0].start - start : state === "in_progress" ? now - start : 0;
  const late = !missed && lateMs > graceMs;
  // Left early: the last shift clocked out before the end.
  const last = overlapping.at(-1);
  const earlyMs = state === "done" && last?.clockedOut ? end - last.end : 0;
  const leftEarly = earlyMs > graceMs;

  return {
    state,
    clockedIn,
    missed,
    late,
    lateMs,
    leftEarly,
    earlyMs,
    onTime: state === "done" && clockedIn && !late && !leftEarly,
  };
}

// ===================================================================
// ===== Assigning =====
// ===================================================================

// Validates the assign-a-shift form. Returns { form } plus either { assignment } or { error }.
export function readAssignmentForm(body) {
  const form = {
    start: String(body.start ?? ""),
    end: String(body.end ?? ""),
    note: String(body.note ?? "").trim(),
    assignAnyway: body.assign_anyway === "on",
  };
  const start = time.fromDatetimeLocal(form.start);
  const end = time.fromDatetimeLocal(form.end);

  if (!start || !end) return { form, error: "Enter a valid start and end time." };
  if (end <= start) return { form, error: "The end time must be after the start time." };
  if (Date.parse(end) - Date.parse(start) > DAY_MS) return { form, error: "An assigned shift can't be longer than 24 hours." };
  if (form.note.length > NOTE_MAX) return { form, error: `Keep the note under ${NOTE_MAX} characters.` };
  return { form, assignment: { start, end, note: form.note } };
}

// Reasons an assignment might be a mistake: it overlaps the employee's other assigned
// shifts, or falls outside their weekly availability (if they've set it).
// Returns a list of messages; empty means no conflicts.
export function findConflicts(userId, startIso, endIso) {
  const conflicts = db.listScheduledForUser(userId, startIso, endIso)
    .map((other) => `Overlaps another assigned shift: ${time.formatRange(other.start_at, other.end_at)}.`);

  const windows = db.listAvailability(userId);
  if (windows.length === 0) return conflicts; // availability not set

  for (const segment of daySegments(startIso, endIso)) {
    const weekday = time.weekdayOf(segment.date);
    const name = time.WEEKDAY_NAMES[weekday];
    const dayWindows = windows.filter((w) => w.weekday === weekday);
    // Availability can only end at 23:59, so that counts as "until midnight".
    const covers = (w) => w.start_time <= segment.start && (w.end_time >= segment.end || (segment.end === "24:00" && w.end_time === "23:59"));

    if (dayWindows.length === 0) {
      conflicts.push(`Unavailable on ${name}s.`);
    } else if (!dayWindows.some(covers)) {
      const hours = dayWindows.map((w) => `${time.formatClockTime(w.start_time)} – ${time.formatClockTime(w.end_time)}`).join(", ");
      conflicts.push(`Outside availability on ${name} (available ${hours}).`);
    }
  }
  return conflicts;
}

// Splits [startIso, endIso) into pieces that each fall on one local day:
// [{ date: "YYYY-MM-DD", start: "HH:MM", end: "HH:MM" or "24:00" }].
function daySegments(startIso, endIso) {
  const segments = [];
  for (let date = time.localDate(startIso); ; date = time.addDays(date, 1)) {
    const [dayStart, dayEnd] = time.dayRangeUtc(date);
    const from = startIso > dayStart ? startIso : dayStart;
    const to = endIso < dayEnd ? endIso : dayEnd;
    if (from < to) {
      segments.push({
        date,
        start: time.toDatetimeLocal(from).slice(11),
        end: to === dayEnd ? "24:00" : time.toDatetimeLocal(to).slice(11),
      });
    }
    if (endIso <= dayEnd) return segments;
  }
}
