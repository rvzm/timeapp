// Mandatory (assigned) shifts. See schedule.js for attendance and conflict checks.
import { db } from "./connection.js";

// Every query returns the assignment plus the employee's name/role and who assigned it.
const SELECT_SCHEDULED = `
  SELECT s.*,
         COALESCE(NULLIF(u.display_name, ''), u.username) AS user_name, u.role AS user_role,
         COALESCE(NULLIF(a.display_name, ''), a.username) AS assigned_by_name
  FROM scheduled_shifts s
  JOIN users u ON u.id = s.user_id
  JOIN users a ON a.id = s.assigned_by`;

const stmt = {
  getScheduledShift: db.prepare(`${SELECT_SCHEDULED} WHERE s.id = ?`),
  // Assignments overlapping a time range.
  listScheduledForUser: db.prepare(`${SELECT_SCHEDULED} WHERE s.user_id = ? AND s.start_at < ? AND s.end_at > ? ORDER BY s.start_at`),
  listScheduledBetween: db.prepare(`${SELECT_SCHEDULED} WHERE s.start_at < ? AND s.end_at > ? ORDER BY s.start_at`),
  insertScheduledShift: db.prepare(`
    INSERT INTO scheduled_shifts (user_id, start_at, end_at, note, assigned_by, created_at)
    VALUES (@userId, @startAt, @endAt, @note, @assignedBy, @createdAt)`),
  updateScheduledShift: db.prepare("UPDATE scheduled_shifts SET start_at = @startAt, end_at = @endAt, note = @note WHERE id = @id"),
  deleteScheduledShift: db.prepare("DELETE FROM scheduled_shifts WHERE id = ?"),
};

export const getScheduledShift = (id) => stmt.getScheduledShift.get(id);
// Assignments that overlap [fromIso, toIso).
export const listScheduledForUser = (userId, fromIso, toIso) => stmt.listScheduledForUser.all(userId, toIso, fromIso);
export const listScheduledBetween = (fromIso, toIso) => stmt.listScheduledBetween.all(toIso, fromIso);
export const deleteScheduledShift = (id) => stmt.deleteScheduledShift.run(id);
// Changing an assigned shift keeps who assigned it; only the times and note move.
export const updateScheduledShift = (id, { startAt, endAt, note = "" }) =>
  stmt.updateScheduledShift.run({ id, startAt, endAt, note });

export function insertScheduledShift({ userId, startAt, endAt, note = "", assignedBy, createdAt }) {
  return Number(stmt.insertScheduledShift.run({ userId, startAt, endAt, note, assignedBy, createdAt }).lastInsertRowid);
}
