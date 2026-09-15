// Your account, reached from the menu under your name in the header:
//   /profile   your details (view, plus an Edit page), availability, and upcoming mandatory shifts
//   /settings  password, appearance, and exporting all your shift data
// Any logged-in user. Mounted at the root, so each route checks the login itself.
import express from "express";
import * as db from "../db.js";
import * as time from "../time.js";
import { requireLogin, verifyPassword, hashPassword, validateProfileFields, validatePassword } from "../auth.js";
import { getSettings } from "../settings.js";
import { availabilityWeek, readAvailabilityForm } from "../availability.js";
import { themeFor, readThemeForm } from "../themes.js";
import { withAttendance } from "../schedule.js";
import { allShiftsCsv, allShiftsFilename } from "../timesheet.js";

const router = express.Router();

router.get("/portal/profile", (req, res) => res.redirect("/profile")); // the old URL

// ===================================================================
// ===== Profile =====
// ?saved=<form> shows that form's notice.
// ===================================================================

function renderProfile(req, res, { availability = null, errors = {}, statusCode = 200 } = {}) {
  const account = db.getUserById(req.user.id);
  const now = time.nowIso();
  const [, to] = time.dayRangeUtc(time.addDays(time.localDate(), 28));

  res.status(statusCode).render("account/profile", {
    title: "Profile",
    account,
    availability: availability ?? availabilityWeek(account.id, getSettings().weekStart),
    // Upcoming (including one under way) over the next four weeks.
    upcoming: withAttendance(account.id, db.listScheduledForUser(account.id, now, to)).filter((a) => a.end_at > now),
    errors,
    saved: statusCode === 200 ? req.query.saved : null,
  });
}

function renderProfileEdit(req, res, { form = null, error = null, statusCode = 200 } = {}) {
  const account = db.getUserById(req.user.id);

  res.status(statusCode).render("account/profile-edit", {
    title: "Edit profile",
    account,
    form: form ?? { display_name: account.display_name, email: account.email, phone: account.phone },
    error,
  });
}

router.get("/profile", requireLogin, (req, res) => renderProfile(req, res));

router.get("/profile/edit", requireLogin, (req, res) => renderProfileEdit(req, res));

router.post("/profile", requireLogin, (req, res) => {
  const form = {
    display_name: String(req.body.display_name ?? "").trim(),
    email: String(req.body.email ?? "").trim(),
    phone: String(req.body.phone ?? "").trim(),
  };

  const error = validateProfileFields(form);
  if (error) return renderProfileEdit(req, res, { form, error, statusCode: 400 });

  db.updateProfile(req.user.id, form);
  res.redirect("/profile?saved=profile");
});

router.post("/profile/availability", requireLogin, (req, res) => {
  const { windows, week, error } = readAvailabilityForm(req.body, getSettings().weekStart);
  if (error) return renderProfile(req, res, { availability: week, errors: { availability: error }, statusCode: 400 });

  db.replaceAvailability(req.user.id, windows);
  res.redirect("/profile?saved=availability");
});

// ===================================================================
// ===== Settings =====
// ?saved=<form> shows that form's notice.
// ===================================================================

function renderSettings(req, res, { errors = {}, statusCode = 200 } = {}) {
  const account = db.getUserById(req.user.id);

  res.status(statusCode).render("account/settings", {
    title: "Settings",
    themeForm: {
      ...themeFor(account, getSettings()),
      usingDefault: [account.theme_style, account.theme_color, account.theme_mode, account.theme_background].every((value) => value === null),
    },
    errors,
    saved: statusCode === 200 ? req.query.saved : null,
  });
}

router.get("/settings", requireLogin, (req, res) => renderSettings(req, res));

router.post("/settings/password", requireLogin, (req, res) => {
  const current = String(req.body.current_password ?? "");
  const next = String(req.body.new_password ?? "");
  const confirm = String(req.body.confirm_password ?? "");
  const account = db.getUserById(req.user.id);

  const error =
    (verifyPassword(current, account.password_hash) ? null : "Your current password is incorrect.") ||
    validatePassword(next) ||
    (next === confirm ? null : "The new passwords don't match.");
  if (error) return renderSettings(req, res, { errors: { password: error }, statusCode: 400 });

  db.setPasswordHash(account.id, hashPassword(next));
  db.deleteOtherSessions(account.id, req.user.session_id); // log out other devices
  res.redirect("/settings?saved=password");
});

// Your theme. reset=1 goes back to the app default.
router.post("/settings/theme", requireLogin, (req, res) => {
  if (req.body.reset) {
    db.setUserTheme(req.user.id, { style: null, color: null, mode: null, background: null });
    return res.redirect("/settings?saved=theme");
  }

  const { values, error } = readThemeForm(req.body);
  if (error) return renderSettings(req, res, { errors: { theme: error }, statusCode: 400 });

  db.setUserTheme(req.user.id, values);
  res.redirect("/settings?saved=theme");
});

// Every shift you've ever worked, as a CSV download.
router.get("/settings/export.csv", requireLogin, (req, res) => {
  const account = db.getUserById(req.user.id);
  res.attachment(allShiftsFilename(account));
  res.type("text/csv; charset=utf-8");
  res.send(allShiftsCsv(account.id));
});

export default router;
