// Who can do what.
//   employee: Clock and their own Portal
//   manager:  + Manage Console for employee-role accounts (and themselves, if the
//               "managers can edit self" setting is on)
//   admin:    + everyone in the Manage Console, and the Admin Console
import { getSettings } from "./settings.js";

export const isAdmin = (user) => user?.role === "admin";
export const isManagerOrAdmin = (user) => user?.role === "manager" || user?.role === "admin";

// Viewing and changing someone's punches, shifts, notes, and edit requests.
export function canManageShifts(actor, target) {
  if (isAdmin(actor)) return true;
  if (actor?.role !== "manager") return false;
  if (actor.id === target.id) return getSettings().managersEditSelf;
  return target.role === "employee";
}

// Assigning mandatory shifts and changing break allowances. Managers never do this for themselves.
export function canManageSchedule(actor, target) {
  if (isAdmin(actor)) return true;
  return actor?.role === "manager" && actor.id !== target.id && target.role === "employee";
}
