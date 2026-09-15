// Punch edit requests (see requests.js for how they flow).
import { db } from "./connection.js";

// Every request query returns the request plus who asked, who reviewed, and the
// punch as it is now (punch_type/punch_timestamp; null if it was deleted).
const SELECT_REQUESTS = `
  SELECT r.*,
         COALESCE(NULLIF(u.display_name, ''), u.username) AS user_name, u.role AS user_role,
         COALESCE(NULLIF(v.display_name, ''), v.username) AS reviewer_name,
         p.type AS punch_type, p.timestamp AS punch_timestamp
  FROM edit_requests r
  JOIN users u ON u.id = r.user_id
  LEFT JOIN users v ON v.id = r.reviewed_by
  LEFT JOIN punches p ON p.id = r.punch_id`;

const stmt = {
  getRequest: db.prepare(`${SELECT_REQUESTS} WHERE r.id = ?`),
  listRequestsForUser: db.prepare(`${SELECT_REQUESTS} WHERE r.user_id = ? ORDER BY r.created_at DESC, r.id DESC LIMIT 200`),
  listPendingRequests: db.prepare(`${SELECT_REQUESTS} WHERE r.status = 'pending' ORDER BY r.created_at, r.id`),
  listPendingRequestsForUser: db.prepare(`${SELECT_REQUESTS} WHERE r.status = 'pending' AND r.user_id = ? ORDER BY r.created_at, r.id`),
  listRecentRequests: db.prepare(`
    ${SELECT_REQUESTS} WHERE r.status != 'pending'
    ORDER BY COALESCE(r.reviewed_at, r.created_at) DESC, r.id DESC LIMIT 50`),
  getPendingRequestForPunch: db.prepare("SELECT id FROM edit_requests WHERE punch_id = ? AND status = 'pending'"),
  insertRequest: db.prepare(`
    INSERT INTO edit_requests (user_id, kind, punch_id, original_type, original_timestamp, type, timestamp, end_timestamp, reason, created_at)
    VALUES (@userId, @kind, @punchId, @originalType, @originalTimestamp, @type, @timestamp, @endTimestamp, @reason, @createdAt)`),
  // Only a pending request can be finished (approved, denied, cancelled).
  finishRequest: db.prepare(`
    UPDATE edit_requests
    SET status = @status, reviewed_by = @reviewedBy, reviewed_at = @reviewedAt, review_note = @reviewNote
    WHERE id = @id AND status = 'pending'`),
};

export const getRequest = (id) => stmt.getRequest.get(id);
export const listRequestsForUser = (userId) => stmt.listRequestsForUser.all(userId);
export const listPendingRequests = () => stmt.listPendingRequests.all();
export const listPendingRequestsForUser = (userId) => stmt.listPendingRequestsForUser.all(userId);
export const listRecentRequests = () => stmt.listRecentRequests.all();
export const getPendingRequestForPunch = (punchId) => stmt.getPendingRequestForPunch.get(punchId);

export function insertRequest({
  userId, kind, punchId = null, originalType = null, originalTimestamp = null,
  type = null, timestamp = null, endTimestamp = null, reason, createdAt,
}) {
  const info = stmt.insertRequest.run({ userId, kind, punchId, originalType, originalTimestamp, type, timestamp, endTimestamp, reason, createdAt });
  return Number(info.lastInsertRowid);
}

// Marks a pending request as finished. Returns false if it wasn't pending anymore.
export function finishRequest(id, { status, reviewedBy = null, reviewedAt, reviewNote = "" }) {
  return stmt.finishRequest.run({ id, status, reviewedBy, reviewedAt, reviewNote }).changes > 0;
}
