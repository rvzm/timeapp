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
  // ----- Failed logins and lockouts -----
  addFailedLogin: db.prepare("UPDATE users SET failed_logins = failed_logins + 1, last_failed_at = ? WHERE id = ?"),
  setLockedUntil: db.prepare("UPDATE users SET locked_until = ? WHERE id = ?"),
  clearFailedLogins: db.prepare("UPDATE users SET failed_logins = 0, last_failed_at = NULL, locked_until = NULL WHERE id = ?"),
  // Accounts an admin needs to see: currently locked, or with failures since their last success.
  listLockedUsers: db.prepare(`
    SELECT id, username, display_name, role, active, failed_logins, last_failed_at, locked_until
    FROM users
    WHERE failed_logins > 0 OR locked_until IS NOT NULL
    ORDER BY locked_until IS NULL, last_failed_at DESC`),
  // Every user plus their latest punch (if any) and their teams' names. Active users first, then by name.
  listUsersWithLastPunch: db.prepare(`
    SELECT u.id, u.username, u.display_name, u.role, u.active, u.created_at,
           u.email, u.phone, u.job_title, u.employee_number, u.break_max_count, u.break_max_minutes,
           p.type AS last_type, p.timestamp AS last_timestamp,
           (SELECT GROUP_CONCAT(t.name, ', ') FROM team_members m JOIN teams t ON t.id = m.team_id
            WHERE m.user_id = u.id) AS team_names
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

// Counts one wrong password. `lockUntil` is an ISO time, or null to leave the account unlocked.
export const addFailedLogin = (id, nowIso) => stmt.addFailedLogin.run(nowIso, id);
export const setLockedUntil = (id, lockUntil) => stmt.setLockedUntil.run(lockUntil, id);
// Wipes the failure count and any lock: on a good password, or when an admin unlocks.
export const clearFailedLogins = (id) => stmt.clearFailedLogins.run(id);
export const listLockedUsers = () => stmt.listLockedUsers.all();

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
