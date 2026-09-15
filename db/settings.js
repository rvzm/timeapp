// Saved settings: key/value rows, values stored as JSON. See settings.js for defaults and validation.
import { db } from "./connection.js";

const stmt = {
  listSettings: db.prepare("SELECT key, value FROM settings"),
  setSetting: db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT (key) DO UPDATE SET value = excluded.value`),
};

// { key: value } for every saved setting. Rows that aren't valid JSON are skipped.
export function loadSavedSettings() {
  const saved = {};
  for (const { key, value } of stmt.listSettings.all()) {
    try {
      saved[key] = JSON.parse(value);
    } catch {
      console.warn(`Ignoring unreadable setting "${key}".`);
    }
  }
  return saved;
}

export const saveSettingValues = db.transaction((values) => {
  for (const [key, value] of Object.entries(values)) stmt.setSetting.run(key, JSON.stringify(value));
});
