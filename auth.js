// Authentication: password hashing, login sessions, route guards, and account validation.
//
// How sessions work: on login we add a row to the `sessions` table with a random
// id and give the browser that id in a signed cookie. Every request looks the id
// up again. Deleting the row (on logout or deactivation) ends that session on the
// server right away.
import crypto from "node:crypto";
import { session_config, account_config } from "./config.js";
import * as db from "./db.js";
import { getSettings } from "./settings.js";
import { isAdmin, isManagerOrAdmin } from "./permissions.js";

// ===================================================================
// ===== Passwords =====
// Stored as "pbkdf2$<iterations>$<salt>$<hash>". Because the iteration count is
// part of the string, it can be raised later without breaking existing accounts.
// ===================================================================

const PBKDF2_ITERATIONS = 150000;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 32, "sha256").toString("hex");
  return `pbkdf2$${PBKDF2_ITERATIONS}$${salt}$${hash}`;
}

export function verifyPassword(password, stored) {
  const [scheme, iterations, salt, hash] = String(stored).split("$");
  if (scheme !== "pbkdf2" || !salt || !hash || !(Number(iterations) > 0)) return false;
  const expected = Buffer.from(hash, "hex");
  if (expected.length === 0) return false; // corrupt/non-hex hash
  const actual = crypto.pbkdf2Sync(password, salt, Number(iterations), expected.length, "sha256");
  return crypto.timingSafeEqual(expected, actual);
}

let dummyHash = null;

// Returns the user if the username/password are right and the account is active, otherwise null.
// Unknown usernames still pay for a hash so response time doesn't reveal which usernames exist.
export function checkLogin(username, password) {
  const user = username ? db.getUserByUsername(username) : null;
  if (!user) {
    dummyHash ??= hashPassword(crypto.randomBytes(16).toString("hex"));
    verifyPassword(password, dummyHash);
    return null;
  }
  if (!verifyPassword(password, user.password_hash) || !user.active) return null;
  return user;
}

// ===================================================================
// ===== Account validation =====
// Each returns an error message, or null if everything is valid.
// ===================================================================

const USERNAME_RE = /^[A-Za-z0-9._-]{2,32}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[0-9+().\-\sxX]{3,40}$/;

// The profile fields employees can edit themselves. Only fields present in `fields` are checked.
export function validateProfileFields(fields) {
  if ((fields.display_name ?? "").length > 80) return "Display name must be 80 characters or fewer.";
  if (fields.email && (fields.email.length > 120 || !EMAIL_RE.test(fields.email))) {
    return "Enter a valid email address, or leave it blank.";
  }
  if (fields.phone && !PHONE_RE.test(fields.phone)) {
    return "Phone numbers can only use digits, spaces, and + ( ) - . x characters.";
  }
  return null;
}

// Everything on the admin account form. `userId` is the account being edited (null when adding one).
export function validateAccount(fields, userId = null) {
  if (!USERNAME_RE.test(fields.username ?? "")) {
    return "Username must be 2–32 characters: letters, numbers, dots, dashes, or underscores.";
  }
  const sameUsername = db.getUserByUsername(fields.username);
  if (sameUsername && sameUsername.id !== userId) return `The username "${fields.username}" is already taken.`;

  if ((fields.job_title ?? "").length > 80) return "Job title must be 80 characters or fewer.";
  if ((fields.employee_number ?? "").length > 40) return "Employee number must be 40 characters or fewer.";
  if (fields.employee_number) {
    const sameNumber = db.getUserByEmployeeNumber(fields.employee_number);
    if (sameNumber && sameNumber.id !== userId) {
      return `Employee number ${fields.employee_number} already belongs to ${db.displayName(sameNumber)}.`;
    }
  }

  if (!db.ROLES.includes(fields.role)) return "Pick a role.";
  return validateProfileFields(fields);
}

export function validatePassword(password) {
  if (password.length < account_config.minPasswordLength) {
    return `Password must be at least ${account_config.minPasswordLength} characters.`;
  }
  return null;
}

// ===================================================================
// ===== Sessions =====
// ===================================================================

function cookieOptions() {
  return { httpOnly: true, sameSite: "lax", secure: session_config.secure, path: "/" };
}

export function startSession(req, res, userId) {
  const now = new Date();
  const expires = new Date(now.getTime() + getSettings().sessionHours * 60 * 60 * 1000);

  const oldId = req.signedCookies[session_config.cookieName];
  if (oldId) db.deleteSession(oldId);
  db.purgeExpiredSessions(now.toISOString());

  const id = crypto.randomBytes(32).toString("hex");
  db.insertSession({ id, userId, createdAt: now.toISOString(), expiresAt: expires.toISOString() });
  res.cookie(session_config.cookieName, id, { ...cookieOptions(), signed: true, expires });
}

export function endSession(req, res) {
  const id = req.signedCookies[session_config.cookieName];
  if (id) db.deleteSession(id);
  res.clearCookie(session_config.cookieName, cookieOptions());
}

// ===================================================================
// ===== Middleware =====
// ===================================================================

// Runs on every request. Sets req.user (and res.locals.user for templates) to the
// logged-in user, or null. If the signature is bad, the session is gone, or the
// account is inactive, the cookie is cleared.
export function loadUser(req, res, next) {
  req.user = null;
  res.locals.user = null;

  // cookie-parser sets this to false when the signature doesn't match.
  const sessionId = req.signedCookies[session_config.cookieName];
  if (sessionId !== undefined) {
    const user = sessionId ? db.getSessionUser(sessionId, new Date().toISOString()) : null;
    if (user) {
      req.user = user;
      res.locals.user = user;
    } else {
      res.clearCookie(session_config.cookieName, cookieOptions());
    }
  }
  next();
}

export function requireLogin(req, res, next) {
  if (!req.user) return res.redirect("/login");
  next();
}

export function requireManager(req, res, next) {
  if (!req.user) return res.redirect("/login");
  if (!isManagerOrAdmin(req.user)) {
    return res.status(403).render("error", { title: "Managers only", message: "You don't have access to that page." });
  }
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user) return res.redirect("/login");
  if (!isAdmin(req.user)) {
    return res.status(403).render("error", { title: "Admins only", message: "You don't have access to that page." });
  }
  next();
}

// Where a user lands after logging in.
export function homePath(user) {
  return isAdmin(user) ? "/admin" : "/clock";
}
