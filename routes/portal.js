// Employee Portal: a home summary, your own shifts (with notes), mandatory shifts, and
// punch edit requests.
// Mounted at /portal; any logged-in user. Profile and settings are in routes/account.js.
import express from "express";
import * as db from "../db.js";
import * as time from "../time.js";
import { requireLogin } from "../auth.js";
import { loadShifts } from "../shifts.js";
import { getSettings } from "../settings.js";
import {
  KIND_LABELS, REQUEST_KINDS, readRequestForm, submitRequest, modifyRequest, requestsEnabled, pendingByPunch, groupRequests,
} from "../requests.js";
import { withAttendance, groupByWeek } from "../schedule.js";
import { buildTimesheet, readExportQuery, exportFilename, homeSummary } from "../timesheet.js";
import { readRange, toId, notFound } from "./helpers.js";

const router = express.Router();
router.use(requireLogin);

// ===================================================================
// ===== Home =====
// ===================================================================

router.get("/", (req, res) => {
  // My shifts used to live here; old links (and saved note "back" URLs) carry ?from/?to.
  if (req.query.from !== undefined || req.query.to !== undefined) {
    const query = new URLSearchParams({ from: String(req.query.from ?? ""), to: String(req.query.to ?? "") });
    return res.redirect(`/portal/shifts?${query}`);
  }
  res.render("portal/home", { title: "My Portal", ...homeSummary(req.user.id) });
});

// ===================================================================
// ===== My shifts =====
// ===================================================================

router.get("/shifts", (req, res) => {
  const { weekStart } = getSettings();
  const thisWeek = time.weekRange(time.localDate(), weekStart);
  const range = time.isValidDate(req.query.from) ? readRange(req.query) : thisWeek;
  const [fromIso, toIso] = time.dayRangeUtc(range.from, range.to);
  const shifts = loadShifts(req.user.id, fromIso, toIso);

  // Totals count shifts that start in the range (an overnight shift belongs to the day it starts).
  const counted = shifts.filter((shift) => shift.date >= range.from && shift.date <= range.to);

  res.render("portal/shifts", {
    title: "My shifts",
    shifts,
    range,
    lastWeek: time.weekRange(time.addDays(thisWeek.from, -1), weekStart),
    totalMs: counted.reduce((sum, shift) => sum + (shift.workedMs ?? 0), 0),
    incomplete: counted.filter((shift) => shift.workedMs === null).length,
    requestsOn: requestsEnabled(),
    pendingByPunch: pendingByPunch(req.user.id),
  });
});

// Timesheet export (PDF via the print dialog, or a PNG image).
router.get("/export", (req, res) => {
  const employee = db.getUserById(req.user.id);
  const sheet = buildTimesheet(employee.id, readExportQuery(req.query));

  res.render("export", {
    title: "Timesheet",
    employee,
    sheet,
    exportUrl: "/portal/export",
    backUrl: "/portal/shifts",
    filename: exportFilename(employee, sheet),
  });
});

// ===================================================================
// ===== My schedule =====
// ===================================================================

router.get("/schedule", (req, res) => {
  const now = time.nowIso();
  const today = time.localDate();
  const [from] = time.dayRangeUtc(time.addDays(today, -30));
  const [, to] = time.dayRangeUtc(time.addDays(today, 60));
  const assignments = withAttendance(req.user.id, db.listScheduledForUser(req.user.id, from, to));
  const upcoming = assignments.filter((a) => a.end_at > now); // includes one that's under way
  const past = assignments.filter((a) => a.end_at <= now).reverse();

  res.render("portal/schedule", {
    title: "My schedule",
    upcoming: groupByWeek(upcoming),
    past: groupByWeek(past),
  });
});

// ===================================================================
// ===== Edit requests =====
// ===================================================================

function requestsOff(res) {
  return res.status(403).render("error", {
    title: "Edit requests are off",
    message: "Punch edit requests are turned off. Talk to a manager about changes.",
  });
}

// One of the user's own punches, or null.
function ownPunch(user, id) {
  const punch = db.getPunch(toId(id));
  return punch?.user_id === user.id ? punch : null;
}

// The new-request form, or (with `editing`, one of the user's pending requests) the
// Modify form for it.
function renderRequestForm(req, res, { form, editing = null, error = null, statusCode = 200 }) {
  res.status(statusCode).render("portal/request-new", {
    title: editing ? "Modify request" : KIND_LABELS[form.kind],
    form,
    editing,
    punch: form.punch_id ? ownPunch(req.user, form.punch_id) : null,
    error,
  });
}

// One of the user's own requests that's still pending, or null.
function ownPendingRequest(user, id) {
  const request = db.getRequest(toId(id));
  return request?.user_id === user.id && request.status === "pending" ? request : null;
}

// Same layout as Manage → Requests: pending ones (with Modify / Cancel), then the rest,
// grouped by week and day of the punch they concern.
router.get("/requests", (req, res) => {
  const requests = db.listRequestsForUser(req.user.id);
  const pending = requests.filter((request) => request.status === "pending");
  const past = requests.filter((request) => request.status !== "pending");
  res.render("portal/requests", {
    title: "My requests",
    pending,
    pendingGroups: groupRequests(pending),
    past,
    pastGroups: groupRequests(past, { newestFirst: true }),
    requestsOn: requestsEnabled(),
    submitted: req.query.submitted,
  });
});

// ?kind=change|add|delete|add_shift, plus &punch=<id> for change and delete.
router.get("/requests/new", (req, res) => {
  if (!requestsEnabled()) return requestsOff(res);
  const kind = String(req.query.kind ?? "");
  if (!REQUEST_KINDS.includes(kind)) return notFound(res, "request type");

  const needsPunch = kind === "change" || kind === "delete";
  const punch = needsPunch ? ownPunch(req.user, req.query.punch) : null;
  if (needsPunch && !punch) return notFound(res, "punch");

  renderRequestForm(req, res, {
    form: {
      kind,
      punch_id: punch?.id ?? "",
      type: punch?.type ?? "clock_in",
      when: punch ? time.toDatetimeLocal(punch.timestamp) : "",
      end: "",
      reason: "",
    },
  });
});

router.post("/requests", (req, res) => {
  if (!requestsEnabled()) return requestsOff(res);

  const { form, request, error } = readRequestForm(req.user, req.body);
  if (error) {
    if (!REQUEST_KINDS.includes(form.kind)) return notFound(res, "request type");
    return renderRequestForm(req, res, { form, error, statusCode: 400 });
  }

  const { applied } = submitRequest(req.user, request);
  res.redirect(`/portal/requests?submitted=${applied ? "applied" : "pending"}`);
});

router.get("/requests/:id/edit", (req, res) => {
  if (!requestsEnabled()) return requestsOff(res);
  const request = ownPendingRequest(req.user, req.params.id);
  if (!request) return notFound(res, "pending request");

  renderRequestForm(req, res, {
    editing: request,
    form: {
      kind: request.kind,
      punch_id: request.punch_id ?? "",
      type: request.type ?? request.original_type ?? "clock_in",
      when: request.timestamp ? time.toDatetimeLocal(request.timestamp) : "",
      end: request.end_timestamp ? time.toDatetimeLocal(request.end_timestamp) : "",
      reason: request.reason,
    },
  });
});

router.post("/requests/:id", (req, res) => {
  if (!requestsEnabled()) return requestsOff(res);
  const editing = ownPendingRequest(req.user, req.params.id);
  if (!editing) return notFound(res, "pending request");

  const { form, request, error } = readRequestForm(req.user, req.body, { editing });
  if (error) return renderRequestForm(req, res, { form, editing, error, statusCode: 400 });

  if (!modifyRequest(editing.id, request)) {
    return res.status(409).render("error", { title: "Can't modify", message: "This request has already been handled." });
  }
  res.redirect("/portal/requests?submitted=modified");
});

router.post("/requests/:id/cancel", (req, res) => {
  const request = db.getRequest(toId(req.params.id));
  if (!request || request.user_id !== req.user.id) return notFound(res, "request");

  if (!db.finishRequest(request.id, { status: "cancelled", reviewedAt: time.nowIso() })) {
    return res.status(409).render("error", { title: "Can't cancel", message: "This request has already been handled." });
  }
  res.redirect("/portal/requests?submitted=cancelled");
});

export default router;
