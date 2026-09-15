// Shift notes: a thread of comments on a shift. Each note is attached to one of the
// shift's punches (normally its clock-in), so shifts.js can find it again.
import { db } from "./connection.js";

const stmt = {
  // Notes on a user's punches with timestamps in [fromIso, toIso], oldest first.
  listNotesForUserBetween: db.prepare(`
    SELECT n.id, n.punch_id, n.author_id, n.body, n.created_at,
           COALESCE(NULLIF(a.display_name, ''), a.username) AS author_name
    FROM shift_notes n
    JOIN punches p ON p.id = n.punch_id
    JOIN users a ON a.id = n.author_id
    WHERE p.user_id = ? AND p.timestamp >= ? AND p.timestamp <= ?
    ORDER BY n.created_at, n.id`),
  getNote: db.prepare("SELECT * FROM shift_notes WHERE id = ?"),
  insertNote: db.prepare(`
    INSERT INTO shift_notes (punch_id, author_id, body, created_at)
    VALUES (@punchId, @authorId, @body, @createdAt)`),
  deleteNote: db.prepare("DELETE FROM shift_notes WHERE id = ?"),
};

export const listNotesForUserBetween = (userId, fromIso, toIso) => stmt.listNotesForUserBetween.all(userId, fromIso, toIso);
export const getNote = (id) => stmt.getNote.get(id);
export const deleteNote = (id) => stmt.deleteNote.run(id);

export function insertNote({ punchId, authorId, body, createdAt }) {
  return Number(stmt.insertNote.run({ punchId, authorId, body, createdAt }).lastInsertRowid);
}
