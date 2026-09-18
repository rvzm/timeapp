// Requests off an assigned (mandatory) shift (see timeoff.js for the rules).
import { db } from "./connection.js";

// Every query returns the request plus who asked, who reviewed, and the shift it's about.
const SELECT_TIME_OFF = `
  SELECT t.*,
         COALESCE(NULLIF(u.display_name, ''), u.username) AS user_name, u.role AS user_role,
         COALESCE(NULLIF(v.display_name, ''), v.username) AS reviewer_name,
         s.start_at, s.end_at, s.note AS shift_note
  FROM time_off_requests t
  JOIN users u ON u.id = t.user_id
  JOIN scheduled_shifts s ON s.id = t.shift_id
  LEFT JOIN users v ON v.id = t.reviewed_by`;

const stmt = {
  getTimeOff: db.prepare(`${SELECT_TIME_OFF} WHERE t.id = ?`),
  listPendingTimeOff: db.prepare(`${SELECT_TIME_OFF} WHERE t.status = 'pending' ORDER BY s.start_at, t.id`),
  listRecentTimeOff: db.prepare(`
    ${SELECT_TIME_OFF} WHERE t.status NOT IN ('pending', 'cancelled')
    ORDER BY COALESCE(t.reviewed_at, t.created_at) DESC, t.id DESC LIMIT 50`),
  // Pending or approved: the shift already has a live request, so another can't be made.
  getOpenTimeOffForShift: db.prepare(`
    SELECT id FROM time_off_requests WHERE shift_id = ? AND status IN ('pending', 'approved', 'auto_approved')`),
  insertTimeOff: db.prepare(`
    INSERT INTO time_off_requests (shift_id, user_id, reason, status, reviewed_at, created_at)
    VALUES (@shiftId, @userId, @reason, @status, @reviewedAt, @createdAt)`),
  // Only a pending request can be finished (approved, denied, cancelled).
  finishTimeOff: db.prepare(`
    UPDATE time_off_requests
    SET status = @status, reviewed_by = @reviewedBy, reviewed_at = @reviewedAt, review_note = @reviewNote
    WHERE id = @id AND status = 'pending'`),
};

export const getTimeOff = (id) => stmt.getTimeOff.get(id);
export const listPendingTimeOff = () => stmt.listPendingTimeOff.all();
export const listRecentTimeOff = () => stmt.listRecentTimeOff.all();
export const getOpenTimeOffForShift = (shiftId) => stmt.getOpenTimeOffForShift.get(shiftId);

// `status` is "pending", or "auto_approved" in honor mode (then `reviewedAt` is set too).
export function insertTimeOff({ shiftId, userId, reason, status = "pending", reviewedAt = null, createdAt }) {
  return Number(stmt.insertTimeOff.run({ shiftId, userId, reason, status, reviewedAt, createdAt }).lastInsertRowid);
}

// Returns false if the request wasn't pending anymore.
export function finishTimeOff(id, { status, reviewedBy = null, reviewedAt, reviewNote = "" }) {
  return stmt.finishTimeOff.run({ id, status, reviewedBy, reviewedAt, reviewNote }).changes > 0;
}
