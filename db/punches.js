// Punches, and the status rules derived from them.
import { db } from "./connection.js";

// ===================================================================
// ===== Status =====
// Status is never stored. It comes from the user's most recent punch.
// ===================================================================

export const PUNCH_TYPES = ["clock_in", "break_start", "break_end", "clock_out"];

export const PUNCH_LABELS = {
  clock_in: "Clock In",
  break_start: "Start Break",
  break_end: "End Break",
  clock_out: "Clock Out",
};

export const STATUS_LABELS = {
  out: "Clocked Out",
  in: "Clocked In",
  break: "On Break",
};

// Which punches each status allows next. The first entry is the Clock page's big button.
const NEXT_ACTIONS = {
  out: ["clock_in"],
  in: ["break_start", "clock_out"],
  break: ["break_end"],
};

// The status a punch leaves the user in. No punch at all means "out".
export function statusFromPunch(punch) {
  switch (punch?.type) {
    case "clock_in":
    case "break_end":
      return "in";
    case "break_start":
      return "break";
    default:
      return "out";
  }
}

export function allowedActions(status) {
  return NEXT_ACTIONS[status];
}

// ===================================================================
// ===== Queries =====
// ===================================================================

const stmt = {
  getPunch: db.prepare(`
    SELECT p.*, COALESCE(NULLIF(e.display_name, ''), e.username) AS editor_name
    FROM punches p LEFT JOIN users e ON e.id = p.edited_by
    WHERE p.id = ?`),
  getLastPunch: db.prepare(`
    SELECT * FROM punches WHERE user_id = ?
    ORDER BY timestamp DESC, id DESC LIMIT 1`),
  // The nearest clock-in/clock-out on either side of a time. shifts.js uses these
  // to widen a date range so shifts crossing its edges load whole.
  getShiftEdgeBefore: db.prepare(`
    SELECT * FROM punches WHERE user_id = ? AND timestamp < ? AND type IN ('clock_in', 'clock_out')
    ORDER BY timestamp DESC, id DESC LIMIT 1`),
  getShiftEdgeFrom: db.prepare(`
    SELECT * FROM punches WHERE user_id = ? AND timestamp >= ? AND type IN ('clock_in', 'clock_out')
    ORDER BY timestamp, id LIMIT 1`),
  // Inclusive on both ends.
  listPunchesBetween: db.prepare(`
    SELECT p.*, COALESCE(NULLIF(e.display_name, ''), e.username) AS editor_name
    FROM punches p LEFT JOIN users e ON e.id = p.edited_by
    WHERE p.user_id = ? AND p.timestamp >= ? AND p.timestamp <= ?
    ORDER BY p.timestamp, p.id`),
  insertPunch: db.prepare(`
    INSERT INTO punches (user_id, type, timestamp, edited_by, note)
    VALUES (@userId, @type, @timestamp, @editedBy, @note)`),
  updatePunch: db.prepare(`
    UPDATE punches SET type = @type, timestamp = @timestamp, edited_by = @editedBy, note = @note
    WHERE id = @id`),
  deleteUserPunch: db.prepare("DELETE FROM punches WHERE id = ? AND user_id = ?"),
};

export const getPunch = (id) => stmt.getPunch.get(id);
export const getLastPunch = (userId) => stmt.getLastPunch.get(userId);
export const getShiftEdgeBefore = (userId, iso) => stmt.getShiftEdgeBefore.get(userId, iso);
export const getShiftEdgeFrom = (userId, iso) => stmt.getShiftEdgeFrom.get(userId, iso);
export const listPunchesBetween = (userId, fromIso, toIso) => stmt.listPunchesBetween.all(userId, fromIso, toIso);

export function insertPunch({ userId, type, timestamp, editedBy = null, note = "" }) {
  return Number(stmt.insertPunch.run({ userId, type, timestamp, editedBy, note }).lastInsertRowid);
}

export function updatePunch(id, { type, timestamp, editedBy, note = "" }) {
  return stmt.updatePunch.run({ id, type, timestamp, editedBy, note });
}

// Deletes several of one user's punches in a single transaction. Ids that don't
// exist or belong to a different user are skipped. Returns how many were deleted.
export const deletePunches = db.transaction((userId, ids) => {
  let deleted = 0;
  for (const id of ids) deleted += stmt.deleteUserPunch.run(id, userId).changes;
  return deleted;
});
