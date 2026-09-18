// App settings. Defaults come from config.js; admins can override some of them from
// Admin → Settings (and managers the break rules), which saves to the settings table.
// Read the current values with getSettings().
import { time_config, ui_config, session_config, login_config, attendance_config, request_config, break_config } from "./config.js";
import * as db from "./db.js";
import { configureTime, isValidTimeZone } from "./time.js";
import { THEME_STYLES, THEME_COLORS, THEME_MODES, THEME_BACKGROUNDS } from "./themes.js";

export const REQUEST_MODES = ["disabled", "approval", "honor"];

const DEFAULTS = {
  timezone: time_config.timezone,
  hour12: time_config.hour12,
  weekStart: time_config.weekStart,
  defaultStyle: ui_config.defaultStyle,
  defaultColor: ui_config.defaultColor,
  defaultTheme: ui_config.defaultTheme, // light/dark mode
  showModeToggle: ui_config.showModeToggle ?? true, // older config.js files don't have these two
  rememberGuestMode: ui_config.rememberGuestMode ?? true,
  defaultBackground: ui_config.defaultBackground,
  sessionHours: session_config.maxAgeHours,
  maxFailedLogins: login_config.maxFailedLogins,
  lockoutMinutes: login_config.lockoutMinutes,
  failureWindowMinutes: login_config.failureWindowMinutes,
  lateGraceMinutes: attendance_config.lateGraceMinutes,
  requestMode: request_config.mode,
  managersEditSelf: request_config.managersEditSelf,
  breakMaxCount: break_config.maxCount,
  breakMaxMinutes: break_config.maxMinutes,
};

let current = null;

export function getSettings() {
  return current;
}

function load() {
  const saved = db.loadSavedSettings();
  current = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS)) if (key in saved) current[key] = saved[key];

  if (current.timezone && !isValidTimeZone(current.timezone)) {
    console.warn(`Saved timezone "${current.timezone}" isn't valid; using "${DEFAULTS.timezone || "server timezone"}".`);
    current.timezone = DEFAULTS.timezone;
  }
  configureTime({ timezone: current.timezone, hour12: current.hour12 });
}

// Saves some settings (only known keys) and applies them right away.
export function saveSettings(values) {
  const known = Object.fromEntries(Object.entries(values).filter(([key]) => key in DEFAULTS));
  db.saveSettingValues(known);
  load();
}

// ===================================================================
// ===== Form parsing =====
// ===================================================================

// A whole number if the text is one, otherwise the text as typed (so the form can show it again).
function wholeNumberOrText(value) {
  const text = String(value ?? "").trim();
  return /^\d+$/.test(text) ? Number(text) : text;
}

const inRange = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;

// Validates the Admin → Settings form. Returns { values, error }; values is filled in
// even when there's an error so the form can be shown again.
export function readSettingsForm(body) {
  const values = {
    timezone: String(body.timezone ?? "").trim(),
    hour12: body.hour12 !== "false",
    weekStart: wholeNumberOrText(body.weekStart),
    defaultStyle: String(body.defaultStyle ?? ""),
    defaultColor: String(body.defaultColor ?? "standard"),
    defaultTheme: String(body.defaultTheme ?? ""),
    showModeToggle: body.showModeToggle === "on",
    rememberGuestMode: body.rememberGuestMode === "on",
    defaultBackground: String(body.defaultBackground ?? ""),
    sessionHours: wholeNumberOrText(body.sessionHours),
    maxFailedLogins: wholeNumberOrText(body.maxFailedLogins),
    lockoutMinutes: wholeNumberOrText(body.lockoutMinutes),
    failureWindowMinutes: wholeNumberOrText(body.failureWindowMinutes),
    lateGraceMinutes: wholeNumberOrText(body.lateGraceMinutes),
    requestMode: String(body.requestMode ?? ""),
    managersEditSelf: body.managersEditSelf === "on",
  };

  let error = null;
  if (values.timezone && !isValidTimeZone(values.timezone)) {
    error = `"${values.timezone}" isn't a timezone name. Use one like America/Chicago, or leave it blank for the server's timezone.`;
  } else if (!inRange(values.weekStart, 0, 6)) {
    error = "Pick the day weeks start on.";
  } else if (!THEME_STYLES.includes(values.defaultStyle)) {
    error = "Pick a default style.";
  } else if (!THEME_COLORS.includes(values.defaultColor)) {
    error = "Pick a default color theme.";
  } else if (!THEME_MODES.includes(values.defaultTheme)) {
    error = "Pick a default light/dark mode.";
  } else if (!THEME_BACKGROUNDS.includes(values.defaultBackground)) {
    error = "Pick a default background.";
  } else if (!inRange(values.sessionHours, 1, 720)) {
    error = "Login length must be a whole number of hours from 1 to 720.";
  } else if (!inRange(values.maxFailedLogins, 0, 100)) {
    error = "Failed attempts before locking must be a whole number from 0 to 100 (0 = never lock).";
  } else if (!inRange(values.lockoutMinutes, 0, 10080)) {
    error = "Lock length must be a whole number of minutes from 0 to 10080 (0 = until an admin unlocks).";
  } else if (!inRange(values.failureWindowMinutes, 1, 10080)) {
    error = "The attempt window must be a whole number of minutes from 1 to 10080.";
  } else if (!inRange(values.lateGraceMinutes, 0, 240)) {
    error = "Grace minutes must be a whole number from 0 to 240.";
  } else if (!REQUEST_MODES.includes(values.requestMode)) {
    error = "Pick an edit request mode.";
  }
  return { values, error };
}

// ===================================================================
// ===== Break rules =====
// ===================================================================

// Validates a break limits form (the default rules, or one employee's allowance).
// Blank fields become null. Returns { values: { maxCount, maxMinutes }, error }.
export function readBreakLimitsForm(body) {
  const blankOrNumber = (value) => (String(value ?? "").trim() === "" ? null : wholeNumberOrText(value));
  const values = { maxCount: blankOrNumber(body.maxCount), maxMinutes: blankOrNumber(body.maxMinutes) };

  let error = null;
  if (values.maxCount !== null && !inRange(values.maxCount, 0, 20)) {
    error = "Breaks per shift must be a whole number from 0 to 20, or blank.";
  } else if (values.maxMinutes !== null && !inRange(values.maxMinutes, 1, 480)) {
    error = "Minutes per break must be a whole number from 1 to 480, or blank.";
  }
  return { values, error };
}

// The break limits that apply to a user: their own allowance, or the default.
// Each is a number, or null for no limit.
export function breakPolicyFor(user) {
  return {
    maxCount: user.break_max_count ?? current.breakMaxCount,
    maxMinutes: user.break_max_minutes ?? current.breakMaxMinutes,
  };
}

load();
