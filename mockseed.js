// Builds the throwaway database behind `npm run seed -- mock`: username wordlists,
// generated accounts, teams, and enough plausible history to look at every page.
//
// Nothing in the server imports this file. seed.js loads it only after pointing
// TIMEAPP_DB_FILE at the mock file, so every insert below lands in that database and
// never in the real one.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { account_config, seed_config } from "./config.js";
import * as db from "./db.js";
import * as time from "./time.js";
import { USERNAME_RE, hashPassword } from "./auth.js";
import { reviewRequest } from "./requests.js";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const relative = (file) => path.relative(process.cwd(), file) || file;

// ===================================================================
// ===== Wordlists =====
// One name per line over http(s). Downloads are cached so later runs work offline,
// and a built-in list is always there as a last resort: seeding never fails because
// the network is down.
// ===================================================================

// Used whenever the matching seed_config value is missing or isn't an http(s) URL.
export const DEFAULT_URLS = {
  people: "https://raw.githubusercontent.com/jeanphorn/wordlist/master/usernames/common.txt",
  admin: "https://raw.githubusercontent.com/jeanphorn/wordlist/master/usernames/admin.txt",
};

const CACHE_DIR = path.join(projectRoot, "data", "wordlists");

// Names that sound like an account with the keys to the building. They're kept out of
// employee and manager usernames so "admin" stays a hint about the role.
const ADMIN_LIKE = /admin|adm1n|root|sudo|superuser|sysadmin|sysop|operator/i;

const FALLBACK_NAMES = [
  "avery", "bex", "cardoso", "dmitra", "elin", "fperez", "gus.hall", "hnwosu", "ianto", "jree",
  "kovacs", "lmarsh", "moss", "nadia.k", "oscar_b", "pham", "quill", "rbeck", "sofie", "tandy",
  "uma.r", "vega", "wren", "xu.lin", "yusuf", "zeb", "abelarde", "brizo", "cyn", "dalgleish",
  "esther.m", "finlay", "greer", "hollis", "ivo", "jansen", "kestrel", "lowry", "mireille", "nox",
];
const FALLBACK_ADMIN_NAMES = [
  "admin", "administrator", "root", "sysadmin", "superuser", "admin1",
  "operator", "sysop", "adminsrv", "rootadmin", "admin.ops", "superadmin",
];

// A github.com blob link points at an HTML page; its raw form is the actual text file.
function rawUrl(url) {
  const m = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/i.exec(url);
  return m ? `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}` : url;
}

// The configured URL if it's usable, otherwise the built-in default.
function urlOrDefault(value, fallback) {
  if (typeof value === "string" && value.trim()) {
    try {
      const url = new URL(rawUrl(value.trim()));
      if (url.protocol === "http:" || url.protocol === "https:") return url.href;
    } catch {
      // not a URL at all; fall through to the default
    }
  }
  return fallback;
}

const cacheFileFor = (url) => {
  const hash = crypto.createHash("sha1").update(url).digest("hex").slice(0, 12);
  const name = path.basename(new URL(url).pathname) || "list.txt";
  return path.join(CACHE_DIR, `${hash}-${name}`);
};

// Downloads a list (or reads the cached copy). Returns null when there's nothing to
// read at all, which means the caller uses the built-in names.
async function loadListText(url, { refresh, log }) {
  const cache = cacheFileFor(url);
  if (!refresh && fs.existsSync(cache)) {
    log(`  ${url}\n    from the cached copy at ${relative(cache)}`);
    return fs.readFileSync(cache, "utf8");
  }
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
    const text = await response.text();
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(cache, text);
    log(`  ${url}\n    downloaded, cached as ${relative(cache)}`);
    return text;
  } catch (err) {
    if (fs.existsSync(cache)) {
      log(`  ${url}\n    couldn't be downloaded (${err.message}); using the cached copy at ${relative(cache)}`);
      return fs.readFileSync(cache, "utf8");
    }
    log(`  ${url}\n    couldn't be downloaded (${err.message}); using the built-in name list instead`);
    return null;
  }
}

// Turns a wordlist into usernames this app will actually accept. Blank lines, comments,
// number-only names ("007", "11111"), and anything that isn't a valid username are
// dropped, and so are admin-sounding names unless the caller wants them. Matching is
// case-insensitive because users.username is UNIQUE COLLATE NOCASE.
export function cleanNames(text, { allowAdminLike = false } = {}) {
  const seen = new Set();
  const names = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const name = raw.trim();
    if (!name || name.startsWith("#")) continue;
    if (!USERNAME_RE.test(name)) continue;
    if (/^\d+$/.test(name)) continue;
    if (!allowAdminLike && ADMIN_LIKE.test(name)) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

// ===================================================================
// ===== Random helpers =====
// One seeded generator runs the whole build, so `--seed 7` gives the same database twice.
// ===================================================================

export function makeRng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const int = (rng, min, max) => min + Math.floor(rng() * (max - min + 1));
const pick = (rng, list) => list[Math.floor(rng() * list.length)];
const chance = (rng, probability) => rng() < probability;

function shuffled(rng, list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ===================================================================
// ===== Names and passwords =====
// ===================================================================

// "j.smith" -> "J Smith"
export const displayNameFor = (username) =>
  username.replace(/[._-]+/g, " ").replace(/\b[a-z]/g, (c) => c.toUpperCase()).trim() || username;

// Lookalike characters are left out so a password can be read off the screen and typed.
const PASSWORD_ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function makePassword(length = Math.max(account_config.minPasswordLength, 8)) {
  let out = "";
  for (let i = 0; i < length; i++) out += PASSWORD_ALPHABET[crypto.randomInt(PASSWORD_ALPHABET.length)];
  return out;
}

// The one account whose details never change, so there's always a way in.
export const MASTER = {
  username: "master",
  displayName: "Master",
  jobTitle: "System Master",
  employeeNumber: "001",
  role: "admin",
  password: "Master123",
};

// Which list each role draws from, and whether admin-sounding names are allowed in it.
function poolSpecFor(role) {
  const adminSpec = { url: urlOrDefault(seed_config.adminNamesUrl, DEFAULT_URLS.admin), allowAdminLike: true };
  if (seed_config.adminNamesForEveryone === true) return adminSpec;
  if (role === "admin") return adminSpec;
  if (role === "manager") {
    if (seed_config.managersUseAdminNames === true) return adminSpec;
    return { url: urlOrDefault(seed_config.managerNamesUrl, DEFAULT_URLS.people), allowAdminLike: false };
  }
  return { url: urlOrDefault(seed_config.employeeNamesUrl, DEFAULT_URLS.people), allowAdminLike: false };
}

// Loads the lists the requested roles need and hands out usernames, never the same one
// twice. `counts` is { employees, managers, admins }.
export async function createNamer({ counts, rng, refresh = false, log = console.log }) {
  if (seed_config.adminNamesForEveryone === true) {
    log('Heads up: seed_config.adminNamesForEveryone is on, so every account — employees included —');
    log("           gets an admin-style username. Turn it off for anything you'll show someone.\n");
  }

  const roles = ["employee", "manager", "admin"].filter((role) => counts[`${role}s`] > 0);
  const specs = new Map(); // one entry per distinct list, so a shared URL is only fetched once
  for (const role of roles) {
    const spec = poolSpecFor(role);
    specs.set(`${spec.url}|${spec.allowAdminLike}`, spec);
  }

  log("Username lists:");
  const pools = new Map();
  for (const [key, spec] of specs) {
    const text = await loadListText(spec.url, { refresh, log });
    const names = text === null
      ? cleanNames((spec.allowAdminLike ? FALLBACK_ADMIN_NAMES : FALLBACK_NAMES).join("\n"), spec)
      : cleanNames(text, spec);
    log(`    ${names.length} usable name${names.length === 1 ? "" : "s"}`);
    pools.set(key, { names: shuffled(rng, names), next: 0 });
  }
  log("");

  const used = new Set([MASTER.username]); // one namespace: every account shares the users table
  const claim = (name) => {
    const key = name.toLowerCase();
    if (used.has(key)) return null;
    used.add(key);
    return name;
  };

  return function takeName(role) {
    const spec = poolSpecFor(role);
    const pool = pools.get(`${spec.url}|${spec.allowAdminLike}`);
    while (pool.next < pool.names.length) {
      const name = claim(pool.names[pool.next++]);
      if (name) return name;
    }
    // A short list (admin.txt is 78 names) runs out fast; keep going as name2, name3...
    for (let suffix = 2; ; suffix++) {
      for (const base of pool.names) {
        const name = claim(`${base}${suffix}`.slice(0, 32));
        if (name) return name;
      }
    }
  };
}

// ===================================================================
// ===== The people =====
// ===================================================================

const TEAM_NAMES = [
  "Front of House", "Warehouse", "Support", "Night Crew",
  "Deliveries", "Back Office", "Maintenance", "Receiving",
];

const JOB_TITLES = {
  employee: ["Associate", "Clerk", "Line Cook", "Stocker", "Driver", "Technician", "Cashier", "Server"],
  manager: ["Shift Lead", "Floor Manager", "Team Lead", "Supervisor"],
  admin: ["Operations Admin", "HR Admin", "Systems Admin"],
};

const employeeNumber = (n) => String(n).padStart(3, "0");

// ===================================================================
// ===== History =====
// Punches are built from local wall-clock times so they land correctly in the
// configured timezone, the same way the app's own forms do.
// ===================================================================

const WORK_START = 9 * 60; // 9:00 am, give or take

// A local date plus minutes past its midnight, as an ISO UTC timestamp. Minutes past
// 24 h roll into the next day, which fromDatetimeLocal alone won't do.
function localIso(dateStr, minutes) {
  const days = Math.floor(minutes / 1440);
  const rest = minutes - days * 1440;
  const date = days ? time.addDays(dateStr, days) : dateStr;
  const hh = String(Math.floor(rest / 60)).padStart(2, "0");
  const mm = String(rest % 60).padStart(2, "0");
  return time.fromDatetimeLocal(`${date}T${hh}:${mm}`);
}

const isWeekday = (dateStr) => ![0, 6].includes(time.weekdayOf(dateStr));

// One person's day: clock in, a lunch break, sometimes a second one, clock out.
// Some punches are dropped on purpose so shifts with issues show up in the timesheets.
// An open shift keeps counting until now, so `openEnded` (one person, on the most recent
// day) is the only missing clock-out; any other day would put someone on a 60-hour week.
// Other days lose their clock-in instead, which flags the shift without running the clock up.
function punchOneDay(rng, userId, dateStr, { openEnded = false } = {}) {
  const start = WORK_START + int(rng, -25, 25);
  const lunchAt = start + int(rng, 200, 260);
  const lunchLength = int(rng, 25, 40);
  const end = start + int(rng, 450, 510) + lunchLength;

  const punches = [];
  if (openEnded || !chance(rng, 1 / 15)) punches.push({ type: "clock_in", at: start }); // forgot to clock in
  punches.push({ type: "break_start", at: lunchAt });
  if (!chance(rng, 1 / 20)) punches.push({ type: "break_end", at: lunchAt + lunchLength }); // forgot to end it
  if (chance(rng, 0.25)) {
    const short = end - int(rng, 90, 150);
    punches.push({ type: "break_start", at: short }, { type: "break_end", at: short + int(rng, 10, 15) });
  }
  if (!openEnded) punches.push({ type: "clock_out", at: end }); // openEnded = forgot to clock out

  for (const punch of punches.sort((a, b) => a.at - b.at)) {
    db.insertPunch({ userId, type: punch.type, timestamp: localIso(dateStr, punch.at) });
  }
  return { start, end };
}

// Today, so far: a few people are mid-shift or on a break right now, which is what the
// Clock page and the manager console are mostly about.
function punchToday(rng, userId, dateStr, nowMinutes) {
  const start = nowMinutes - int(rng, 70, 320);
  if (start < 5) return;
  db.insertPunch({ userId, type: "clock_in", timestamp: localIso(dateStr, start) });

  const breakAt = start + int(rng, 40, 180);
  if (breakAt < nowMinutes - 5) {
    db.insertPunch({ userId, type: "break_start", timestamp: localIso(dateStr, breakAt) });
    const breakEnd = breakAt + int(rng, 20, 35);
    // Leave a couple of people on break: no break_end yet.
    if (breakEnd < nowMinutes && !chance(rng, 0.3)) {
      db.insertPunch({ userId, type: "break_end", timestamp: localIso(dateStr, breakEnd) });
    }
  }
}

const REQUEST_REASONS = [
  "I forgot to clock out before I left.",
  "The tablet was frozen when my shift started.",
  "I clocked in at the wrong terminal.",
  "My break ran long because of a customer.",
  "I was covering the floor and missed the clock entirely.",
  "This punch is a duplicate.",
];

// A handful of punch edit requests: most still pending, a few already reviewed so the
// approved/denied lists have something in them. Reviews go through the real
// reviewRequest(), so approved ones actually move their punches.
function seedRequests(rng, workers, reviewers, fromIso, toIso) {
  const candidates = shuffled(rng, workers).slice(0, Math.min(8, workers.length));
  const created = [];

  for (const worker of candidates) {
    const punches = db.listPunchesBetween(worker.id, fromIso, toIso);
    if (!punches.length) continue;
    const punch = pick(rng, punches);
    if (db.getPendingRequestForPunch(punch.id)) continue;

    const reason = pick(rng, REQUEST_REASONS);
    const createdAt = time.nowIso();
    const roll = rng();
    let id;
    if (roll < 0.45) {
      // Move a punch by up to 25 minutes.
      const shifted = new Date(Date.parse(punch.timestamp) + int(rng, -25, 25) * 60_000).toISOString();
      if (shifted >= createdAt) continue;
      id = db.insertRequest({
        userId: worker.id, kind: "change", punchId: punch.id,
        originalType: punch.type, originalTimestamp: punch.timestamp,
        type: punch.type, timestamp: shifted, reason, createdAt,
      });
    } else if (roll < 0.65) {
      id = db.insertRequest({
        userId: worker.id, kind: "delete", punchId: punch.id,
        originalType: punch.type, originalTimestamp: punch.timestamp,
        reason: "This punch is a duplicate.", createdAt,
      });
    } else if (roll < 0.85) {
      // A missing clock-out, a few hours after an existing punch.
      const at = new Date(Date.parse(punch.timestamp) + int(rng, 120, 300) * 60_000).toISOString();
      if (at >= createdAt) continue;
      id = db.insertRequest({
        userId: worker.id, kind: "add", type: "clock_out", timestamp: at, reason, createdAt,
      });
    } else {
      // A whole shift that was never clocked at all.
      const day = time.addDays(time.localDate(punch.timestamp), -int(rng, 1, 3));
      const start = localIso(day, WORK_START);
      const end = localIso(day, WORK_START + 480);
      if (!start || !end || end >= createdAt) continue;
      id = db.insertRequest({
        userId: worker.id, kind: "add_shift", timestamp: start, endTimestamp: end,
        reason: "I was on the floor all day but never got to a terminal.", createdAt,
      });
    }
    created.push(id);
  }

  // Review a third of them; the rest stay pending, because the manager console is
  // more interesting with a queue waiting in it.
  for (const id of created.slice(0, Math.floor(created.length / 3))) {
    const reviewer = pick(rng, reviewers);
    const approve = chance(rng, 0.7);
    reviewRequest(reviewer, id, {
      approve,
      note: approve ? "Checked with the floor lead." : "Doesn't match the schedule — come see me.",
    });
  }
  return created.length;
}

// ===================================================================
// ===== Building the database =====
// ===================================================================

// Fills the (empty) database this process is connected to. `counts` is
// { employees, managers, admins }. Returns every account it made, passwords included.
export function buildMockDatabase({ counts, teams: teamCount, weeks, rng, master = true, takeName }) {
  const today = time.localDate();
  const historyFrom = time.addDays(today, -(weeks * 7));
  const createdAt = localIso(historyFrom, 8 * 60) ?? time.nowIso();

  return db.db.transaction(() => {
    const accounts = [];
    let nextNumber = master ? 1 : 0; // the Master keeps 001

    const addAccount = (role, fixed = null) => {
      const username = fixed?.username ?? takeName(role);
      const account = {
        username,
        displayName: fixed?.displayName ?? displayNameFor(username),
        role,
        jobTitle: fixed?.jobTitle ?? pick(rng, JOB_TITLES[role]),
        employeeNumber: fixed?.employeeNumber ?? employeeNumber(++nextNumber),
        password: fixed?.password ?? makePassword(),
        team: "",
      };
      account.id = db.insertUser({
        username: account.username,
        display_name: account.displayName,
        job_title: account.jobTitle,
        employee_number: account.employeeNumber,
        role,
        passwordHash: hashPassword(account.password),
        createdAt,
      });
      accounts.push(account);
      return account;
    };

    // The Master goes in first so it owns id 1 and employee number 001.
    if (master) addAccount(MASTER.role, MASTER);
    for (let i = 0; i < counts.admins; i++) addAccount("admin");
    const managers = Array.from({ length: counts.managers }, () => addAccount("manager"));
    const employees = Array.from({ length: counts.employees }, () => addAccount("employee"));

    // ----- Teams: managers round-robin, employees on exactly one team, admins on none -----
    const teams = [];
    for (let i = 0; i < teamCount; i++) {
      const base = TEAM_NAMES[i % TEAM_NAMES.length];
      const name = i < TEAM_NAMES.length ? base : `${base} ${Math.floor(i / TEAM_NAMES.length) + 1}`;
      teams.push({ id: db.insertTeam({ name, createdAt }), name, managers: [], employees: [] });
    }
    if (teams.length) {
      managers.forEach((manager, i) => {
        const team = teams[i % teams.length];
        db.addTeamMember(team.id, manager.id);
        team.managers.push(manager);
        manager.team = team.name;
      });
      employees.forEach((employee, i) => {
        const team = teams[i % teams.length];
        db.addTeamMember(team.id, employee.id);
        team.employees.push(employee);
        employee.team = team.name;
      });
    }

    // ----- Punch history for everyone who works a floor (admins don't) -----
    const workers = [...managers, ...employees];
    const nowMinutes = (() => {
      const [hh, mm] = time.toDatetimeLocal(time.nowIso()).slice(11).split(":").map(Number);
      return hh * 60 + mm;
    })();

    const workdays = [];
    for (let date = historyFrom; date < today; date = time.addDays(date, 1)) {
      if (isWeekday(date)) workdays.push(date);
    }
    // Exactly one person forgets to clock out, on the most recent day worked.
    const forgetful = workers.length ? pick(rng, workers) : null;
    workdays.forEach((date, i) => {
      const lastDay = i === workdays.length - 1;
      for (const worker of workers) {
        const openEnded = lastDay && worker === forgetful;
        if (openEnded || chance(rng, 0.85)) punchOneDay(rng, worker.id, date, { openEnded });
      }
    });
    if (isWeekday(today)) {
      for (const worker of workers) {
        if (chance(rng, 0.45)) punchToday(rng, worker.id, today, nowMinutes);
      }
    }

    // ----- Mandatory shifts: past ones to compare against, next week's to look forward to -----
    const assignerFor = (worker) => {
      const team = teams.find((t) => t.name === worker.team);
      return team?.managers[0] ?? managers[0] ?? accounts[0];
    };
    for (let date = historyFrom; date <= time.addDays(today, 7); date = time.addDays(date, 1)) {
      if (!isWeekday(date)) continue;
      for (const employee of employees) {
        if (!chance(rng, 0.55)) continue;
        db.insertScheduledShift({
          userId: employee.id,
          startAt: localIso(date, WORK_START),
          endAt: localIso(date, WORK_START + 480),
          note: chance(rng, 0.2) ? "Cover the front counter." : "",
          assignedBy: assignerFor(employee).id,
          createdAt,
        });
      }
    }

    // ----- Availability: a normal week for about half of them -----
    for (const employee of employees) {
      if (!chance(rng, 0.5)) continue;
      db.replaceAvailability(
        employee.id,
        [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: "08:00", end: "18:00" })),
      );
    }

    // ----- Punch edit requests -----
    const [fromIso, toIso] = time.dayRangeUtc(historyFrom, today);
    const reviewers = managers.length ? managers : accounts.filter((a) => a.role === "admin");
    const requestCount = reviewers.length ? seedRequests(rng, employees, reviewers, fromIso, toIso) : 0;

    return { accounts, teams, requestCount };
  })();
}
