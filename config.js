// TimeApp configuration file
// Everything you'd normally want to tweak lives here. Restart the server after editing.
// Values marked [setting] are only defaults: admins can override them from Admin → Settings
// (break limits from Manage → Break rules), and the saved value wins.

export const app_config = {
  name: "TimeApp", // Shown in the page title, header, and footer
  version: "0.2.3",
};

export const server_config = {
  port: 3000,        // Port the web server listens on
  host: "localhost", // "0.0.0.0" to accept connections from other machines on the network
};

export const db_config = {
  file: "data/timeapp.sqlite", // SQLite database file; relative paths resolve from the project root
};

export const session_config = {
  secret: "changeme",       // Signs session cookies. Change to a long random string in production
  cookieName: "timeapp_sid",
  maxAgeHours: 12,          // [setting] How long a login lasts before the user has to log in again
  secure: false,            // true = cookies only sent over HTTPS (turn on when served behind HTTPS)
};

export const account_config = {
  minPasswordLength: 8, // Minimum length for new passwords
};

export const time_config = {
  timezone: "",    // [setting] IANA timezone like "America/Chicago"; empty = the server's local timezone
  locale: "en-US", // Controls how dates and times are formatted
  hour12: true,    // [setting] true = 12-hour clock (3:05 PM), false = 24-hour clock (15:05)
  weekStart: 0,    // [setting] First day of the week for weekly views and exports: 0 = Sunday, 1 = Monday
};

export const ui_config = {
  defaultStyle: "modern",   // [setting] Theme style (fonts, corners, borders, shadows) for anyone who hasn't picked: "modern", "minimal", "terminal", or "blueprint"
  defaultColor: "standard", // [setting] Color theme for anyone who hasn't picked one: "standard", "ocean", "forest", "sunset", "grape", or "fire"
  defaultTheme: "system",   // [setting] Light/dark for anyone who hasn't picked: "system" (match the device), "light", or "dark"
  defaultBackground: "aurora", // [setting] Page background for anyone who hasn't picked: "none" (plain), "glow", "aurora" (moving), "dots", "grain", "waves" (moving), "starfield" (moving), or "cityscape"
};

export const attendance_config = {
  lateGraceMinutes: 5, // [setting] Minutes of slack before a mandatory shift counts as Late or Left early
};

export const request_config = {
  mode: "approval",        // [setting] Punch edit requests: "disabled", "approval" (a manager approves), or "honor" (applied immediately)
  managersEditSelf: false, // [setting] true = managers can edit their own punches and approve their own requests
};

export const break_config = {
  maxCount: null,   // [setting] Breaks allowed per shift; null = no limit
  maxMinutes: null, // [setting] Minutes per break before it's flagged; null = no limit
};
