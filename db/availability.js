// Weekly availability rows (see availability.js for the rules).
import { db } from "./connection.js";

const stmt = {
  listAvailability: db.prepare(`
    SELECT weekday, start_time, end_time FROM availability
    WHERE user_id = ? ORDER BY weekday, start_time`),
  deleteAvailability: db.prepare("DELETE FROM availability WHERE user_id = ?"),
  insertAvailability: db.prepare("INSERT INTO availability (user_id, weekday, start_time, end_time) VALUES (?, ?, ?, ?)"),
};

export const listAvailability = (userId) => stmt.listAvailability.all(userId);

// Replaces a user's whole week. windows: [{ weekday, start, end }]
export const replaceAvailability = db.transaction((userId, windows) => {
  stmt.deleteAvailability.run(userId);
  for (const w of windows) stmt.insertAvailability.run(userId, w.weekday, w.start, w.end);
});
