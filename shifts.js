// Shifts: groups punches into clock in -> breaks -> clock out sets for display.
// Used everywhere punches are listed (Clock, Manage Employee page).
// Like status, shifts are never stored. They're worked out from the punches each time.
import * as db from "./db.js";
import { localDate } from "./time.js";
import { breakPolicyFor } from "./settings.js";

// Groups punches (sorted oldest first) into shifts:
//   { clockIn, clockOut, breaks: [{ start, end, punches }], punches, rows: [{ punch, brk }] }
// A clock-in always starts a new shift and a clock-out always ends one. Punches that
// don't fit the normal order still land in a shift, which then has a missing piece
// (e.g. clockIn: null, or a break with end: null).
export function groupIntoShifts(punches) {
  const shifts = [];
  let shift = null;     // the shift being filled in
  let openBreak = null; // a break in that shift still waiting for its end

  for (const punch of punches) {
    if (punch.type === "clock_in" || !shift) {
      shift = { clockIn: null, clockOut: null, breaks: [], punches: [], rows: [] };
      shifts.push(shift);
      openBreak = null;
    }

    let brk = null; // the break this punch belongs to, if any
    switch (punch.type) {
      case "clock_in":
        shift.clockIn = punch;
        break;
      case "break_start":
        brk = openBreak = { start: punch, end: null, punches: [] };
        shift.breaks.push(brk);
        break;
      case "break_end":
        if (!openBreak) {
          openBreak = { start: null, end: null, punches: [] }; // a break end with no start
          shift.breaks.push(openBreak);
        }
        brk = openBreak;
        brk.end = punch;
        openBreak = null;
        break;
      case "clock_out":
        shift.clockOut = punch;
        break;
    }

    if (brk) brk.punches.push(punch);
    shift.punches.push(punch);
    shift.rows.push({ punch, brk });

    if (punch.type === "clock_out") shift = null; // the next punch starts a new shift
  }

  return shifts;
}

// Loads the shifts that have at least one punch in [fromIso, toIso).
// Shifts crossing the range edges (like an overnight shift) come back whole.
export function loadShifts(userId, fromIso, toIso) {
  // Widen the query out to the nearest clock-in/clock-out on each side so edge shifts
  // are complete. With none, go all the way ("" sorts before every ISO timestamp, "9999" after).
  const windowStart = db.getShiftEdgeBefore(userId, fromIso)?.timestamp ?? "";
  const windowEnd = db.getShiftEdgeFrom(userId, toIso)?.timestamp ?? "9999";
  const punches = db.listPunchesBetween(userId, windowStart, windowEnd);

  const context = {
    lastPunch: db.getLastPunch(userId),
    now: Date.now(),
    policy: breakPolicyFor(db.getUserById(userId)),
    notes: db.listNotesForUserBetween(userId, windowStart, windowEnd),
  };
  const inRange = (punch) => punch.timestamp >= fromIso && punch.timestamp < toIso;

  return groupIntoShifts(punches)
    .filter((shift) => shift.punches.some(inRange))
    .map((shift) => describeShift(shift, context));
}

// The shift the user is working right now (clocked in, not clocked out yet), or null.
export function currentShift(userId) {
  const edge = db.getShiftEdgeBefore(userId, "9999");
  if (edge?.type !== "clock_in") return null;
  const shifts = groupIntoShifts(db.listPunchesBetween(userId, edge.timestamp, "9999"));
  return shifts.find((shift) => shift.clockIn?.id === edge.id) ?? null;
}

// Adds display details to a shift: its date, whether it's still going, what's
// missing, break-rule warnings, and how long was worked and spent on break.
function describeShift(shift, { lastPunch, now, policy, notes }) {
  const ms = (punch) => Date.parse(punch.timestamp);
  const last = shift.punches.at(-1);

  shift.date = localDate(shift.punches[0].timestamp);
  shift.ids = shift.punches.map((p) => p.id);
  // Notes attach to any of the shift's punches; new ones go on the clock-in.
  shift.notes = notes.filter((note) => shift.ids.includes(note.punch_id));
  shift.notePunchId = (shift.clockIn ?? shift.punches[0]).id;
  // Still going: no clock-out yet, and nothing has been punched since.
  shift.inProgress = !shift.clockOut && last.id === lastPunch?.id;

  const issues = new Set();
  if (!shift.clockIn) issues.add("Missing clock in");
  if (!shift.clockOut && !shift.inProgress) issues.add("Missing clock out");

  shift.breakMs = 0;
  for (const brk of shift.breaks) {
    brk.ids = brk.punches.map((p) => p.id);
    brk.durationMs = null;
    const onBreakNow = shift.inProgress && !brk.end && brk.start === last;
    if (!brk.start) issues.add("Break missing start");
    else if (!brk.end && !onBreakNow) issues.add("Break missing end");
    else {
      brk.durationMs = (brk.end ? ms(brk.end) : now) - ms(brk.start);
      shift.breakMs += brk.durationMs;
    }
  }
  shift.issues = [...issues];
  shift.warnings = breakWarnings(shift, policy);

  // Only total up shifts with nothing missing; a gap would make the number wrong.
  // Warnings (like a long break) don't affect the total.
  const endMs = shift.clockOut ? ms(shift.clockOut) : now;
  shift.workedMs = shift.issues.length === 0 ? endMs - ms(shift.clockIn) - shift.breakMs : null;

  return shift;
}

// Break-rule problems worth flagging on a shift. They're flagged, never blocked.
function breakWarnings(shift, { maxCount, maxMinutes }) {
  const warnings = [];
  const count = shift.breaks.length;
  if (maxCount !== null && count > maxCount) {
    warnings.push(`${count} break${count === 1 ? "" : "s"} (limit ${maxCount})`);
  }
  if (maxMinutes !== null) {
    const long = shift.breaks.filter((brk) => brk.durationMs > maxMinutes * 60000).length;
    if (long === 1) warnings.push(`Break over ${maxMinutes} min`);
    if (long > 1) warnings.push(`${long} breaks over ${maxMinutes} min`);
  }
  return warnings;
}
