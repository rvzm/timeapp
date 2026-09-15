// Admin Console: accounts and app settings. Mounted at /admin; admins only.
// Each account has tabs: Profile (name, contact, job details), Access (role, active),
// and Password (reset). Shift management is in the Manager Console (routes/manage.js),
// which admins can use for everyone.
import express from "express";
import * as db from "../db.js";
import * as time from "../time.js";
import { requireAdmin, hashPassword, validateAccount, validatePassword } from "../auth.js";
import { getSettings, saveSettings, readSettingsForm, REQUEST_MODES } from "../settings.js";
import { toId, notFound } from "./helpers.js";

const router = express.Router();
router.use(requireAdmin);

const PROFILE_FIELDS = ["username", "display_name", "email", "phone", "job_title", "employee_number"];
const TIME_ZONES = Intl.supportedValuesOf("timeZone");

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

router.get("/", (req, res) => {
  res.render("admin/index", { title: "Accounts", users: db.listUsersWithLastPunch() });
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
  renderAccountTab(req, res, target, "user-access", { role: role ?? target.role, error }, statusCode);
}

router.get("/users/:id/access", accountTab(renderAccessTab));

router.post("/users/:id/role", (req, res) => {
  const target = loadAccount(res, req.params.id);
  if (!target) return;

  const role = String(req.body.role ?? "");
  const error =
    (target.id === req.user.id ? "You can't change your own role." : null) ||
    (db.ROLES.includes(role) ? null : "Pick a role.");
  if (error) return renderAccessTab(req, res, target, { role, error, statusCode: 400 });

  db.setUserRole(target.id, role);
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
