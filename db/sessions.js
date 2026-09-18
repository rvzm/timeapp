// Login sessions (see auth.js for how they're used).
import { db } from "./connection.js";

const stmt = {
  insertSession: db.prepare(`
    INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at, ip, user_agent)
    VALUES (@id, @userId, @createdAt, @expiresAt, @createdAt, @ip, @userAgent)`),
  // Only returns a user if the session hasn't expired and the account is still active.
  getSessionUser: db.prepare(`
    SELECT u.id, u.username, u.display_name, u.role, u.email, u.phone, u.job_title, u.employee_number,
           u.break_max_count, u.break_max_minutes, u.theme_color, u.theme_mode, u.theme_background, u.theme_style,
           s.id AS session_id, s.last_seen_at
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.id = ? AND s.expires_at > ? AND u.active = 1`),
  touchSession: db.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?"),
  deleteSession: db.prepare("DELETE FROM sessions WHERE id = ?"),
  deleteUserSessions: db.prepare("DELETE FROM sessions WHERE user_id = ?"),
  deleteOtherSessions: db.prepare("DELETE FROM sessions WHERE user_id = ? AND id != ?"),
  deleteAllSessions: db.prepare("DELETE FROM sessions"),
  deleteAllSessionsExcept: db.prepare("DELETE FROM sessions WHERE id != ?"),
  purgeExpiredSessions: db.prepare("DELETE FROM sessions WHERE expires_at <= ?"),
  // Every live session with the person it belongs to. Most recently active first.
  listActiveSessions: db.prepare(`
    SELECT s.id, s.user_id, s.created_at, s.expires_at, s.last_seen_at, s.ip, s.user_agent,
           u.username, u.display_name, u.role
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.expires_at > ?
    ORDER BY COALESCE(s.last_seen_at, s.created_at) DESC`),
};

export const insertSession = ({ id, userId, createdAt, expiresAt, ip = "", userAgent = "" }) =>
  stmt.insertSession.run({ id, userId, createdAt, expiresAt, ip, userAgent });
export const getSessionUser = (sessionId, nowIso) => stmt.getSessionUser.get(sessionId, nowIso);
export const touchSession = (id, nowIso) => stmt.touchSession.run(nowIso, id);
export const deleteSession = (id) => stmt.deleteSession.run(id);
export const deleteUserSessions = (userId) => stmt.deleteUserSessions.run(userId);
// Logs a user out everywhere except the session they're using now.
export const deleteOtherSessions = (userId, keepSessionId) => stmt.deleteOtherSessions.run(userId, keepSessionId);
// Logs everyone out. `keepSessionId` spares the admin doing it, so they stay on the page.
export const deleteAllSessions = (keepSessionId = null) =>
  keepSessionId ? stmt.deleteAllSessionsExcept.run(keepSessionId) : stmt.deleteAllSessions.run();
export const purgeExpiredSessions = (nowIso) => stmt.purgeExpiredSessions.run(nowIso);
export const listActiveSessions = (nowIso) => stmt.listActiveSessions.all(nowIso);
