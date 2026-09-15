// Backs up the database and config.js into backup/, ready for `npm run migrate` after an update.
// Usage: npm run backup
// Safe while the server is running: the database is copied with SQLite's backup API, which
// takes a consistent snapshot. The previous backup, if there is one, moves to backup/previous/.
// backup/ holds your session secret and everyone's data, so keep it private.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { db_config } from "./config.js";

const root = path.dirname(fileURLToPath(import.meta.url));
const folder = path.join(root, "backup");
const previous = path.join(folder, "previous");
const dbFile = path.resolve(root, db_config.file);
const relative = (file) => path.relative(process.cwd(), file) || file;

// Keep one earlier backup.
const existing = fs.existsSync(folder) ? fs.readdirSync(folder).filter((name) => name !== "previous") : [];
if (existing.length) {
  fs.rmSync(previous, { recursive: true, force: true });
  fs.mkdirSync(previous, { recursive: true });
  for (const name of existing) fs.renameSync(path.join(folder, name), path.join(previous, name));
  console.log(`Moved the earlier backup to ${relative(previous)}/.`);
}
fs.mkdirSync(folder, { recursive: true });

if (fs.existsSync(dbFile)) {
  const dest = path.join(folder, path.basename(dbFile));
  const source = new Database(dbFile, { fileMustExist: true });
  try {
    await source.backup(dest);
  } finally {
    source.close();
  }

  // Keep the copy as one self-contained file (no -wal/-shm beside it), then read its details.
  const copy = new Database(dest);
  copy.pragma("journal_mode = DELETE");
  const count = (table) => copy.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  console.log(`Database: ${relative(dest)} (schema version ${copy.pragma("user_version", { simple: true })}, ${count("users")} users, ${count("punches")} punches)`);
  copy.close();
} else {
  console.log(`No database at ${relative(dbFile)} yet, so only config.js was backed up.`);
}

fs.copyFileSync(path.join(root, "config.js"), path.join(folder, "config.js"));
console.log(`Config:   ${relative(path.join(folder, "config.js"))}`);
console.log("Keep backup/ private: it holds your session secret and everyone's data.");
console.log("After updating TimeApp, run: npm run migrate");
