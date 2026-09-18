// Admin Console: accounts, teams, and app settings. Mounted at /admin; admins only.
// Each account has tabs: Profile (name, contact, job details), Access (role, active, teams),
// and Password (reset). Shift management is in the Manager Console (routes/manage.js),
// which admins can use for everyone.
import express from "express";
import * as db from "../db.js";
import * as time from "../time.js";
import { requireAdmin, hashPassword, validateAccount, validatePassword, lockedUntil, isLockedForever } from "../auth.js";
import { getSettings, saveSettings, readSettingsForm, REQUEST_MODES } from "../settings.js";
import { readTeamFilter, inTeamFilter } from "../teams.js";
import { toId, notFound } from "./helpers.js";

const router = express.Router();
router.use(requireAdmin);

const PROFILE_FIELDS = ["username", "display_name", "email", "phone", "job_title", "employee_number"];
const TIME_ZONES = Intl.supportedValuesOf("timeZone");
const TEAM_NAME_MAX = 60;

// ===================================================================
// ===== Helpers =====
// ===================================================================

// The profile fields as trimmed strings. Also works on a user row, to prefill the form.
function readProfileForm(src) {
  return Object.fromEntries(PROFILE_FIELDS.map((field) => [field, String(src[field] ?? "").trim()]));
}

// The account with this id, or renders a 404 and returns null.
function loadAccount(res, id) {
  const target = db.getUserById(toId(id));
  if (!target) notFound(res, "account");
  return target ?? null;
}

function renderSettings(res, { form = getSettings(), error = null, notice = null, statusCode = 200 } = {}) {
  res.status(statusCode).render("admin/settings", {
    title: "Settings",
    form,
    error,
    notice,
    REQUEST_MODES,
    TIME_ZONES,
  });
}

// ===================================================================
// ===== Accounts =====
// ===================================================================

// ?team= filters the list, as in the Manage Console.
router.get("/", (req, res) => {
  const { filter, picker } = readTeamFilter(req.user, req.query.team);
  const users = db.listUsersWithLastPunch().filter((u) => inTeamFilter(filter, u.id));
  res.render("admin/index", { title: "Accounts", users, teamPicker: picker });
});

router.get("/users/new", (req, res) => {
  res.render("admin/user-new", { title: "Add account", error: null, form: { ...readProfileForm({}), role: "employee" } });
});

router.post("/users", (req, res) => {
  const form = { ...readProfileForm(req.body), role: String(req.body.role ?? "") };
  const password = String(req.body.password ?? "");

  const error = validateAccount(form) || validatePassword(password);
  if (error) return res.status(400).render("admin/user-new", { title: "Add account", error, form });

  const id = db.insertUser({ ...form, passwordHash: hashPassword(password), createdAt: time.nowIso() });
  res.redirect(`/admin/users/${id}`);
});

// ===================================================================
// ===== Account tabs =====
// Every tab shares a header and tab bar; `data` is the tab's own content.
// ?saved=<what> shows a notice after a successful save.
// ===================================================================

function renderAccountTab(req, res, target, view, data = {}, statusCode = 200) {
  res.status(statusCode).render(`admin/${view}`, {
    title: db.displayName(target),
    target,
    isSelf: target.id === req.user.id,
    saved: statusCode === 200 ? req.query.saved : null,
    error: null,
    ...data,
  });
}

// Each GET tab route loads the account (404 if there isn't one) and renders its tab.
const accountTab = (render) => (req, res) => {
  const target = loadAccount(res, req.params.id);
  if (target) render(req, res, target);
};

// ----- Profile -----

function renderProfileTab(req, res, target, { form = null, error = null, statusCode = 200 } = {}) {
  renderAccountTab(req, res, target, "user-edit", { form: form ?? readProfileForm(target), error }, statusCode);
}

router.get("/users/:id", accountTab(renderProfileTab));

router.post("/users/:id", (req, res) => {
  const target = loadAccount(res, req.params.id);
  if (!target) return;

  // The role lives on the Access tab, so it stays as it is here.
  const form = readProfileForm(req.body);
  const error = validateAccount({ ...form, role: target.role }, target.id);
  if (error) return renderProfileTab(req, res, target, { form, error, statusCode: 400 });

  db.updateAccount(target.id, { ...form, role: target.role });
  res.redirect(`/admin/users/${target.id}?saved=1`);
});

// ----- Access: role and active status -----

function renderAccessTab(req, res, target, { role = null, error = null, statusCode = 200 } = {}) {
  const until = lockedUntil(target);
  renderAccountTab(req, res, target, "user-access", {
    role: role ?? target.role,
    teams: db.listTeamsForUser(target.id),
    lock: { until, forever: isLockedForever(until), failedLogins: target.failed_logins },
    error,
  }, statusCode);
}

router.get("/users/:id/access", accountTab(renderAccessTab));

router.post("/users/:id/role", (req, res) => {
  const target = loadAccount(res, req.params.id);
  if (!target) return;

  const role = String(req.body.role ?? "");
  const error =
    (target.id === req.user.id ? "You can't change your own role." : null) ||
    (db.ROLES.includes(role) ? null : "Pick a role.") ||
    (role === "employee" && db.listTeamIdsForUser(target.id).length > 1
      ? "Employees can only be on one team. Remove them from all but one team first."
      : null);
  if (error) return renderAccessTab(req, res, target, { role, error, statusCode: 400 });

  // Admins manage everyone, so they aren't kept on teams.
  db.db.transaction(() => {
    db.setUserRole(target.id, role);
    if (role === "admin") db.removeUserFromAllTeams(target.id);
  })();
  res.redirect(`/admin/users/${target.id}/access?saved=role`);
});

function setActive(req, res, active) {
  const target = loadAccount(res, req.params.id);
  if (!target) return;
  if (!active && target.id === req.user.id) {
    return renderAccessTab(req, res, target, { error: "You can't deactivate your own account.", statusCode: 400 });
  }

  db.setUserActive(target.id, active);
  if (!active) db.deleteUserSessions(target.id); // logs them out everywhere, right away

  const saved = active ? "activated" : "deactivated";
  res.redirect(req.body.back === "list" ? "/admin" : `/admin/users/${target.id}/access?saved=${saved}`);
}

router.post("/users/:id/deactivate", (req, res) => setActive(req, res, false));
router.post("/users/:id/activate", (req, res) => setActive(req, res, true));

// ----- Password -----

function renderPasswordTab(req, res, target, { error = null, statusCode = 200 } = {}) {
  renderAccountTab(req, res, target, "user-password", { error }, statusCode);
}

router.get("/users/:id/password", accountTab(renderPasswordTab));

router.post("/users/:id/password", (req, res) => {
  const target = loadAccount(res, req.params.id);
  if (!target) return;

  const password = String(req.body.password ?? "");
  const confirm = String(req.body.confirm_password ?? "");
  const error = validatePassword(password) || (password === confirm ? null : "The passwords don't match.");
  if (error) return renderPasswordTab(req, res, target, { error, statusCode: 400 });

  db.setPasswordHash(target.id, hashPassword(password));
  // Someone else's password: log them out everywhere. Your own: just your other devices.
  if (target.id === req.user.id) db.deleteOtherSessions(target.id, req.user.session_id);
  else db.deleteUserSessions(target.id);
  res.redirect(`/admin/users/${target.id}/password?saved=1`);
});

// ===================================================================
// ===== Teams =====
// Managers on a team only manage that team's employees. An employee is on at most one
// team; a manager can be on several. Admins aren't on teams.
// ===================================================================

// Validates the add/rename team form. Returns { form } plus either { name } or { error }.
function readTeamForm(body, teamId = null) {
  const form = { name: String(body.name ?? "").trim() };
  if (!form.name || form.name.length > TEAM_NAME_MAX) {
    return { form, error: `Team name must be 1–${TEAM_NAME_MAX} characters.` };
  }
  const same = db.getTeamByName(form.name);
  if (same && same.id !== teamId) return { form, error: `There's already a team called "${same.name}".` };
  return { form, name: form.name };
}

// The team with this id, or renders a 404 and returns null.
function loadTeam(res, id) {
  const team = db.getTeam(toId(id));
  if (!team) notFound(res, "team");
  return team ?? null;
}

function renderTeams(res, { form = { name: "" }, error = null, statusCode = 200 } = {}) {
  res.status(statusCode).render("admin/teams", { title: "Teams", teams: db.listTeams(), form, error });
}

function renderTeam(req, res, team, { form = null, error = null, memberError = null, statusCode = 200 } = {}) {
  const members = db.listTeamMembers(team.id);
  const memberIds = new Set(members.map((m) => m.id));
  // Everyone who could be added, with the team an employee would be moved out of.
  const candidates = db.listUsersWithLastPunch()
    .filter((u) => u.active && u.role !== "admin" && !memberIds.has(u.id))
    .map((u) => ({ ...u, movesFrom: u.role === "employee" ? u.team_names : null }));
  const addedCount = Number(req.query.count) || 1;

  res.status(statusCode).render("admin/team", {
    title: team.name,
    team,
    members,
    candidates,
    form: form ?? { name: team.name },
    error,
    memberError,
    addedCount,
    saved: statusCode === 200 ? req.query.saved : null,
  });
}

router.get("/teams", (req, res) => renderTeams(res));

router.post("/teams", (req, res) => {
  const { form, name, error } = readTeamForm(req.body);
  if (error) return renderTeams(res, { form, error, statusCode: 400 });

  const id = db.insertTeam({ name, createdAt: time.nowIso() });
  res.redirect(`/admin/teams/${id}`);
});

router.get("/teams/:id", (req, res) => {
  const team = loadTeam(res, req.params.id);
  if (team) renderTeam(req, res, team);
});

router.post("/teams/:id", (req, res) => {
  const team = loadTeam(res, req.params.id);
  if (!team) return;

  const { form, name, error } = readTeamForm(req.body, team.id);
  if (error) return renderTeam(req, res, team, { form, error, statusCode: 400 });

  db.renameTeam(team.id, name);
  res.redirect(`/admin/teams/${team.id}?saved=renamed`);
});

router.post("/teams/:id/delete", (req, res) => {
  const team = loadTeam(res, req.params.id);
  if (!team) return;

  db.deleteTeam(team.id); // memberships go with it
  res.redirect("/admin/teams");
});

// Adds everyone ticked in the Add members dialog (one or more user_id values).
router.post("/teams/:id/members", (req, res) => {
  const team = loadTeam(res, req.params.id);
  if (!team) return;

  const ids = [req.body.user_id ?? []].flat().map(toId);
  const people = [...new Set(ids)].map((id) => id && db.getUserById(id));
  const memberError =
    (people.length === 0 ? "Tick at least one person to add." : null) ||
    (people.some((person) => !person) ? "Someone you picked doesn't exist anymore. Try again." : null) ||
    (people.some((person) => person.role === "admin") ? "Admins manage everyone, so they aren't added to teams." : null);
  if (memberError) return renderTeam(req, res, team, { memberError, statusCode: 400 });

  // An employee is on one team at a time, so adding them moves them here.
  db.db.transaction(() => {
    for (const person of people) {
      if (person.role === "employee") db.removeUserFromAllTeams(person.id);
      db.addTeamMember(team.id, person.id);
    }
  })();
  res.redirect(`/admin/teams/${team.id}?saved=added${people.length > 1 ? `&count=${people.length}` : ""}`);
});

router.post("/teams/:id/members/:userId/delete", (req, res) => {
  const team = loadTeam(res, req.params.id);
  if (!team) return;

  db.removeTeamMember(team.id, toId(req.params.userId));
  res.redirect(`/admin/teams/${team.id}?saved=removed`);
});

// ===================================================================
// ===== Logins =====
// Who's signed in right now, and which accounts are locked out. Ending a session row
// logs that browser out on its next request (see auth.js).
// ===================================================================

// A short "Chrome on Windows" from a user agent string, for the sessions table.
// Browsers lie in these, so it's a hint about the device, never an identity check.
function describeDevice(userAgent) {
  const ua = String(userAgent ?? "");
  if (!ua) return "Unknown";

  const browser =
    /\bEdg\//.test(ua) ? "Edge" :
    /\b(OPR|Opera)\//.test(ua) ? "Opera" :
    /\bFirefox\//.test(ua) ? "Firefox" :
    /\bChrome\//.test(ua) ? "Chrome" :
    /\bSafari\//.test(ua) ? "Safari" : null;

  const system =
    /\biPhone|\biPad/.test(ua) ? "iOS" :
    /\bAndroid\b/.test(ua) ? "Android" :
    /\bWindows\b/.test(ua) ? "Windows" :
    /\bMac OS X\b/.test(ua) ? "macOS" :
    /\bCrOS\b/.test(ua) ? "ChromeOS" :
    /\bLinux\b/.test(ua) ? "Linux" : null;

  if (!browser) return system ?? "Unknown";
  return system ? `${browser} on ${system}` : browser;
}

router.get("/logins", (req, res) => {
  const now = time.nowIso();
  db.purgeExpiredSessions(now); // so the page only ever shows live logins

  const sessions = db.listActiveSessions(now).map((s) => ({
    ...s,
    device: describeDevice(s.user_agent),
    isCurrent: s.id === req.user.session_id,
  }));
  // Accounts with failures behind them: locked ones first (see listLockedUsers).
  const locked = db.listLockedUsers().map((u) => {
    const until = lockedUntil(u, now);
    return { ...u, until, forever: isLockedForever(until) };
  });

  res.render("admin/logins", {
    title: "Logins",
    sessions,
    locked,
    people: new Set(sessions.map((s) => s.user_id)).size,
    saved: req.query.saved ?? null,
  });
});

// Ends one browser's session.
router.post("/logins/:sid/delete", (req, res) => {
  const sid = String(req.params.sid ?? "");
  const self = sid === req.user.session_id;
  db.deleteSession(sid);
  // Admins can end their own session here; that's just a logout.
  res.redirect(self ? "/login" : "/admin/logins?saved=ended");
});

// Logs one account out on every device.
router.post("/users/:id/sessions/delete", (req, res) => {
  const target = loadAccount(res, req.params.id);
  if (!target) return;

  // Your own account: keep the session you're using, or you'd log yourself out mid-click.
  if (target.id === req.user.id) db.deleteOtherSessions(target.id, req.user.session_id);
  else db.deleteUserSessions(target.id);

  const back = req.body.back === "access" ? `/admin/users/${target.id}/access?saved=logged-out` : "/admin/logins?saved=user";
  res.redirect(back);
});

// Logs everyone out except the admin doing it.
router.post("/logins/all", (req, res) => {
  db.deleteAllSessions(req.user.session_id);
  res.redirect("/admin/logins?saved=all");
});

// Clears a lockout and its failed-attempt count.
router.post("/users/:id/unlock", (req, res) => {
  const target = loadAccount(res, req.params.id);
  if (!target) return;

  db.clearFailedLogins(target.id);
  res.redirect(req.body.back === "access" ? `/admin/users/${target.id}/access?saved=unlocked` : "/admin/logins?saved=unlocked");
});

// ===================================================================
// ===== Settings =====
// ===================================================================

router.get("/settings", (req, res) => {
  renderSettings(res, { notice: req.query.saved ? "Settings saved." : null });
});

router.post("/settings", (req, res) => {
  const { values, error } = readSettingsForm(req.body);
  if (error) return renderSettings(res, { form: { ...getSettings(), ...values }, error, statusCode: 400 });

  saveSettings(values);
  res.redirect("/admin/settings?saved=1");
});

export default router;
