// Teams: named groups of managers and employees. A manager on a team only manages
// that team's employees (see permissions.js).
import { db } from "./connection.js";

const stmt = {
  listTeams: db.prepare(`
    SELECT t.*,
           (SELECT COUNT(*) FROM team_members m JOIN users u ON u.id = m.user_id
            WHERE m.team_id = t.id AND u.role = 'manager') AS manager_count,
           (SELECT COUNT(*) FROM team_members m JOIN users u ON u.id = m.user_id
            WHERE m.team_id = t.id AND u.role = 'employee') AS employee_count
    FROM teams t
    ORDER BY t.name COLLATE NOCASE`),
  getTeam: db.prepare("SELECT * FROM teams WHERE id = ?"),
  getTeamByName: db.prepare("SELECT * FROM teams WHERE name = ?"),
  insertTeam: db.prepare("INSERT INTO teams (name, created_at) VALUES (?, ?)"),
  renameTeam: db.prepare("UPDATE teams SET name = ? WHERE id = ?"),
  deleteTeam: db.prepare("DELETE FROM teams WHERE id = ?"),
  // Managers first, then by name.
  listTeamMembers: db.prepare(`
    SELECT u.id, u.username, u.display_name, u.role, u.active, u.job_title
    FROM team_members m JOIN users u ON u.id = m.user_id
    WHERE m.team_id = ?
    ORDER BY u.role = 'employee', COALESCE(NULLIF(u.display_name, ''), u.username) COLLATE NOCASE`),
  listTeamsForUser: db.prepare(`
    SELECT t.* FROM team_members m JOIN teams t ON t.id = m.team_id
    WHERE m.user_id = ?
    ORDER BY t.name COLLATE NOCASE`),
  addTeamMember: db.prepare("INSERT OR IGNORE INTO team_members (team_id, user_id) VALUES (?, ?)"),
  removeTeamMember: db.prepare("DELETE FROM team_members WHERE team_id = ? AND user_id = ?"),
  removeUserFromAllTeams: db.prepare("DELETE FROM team_members WHERE user_id = ?"),
};

export const listTeams = () => stmt.listTeams.all();
export const getTeam = (id) => stmt.getTeam.get(id);
export const getTeamByName = (name) => stmt.getTeamByName.get(name);
export const renameTeam = (id, name) => stmt.renameTeam.run(name, id);
export const deleteTeam = (id) => stmt.deleteTeam.run(id);
export const listTeamMembers = (teamId) => stmt.listTeamMembers.all(teamId);
export const listTeamsForUser = (userId) => stmt.listTeamsForUser.all(userId);
export const listTeamIdsForUser = (userId) => stmt.listTeamsForUser.all(userId).map((team) => team.id);
export const addTeamMember = (teamId, userId) => stmt.addTeamMember.run(teamId, userId);
export const removeTeamMember = (teamId, userId) => stmt.removeTeamMember.run(teamId, userId);
export const removeUserFromAllTeams = (userId) => stmt.removeUserFromAllTeams.run(userId);

export function insertTeam({ name, createdAt }) {
  return Number(stmt.insertTeam.run(name, createdAt).lastInsertRowid);
}
