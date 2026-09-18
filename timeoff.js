// Requests off: an employee asks to be let off one of their assigned (mandatory) shifts.
// They follow the requestMode setting like punch edit requests do:
//   disabled - requests off can't be made
//   approval - a manager who can manage the employee's schedule approves or denies
//   honor    - it's approved right away and logged as auto-approved
// An approved request doesn't remove the shift: it stays on the schedule marked OFF, and
// is no longer counted in scheduled hours or checked for attendance (see `off` in
// db/schedule.js). Cancelling or a denial leaves the shift as it was.
import * as db from "./db.js";
import * as time from "./time.js";
import { getSettings } from "./settings.js";
import { canManageSchedule } from "./permissions.js";

const REASON_MAX = 500;
const NOTE_MAX = 500;

export const TIME_OFF_STATUS_LABELS = {
  pending: "Pending",
  approved: "Approved OFF",
  auto_approved: "Approved OFF",
  denied: "Denied",
  cancelled: "Cancelled",
};

// Why `user` can't ask for this assigned shift off, or null if they can: it must be
// theirs, not started yet, and without a pending or approved request already.
export function timeOffProblem(user, assignment) {
  if (!assignment || assignment.user_id !== user.id) return "That shift isn't on your schedule.";
  if (assignment.start_at <= time.nowIso()) return "That shift has already started, so it can't be requested off.";
  if (db.getOpenTimeOffForShift(assignment.id)) return "You've already asked for this shift off.";
  return null;
}

// Validates a request off from `user` for the assigned shift `shiftId`.
// Returns { form, assignment } plus either { request } or { error }; `assignment` is null
// if it isn't one of the user's shifts.
export function readTimeOffForm(user, shiftId, body) {
  const form = { reason: String(body.reason ?? "").trim() };
  const assignment = db.getScheduledShift(shiftId);
  const fail = (error) => ({ form, assignment: assignment?.user_id === user.id ? assignment : null, error });

  const problem = timeOffProblem(user, assignment);
  if (problem) return fail(problem);
  if (!form.reason) return fail("Say why you need this shift off.");
  if (form.reason.length > REASON_MAX) return fail(`Keep the reason under ${REASON_MAX} characters.`);
  return { form, assignment, request: { shiftId: assignment.id, userId: user.id, reason: form.reason } };
}

// Saves a validated request off. In honor mode it's approved immediately. Returns { id, approved }.
export function submitTimeOff(request) {
  const now = time.nowIso();
  const honor = getSettings().requestMode === "honor";
  const id = db.insertTimeOff({
    ...request,
    status: honor ? "auto_approved" : "pending",
    reviewedAt: honor ? now : null,
    createdAt: now,
  });
  return { id, approved: honor };
}

// ===================================================================
// ===== Reviewing =====
// ===================================================================

// Whether `user` may approve or deny this request off: the same people who may change
// the employee's schedule (managers never their own).
export const canReviewTimeOff = (user, request) =>
  canManageSchedule(user, { id: request.user_id, role: request.user_role });

// Pending requests off the user may review.
export function pendingTimeOffFor(user) {
  return db.listPendingTimeOff().filter((request) => canReviewTimeOff(user, request));
}

// Approves or denies a pending request off. The caller checks the reviewer is allowed to.
// Returns an error message, or null.
export function reviewTimeOff(reviewer, requestId, { approve, note = "" }) {
  const done = db.finishTimeOff(requestId, {
    status: approve ? "approved" : "denied",
    reviewedBy: reviewer.id,
    reviewedAt: time.nowIso(),
    reviewNote: String(note).trim().slice(0, NOTE_MAX),
  });
  return done ? null : "This request has already been handled.";
}
