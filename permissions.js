// Who can do what.
//   employee: Clock and their own Portal
//   manager:  + Manage Console for employee-role accounts (and themselves, if the
//               "managers can edit self" setting is on). A manager on one or more
//               teams only manages the employees on those teams; a manager on no
//               team manages every employee.
//   admin:    + everyone in the Manage Console, and the Admin Console
import * as db from "./db.js";
import { getSettings } from "./settings.js";

export const isAdmin = (user) => user?.role === "admin";
export const isManagerOrAdmin = (user) => user?.role === "manager" || user?.role === "admin";

// The ids of the teams a manager is limited to, or null when they aren't limited
// (admins, and managers on no team).
export function managedTeamIds(actor) {
  if (actor?.role !== "manager") return null;
  const ids = db.listTeamIdsForUser(actor.id);
  return ids.length ? ids : null;
}

// Whether the target is within the actor's teams (always true when the actor isn't limited).
function sharesTeam(actor, target) {
  const teamIds = managedTeamIds(actor);
  if (!teamIds) return true;
  return db.listTeamIdsForUser(target.id).some((id) => teamIds.includes(id));
}

// Viewing and changing someone's punches, shifts, notes, and edit requests.
export function canManageShifts(actor, target) {
  if (isAdmin(actor)) return true;
  if (actor?.role !== "manager") return false;
  if (actor.id === target.id) return getSettings().managersEditSelf;
  return target.role === "employee" && sharesTeam(actor, target);
}

// Assigning mandatory shifts and changing break allowances. Managers never do this for themselves.
export function canManageSchedule(actor, target) {
  if (isAdmin(actor)) return true;
  return actor?.role === "manager" && actor.id !== target.id && target.role === "employee" && sharesTeam(actor, target);
}
