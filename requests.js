// Punch edit requests: employees ask for a punch to be changed, added, or deleted, or for
// a whole missing shift to be added. What happens next depends on the requestMode setting:
//   disabled - requests can't be made
//   approval - a manager or admin approves (the change is applied then) or denies
//   honor    - the change is applied right away and logged as auto-approved
import * as db from "./db.js";
import * as time from "./time.js";
import { getSettings } from "./settings.js";
import { canManageShifts } from "./permissions.js";

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

// Approves (applying the change) or denies a pending request.
// The caller checks the reviewer is allowed to. Returns an error message, or null.
export function reviewRequest(reviewer, requestId, { approve, note = "" }) {
  return db.db.transaction(() => {
    const request = db.getRequest(requestId);
    if (!request || request.status !== "pending") return "This request has already been handled.";

    if (approve) {
      const error = applyRequest(request, reviewer.id);
      if (error) return error; // nothing has been written yet
    }
    db.finishRequest(request.id, {
      status: approve ? "approved" : "denied",
      reviewedBy: reviewer.id,
      reviewedAt: time.nowIso(),
      reviewNote: note,
    });
    return null;
  })();
}

// Makes the punch changes a request asks for. `actorId` is recorded as edited_by.
// Returns an error message if it can't be applied, or null.
function applyRequest(request, actorId) {
  const note = `Request #${request.id}: ${request.reason}`.slice(0, 500);
  const punch = request.punch_id ? db.getPunch(request.punch_id) : null;

  switch (request.kind) {
    case "change":
      if (!punch) return "The punch in this request no longer exists, so it can't be changed. Deny the request instead.";
      db.updatePunch(punch.id, { type: request.type, timestamp: request.timestamp, editedBy: actorId, note });
      return null;
    case "delete":
      if (!punch) return "The punch in this request no longer exists. Deny the request instead.";
      db.deletePunches(request.user_id, [punch.id]);
      return null;
    case "add":
      db.insertPunch({ userId: request.user_id, type: request.type, timestamp: request.timestamp, editedBy: actorId, note });
      return null;
    case "add_shift":
      db.insertPunch({ userId: request.user_id, type: "clock_in", timestamp: request.timestamp, editedBy: actorId, note });
      db.insertPunch({ userId: request.user_id, type: "clock_out", timestamp: request.end_timestamp, editedBy: actorId, note });
      return null;
    default:
      return "Unknown request type.";
  }
}
