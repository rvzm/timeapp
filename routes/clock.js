// Clock Portal: clock in/out, breaks, the current shift and week so far, and today's shifts.
import express from "express";
import * as db from "../db.js";
import * as time from "../time.js";
import { requireLogin } from "../auth.js";
import { loadShifts, currentShift } from "../shifts.js";
import { breakPolicyFor, getSettings } from "../settings.js";

const router = express.Router();

// The user's break rules and where they stand in their current shift:
// { policy, used, left (null = no limit), overLimit (on a break that's run long) }.
function breakStatus(user, status) {
  const policy = breakPolicyFor(user);
  const shift = currentShift(user.id);
  const used = shift?.breaks.length ?? 0;
  const lastBreak = shift?.breaks.at(-1);
  const breakMs = status === "break" && lastBreak?.start ? Date.now() - Date.parse(lastBreak.start.timestamp) : 0;

  return {
    policy,
    used,
    left: policy.maxCount === null ? null : Math.max(0, policy.maxCount - used),
    overLimit: policy.maxMinutes !== null && breakMs > policy.maxMinutes * 60000,
  };
}

// The shift in progress, with its worked and break time, or null when clocked out.
// Loaded from its own clock-in, so a shift that started yesterday still shows.
function shiftSoFar(userId, status) {
  if (status === "out") return null;
  const clockIn = currentShift(userId)?.clockIn;
  if (!clockIn) return null;
  const shift = loadShifts(userId, clockIn.timestamp, time.nowIso()).find((s) => s.inProgress);
  if (!shift) return null;
  return {
    startedAt: clockIn.timestamp,
    onClockMs: Date.now() - Date.parse(clockIn.timestamp),
    workedMs: shift.workedMs,
    breakMs: shift.breakMs,
  };
}

// Time worked this week (shifts counted on the day they start, as in timesheets).
// Shifts with a missing punch aren't counted; `incompleteCount` says how many.
function weekSoFar(userId) {
  const week = time.weekRange(time.localDate(), getSettings().weekStart);
  const [fromIso, toIso] = time.dayRangeUtc(week.from, week.to);
  const shifts = loadShifts(userId, fromIso, toIso).filter((s) => s.date >= week.from && s.date <= week.to);
  const counted = shifts.filter((s) => s.workedMs !== null);
  return {
    week,
    workedMs: counted.reduce((total, s) => total + s.workedMs, 0),
    incompleteCount: shifts.length - counted.length,
  };
}

function renderClock(req, res, error = null, statusCode = 200) {
  const last = db.getLastPunch(req.user.id);
  const status = db.statusFromPunch(last);
  const breaks = breakStatus(req.user, status);
  const [todayStart, todayEnd] = time.dayRangeUtc(time.localDate());

  // With no breaks left, Start Break goes away and Clock Out becomes the big button.
  const actions = db.allowedActions(status).filter((action) => action !== "break_start" || breaks.left !== 0);

  res.status(statusCode).render("clock", {
    title: "Clock",
    status,
    last,
    lastClock: db.getShiftEdgeBefore(req.user.id, "9999"),
    shiftNow: shiftSoFar(req.user.id, status),
    weekNow: weekSoFar(req.user.id),
    actions,
    breaks,
    shifts: loadShifts(req.user.id, todayStart, todayEnd),
    scheduledToday: db.listScheduledForUser(req.user.id, todayStart, todayEnd),
    today: time.localDate(),
    error,
  });
}

router.get("/dashboard", (req, res) => res.redirect("/clock")); // the old URL

router.get("/clock", requireLogin, (req, res) => renderClock(req, res));

router.post("/punch", requireLogin, (req, res) => {
  const action = String(req.body.action || "");
  const last = db.getLastPunch(req.user.id);
  const status = db.statusFromPunch(last);

  // Same punch as the last one: a double-click or a resubmitted form. Nothing to do.
  if (last && last.type === action) return res.redirect("/clock");

  // Another tab or device may have changed the status since this page loaded.
  if (!db.allowedActions(status).includes(action)) {
    const label = db.PUNCH_LABELS[action] ?? "punch";
    const message = `Couldn't ${label}: you're currently ${db.STATUS_LABELS[status]}. The page was out of date, so it has been refreshed.`;
    return renderClock(req, res, message, 409);
  }

  if (action === "break_start" && breakStatus(req.user, status).left === 0) {
    return renderClock(req, res, "You've used all your breaks for this shift.", 409);
  }

  // better-sqlite3 is synchronous, so no other request can run between the checks above and this insert.
  db.insertPunch({ userId: req.user.id, type: action, timestamp: time.nowIso() });
  res.redirect("/clock");
});

export default router;
