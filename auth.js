// Authentication: password hashing, login sessions, route guards, and account validation.
//
// How sessions work: on login we add a row to the `sessions` table with a random
// id and give the browser that id in a signed cookie. Every request looks the id
// up again. Deleting the row (on logout or deactivation) ends that session on the
// server right away.
import crypto from "node:crypto";
import { session_config, account_config } from "./config.js";
import * as db from "./db.js";
import * as time from "./time.js";
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

// ===================================================================
// ===== Failed logins and lockouts =====
// Wrong passwords are counted on the account (users.failed_logins). Once there are
// `maxFailedLogins` in a row the account locks until `locked_until`; a gap of
// `failureWindowMinutes` with no attempt starts the count over, and any successful
// login clears it. Admin → Logins can unlock early.
// ===================================================================

// A lock with no end date. Far enough in the future that the usual "locked_until > now"
// comparison keeps working, so nothing else needs a special case.
export const LOCK_FOREVER = "9999-12-31T23:59:59.999Z";

const minutesFrom = (iso, minutes) => new Date(Date.parse(iso) + minutes * 60_000).toISOString();

// The time an account's lock lifts, or null if it isn't locked right now.
export function lockedUntil(user, nowIso = time.nowIso()) {
  return user.locked_until && user.locked_until > nowIso ? user.locked_until : null;
}

export const isLockedForever = (until) => until === LOCK_FOREVER;

// Counts one wrong password and locks the account if that was the last straw.
function recordFailure(user, nowIso) {
  const { maxFailedLogins, lockoutMinutes, failureWindowMinutes } = getSettings();

  // Nothing since the window opened? The old failures don't count toward this lock.
  const stale = !user.last_failed_at || user.last_failed_at < minutesFrom(nowIso, -failureWindowMinutes);
  if (stale) db.clearFailedLogins(user.id);
  db.addFailedLogin(user.id, nowIso);

  const count = (stale ? 0 : user.failed_logins) + 1;
  if (maxFailedLogins > 0 && count >= maxFailedLogins) {
    db.setLockedUntil(user.id, lockoutMinutes > 0 ? minutesFrom(nowIso, lockoutMinutes) : LOCK_FOREVER);
  }
}

let dummyHash = null;

// Checks a username and password. Returns one of:
//   { user }              the password was right and the account is active
//   { lockedUntil }       the account is locked; nothing was checked
//   {}                    wrong username or password, or the account is deactivated
// Unknown usernames still pay for a hash so response time doesn't reveal which usernames exist.
export function checkLogin(username, password) {
  const now = time.nowIso();
  const user = username ? db.getUserByUsername(username) : null;
  if (!user) {
    dummyHash ??= hashPassword(crypto.randomBytes(16).toString("hex"));
    verifyPassword(password, dummyHash);
    return {};
  }

  const until = lockedUntil(user, now);
  if (until) return { lockedUntil: until };
  // A lock that has run out gives the account a fresh set of attempts.
  if (user.locked_until) {
    db.clearFailedLogins(user.id);
    Object.assign(user, { failed_logins: 0, last_failed_at: null, locked_until: null });
  }

  if (!verifyPassword(password, user.password_hash)) {
    if (user.active) recordFailure(user, now); // a deactivated account can't be locked out of anything
    return {};
  }
  if (!user.active) return {};

  if (user.failed_logins) db.clearFailedLogins(user.id);
  return { user };
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

const USER_AGENT_MAX = 300;
// How stale a session's "last seen" may get before a request updates it. Without this,
// every page view would be a write.
const TOUCH_AFTER_MS = 60_000;

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
  db.insertSession({
    id,
    userId,
    createdAt: now.toISOString(),
    expiresAt: expires.toISOString(),
    // Recorded so Admin → Logins can show where a session came from. Both are whatever the
    // browser and network say they are, so they're a hint, not proof.
    ip: String(req.ip ?? ""),
    userAgent: String(req.get("user-agent") ?? "").slice(0, USER_AGENT_MAX),
  });
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
    const nowIso = new Date().toISOString();
    const user = sessionId ? db.getSessionUser(sessionId, nowIso) : null;
    if (user) {
      req.user = user;
      res.locals.user = user;
      // Keeps "last active" on Admin → Logins roughly current without a write per request.
      if (!user.last_seen_at || Date.parse(nowIso) - Date.parse(user.last_seen_at) > TOUCH_AFTER_MS) {
        db.touchSession(sessionId, nowIso);
      }
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
