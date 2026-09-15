// Restores a backup (from `npm run backup`, or files you copied yourself) into this version of
// TimeApp:
//   - settings you changed in the backed-up config.js are carried into this config.js
//   - the backed-up database is put in place and upgraded to this version's schema
// Usage: npm run migrate [-- <folder>] [--dry-run] [--yes]
//   <folder>   where the backup is (default: backup/); it can hold config.js or config.js-bak,
//              and a .sqlite/.db file (with its -wal/-shm files, if any)
//   --dry-run  show what would change, and change nothing
//   --yes      don't ask before applying
// Stop the server first. Nothing is lost: the database it replaces is kept as
// <file>.before-migrate-<time>, and the config.js it edits as config.js.before-migrate.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_FILE = path.join(root, "config.js");
const PID_FILE = path.join(root, "data", "timeapp.pid");

// Setting values that were renamed. Keep these in step with the migrations in db/connection.js
// that rename the same values in the database.
const CONFIG_RENAMES = {
  "ui_config.defaultStyle": { ombre: "modern" },
  "ui_config.defaultColor": { vanilla: "plum" },
};

// Always taken from the new config.js, never from the backup.
const ALWAYS_NEW = new Set(["app_config.version"]);

const USAGE = `Usage: npm run migrate [-- <folder>] [--dry-run] [--yes]
  <folder>   where the backup is (default: backup/)
  --dry-run  show what would change, and change nothing
  --yes      don't ask before applying`;

const relative = (file) => path.relative(process.cwd(), file) || file;
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isLiteral = (value) =>
  value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value));
const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");

class Stop extends Error {} // an expected reason to stop: printed without a stack trace

// ===================================================================
// ===== Config =====
// ===================================================================

// Imports a config file as a module (from a temporary .mjs copy, so config.js-bak works too).
async function loadConfig(file) {
  const tmp = path.join(os.tmpdir(), `timeapp-config-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`);
  fs.copyFileSync(file, tmp);
  try {
    return { ...(await import(pathToFileURL(tmp).href)) };
  } catch (err) {
    throw new Stop(`Couldn't read ${relative(file)}: ${err.message}`);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

// Compares the backup's settings with this config.js (`current` is its values, `configText`
// its source). Returns:
//   changes  simple values that can be written into config.js
//   manual   values to set by hand, each with a `reason`: not a simple value, or not written
//            as a plain `key: value` line in config.js
//   unused   settings in the backup that this version no longer has
//   added    settings new in this version (they keep their defaults)
function planConfig(current, backup, configText) {
  const changes = [];
  const manual = [];
  const unused = [];
  const added = [];

  for (const [section, backupValues] of Object.entries(backup)) {
    if (!isObject(backupValues)) continue;
    for (const [key, backupValue] of Object.entries(backupValues)) {
      const name = `${section}.${key}`;
      if (!isObject(current[section]) || !(key in current[section])) {
        unused.push(name);
        continue;
      }
      if (ALWAYS_NEW.has(name)) continue;

      const renamed = CONFIG_RENAMES[name]?.[backupValue];
      const value = renamed ?? backupValue;
      const currentValue = current[section][key];
      if (JSON.stringify(value) === JSON.stringify(currentValue)) continue;

      const change = { section, key, name, from: currentValue, to: value, renamedFrom: renamed === undefined ? undefined : backupValue };
      if (!isLiteral(value) || !isLiteral(currentValue)) manual.push({ ...change, reason: "not a simple value" });
      else if (setInConfigText(configText, change) === null) manual.push({ ...change, reason: "not written as a plain `key: value` line in config.js" });
      else changes.push(change);
    }
  }

  for (const [section, values] of Object.entries(current)) {
    if (!isObject(values)) continue;
    for (const key of Object.keys(values)) {
      if (!isObject(backup[section]) || !(key in backup[section])) added.push(`${section}.${key}`);
    }
  }
  return { changes, manual, unused, added };
}

const LITERAL = String.raw`"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null`;
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Rewrites one `key: value` in config.js's text, keeping its spacing and comment.
// Returns the new text, or null if the setting isn't written as a plain `key: literal` line.
function setInConfigText(text, { section, key, to }) {
  const start = text.search(new RegExp(`^export const ${escapeRegExp(section)}\\s*=\\s*\\{`, "m"));
  if (start < 0) return null;
  const end = text.indexOf("\n};", start);
  if (end < 0) return null;

  const block = text.slice(start, end);
  const line = new RegExp(`^(\\s*${escapeRegExp(key)}\\s*:\\s*)(${LITERAL})`, "m").exec(block);
  if (!line) return null;

  const newBlock = block.slice(0, line.index) + line[1] + JSON.stringify(to) + block.slice(line.index + line[0].length);
  return text.slice(0, start) + newBlock + text.slice(end);
}

// How a value is shown in the preview. Secrets only show their length.
function show(name, value) {
  if (/secret|password|token/i.test(name) && typeof value === "string" && value !== "changeme") {
    return `(hidden, ${value.length} characters)`;
  }
  return JSON.stringify(value);
}

// ===================================================================
// ===== Database =====
// ===================================================================

// The database file in the backup folder: one named like this version's, or the only one there.
function findBackupDatabase(folder, fileName) {
  const named = path.join(folder, fileName);
  if (fs.existsSync(named)) return named;
  const found = fs.readdirSync(folder).filter((name) => /\.(sqlite3?|db)$/i.test(name));
  if (found.length > 1) {
    throw new Stop(`${relative(folder)} has more than one database file (${found.join(", ")}). Keep only one, or name it ${fileName}.`);
  }
  return found.length ? path.join(folder, found[0]) : null;
}

const sidecars = (file) => [file, `${file}-wal`, `${file}-shm`];

// The schema version of a database file, read from its header (bytes 60-63) without opening it:
// opening a WAL-mode database creates -wal/-shm files, and a dry run must not change anything.
// Returns null if the file isn't a SQLite database.
function schemaVersion(file) {
  try {
    const fd = fs.openSync(file, "r");
    try {
      const header = Buffer.alloc(100);
      if (fs.readSync(fd, header, 0, 100, 0) < 100 || header.toString("latin1", 0, 16) !== "SQLite format 3\0") return null;
      return header.readUInt32BE(60);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}

// ===================================================================
// ===== Is the server running? =====
// ===================================================================

function pidFileIsLive() {
  try {
    const pid = Number(fs.readFileSync(PID_FILE, "utf8").trim());
    if (!Number.isInteger(pid) || pid <= 0) return false;
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}

function portAnswers(host, port) {
  const target = ["0.0.0.0", "::", ""].includes(host) ? "localhost" : host;
  return new Promise((resolve) => {
    const socket = net.connect({ host: target, port });
    socket.setTimeout(1000);
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("timeout", () => { socket.destroy(); resolve(false); });
    socket.once("error", () => resolve(false));
  });
}

// ===================================================================
// ===== Main =====
// ===================================================================

async function main() {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((arg) => arg.startsWith("--")));
  if (flags.has("--help")) {
    console.log(USAGE);
    return 0;
  }
  const unknown = [...flags].filter((flag) => !["--dry-run", "--yes"].includes(flag));
  if (unknown.length) throw new Stop(`Unknown option ${unknown.join(", ")}.\n${USAGE}`);
  const dryRun = flags.has("--dry-run");
  const assumeYes = flags.has("--yes");

  const folderArg = args.find((arg) => !arg.startsWith("--"));
  const folder = folderArg ? path.resolve(process.cwd(), folderArg) : path.join(root, "backup");
  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
    throw new Stop(`No backup folder at ${relative(folder)}. Make one with \`npm run backup\`, or pass its path.\n${USAGE}`);
  }

  // ----- Plan -----
  const current = await loadConfig(CONFIG_FILE);
  const backupConfigFile = ["config.js", "config.js-bak"].map((name) => path.join(folder, name)).find((file) => fs.existsSync(file));
  const config = backupConfigFile
    ? planConfig(current, await loadConfig(backupConfigFile), fs.readFileSync(CONFIG_FILE, "utf8"))
    : null;

  // The database goes wherever the (merged) config says.
  const dbSetting = config?.changes.find((c) => c.name === "db_config.file")?.to ?? current.db_config?.file ?? "data/timeapp.sqlite";
  const dbFile = path.resolve(root, dbSetting);
  const backupDb = findBackupDatabase(folder, path.basename(dbFile));

  if (!backupConfigFile && !backupDb) {
    throw new Stop(`${relative(folder)} has no config.js (or config.js-bak) and no database file, so there's nothing to migrate.`);
  }

  if (pidFileIsLive() || (await portAnswers(current.server_config?.host ?? "localhost", current.server_config?.port ?? 3000))) {
    throw new Stop("TimeApp is running. Stop the server first (npm stop), then run this again.");
  }

  // ----- Preview -----
  console.log(`TimeApp migrate: from ${relative(folder)}/\n`);
  const nothingForConfig = !config || (!config.changes.length && !config.manual.length);

  if (config) {
    console.log(`Config: ${relative(backupConfigFile)} → config.js`);
    if (nothingForConfig) console.log("  No settings to carry over; your backup matches this config.js.");
    for (const change of config.changes) {
      const renamed = change.renamedFrom !== undefined ? ` (renamed from ${JSON.stringify(change.renamedFrom)})` : "";
      console.log(`  ${change.name}: ${show(change.name, change.from)} → ${show(change.name, change.to)}${renamed}`);
    }
    if (config.manual.length) {
      console.log("  Set these by hand:");
      for (const change of config.manual) console.log(`    ${change.name}: ${show(change.name, change.to)} (${change.reason})`);
    }
    if (config.unused.length) console.log(`  No longer used, skipped: ${config.unused.join(", ")}`);
    if (config.added.length) console.log(`  New in this version, keeping their defaults: ${config.added.join(", ")}`);
  } else {
    console.log("Config: no config.js in the backup; config.js is left as it is.");
  }

  let keptDbAs = null;
  if (backupDb) {
    const version = schemaVersion(backupDb);
    console.log(`\nDatabase: ${relative(backupDb)}${version === null ? "" : ` (schema version ${version})`} → ${relative(dbFile)}, upgraded to this version`);
    if (fs.existsSync(dbFile)) {
      keptDbAs = `${dbFile}.before-migrate-${stamp()}`;
      console.log(`  The current ${relative(dbFile)} will be kept as ${relative(keptDbAs)}`);
    }
  } else {
    console.log("\nDatabase: no database file in the backup; the database is left as it is.");
  }

  if (nothingForConfig && !backupDb) {
    console.log("\nNothing to do.");
    return 0;
  }
  if (dryRun) {
    console.log("\nDry run: nothing was changed.");
    return 0;
  }

  // ----- Confirm -----
  let selected = config?.changes ?? [];
  let restoreDb = Boolean(backupDb);
  if (!assumeYes) {
    if (!process.stdin.isTTY) throw new Stop("\nRun this in a terminal to confirm, or add --yes to apply without asking.");
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    // Answers come through the line iterator, which also keeps lines typed ahead of a question.
    const lines = rl[Symbol.asyncIterator]();
    const ask = async (question) => {
      rl.setPrompt(question);
      rl.prompt();
      const { value, done } = await lines.next();
      return done ? null : value.trim().toLowerCase(); // null = input closed (Ctrl+D)
    };
    const isYes = (answer) => answer === "y" || answer === "yes";
    try {
      const answer = await ask("\nApply? [y]es / [n]o / [c]hoose each: ");
      if (answer === "c" || answer === "choose") {
        selected = [];
        for (const change of config?.changes ?? []) {
          const reply = await ask(`  ${change.name} → ${show(change.name, change.to)}? [y/N] `);
          if (reply === null) break;
          if (isYes(reply)) selected.push(change);
        }
        restoreDb = backupDb ? isYes(await ask("  Restore and upgrade the database? [y/N] ")) : false;
      } else if (!isYes(answer)) {
        selected = [];
        restoreDb = false;
      }
    } finally {
      rl.close();
    }
    if (!selected.length && !restoreDb) {
      console.log("\nNothing was changed.");
      return 0;
    }
  }

  // ----- Apply the config -----
  const byHand = [...(config?.manual ?? [])];
  if (selected.length) {
    const original = fs.readFileSync(CONFIG_FILE, "utf8");
    let text = original;
    const applied = [];
    for (const change of selected) {
      const updated = setInConfigText(text, change);
      if (updated === null) byHand.push({ ...change, reason: "couldn't be updated automatically" });
      else {
        text = updated;
        applied.push(change);
      }
    }

    if (applied.length) {
      fs.writeFileSync(`${CONFIG_FILE}.before-migrate`, original);
      fs.writeFileSync(CONFIG_FILE, text);
      // Read it back to be sure the file still works and holds the new values.
      try {
        const check = await loadConfig(CONFIG_FILE);
        const wrong = applied.filter((c) => JSON.stringify(check[c.section]?.[c.key]) !== JSON.stringify(c.to));
        if (wrong.length) throw new Error(`these didn't read back correctly: ${wrong.map((c) => c.name).join(", ")}`);
      } catch (err) {
        fs.writeFileSync(CONFIG_FILE, original);
        throw new Stop(`Updating config.js failed, so it was put back as it was (${err.message}).`);
      }
      console.log(`\nconfig.js: carried over ${applied.length} setting${applied.length === 1 ? "" : "s"}; the previous file is config.js.before-migrate`);
    }
  }

  // ----- Apply the database -----
  if (backupDb && restoreDb) {
    fs.mkdirSync(path.dirname(dbFile), { recursive: true });
    const moved = [];
    if (keptDbAs) {
      sidecars(dbFile).forEach((file, i) => {
        if (fs.existsSync(file)) {
          const to = sidecars(keptDbAs)[i];
          fs.renameSync(file, to);
          moved.push([to, file]);
        }
      });
    }
    sidecars(backupDb).forEach((file, i) => {
      if (fs.existsSync(file)) fs.copyFileSync(file, sidecars(dbFile)[i]);
    });

    // Run the migrations in a fresh process, so it reads the config.js written above.
    console.log(`\nUpgrading ${relative(dbFile)}:`);
    const script = `
      let db;
      try {
        ({ db } = await import(${JSON.stringify(pathToFileURL(path.join(root, "db", "connection.js")).href)}));
      } catch (err) {
        console.error(err.message);
        process.exit(1);
      }
      const integrity = db.pragma("integrity_check", { simple: true });
      const count = (table) => db.prepare("SELECT COUNT(*) AS n FROM " + table).get().n;
      console.log("Schema version " + db.pragma("user_version", { simple: true }) + ", integrity " + integrity + ", " + count("users") + " users, " + count("punches") + " punches");
      db.close();
      if (integrity !== "ok") process.exit(2);`;
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], { cwd: root, stdio: "inherit" });

    if (child.status !== 0) {
      sidecars(dbFile).forEach((file) => fs.rmSync(file, { force: true }));
      for (const [from, to] of moved) fs.renameSync(from, to);
      throw new Stop(`The database couldn't be upgraded (see the error above). ${moved.length ? `${relative(dbFile)} was put back as it was.` : "Nothing was restored."}`);
    }
    if (keptDbAs && moved.length) console.log(`The previous database is kept as ${relative(keptDbAs)}`);
  }

  // ----- Summary -----
  if (byHand.length) {
    console.log("\nSet these in config.js by hand:");
    for (const change of byHand) console.log(`  ${change.name}: ${show(change.name, change.to)} (${change.reason})`);
  }
  console.log("\nDone. Start the server: npm start");
  return 0;
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
