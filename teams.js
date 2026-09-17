// Team filters: the "Team:" picker on the Manage Console and the Admin accounts list.
// A filter value is "" (everyone), a team id as a string, or "none" (people on no team).
import * as db from "./db.js";
import { isAdmin } from "./permissions.js";

// The teams the user can pick between, as [{ value, label }]; empty = no picker.
// Admins get "All teams" and "No team" too. A manager with several teams always
// views one of them; the teams are never mixed.
export function teamOptions(user) {
  const toOption = (team) => ({ value: String(team.id), label: team.name });
  if (isAdmin(user)) {
    const teams = db.listTeams();
    if (!teams.length) return [];
    return [{ value: "", label: "All teams" }, ...teams.map(toOption), { value: "none", label: "No team" }];
  }
  const teams = db.listTeamsForUser(user.id);
  return teams.length > 1 ? teams.map(toOption) : [];
}

// Reads ?team= against the user's options. Returns { filter, picker } where picker is
// { options, current } for views/partials/team-picker.ejs, or null when there's nothing to pick.
export function readTeamFilter(user, value) {
  const options = teamOptions(user);
  const picked = options.find((option) => option.value === String(value ?? "")) ?? options[0];
  const filter = picked?.value ?? "";
  return { filter, picker: options.length ? { options, current: filter } : null };
}

// Whether a user belongs to the picked team.
export function inTeamFilter(filter, userId) {
  if (!filter) return true;
  const teamIds = db.listTeamIdsForUser(userId);
  return filter === "none" ? teamIds.length === 0 : teamIds.includes(Number(filter));
}
