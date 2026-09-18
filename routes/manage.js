// Manager Console: the employee list, each employee's Manage Employee tabs (Shifts,
// Schedule, Requests, Details), the weekly schedule, the edit request queue, and the
// default break rules.
// Mounted at /manage. Managers only see the employees they can manage (permissions.js);
// admins see everyone. Managers on several teams (and admins, once teams exist) view one
// team at a time with ?team=<id> (admins also get "all" and "none").
import express from "express";
import * as db from "../db.js";
import * as time from "../time.js";
import { loadShifts } from "../shifts.js";
import { requireManager } from "../auth.js";
import { canManageShifts, canManageSchedule } from "../permissions.js";
import { readTeamFilter, inTeamFilter } from "../teams.js";
import { getSettings, saveSettings, readBreakLimitsForm, breakPolicyFor } from "../settings.js";
import { availabilityWeek } from "../availability.js";
import { reviewRequest, pendingByPunch, pendingRequestsFor } from "../requests.js";
import { withAttendance, readAssignmentForm, readWeeklyForm, findConflicts } from "../schedule.js";
import { buildTimesheet, readExportQuery, exportFilename, weekSoFar } from "../timesheet.js";
import { toId, notFound, readRange, rangeIncluding, safeRedirect } from "./helpers.js";

const router = express.Router();
router.use(requireManager);

const NOTE_MAX = 500;

// ===================================================================
// ===== Team picker =====
// Sets req.teamFilter: "" (no filter), a team id, or "none" (people on no team), and
// res.locals.teamPicker / teamQuery for the tabs and links.
// ===================================================================

router.use((req, res, next) => {
  const { filter, picker } = readTeamFilter(req.user, req.query.team);
  req.teamFilter = filter;
  res.locals.teamPicker = picker;
  res.locals.teamQuery = filter ? `team=${filter}` : "";
  next();
});

// Whether a user belongs to the team picked in the Manage Console.
const inSelectedTeam = (req, userId) => inTeamFilter(req.teamFilter, userId);

// ===================================================================
// ===== Helpers =====
// ===================================================================

// The user with this id, if the current user may manage them. Otherwise renders a 404
// (so managers can't probe which admin accounts exist) and returns null.
function loadEmployee(req, res, id) {
  const target = db.getUserById(toId(id));
  if (!target || !canManageShifts(req.user, target)) {
    notFound(res, "employee");
    return null;
  }
  return target;
}

// The punch with this id plus its owner, if the current user may manage them. Otherwise 404 and null.
function loadPunch(req, res, id) {
  const punch = db.getPunch(toId(id));
  const target = punch && db.getUserById(punch.user_id);
  if (!punch || !canManageShifts(req.user, target)) {
    notFound(res, "punch");
    return null;
  }
  return { punch, target };
}

function employeeUrl(userId, range) {
  return `/manage/employees/${userId}?from=${range.from}&to=${range.to}`;
}

// Validates the add/edit punch form.
// Returns { form } (the raw values, for re-rendering) plus either { punch } or { error }.
function readPunchForm(body) {
  const form = {
    type: String(body.type || ""),
    when: String(body.when || ""),
    note: String(body.note || "").trim(),
  };
  const timestamp = time.fromDatetimeLocal(form.when);

  if (!db.PUNCH_TYPES.includes(form.type)) return { form, error: "Pick a punch type." };
  if (!timestamp) return { form, error: "Enter a valid date and time." };
  if (form.note.length > NOTE_MAX) return { form, error: `Note must be ${NOTE_MAX} characters or fewer.` };
  return { form, punch: { type: form.type, timestamp, note: form.note } };
}

// ===================================================================
// ===== Manage Employee tabs =====
// Every tab shares a header (name, status, Export) and the tab bar, so each gets
// `target`, `currentStatus`, and `pendingCount` plus its own content.
// ===================================================================

function renderEmployeeTab(res, target, view, data, statusCode = 200) {
  res.status(statusCode).render(`manage/${view}`, {
    title: db.displayName(target),
    target,
    currentStatus: db.statusFromPunch(db.getLastPunch(target.id)),
    targetTeams: db.listTeamsForUser(target.id),
    pendingCount: db.listPendingRequestsForUser(target.id).length,
    ...data,
  });
}

// Shifts: punches in a date range, plus the add-punch form.
function renderShiftsTab(req, res, target, { range, error = null, form = null, statusCode = 200 }) {
  const [fromIso, toIso] = time.dayRangeUtc(range.from, range.to);
  const status = db.statusFromPunch(db.getLastPunch(target.id));

  renderEmployeeTab(res, target, "employee", {
    shifts: loadShifts(target.id, fromIso, toIso),
    pendingByPunch: pendingByPunch(target.id),
    range,
    today: time.localDate(),
    error,
    form: form ?? { type: db.allowedActions(status)[0], when: time.toDatetimeLocal(time.nowIso()), note: "" },
  }, statusCode);
}

// Schedule: mandatory shifts from two weeks back to four weeks ahead, plus the three
// dialogs that change them. `open` says which dialog to reopen after an error
// ("add", "weekly" or "modify"), and `selected` which shift the list has picked.
function renderScheduleTab(req, res, target, {
  open = null, error = null, conflicts = [], selected = null,
  addForm = null, weeklyForm = null, modifyForm = null, statusCode = 200,
} = {}) {
  const today = time.localDate();
  const [from] = time.dayRangeUtc(time.addDays(today, -14));
  const [, to] = time.dayRangeUtc(time.addDays(today, 28));

  renderEmployeeTab(res, target, "employee-schedule", {
    schedule: withAttendance(target.id, db.listScheduledForUser(target.id, from, to)),
    canSchedule: canManageSchedule(req.user, target),
    added: statusCode === 200 ? Number(req.query.added) || null : null,
    scheduleOpen: open,
    scheduleError: error,
    scheduleConflicts: conflicts,
    selectedId: selected,
    addForm: addForm ?? { start: "", end: "", note: "", assignAnyway: false },
    weeklyForm: weeklyForm ?? { days: [], start: "09:00", end: "17:00", from: today, weeks: "4", note: "", assignAnyway: false },
    modifyForm,
  }, statusCode);
}

// Requests: pending ones to review, and the employee's past requests.
function renderRequestsTab(req, res, target) {
  renderEmployeeTab(res, target, "employee-requests", {
    pending: db.listPendingRequestsForUser(target.id),
    reviewed: db.listRequestsForUser(target.id).filter((request) => request.status !== "pending").slice(0, 50),
  });
}

// Details: profile, availability, and break allowance.
function renderDetailsTab(req, res, target, { breakForm = null, breakError = null, statusCode = 200 } = {}) {
  const settings = getSettings();

  renderEmployeeTab(res, target, "employee-details", {
    availability: availabilityWeek(target.id, settings.weekStart),
    policy: breakPolicyFor(target),
    breakDefaults: { maxCount: settings.breakMaxCount, maxMinutes: settings.breakMaxMinutes },
    breakForm: breakForm ?? { maxCount: target.break_max_count, maxMinutes: target.break_max_minutes },
    breakError,
    canSchedule: canManageSchedule(req.user, target),
    saved: statusCode === 200 ? req.query.saved : null,
  }, statusCode);
}

// Each GET tab route loads the employee (404 if they can't be managed) and renders its tab.
const tabRoute = (render) => (req, res) => {
  const target = loadEmployee(req, res, req.params.id);
  if (target) render(req, res, target);
};

router.get("/employees/:id", tabRoute((req, res, target) => renderShiftsTab(req, res, target, { range: readRange(req.query) })));
router.get("/employees/:id/schedule", tabRoute(renderScheduleTab));
router.get("/employees/:id/requests", tabRoute(renderRequestsTab));
router.get("/employees/:id/details", tabRoute(renderDetailsTab));

// The employee's timesheet export (same page as the Portal's).
router.get("/employees/:id/export", (req, res) => {
  const target = loadEmployee(req, res, req.params.id);
  if (!target) return;
  const sheet = buildTimesheet(target.id, readExportQuery(req.query));

  res.render("export", {
    title: "Timesheet",
    employee: target,
    sheet,
    exportUrl: `/manage/employees/${target.id}/export`,
    backUrl: `/manage/employees/${target.id}`,
    filename: exportFilename(target, sheet),
  });
});

// ===================================================================
// ===== Employee list =====
// ===================================================================

router.get("/", (req, res) => {
  const users = db.listUsersWithLastPunch()
    .filter((u) => canManageShifts(req.user, u) && inSelectedTeam(req, u.id))
    .map((u) => ({ ...u, status: db.statusFromPunch({ type: u.last_type }), week: weekSoFar(u.id) }));

  const counts = { in: 0, break: 0, out: 0 };
  for (const u of users) if (u.active) counts[u.status]++;

  const [todayStart, todayEnd] = time.dayRangeUtc(time.localDate());
  const scheduledToday = Map.groupBy(db.listScheduledBetween(todayStart, todayEnd), (a) => a.user_id);

  res.render("manage/index", { title: "Employees", users, counts, scheduledToday, showTeams: db.listTeams().length > 0 });
});

// ===================================================================
// ===== Punches =====
// Edits here are free-form: no sequence rules, but edited_by records who made them.
// ===================================================================

router.post("/employees/:id/punches", (req, res) => {
  const target = loadEmployee(req, res, req.params.id);
  if (!target) return;

  const range = readRange(req.body);
  const { form, punch, error } = readPunchForm(req.body);
  if (error) return renderShiftsTab(req, res, target, { range, error, form, statusCode: 400 });

  db.insertPunch({ userId: target.id, ...punch, editedBy: req.user.id });
  res.redirect(employeeUrl(target.id, rangeIncluding(range, time.localDate(punch.timestamp))));
});

// Deletes a single punch, a whole break, or a whole shift. The form sends the ids of
// the punches it showed, so exactly what was on screen is removed. Ids that belong
// to a different user are ignored.
router.post("/employees/:id/punches/delete", (req, res) => {
  const target = loadEmployee(req, res, req.params.id);
  if (!target) return;

  const ids = String(req.body.ids || "").split(",").map(toId);
  if (ids.includes(null)) {
    return res.status(400).render("error", { title: "Nothing deleted", message: "No valid punches were selected." });
  }

  db.deletePunches(target.id, ids);
  res.redirect(employeeUrl(target.id, readRange(req.body)));
});

router.get("/punches/:id/edit", (req, res) => {
  const found = loadPunch(req, res, req.params.id);
  if (!found) return;
  const { punch, target } = found;

  res.render("manage/punch-edit", {
    title: "Edit punch",
    punch,
    target,
    range: readRange(req.query, time.localDate(punch.timestamp)),
    error: null,
    form: { type: punch.type, when: time.toDatetimeLocal(punch.timestamp), note: punch.note },
  });
});

router.post("/punches/:id", (req, res) => {
  const found = loadPunch(req, res, req.params.id);
  if (!found) return;
  const { punch, target } = found;

  const range = readRange(req.body, time.localDate(punch.timestamp));
  const { form, punch: changes, error } = readPunchForm(req.body);
  if (error) {
    return res.status(400).render("manage/punch-edit", { title: "Edit punch", punch, target, range, error, form });
  }

  db.updatePunch(punch.id, { ...changes, editedBy: req.user.id });
  res.redirect(employeeUrl(target.id, rangeIncluding(range, time.localDate(changes.timestamp))));
});

// ===================================================================
// ===== Mandatory shifts =====
// Managers assign employees; admins assign anyone. Nobody but an admin assigns a manager.
// ===================================================================

// The employee whose schedule the current user may change, or null after answering
// (403 for their own schedule, 404 for anyone they can't manage).
function loadForSchedule(req, res, id) {
  const target = loadEmployee(req, res, id);
  if (!target) return null;
  if (!canManageSchedule(req.user, target)) {
    res.status(403).render("error", { title: "Not allowed", message: "Only an admin can assign your own shifts." });
    return null;
  }
  return target;
}

// Add Single Shift.
router.post("/employees/:id/schedule", (req, res) => {
  const target = loadForSchedule(req, res, req.params.id);
  if (!target) return;

  const { form, assignment, error } = readAssignmentForm(req.body);
  if (error) return renderScheduleTab(req, res, target, { open: "add", addForm: form, error, statusCode: 400 });

  // Conflicts don't block, but they have to be confirmed with "Assign anyway".
  const conflicts = findConflicts(target.id, assignment.start, assignment.end);
  if (conflicts.length && !form.assignAnyway) {
    return renderScheduleTab(req, res, target, { open: "add", addForm: form, conflicts, statusCode: 409 });
  }

  db.insertScheduledShift({
    userId: target.id,
    startAt: assignment.start,
    endAt: assignment.end,
    note: assignment.note,
    assignedBy: req.user.id,
    createdAt: time.nowIso(),
  });
  res.redirect(`/manage/employees/${target.id}/schedule`);
});

// Add Weekly Shift: the same shift on chosen weekdays, repeated for a number of weeks.
// Every occurrence becomes an ordinary assigned shift, so each can be changed on its own.
router.post("/employees/:id/schedule/weekly", (req, res) => {
  const target = loadForSchedule(req, res, req.params.id);
  if (!target) return;

  const { form, occurrences, error } = readWeeklyForm(req.body);
  if (error) return renderScheduleTab(req, res, target, { open: "weekly", weeklyForm: form, error, statusCode: 400 });

  const conflicts = occurrences.flatMap((shift) =>
    findConflicts(target.id, shift.start, shift.end).map((conflict) => `${time.formatDay(time.localDate(shift.start))}: ${conflict}`));
  if (conflicts.length && !form.assignAnyway) {
    return renderScheduleTab(req, res, target, { open: "weekly", weeklyForm: form, conflicts, statusCode: 409 });
  }

  const createdAt = time.nowIso();
  db.db.transaction(() => {
    for (const shift of occurrences) {
      db.insertScheduledShift({
        userId: target.id,
        startAt: shift.start,
        endAt: shift.end,
        note: shift.note,
        assignedBy: req.user.id,
        createdAt,
      });
    }
  })();
  res.redirect(`/manage/employees/${target.id}/schedule?added=${occurrences.length}`);
});

// The assigned shift with this id, if the current user may change it. Otherwise 404 and null.
function loadAssignment(req, res, id) {
  const assignment = db.getScheduledShift(toId(id));
  const target = assignment && db.getUserById(assignment.user_id);
  if (!assignment || !canManageSchedule(req.user, target)) {
    notFound(res, "assigned shift");
    return null;
  }
  return { assignment, target };
}

// Modify Shift: new times and note for one assigned shift.
router.post("/schedule/:id", (req, res) => {
  const found = loadAssignment(req, res, req.params.id);
  if (!found) return;
  const { assignment, target } = found;

  const reopen = { open: "modify", selected: assignment.id };
  const { form, assignment: changes, error } = readAssignmentForm(req.body);
  if (error) return renderScheduleTab(req, res, target, { ...reopen, modifyForm: form, error, statusCode: 400 });

  const conflicts = findConflicts(target.id, changes.start, changes.end, assignment.id);
  if (conflicts.length && !form.assignAnyway) {
    return renderScheduleTab(req, res, target, { ...reopen, modifyForm: form, conflicts, statusCode: 409 });
  }

  db.updateScheduledShift(assignment.id, { startAt: changes.start, endAt: changes.end, note: changes.note });
  res.redirect(`/manage/employees/${target.id}/schedule`);
});

router.post("/schedule/:id/delete", (req, res) => {
  const found = loadAssignment(req, res, req.params.id);
  if (!found) return;

  db.deleteScheduledShift(found.assignment.id);
  res.redirect(safeRedirect(req.body.back, `/manage/employees/${found.target.id}/schedule`));
});

// The week's assignments for everyone the current user manages, one list per day.
router.get("/schedule", (req, res) => {
  const { weekStart } = getSettings();
  const week = time.weekRange(time.isValidDate(req.query.week) ? req.query.week : time.localDate(), weekStart);
  const [fromIso, toIso] = time.dayRangeUtc(week.from, week.to);

  const visible = db.listScheduledBetween(fromIso, toIso)
    .filter((a) => canManageShifts(req.user, { id: a.user_id, role: a.user_role }) && inSelectedTeam(req, a.user_id));
  // Attendance is worked out one employee at a time.
  const assignments = [...Map.groupBy(visible, (a) => a.user_id)]
    .flatMap(([userId, list]) => withAttendance(userId, list))
    .sort((a, b) => a.start_at.localeCompare(b.start_at));

  const days = Array.from({ length: 7 }, (_, i) => {
    const date = time.addDays(week.from, i);
    return { date, assignments: assignments.filter((a) => time.localDate(a.start_at) === date) };
  });

  res.render("manage/schedule", {
    title: "Schedule",
    week,
    days,
    prevWeek: time.addDays(week.from, -7),
    nextWeek: time.addDays(week.from, 7),
    canDelete: (a) => canManageSchedule(req.user, { id: a.user_id, role: a.user_role }),
  });
});

// ===================================================================
// ===== Edit requests =====
// ===================================================================

const canReview = (user, request) => canManageShifts(user, { id: request.user_id, role: request.user_role });

router.get("/requests", (req, res) => {
  const inTeam = (request) => inSelectedTeam(req, request.user_id);
  res.render("manage/requests", {
    title: "Requests",
    pending: pendingRequestsFor(req.user).filter(inTeam),
    recent: db.listRecentRequests().filter((request) => canReview(req.user, request) && inTeam(request)),
  });
});

// decision=approve|deny, with an optional note for the employee.
router.post("/requests/:id/review", (req, res) => {
  const request = db.getRequest(toId(req.params.id));
  if (!request || !canReview(req.user, request)) return notFound(res, "request");

  const decision = String(req.body.decision ?? "");
  if (decision !== "approve" && decision !== "deny") {
    return res.status(400).render("error", { title: "Not reviewed", message: "Choose Approve or Deny." });
  }

  const note = String(req.body.note ?? "").trim().slice(0, 500);
  const error = reviewRequest(req.user, request.id, { approve: decision === "approve", note });
  if (error) return res.status(409).render("error", { title: "Couldn't review the request", message: error });

  res.redirect(safeRedirect(req.body.back, "/manage/requests"));
});

// ===================================================================
// ===== Break rules =====
// A default for everyone, plus an optional allowance per employee.
// ===================================================================

function renderBreakRules(req, res, { form = null, error = null, notice = null, statusCode = 200 } = {}) {
  const settings = getSettings();
  const custom = db.listUsersWithLastPunch().filter((u) =>
    canManageShifts(req.user, u) && inSelectedTeam(req, u.id) && (u.break_max_count !== null || u.break_max_minutes !== null));

  res.status(statusCode).render("manage/breaks", {
    title: "Break rules",
    form: form ?? { maxCount: settings.breakMaxCount, maxMinutes: settings.breakMaxMinutes },
    custom,
    error,
    notice,
  });
}

router.get("/breaks", (req, res) => {
  renderBreakRules(req, res, { notice: req.query.saved ? "Break rules saved." : null });
});

router.post("/breaks", (req, res) => {
  const { values, error } = readBreakLimitsForm(req.body);
  if (error) return renderBreakRules(req, res, { form: values, error, statusCode: 400 });

  saveSettings({ breakMaxCount: values.maxCount, breakMaxMinutes: values.maxMinutes });
  res.redirect("/manage/breaks?saved=1");
});

router.post("/employees/:id/breaks", (req, res) => {
  const target = loadEmployee(req, res, req.params.id);
  if (!target) return;
  if (!canManageSchedule(req.user, target)) {
    return res.status(403).render("error", { title: "Not allowed", message: "Only an admin can change your own break allowance." });
  }

  const { values, error } = readBreakLimitsForm(req.body);
  if (error) return renderDetailsTab(req, res, target, { breakError: error, breakForm: values, statusCode: 400 });

  db.setBreakLimits(target.id, values);
  res.redirect(`/manage/employees/${target.id}/details?saved=breaks`);
});

export default router;
