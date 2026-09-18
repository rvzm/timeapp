// Punch edit requests: employees ask for a punch to be changed, added, or deleted, or for
// a whole missing shift to be added. What happens next depends on the requestMode setting:
//   disabled - requests can't be made
//   approval - a manager or admin approves (the change is applied then) or denies
//   honor    - the change is applied right away and logged as auto-approved
import * as db from "./db.js";
import * as time from "./time.js";
import { getSettings } from "./settings.js";
import { canManageShifts } from "./permissions.js";
import { loadShifts } from "./shifts.js";

export const REQUEST_KINDS = ["change", "add", "delete", "add_shift"];

export const KIND_LABELS = {
  change: "Change a punch",
  add: "Add a missing punch",
  delete: "Delete a punch",
  add_shift: "Add a missing shift",
};

export const REQUEST_STATUS_LABELS = {
  pending: "Pending",
  approved: "Approved",
  auto_approved: "Auto-approved",
  denied: "Denied",
  cancelled: "Cancelled",
};

const REASON_MAX = 500;
const DAY_MS = 24 * 60 * 60 * 1000;

export const requestsEnabled = () => getSettings().requestMode !== "disabled";

// ===================================================================
// ===== Reading requests =====
// ===================================================================

// Pending requests the user may review (managers: their employees; admins: everyone).
export function pendingRequestsFor(user) {
  return db.listPendingRequests().filter((request) => canManageShifts(user, { id: request.user_id, role: request.user_role }));
}

// { punchId: request } for a user's pending change/delete requests, to badge those punches.
export function pendingByPunch(userId) {
  return Object.fromEntries(
    db.listPendingRequestsForUser(userId).filter((request) => request.punch_id).map((request) => [request.punch_id, request]),
  );
}

// ===================================================================
// ===== Submitting =====
// ===================================================================

// Validates a new request from `user`. Returns { form } (the raw values, for showing the
// form again) plus either { request } or { error }.
export function readRequestForm(user, body) {
  const form = {
    kind: String(body.kind ?? ""),
    punch_id: String(body.punch_id ?? ""),
    type: String(body.type ?? ""),
    when: String(body.when ?? ""),
    end: String(body.end ?? ""),
    reason: String(body.reason ?? "").trim(),
  };
  const fail = (error) => ({ form, error });
  if (!REQUEST_KINDS.includes(form.kind)) return fail("Pick what kind of request this is.");

  const request = { userId: user.id, kind: form.kind, reason: form.reason };
  const now = time.nowIso();

  if (form.kind === "change" || form.kind === "delete") {
    const punch = db.getPunch(Number(form.punch_id) || null);
    if (!punch || punch.user_id !== user.id) return fail("That punch doesn't exist.");
    if (db.getPendingRequestForPunch(punch.id)) return fail("There's already a pending request for this punch.");
    Object.assign(request, { punchId: punch.id, originalType: punch.type, originalTimestamp: punch.timestamp });
  }

  if (form.kind === "change" || form.kind === "add") {
    const timestamp = time.fromDatetimeLocal(form.when);
    if (!db.PUNCH_TYPES.includes(form.type)) return fail("Pick a punch type.");
    if (!timestamp) return fail("Enter a valid date and time.");
    if (timestamp > now) return fail("Requested times can't be in the future.");
    // The form shows times to the minute, so compare at that precision.
    const unchanged = form.type === request.originalType &&
      timestamp === time.fromDatetimeLocal(time.toDatetimeLocal(request.originalTimestamp));
    if (form.kind === "change" && unchanged) return fail("That's the same as the punch already is.");
    Object.assign(request, { type: form.type, timestamp });
  }

  if (form.kind === "add_shift") {
    const start = time.fromDatetimeLocal(form.when);
    const end = time.fromDatetimeLocal(form.end);
    if (!start || !end) return fail("Enter a valid clock-in and clock-out time.");
    if (end <= start) return fail("Clock-out must be after clock-in.");
    if (Date.parse(end) - Date.parse(start) > DAY_MS) return fail("A shift can't be longer than 24 hours.");
    if (end > now) return fail("Requested times can't be in the future.");
    Object.assign(request, { timestamp: start, endTimestamp: end });
  }

  if (!form.reason) return fail("Say why you need this change.");
  if (form.reason.length > REASON_MAX) return fail(`Keep the reason under ${REASON_MAX} characters.`);
  return { form, request };
}

// Saves a validated request. In honor mode it's applied immediately.
// Returns { id, applied }.
export function submitRequest(user, request) {
  return db.db.transaction(() => {
    const id = db.insertRequest({ ...request, createdAt: time.nowIso() });
    if (getSettings().requestMode !== "honor") return { id, applied: false };

    const error = applyRequest(db.getRequest(id), user.id);
    if (error) throw new Error(error); // can't happen right after validation; rolls back if it does
    db.finishRequest(id, { status: "auto_approved", reviewedAt: time.nowIso() });
    return { id, applied: true };
  })();
}

// ===================================================================
// ===== Reviewing =====
// ===================================================================

// What a reviewer may adjust before approving: the punch type and time, or a missing
// shift's two ends. A delete request has nothing to change, so it has no edit form.
export const canEditOnApproval = (request) => request.kind !== "delete";

// Validates the "Approve with edits" fields against the same rules as the original
// request. Returns { edits } or { error }.
export function readReviewEdits(request, body) {
  const now = time.nowIso();

  if (request.kind === "add_shift") {
    const timestamp = time.fromDatetimeLocal(body.edit_when);
    const endTimestamp = time.fromDatetimeLocal(body.edit_end);
    if (!timestamp || !endTimestamp) return { error: "Enter a valid clock-in and clock-out time." };
    if (endTimestamp <= timestamp) return { error: "Clock-out must be after clock-in." };
    if (Date.parse(endTimestamp) - Date.parse(timestamp) > DAY_MS) return { error: "A shift can't be longer than 24 hours." };
    if (endTimestamp > now) return { error: "Times can't be in the future." };
    return { edits: { timestamp, endTimestamp } };
  }

  const type = String(body.edit_type ?? "");
  const timestamp = time.fromDatetimeLocal(body.edit_when);
  if (!db.PUNCH_TYPES.includes(type)) return { error: "Pick a punch type." };
  if (!timestamp) return { error: "Enter a valid date and time." };
  if (timestamp > now) return { error: "Times can't be in the future." };
  return { edits: { type, timestamp } };
}

// The reviewer's edits, or null when they match what was asked for. Only a real
// difference is recorded, so "Approved with edits" always means something changed.
function changedFromRequest(request, edits) {
  if (!edits) return null;
  const same =
    (edits.type ?? request.type) === request.type &&
    (edits.timestamp ?? request.timestamp) === request.timestamp &&
    (edits.endTimestamp ?? request.end_timestamp) === request.end_timestamp;
  return same ? null : { type: edits.type ?? null, timestamp: edits.timestamp ?? null, endTimestamp: edits.endTimestamp ?? null };
}

// True if a finished request was approved with something other than what was asked.
export const wasEditedOnApproval = (request) =>
  Boolean(request.applied_timestamp || request.applied_type || request.applied_end_timestamp);

// Approves (applying the change) or denies a pending request. `edits` adjusts what gets
// applied; the request keeps the employee's original ask either way.
// The caller checks the reviewer is allowed to. Returns an error message, or null.
export function reviewRequest(reviewer, requestId, { approve, note = "", edits = null }) {
  return db.db.transaction(() => {
    const request = db.getRequest(requestId);
    if (!request || request.status !== "pending") return "This request has already been handled.";

    const applied = approve ? changedFromRequest(request, edits) : null;
    if (approve) {
      const error = applyRequest(request, reviewer.id, edits);
      if (error) return error; // nothing has been written yet
    }
    db.finishRequest(request.id, {
      status: approve ? "approved" : "denied",
      reviewedBy: reviewer.id,
      reviewedAt: time.nowIso(),
      reviewNote: note,
      applied,
    });
    return null;
  })();
}

// Makes the punch changes a request asks for. `actorId` is recorded as edited_by, and
// `edits` (from Approve with edits) replaces what the request asked for.
// Returns an error message if it can't be applied, or null.
function applyRequest(request, actorId, edits = null) {
  const note = `Request #${request.id}: ${request.reason}`.slice(0, 500);
  const punch = request.punch_id ? db.getPunch(request.punch_id) : null;
  const type = edits?.type ?? request.type;
  const timestamp = edits?.timestamp ?? request.timestamp;
  const endTimestamp = edits?.endTimestamp ?? request.end_timestamp;

  switch (request.kind) {
    case "change":
      if (!punch) return "The punch in this request no longer exists, so it can't be changed. Deny the request instead.";
      db.updatePunch(punch.id, { type, timestamp, editedBy: actorId, note });
      return null;
    case "delete":
      if (!punch) return "The punch in this request no longer exists. Deny the request instead.";
      db.deletePunches(request.user_id, [punch.id]);
      return null;
    case "add":
      db.insertPunch({ userId: request.user_id, type, timestamp, editedBy: actorId, note });
      return null;
    case "add_shift":
      db.insertPunch({ userId: request.user_id, type: "clock_in", timestamp, editedBy: actorId, note });
      db.insertPunch({ userId: request.user_id, type: "clock_out", timestamp: endTimestamp, editedBy: actorId, note });
      return null;
    default:
      return "Unknown request type.";
  }
}

// ===================================================================
// ===== Grouping for review =====
// Requests are listed under the employee, the week, and the day of the punch they're
// about (not when they were submitted), with the shift that punch falls in where there
// is one. Each request gets `subject` (that punch time) and `shift` (or null).
// ===================================================================

// The punch time a request concerns: the existing punch for change/delete, the
// proposed one for add/add_shift.
const subjectOf = (request) => request.original_timestamp ?? request.timestamp;

// The shift a request's punch belongs to, out of that employee's loaded shifts.
function shiftFor(request, shifts) {
  if (request.punch_id) return shifts.find((shift) => shift.ids.includes(request.punch_id)) ?? null;
  const subject = subjectOf(request);
  return shifts.find((shift) => {
    const start = shift.clockIn?.timestamp;
    const end = shift.clockOut?.timestamp;
    return start && subject >= start && (!end || subject <= end);
  }) ?? null;
}

// Groups requests into [{ userId, userName, weeks: [{ from, to, days: [{ date, requests }] }] }].
// `newestFirst` reverses the order, for lists of already-reviewed requests.
export function groupRequests(requests, { newestFirst = false } = {}) {
  const { weekStart } = getSettings();
  const byUser = new Map();
  for (const request of requests) {
    if (!byUser.has(request.user_id)) byUser.set(request.user_id, []);
    byUser.get(request.user_id).push(request);
  }

  const groups = [];
  for (const [userId, own] of byUser) {
    // One shift lookup per employee, over the whole span their requests touch.
    const dates = own.map((request) => time.localDate(subjectOf(request))).sort();
    const [fromIso, toIso] = time.dayRangeUtc(dates[0], dates.at(-1));
    const shifts = loadShifts(userId, fromIso, toIso);

    const days = new Map();
    for (const request of own) {
      request.subject = subjectOf(request);
      request.shift = shiftFor(request, shifts);
      const date = time.localDate(request.subject);
      if (!days.has(date)) days.set(date, []);
      days.get(date).push(request);
    }

    // Days into weeks, both in date order.
    const weeks = new Map();
    for (const date of [...days.keys()].sort()) {
      const { from, to } = time.weekRange(date, weekStart);
      if (!weeks.has(from)) weeks.set(from, { from, to, days: [] });
      weeks.get(from).days.push({ date, requests: days.get(date).sort((a, b) => a.subject.localeCompare(b.subject)) });
    }

    groups.push({
      userId,
      userName: own[0].user_name,
      count: own.length,
      weeks: [...weeks.values()].sort((a, b) => a.from.localeCompare(b.from)),
    });
  }

  if (newestFirst) {
    for (const group of groups) {
      group.weeks.reverse();
      for (const week of group.weeks) {
        week.days.reverse();
        for (const day of week.days) day.requests.reverse();
      }
    }
  }
  return groups.sort((a, b) => a.userName.localeCompare(b.userName));
}
