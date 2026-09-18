// Creates accounts from the command line, and builds a throwaway "mock" database with
// generated people and history in it to look at.
//
// Usage:
//   npm run seed -- user <username> [password] [options]
//       --role employee|manager|admin   (default: admin)
//       --name "Ada Lovelace"           display name
//       --title "Shift Lead"            job title
//       --emp 042                       employee number
//       --email a@b.c   --phone 555-0100
//     Leave the password out and a random one is generated and printed once.
//
//   npm run seed -- mock [options]      build data/seeded_mock.sqlite and fill it
//       --employees N  --managers N  --admins N   how many of each (config.js has the defaults)
//       --teams N      --weeks N                  teams to create, weeks of punch history
//       --file <path>  where to write it; the file name has to contain "mock"
//       --force        replace the mock file if it's already there
//       --no-master    skip the fixed "master" account
//       --refresh      re-download the username lists instead of using the cached copies
//       --seed N       build the same database every time from this number
//
//   npm run seed -- <username> [password]   shorthand for: user <username> --role admin
//
// `mock` never writes to the real database: it points TIMEAPP_DB_FILE at its own file
// first, and refuses any target that looks like a production one. To run what it built:
//   env TIMEAPP_DB_FILE=data/seeded_mock.sqlite npm run serve
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { db_config, seed_config } from "./config.js";

const root = path.dirname(fileURLToPath(import.meta.url));
const relative = (file) => path.relative(process.cwd(), file) || file;

class Stop extends Error {} // an expected reason to stop: printed without a stack trace

const USAGE = `Usage:
  npm run seed -- user <username> [password] [--role employee|manager|admin]
                    [--name "Ada Lovelace"] [--title "Shift Lead"] [--emp 042]
                    [--email a@b.c] [--phone 555-0100]
  npm run seed -- mock [--employees N] [--managers N] [--admins N] [--teams N] [--weeks N]
                    [--file <path>] [--force] [--no-master] [--refresh] [--seed N]
  npm run seed -- <username> [password]     shorthand for: user <username> --role admin

Run a mock database with:  env TIMEAPP_DB_FILE=${seed_config.mockFile} npm run serve`;

// ===================================================================
// ===== Arguments =====
// ===================================================================

const VALUE_FLAGS = new Set([
  "role", "name", "title", "emp", "email", "phone",
  "file", "employees", "managers", "admins", "teams", "weeks", "seed",
]);
const BOOL_FLAGS = new Set(["force", "no-master", "refresh", "help"]);

// Returns { words, flags }. Flags are --key value or --key=value; unknown ones stop the run.
function parseArgs(argv) {
  const words = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      words.push(arg);
      continue;
    }
    const [name, inline] = arg.slice(2).split(/=(.*)/s);
    if (BOOL_FLAGS.has(name)) {
      flags[name] = true;
    } else if (VALUE_FLAGS.has(name)) {
      const value = inline ?? argv[++i];
      if (value === undefined) throw new Stop(`--${name} needs a value.\n\n${USAGE}`);
      flags[name] = value;
    } else {
      throw new Stop(`Unknown option --${name}.\n\n${USAGE}`);
    }
  }
  return { words, flags };
}

// A whole number from a flag, falling back to the config default.
function count(value, fallback, label) {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new Stop(`${label} has to be a whole number, 0 or more.`);
  return n;
}

// ===================================================================
// ===== seed user =====
// ===================================================================

async function createOne({ words, flags }) {
  const [username, password] = words;
  if (!username) throw new Stop(`Which username?\n\n${USAGE}`);

  const [db, { hashPassword, validateAccount, validatePassword }, { nowIso }] = await Promise.all([
    import("./db.js"),
    import("./auth.js"),
    import("./time.js"),
  ]);

  const role = flags.role ?? "admin";
  if (!db.ROLES.includes(role)) throw new Stop(`--role has to be one of: ${db.ROLES.join(", ")}.`);

  const generated = !password;
  const secret = password || crypto.randomBytes(12).toString("base64url");
  const fields = {
    username,
    role,
    display_name: flags.name ?? "",
    job_title: flags.title ?? "",
    employee_number: flags.emp ?? "",
    email: flags.email ?? "",
    phone: flags.phone ?? "",
  };

  const error = validateAccount(fields) || validatePassword(secret);
  if (error) throw new Stop(`Not created: ${error}`);

  db.insertUser({ ...fields, passwordHash: hashPassword(secret), createdAt: nowIso() });

  console.log(`${db.ROLE_LABELS[role]} "${username}" created.`);
  if (generated) console.log(`Password: ${secret}   <- shown once, write it down`);
  return 0;
}

// ===================================================================
// ===== seed mock =====
// ===================================================================

const sidecars = (file) => [file, `${file}-wal`, `${file}-shm`];

// Where the mock database goes, once we're sure it can't be a real one.
function mockTarget(fileFlag, force) {
  const setting = fileFlag ?? seed_config.mockFile ?? "data/seeded_mock.sqlite";
  const target = path.resolve(root, setting);
  const real = path.resolve(root, db_config.file);

  if (target === real) {
    throw new Stop(`Refusing to seed ${relative(target)}: that's the database the app runs on (db_config.file).`);
  }
  if (!/mock/i.test(path.basename(target))) {
    throw new Stop(
      `Refusing to seed ${relative(target)}: a mock database's file name has to contain "mock", ` +
      "so it can never be mistaken for a real one.",
    );
  }
  if (fs.existsSync(target)) {
    if (!force) {
      throw new Stop(`${relative(target)} already exists. Add --force to replace it, or pass --file <path>.`);
    }
    for (const file of sidecars(target)) fs.rmSync(file, { force: true });
  }
  return target;
}

// username / name / role / password, lined up.
function table(rows, headers) {
  const all = [headers, ...rows];
  const widths = headers.map((_, i) => Math.max(...all.map((row) => String(row[i]).length)));
  const line = (row) => "  " + row.map((cell, i) => String(cell).padEnd(widths[i])).join("  ").trimEnd();
  return [line(headers), "  " + widths.map((w) => "-".repeat(w)).join("  "), ...rows.map(line)].join("\n");
}

function writeUserList(file, target, accounts) {
  const rows = accounts.map((a) => [a.username, a.displayName, a.role, a.team || "-", a.employeeNumber, a.password]);
  const body = [
    `TimeApp mock database: ${relative(target)}`,
    `Seeded ${new Date().toISOString()}`,
    "Every generated account and its password. This is test data; don't reuse it anywhere real.",
    "",
    table(rows, ["username", "name", "role", "team", "emp#", "password"]),
    "",
  ].join("\n");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
}

async function seedMock({ flags }) {
  const counts = {
    employees: count(flags.employees, seed_config.mockEmployees ?? 24, "--employees"),
    managers: count(flags.managers, seed_config.mockManagers ?? 4, "--managers"),
    admins: count(flags.admins, seed_config.mockAdmins ?? 2, "--admins"),
  };
  const teams = count(flags.teams, seed_config.mockTeams ?? 3, "--teams");
  const weeks = count(flags.weeks, seed_config.mockWeeks ?? 2, "--weeks");
  const master = flags["no-master"] !== true;
  if (!master && counts.admins === 0) {
    throw new Stop("With --no-master you need at least one admin (--admins 1) or there's no way to log in.");
  }

  const target = mockTarget(flags.file, flags.force === true);

  // Everything below has to load *after* this, so db/connection.js opens the mock file.
  process.env.TIMEAPP_DB_FILE = target;
  console.log(`Seeding ${relative(target)}\n`);

  const mock = await import("./mockseed.js"); // pulls in db.js, auth.js and settings.js
  const db = await import("./db.js");

  const seed = flags.seed === undefined ? crypto.randomInt(2 ** 31) : Number(flags.seed);
  if (!Number.isInteger(seed)) throw new Stop("--seed has to be a whole number.");
  const rng = mock.makeRng(seed);

  const takeName = await mock.createNamer({ counts, rng, refresh: flags.refresh === true });
  const { accounts, teams: madeTeams, requestCount } = mock.buildMockDatabase({
    counts, teams, weeks, rng, master, takeName,
  });

  const punches = db.db.prepare("SELECT COUNT(*) AS n FROM punches").get().n;
  const shifts = db.db.prepare("SELECT COUNT(*) AS n FROM scheduled_shifts").get().n;
  const many = (n, one, more = `${one}s`) => `${n} ${n === 1 ? one : more}`;
  console.log(
    `Seeded ${many(accounts.length, "account")} (${many(counts.employees, "employee")}, ` +
    `${many(counts.managers, "manager")}, ${many(counts.admins, "admin")}${master ? " + master" : ""}), ` +
    `${many(madeTeams.length, "team")}, ${many(punches, "punch", "punches")}, ` +
    `${many(shifts, "mandatory shift")}, ${many(requestCount, "edit request")}.`,
  );
  console.log(`Schema version ${db.db.pragma("user_version", { simple: true })}, random seed ${seed}.\n`);

  const keys = accounts.filter((a) => a.role === "admin");
  console.log("Accounts you can administer with:");
  console.log(table(keys.map((a) => [a.username, a.displayName, a.role, a.password]), ["username", "name", "role", "password"]));

  const listFile = path.resolve(root, seed_config.userListFile ?? "data/seeded_db_userlist.txt");
  writeUserList(listFile, target, accounts);
  console.log(`\nEvery account and password: ${relative(listFile)}`);
  console.log(`Run it with:  env TIMEAPP_DB_FILE=${relative(target)} npm run serve`);
  return 0;
}

// ===================================================================
// ===== Main =====
// ===================================================================

async function main() {
  const argv = process.argv.slice(2);
  const { words, flags } = parseArgs(argv);
  if (flags.help) {
    console.log(USAGE);
    return 0;
  }
  if (!words.length) {
    console.error(USAGE);
    return 1;
  }

  const command = words[0];
  if (command === "mock") return seedMock({ flags });
  // "user <name>", or the old shorthand where the first word is the username itself.
  return createOne({ words: command === "user" ? words.slice(1) : words, flags });
}

try {
  process.exitCode = await main();
} catch (err) {
  if (err instanceof Stop) {
    console.error(err.message);
    process.exitCode = 1;
  } else {
    throw err;
  }
}
