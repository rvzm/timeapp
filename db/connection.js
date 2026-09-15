// Opens the SQLite database, creates the base tables, and runs migrations.
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db_config } from "../config.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dbPath = path.resolve(projectRoot, db_config.file);
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// ===================================================================
// ===== Base schema (version 0) =====
// The original tables. Everything since is a migration below, so a brand-new
// database and an old one end up identical.
// All timestamps are ISO 8601 UTC text (see time.js).
// ===================================================================

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name  TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'employee' CHECK (role IN ('employee', 'admin')),
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS punches (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id   INTEGER NOT NULL REFERENCES users(id),
  type      TEXT NOT NULL CHECK (type IN ('clock_in', 'clock_out', 'break_start', 'break_end')),
  timestamp TEXT NOT NULL,
  edited_by INTEGER REFERENCES users(id), -- NULL = punched by the employee; otherwise who added/changed it
  note      TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_punches_user_time ON punches(user_id, timestamp);
`);

// ===================================================================
// ===== Migrations =====
// Each function upgrades the schema by one version; PRAGMA user_version records how
// many have run. To change the schema, add a new function to the END of the list.
// Never edit one that has already run somewhere: that database won't run it again.
// ===================================================================

const migrations = [
  // 1: manager role, profile fields, per-employee break limits, settings table.
  // SQLite can't change a CHECK constraint in place, so users is rebuilt.
  () => {
    db.exec(`
      CREATE TABLE users_new (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        username          TEXT NOT NULL UNIQUE COLLATE NOCASE,
        display_name      TEXT NOT NULL DEFAULT '',
        password_hash     TEXT NOT NULL,
        role              TEXT NOT NULL DEFAULT 'employee' CHECK (role IN ('employee', 'manager', 'admin')),
        active            INTEGER NOT NULL DEFAULT 1,
        created_at        TEXT NOT NULL,
        email             TEXT NOT NULL DEFAULT '',
        phone             TEXT NOT NULL DEFAULT '',
        job_title         TEXT NOT NULL DEFAULT '',
        employee_number   TEXT NOT NULL DEFAULT '',
        break_max_count   INTEGER,  -- NULL = use the default break rules
        break_max_minutes INTEGER   -- NULL = use the default break rules
      );
      INSERT INTO users_new (id, username, display_name, password_hash, role, active, created_at)
        SELECT id, username, display_name, password_hash, role, active, created_at FROM users;
      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;
      CREATE UNIQUE INDEX idx_users_employee_number ON users(employee_number) WHERE employee_number != '';

      CREATE TABLE settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL -- JSON
      );
    `);
  },

  // 2: shift notes and weekly availability.
  () => {
    db.exec(`
      CREATE TABLE shift_notes (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        punch_id   INTEGER NOT NULL REFERENCES punches(id) ON DELETE CASCADE, -- one of the shift's punches
        author_id  INTEGER NOT NULL REFERENCES users(id),
        body       TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_shift_notes_punch ON shift_notes(punch_id);

      CREATE TABLE availability (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        weekday    INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6), -- 0 = Sunday
        start_time TEXT NOT NULL, -- 'HH:MM'
        end_time   TEXT NOT NULL  -- 'HH:MM', later than start_time
      );
      CREATE INDEX idx_availability_user ON availability(user_id, weekday);
    `);
  },

  // 3: punch edit requests.
  () => {
    db.exec(`
      CREATE TABLE edit_requests (
        id                 INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id            INTEGER NOT NULL REFERENCES users(id),
        kind               TEXT NOT NULL CHECK (kind IN ('change', 'add', 'delete', 'add_shift')),
        punch_id           INTEGER REFERENCES punches(id) ON DELETE SET NULL, -- change/delete: the punch in question
        original_type      TEXT,  -- change/delete: the punch as it was when requested
        original_timestamp TEXT,
        type               TEXT CHECK (type IS NULL OR type IN ('clock_in', 'clock_out', 'break_start', 'break_end')),
        timestamp          TEXT,  -- change/add: the requested time; add_shift: clock-in time
        end_timestamp      TEXT,  -- add_shift: clock-out time
        reason             TEXT NOT NULL,
        status             TEXT NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'approved', 'auto_approved', 'denied', 'cancelled')),
        reviewed_by        INTEGER REFERENCES users(id),
        reviewed_at        TEXT,
        review_note        TEXT NOT NULL DEFAULT '',
        created_at         TEXT NOT NULL
      );
      CREATE INDEX idx_edit_requests_status ON edit_requests(status, created_at);
      CREATE INDEX idx_edit_requests_user ON edit_requests(user_id, created_at);
    `);
  },

  // 4: mandatory (assigned) shifts.
  () => {
    db.exec(`
      CREATE TABLE scheduled_shifts (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id     INTEGER NOT NULL REFERENCES users(id),
        start_at    TEXT NOT NULL,
        end_at      TEXT NOT NULL,
        note        TEXT NOT NULL DEFAULT '',
        assigned_by INTEGER NOT NULL REFERENCES users(id),
        created_at  TEXT NOT NULL,
        CHECK (end_at > start_at)
      );
      CREATE INDEX idx_scheduled_shifts_user ON scheduled_shifts(user_id, start_at);
      CREATE INDEX idx_scheduled_shifts_start ON scheduled_shifts(start_at);
    `);
  },

  // 5: each person's own theme (NULL = the app default). No CHECK constraint, so new
  // colors can be added in themes.js without another migration.
  () => {
    db.exec(`
      ALTER TABLE users ADD COLUMN theme_color TEXT;
      ALTER TABLE users ADD COLUMN theme_mode TEXT;
    `);
  },

  // 6: each person's own background style (NULL = the app default). No CHECK, like migration 5.
  () => {
    db.exec("ALTER TABLE users ADD COLUMN theme_background TEXT;");
  },

  // 7: each person's own theme style (NULL = the app default). No CHECK, like migration 5.
  () => {
    db.exec("ALTER TABLE users ADD COLUMN theme_style TEXT;");
  },

  // 8: the "ombre" style was renamed "modern". Settings values are stored as JSON.
  () => {
    db.exec(`
      UPDATE users SET theme_style = 'modern' WHERE theme_style = 'ombre';
      UPDATE settings SET value = '"modern"' WHERE key = 'defaultStyle' AND value = '"ombre"';
    `);
  },

  // 9: the "vanilla" color was replaced by "plum".
  () => {
    db.exec(`
      UPDATE users SET theme_color = 'plum' WHERE theme_color = 'vanilla';
      UPDATE settings SET value = '"plum"' WHERE key = 'defaultColor' AND value = '"vanilla"';
    `);
  },
];

function migrate() {
  const current = db.pragma("user_version", { simple: true });
  if (current > migrations.length) {
    throw new Error(`This database is from a newer version of TimeApp (schema ${current}; this version knows up to ${migrations.length}). Update TimeApp first.`);
  }
  if (current === migrations.length) return;

  // Rebuilding a table needs foreign key enforcement off, and that can only be
  // switched outside a transaction. foreign_key_check confirms nothing broke.
  db.pragma("foreign_keys = OFF");
  try {
    for (let version = current + 1; version <= migrations.length; version++) {
      db.transaction(() => {
        migrations[version - 1]();
        const problems = db.pragma("foreign_key_check");
        if (problems.length) throw new Error(`Migration ${version} broke foreign keys: ${JSON.stringify(problems)}`);
        db.pragma(`user_version = ${version}`);
      })();
      console.log(`Database migrated to version ${version}.`);
    }
  } finally {
    db.pragma("foreign_keys = ON");
  }
}

migrate();
