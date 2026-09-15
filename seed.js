// Creates an admin account.
// Usage: npm run seed -- <username> [password]
// If you leave out the password, a random one is generated and printed once.
import crypto from "node:crypto";
import * as db from "./db.js";
import { hashPassword, validateAccount, validatePassword } from "./auth.js";
import { nowIso } from "./time.js";

const [username, passwordArg] = process.argv.slice(2);

if (!username) {
  console.error("Usage: npm run seed -- <username> [password]");
  process.exit(1);
}

const password = passwordArg || crypto.randomBytes(12).toString("base64url");
const error = validateAccount({ username, role: "admin" }) || validatePassword(password);
if (error) {
  console.error(`Not created: ${error}`);
  process.exit(1);
}

db.insertUser({ username, role: "admin", passwordHash: hashPassword(password), createdAt: nowIso() });

console.log(`Admin "${username}" created.`);
if (!passwordArg) console.log(`Password: ${password}   <- shown once, write it down`);
