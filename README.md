# TimeApp
NodeJS and SQLite powered Time Clock WebApp.

![buildstate-stable](https://img.shields.io/badge/build-stable-green)
![version](https://img.shields.io/badge/version-0.3.0-green)

## Dependencies
app:
![better-sqlite3](https://img.shields.io/badge/better--sqlite3-^12.6.2-green)
![cookie-parser](https://img.shields.io/badge/cookie--parser-^1.4.6-green)
![ejs](https://img.shields.io/badge/ejs-^3.1.10-green)
![express](https://img.shields.io/badge/express-^5.2.1-green)

theme:
![html-to-image](https://img.shields.io/badge/html--to--image-^1.11.13-green)
![open-props](https://img.shields.io/badge/open--props-^1.7-green)
![fontsource](https://img.shields.io/badge/fontsource-Inter%20·%20JetBrains%20Mono%20·%20Space%20Grotesk-green)


# Primary Use
This app is for hosting your own configurable time clock.

# Guides
Guides for the people who use and run TimeApp are in [`guide/`](guide/):

| Guide | For |
|---|---|
| [Quickstart](guide/QUICKSTART.md) | Installing, configuring, running, and updating the server, plus the first admin's setup |
| [Employee](guide/EMPLOYEE.md) | Clocking in and out, your shifts, fixing punches, schedule, profile, and exports |
| [Manager](guide/MANAGER.md) | Managing employees' punches, schedules, edit requests, and break rules |
| [Admin](guide/ADMIN.md) | Accounts, roles, passwords, and app settings |
| [Appearance](guide/APPEARANCE.md) | Styles, colors, light/dark, and backgrounds | It is Vibe-Coded with Claude Code.

Sometimes Claude Code is used to help with grouping Git commits properly after doing a lot of edits, as well as used for helping with edits and bugfixes.

---

# Setup
```sh
npm install
npm run seed -- admin            # creates an admin; prints a random password
npm start                        # starts in the background and gives the terminal back
```
Then open http://localhost:3000.

| Command | What it does |
|---|---|
| `npm start` | Start the server in the background. Output goes to `data/timeapp.log` |
| `npm stop` | Stop it |
| `npm run restart` | Stop, then start (e.g. after editing `config.js` or pulling new code) |
| `npm run status` | Is it running? |
| `npm run serve` | Run in the foreground instead (Ctrl+C stops it); use this under systemd, Docker, etc. |
| `npm run dev` | Foreground, restarting whenever a file changes |
| `npm run backup` | Copy the database and `config.js` into `backup/` (safe while running) |
| `npm run migrate` | After updating: restore `backup/`, carry your settings into the new `config.js`, and upgrade the database (`-- --dry-run` to preview) |
 Before real use, set `session_config.secret` (and probably `time_config.timezone`) in `config.js`.

Create more admins the same way: `npm run seed -- <username> [password]`. Create employees and managers from **Admin → Accounts**.

Database changes run automatically when the app starts, so updating is just pulling the new code and restarting.

# Layout
| Path | What it is |
|---|---|
| `config.js` | Port, DB file, session secret, and the defaults for everything in Admin → Settings |
| `server.js` | Express setup, shared middleware, route mounting |
| `db.js`, `db/` | Database. `db/connection.js` has the schema and migrations; the other files hold the queries for one area each |
| `auth.js` | Passwords, sessions, login/role guards, account validation |
| `permissions.js` | Who can manage whom (employee / manager / admin) |
| `settings.js` | Saved settings layered over the `config.js` defaults, plus break rules |
| `time.js` | UTC ⇄ local timezone conversion, date ranges, formatting |
| `shifts.js` | Groups punches into shifts, with notes, break warnings, and worked time |
| `availability.js` | Weekly availability |
| `requests.js` | Punch edit requests: validating, approving, applying changes |
| `schedule.js` | Mandatory shifts: attendance and conflict checks |
| `timesheet.js` | Day / week / month timesheet exports |
| `seed.js` | Creates admin accounts |
| `daemon.js` | `npm start` / `stop` / `restart` / `status`: runs `server.js` in the background |
| `routes/` | `auth.js` (login), `clock.js`, `portal.js`, `account.js` (Profile and Settings), `notes.js`, `manage.js`, `admin.js`, and shared `helpers.js` |
| `views/` | EJS pages grouped by area (`portal/`, `account/`, `manage/`, `admin/`); shared pieces in `views/partials/` |
| `public/timeapp.css` | Styles. Tweak the "Configurable defaults" block at the top |
| `themes.js` | Color themes and light/dark modes: the list, and which theme a page uses |
| `public/export.js` | The timesheet's PDF and image buttons |
| `data/` | The SQLite database (created on first run) |

# How it works
## Roles
| | Employee | Manager | Admin |
|---|---|---|---|
| **Clock**, **My Portal** (own shifts, schedule, requests, export), **Profile** and **Settings** | ✓ | ✓ | ✓ |
| **Manage** (shifts, requests, schedules, break rules, exports) | | Employee accounts* | Everyone |
| **Admin** (accounts, roles, settings) | | | ✓ |

\* With **Managers can edit their own punches** turned on in Admin → Settings, managers can also manage their own punches and approve their own requests. Assigning a manager's shifts or break allowance always takes an admin.

## Details
- **Status and shifts are never stored.** Status comes from each person's latest punch: `clock_in`/`break_end` = clocked in, `break_start` = on break, `clock_out` or nothing = clocked out. Wherever punches are listed, they're grouped into shifts: a clock-in starts one, a clock-out ends it, and breaks sit inside. An overnight shift shows up whole and counts on the day it starts. Shifts with a missing punch are flagged and left out of totals.
- **Clock punches are checked on the server.** You can only make the punch your status allows, and Start Break goes away once your break allowance for the shift is used up.
- **Break rules** (Manage → Break rules) set a default number of breaks per shift and minutes per break. Individual employees can get their own allowance. Long breaks are flagged, not blocked.
- **Punch edits.** Managers edit punches directly from an employee's Manage page. Employees ask through **edit requests** (change, add, or delete a punch, or add a missing shift). Admin → Settings picks the mode: *disabled*, *approval* (a manager or admin approves, which applies the change), or *honor* (applied right away and logged as auto-approved). Every change records who made it in `punches.edited_by`. Reviewers can also **approve with edits**, applying their own values; the request keeps the original ask and records what was applied in `edit_requests.applied_*`. Manage → Requests groups requests by employee, week and day of the punch they concern, labelled with its shift.
- **Profile and Settings.** Clicking your name in the header opens a menu with Profile, Settings, and Log out. **Profile** shows your details (changed from its Edit button), your weekly availability, and your upcoming mandatory shifts. **Settings** has password change, appearance, and *Export all shift data*, a CSV of every shift you've worked.
- **Shift notes** are a comment thread on each shift. The shift's owner and anyone who manages them can post.
- **Accounts.** In Admin → Accounts, each account has tabs: **Profile** (name, contact, job title, employee number), **Access** (role, deactivate/reactivate), and **Password** (reset; logs them out everywhere).
- **Managing one employee.** Each employee's Manage page has tabs: **Shifts** (punches, notes, add/edit/delete), **Schedule** (mandatory shifts), **Requests** (their edit requests), and **Details** (profile, availability, break allowance).
- **Mandatory shifts** are assigned from the Schedule tab of an employee's Manage page. An assignment that overlaps another, or falls outside the employee's weekly availability, needs an "Assign anyway" confirmation. Attendance (On time, Late, Left early, Missed) is worked out from punches using the grace minutes setting.
- **Timesheet export** (My Portal → Export timesheet, or an employee's Manage page) covers a day, week, or month. *Save as PDF* uses the browser's print dialog; *Download image* makes a PNG with html-to-image.
- **Themes.** Each person picks a style (Modern, Minimal, Boxworld, Terminal, or Blueprint: fonts, corners, borders, and shadows), a color theme (Standard, Ocean, Forest, Sunset, Grape, Fire, Beach, Mountain, Plum, Obsidian), light, dark, or match-my-device, and a background tinted from the theme color (None, Glow, Aurora, Dots, Grain, Waves, Starfield, Cityscape, Farm, or Cornershot; Aurora, Waves, Starfield, and Cornershot move slowly and Farm's windmill turns) in **Settings**. It's saved to their account. The login page, and anyone who hasn't picked, get the default from Admin → Settings. The palettes are in section 2 of `public/timeapp.css`; to add a color, add its light and dark blocks there and its name to `themes.js`.
- **Settings.** Admin → Settings saves the timezone, clock format, week start, default style, color theme, light/dark mode, and background, login length, failed-login locking, grace minutes, and request options in the database. `config.js` holds the defaults.
- **Sessions** are rows in the `sessions` table; the browser holds the id in a signed cookie. Each row records when it was last used and the address and user agent it started from. Logging out, deactivation, password resets, and an admin on Admin → Logins delete rows, which ends those sessions immediately.
- **Failed logins** are counted on the account (`users.failed_logins`). Enough wrong passwords in a row sets `users.locked_until`, and until then every login is refused, right password or not. A successful login, a quiet stretch as long as the attempt window, or an admin clears the count. The limits are in Admin → Settings.
- **Timestamps** are stored as ISO 8601 UTC text and shown in the configured timezone.
- **Database changes** are numbered migrations in `db/connection.js`, run at startup (`PRAGMA user_version` tracks which have run). To change the schema, add a new migration to the end of the list.

# Features
- **Clock Portal** - Clock in or out, or go on/return from your break(s).
- **Employee Portal** - View, manage, and export your shifts. Add notes to shifts and request edits to be approved.
- **Profile and Settings** - From the menu under your name: view and edit your profile, set your availability, see upcoming mandatory shifts, change your password and theme, and export all your shift data as CSV.
- **Admin Console** - View and manage employee accounts, assign people as managers or admins, modify employee shifts, and change configurable interface options.
- **Login security** - See who's signed in and on what, end any session or log everyone out, and lock accounts automatically after repeated wrong passwords (Admin → Logins).
- **Manager Console** - View and modify employee shifts, approve/deny shift edit requests, assign mandatory shifts, and edit allowed breaks.
- **Employee Management** - Admins and managers can view/approve/deny an employees punch edit requests, view/edit their punches/shifts, and export their shift data. Admins can also modify their profile information.
- **Shift Export** - Employees can export a PDF or image displaying their punches and shifts for the day/week/month (selectable), admins can do the same from the employees "Manage Employee" page