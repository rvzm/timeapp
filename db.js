// Database access. The code lives in db/, one file per area; this file re-exports all
// of it so the rest of the app can simply `import * as db from "./db.js"`.
//   db/connection.js  opens the file, base schema, migrations
//   db/users.js       accounts, roles, profile fields
//   db/sessions.js    login sessions
//   db/punches.js     punches and status rules
//   db/settings.js      saved settings
//   db/notes.js         shift notes
//   db/availability.js  weekly availability
//   db/requests.js      punch edit requests
//   db/schedule.js      mandatory (assigned) shifts
export { db } from "./db/connection.js";
export * from "./db/users.js";
export * from "./db/sessions.js";
export * from "./db/punches.js";
export * from "./db/settings.js";
export * from "./db/notes.js";
export * from "./db/availability.js";
export * from "./db/requests.js";
export * from "./db/schedule.js";
