// TimeApp web server: sets up Express, shared middleware, and mounts the routes.
import express from "express";
import cookieParser from "cookie-parser";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app_config, server_config, session_config, cornershot_config } from "./config.js";
import * as db from "./db.js";
import * as time from "./time.js";
import { getSettings } from "./settings.js";
import { getBroadcast } from "./broadcast.js";
import * as permissions from "./permissions.js";
import { loadUser } from "./auth.js";
import { KIND_LABELS, REQUEST_STATUS_LABELS, pendingRequestsFor } from "./requests.js";
import { TIME_OFF_STATUS_LABELS, pendingTimeOffFor } from "./timeoff.js";
import {
  THEME_STYLES, THEME_STYLE_LABELS, THEME_COLORS, THEME_COLOR_LABELS, THEME_MODES, THEME_MODE_LABELS,
  THEME_BACKGROUNDS, THEME_BACKGROUND_LABELS, themeFor, cornershotStyle,
} from "./themes.js";
import authRoutes from "./routes/auth.js";
import clockRoutes from "./routes/clock.js";
import portalRoutes from "./routes/portal.js";
import accountRoutes from "./routes/account.js";
import notesRoutes from "./routes/notes.js";
import manageRoutes from "./routes/manage.js";
import adminRoutes from "./routes/admin.js";
import broadcastRoutes from "./routes/broadcast.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.disable("x-powered-by");
app.set("query parser", "simple"); // plain ?key=value only; we don't need nested query objects

// Available in every template.
Object.assign(app.locals, {
  appConfig: app_config,
  fmt: time,
  displayName: db.displayName,
  statusFromPunch: db.statusFromPunch,
  isAdmin: permissions.isAdmin,
  isManagerOrAdmin: permissions.isManagerOrAdmin,
  ROLES: db.ROLES,
  ROLE_LABELS: db.ROLE_LABELS,
  PUNCH_TYPES: db.PUNCH_TYPES,
  PUNCH_LABELS: db.PUNCH_LABELS,
  STATUS_LABELS: db.STATUS_LABELS,
  KIND_LABELS,
  REQUEST_STATUS_LABELS,
  TIME_OFF_STATUS_LABELS,
  THEME_STYLES,
  THEME_STYLE_LABELS,
  THEME_COLORS,
  THEME_COLOR_LABELS,
  THEME_MODES,
  THEME_MODE_LABELS,
  THEME_BACKGROUNDS,
  THEME_BACKGROUND_LABELS,
  // The Cornershot background's config.js settings, as CSS variables (views/partials/head.ejs).
  cornershotStyle: cornershotStyle(cornershot_config, app_config.name),
});

app.use(express.static(path.join(__dirname, "public")));
// html-to-image's browser build, for the timesheet's "Download image" button.
app.use("/vendor/html-to-image", express.static(path.join(__dirname, "node_modules/html-to-image/dist")));
// For the theme styles: Open Props (shadow, radius, and easing scales) and the self-hosted fonts.
app.use("/vendor/open-props", express.static(path.join(__dirname, "node_modules/open-props")));
for (const font of ["inter", "jetbrains-mono", "space-grotesk"]) {
  app.use(`/vendor/fonts/${font}`, express.static(path.join(__dirname, "node_modules/@fontsource-variable", font)));
}
app.use(express.urlencoded({ extended: false }));
app.use((req, res, next) => {
  req.body ??= {}; // a POST with no form data leaves req.body undefined; routes can always read req.body.x
  next();
});
app.use(cookieParser(session_config.secret));
app.use((req, res, next) => {
  res.locals.path = req.path;
  res.locals.settings = getSettings();
  // Pages show per-user data. Don't let the back button show them after logout.
  res.set("Cache-Control", "no-store");
  next();
});
app.use(loadUser);
app.use((req, res, next) => {
  // The page's theme: the user's own, or the app default (also used when logged out).
  res.locals.theme = themeFor(req.user, getSettings());
  // For the badge on the Manage link: punch edit requests and requests off.
  res.locals.pendingRequestCount = permissions.isManagerOrAdmin(req.user)
    ? pendingRequestsFor(req.user).length + pendingTimeOffFor(req.user).length
    : 0;
  // The site broadcast, if an admin has one up. Everyone sees it, logged in or not.
  res.locals.broadcast = getBroadcast();
  next();
});

app.use(authRoutes);
app.use(broadcastRoutes);
app.use(clockRoutes);
app.use(notesRoutes);
app.use(accountRoutes);
app.use("/portal", portalRoutes);
app.use("/manage", manageRoutes);
app.use("/admin", adminRoutes);

app.use((req, res) => {
  res.status(404).render("error", { title: "Not found", message: "That page doesn't exist." });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render("error", { title: "Something went wrong", message: "The server hit an error. Check the server log." });
});

if (session_config.secret === "changeme") {
  console.warn("WARNING: session_config.secret is still \"changeme\". Set a long random string in config.js.");
}

const server = app.listen(server_config.port, server_config.host, () => {
  console.log(`${app_config.name} v${app_config.version} listening on http://${server_config.host}:${server_config.port} (timezone: ${time.timeZone})`);
});

// `npm stop` sends SIGTERM (Ctrl+C sends SIGINT): finish open requests, close the database, exit.
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.once(signal, () => {
    console.log(`${signal} received, shutting down.`);
    server.close(() => {
      db.db.close();
      process.exit(0);
    });
    server.closeAllConnections?.(); // don't wait on idle keep-alive browser connections
  });
}
