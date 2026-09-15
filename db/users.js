// Users: accounts, roles, and profile fields.
import { db } from "./connection.js";

export const ROLES = ["employee", "manager", "admin"];

export const ROLE_LABELS = {
  employee: "Employee",
  manager: "Manager",
  admin: "Admin",
};

export function displayName(user) {
  return user.display_name || user.username;
}

const stmt = {
  getUserById: db.prepare("SELECT * FROM users WHERE id = ?"),
  getUserByUsername: db.prepare("SELECT * FROM users WHERE username = ?"),
  getUserByEmployeeNumber: db.prepare("SELECT * FROM users WHERE employee_number = ? AND employee_number != ''"),
  insertUser: db.prepare(`
    INSERT INTO users (username, display_name, password_hash, role, email, phone, job_title, employee_number, created_at)
    VALUES (@username, @display_name, @passwordHash, @role, @email, @phone, @job_title, @employee_number, @createdAt)`),
  updateAccount: db.prepare(`
    UPDATE users
    SET username = @username, display_name = @display_name, role = @role,
        email = @email, phone = @phone, job_title = @job_title, employee_number = @employee_number
    WHERE id = @id`),
  updateProfile: db.prepare("UPDATE users SET display_name = @display_name, email = @email, phone = @phone WHERE id = @id"),
  setPasswordHash: db.prepare("UPDATE users SET password_hash = ? WHERE id = ?"),
  setUserActive: db.prepare("UPDATE users SET active = ? WHERE id = ?"),
  setUserRole: db.prepare("UPDATE users SET role = ? WHERE id = ?"),
  setUserTheme: db.prepare("UPDATE users SET theme_color = ?, theme_mode = ?, theme_background = ?, theme_style = ? WHERE id = ?"),
  setBreakLimits: db.prepare("UPDATE users SET break_max_count = ?, break_max_minutes = ? WHERE id = ?"),
  // Every user plus their latest punch (if any). Active users first, then by name.
  listUsersWithLastPunch: db.prepare(`
    SELECT u.id, u.username, u.display_name, u.role, u.active, u.created_at,
           u.email, u.phone, u.job_title, u.employee_number, u.break_max_count, u.break_max_minutes,
           p.type AS last_type, p.timestamp AS last_timestamp
    FROM users u
    LEFT JOIN punches p ON p.id = (
      SELECT id FROM punches WHERE user_id = u.id ORDER BY timestamp DESC, id DESC LIMIT 1
    )
    ORDER BY u.active DESC, COALESCE(NULLIF(u.display_name, ''), u.username) COLLATE NOCASE`),
};

export const getUserById = (id) => stmt.getUserById.get(id);
export const getUserByUsername = (username) => stmt.getUserByUsername.get(username);
export const getUserByEmployeeNumber = (number) => stmt.getUserByEmployeeNumber.get(number);
export const listUsersWithLastPunch = () => stmt.listUsersWithLastPunch.all();
export const setUserActive = (id, active) => stmt.setUserActive.run(active ? 1 : 0, id);
export const setUserRole = (id, role) => stmt.setUserRole.run(role, id);
// A person's own theme; null = use the app default for that part.
export const setUserTheme = (id, { color, mode, background = null, style = null }) =>
  stmt.setUserTheme.run(color, mode, background, style, id);
export const setPasswordHash = (id, passwordHash) => stmt.setPasswordHash.run(passwordHash, id);

// A user's own break allowance. null = use the default break rules.
export const setBreakLimits = (id, { maxCount, maxMinutes }) => stmt.setBreakLimits.run(maxCount, maxMinutes, id);

export function insertUser({
  username, display_name = "", email = "", phone = "", job_title = "", employee_number = "",
  role, passwordHash, createdAt,
}) {
  const info = stmt.insertUser.run({ username, display_name, email, phone, job_title, employee_number, role, passwordHash, createdAt });
  return Number(info.lastInsertRowid);
}

// The fields employees can change themselves.
export function updateProfile(id, { display_name, email, phone }) {
  return stmt.updateProfile.run({ id, display_name, email, phone });
}

export function updateAccount(id, { username, display_name, email, phone, job_title, employee_number, role }) {
  return stmt.updateAccount.run({ id, username, display_name, email, phone, job_title, employee_number, role });
}
