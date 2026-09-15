// Runs the server in the background, so `npm start` gives the terminal back.
// Usage: node daemon.js start | stop | restart | status
//   (npm start / npm stop / npm run restart / npm run status)
// The server's output goes to data/timeapp.log and its process id to data/timeapp.pid.
// To run in the foreground instead (e.g. under systemd or Docker): npm run serve
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { server_config } from "./config.js";

const root = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(root, "data");
const pidFile = path.join(dataDir, "timeapp.pid");
const logFile = path.join(dataDir, "timeapp.log");

const STARTUP_TIMEOUT_MS = 15000;
const STOP_TIMEOUT_MS = 10000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const relative = (file) => path.relative(process.cwd(), file) || file;

// ===================================================================
// ===== Process helpers =====
// ===================================================================

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM"; // exists, but belongs to someone else
  }
}

// The pid of the running server, or null. Clears a pid file left behind by a crash
// (or whose pid now belongs to some other program, where /proc lets us check).
function runningPid() {
  let pid;
  try {
    pid = Number(fs.readFileSync(pidFile, "utf8").trim());
  } catch {
    return null;
  }

  let ours = Number.isInteger(pid) && pid > 0 && isAlive(pid);
  if (ours) {
    try {
      ours = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").includes("server.js");
    } catch {
      // No /proc (macOS, Windows): trust the pid file.
    }
  }
  if (!ours) fs.rmSync(pidFile, { force: true });
  return ours ? pid : null;
}

// True if something accepts connections on the server's port.
function portInUse() {
  const host = ["0.0.0.0", "::", ""].includes(server_config.host) ? "localhost" : server_config.host;
  return new Promise((resolve) => {
    const socket = net.connect({ host, port: server_config.port });
    socket.setTimeout(1000);
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("timeout", () => { socket.destroy(); resolve(false); });
    socket.once("error", () => resolve(false));
  });
}

// The log's lines written since byte `from` (this start attempt), without the "=====" marker.
function logSince(from) {
  try {
    return fs.readFileSync(logFile).subarray(from).toString("utf8").split("\n").filter((line) => line && !line.startsWith("====="));
  } catch {
    return [];
  }
}

// ===================================================================
// ===== Commands =====
// ===================================================================

async function start() {
  const existing = runningPid();
  if (existing) {
    console.log(`Already running (pid ${existing}) on port ${server_config.port}.`);
    return 0;
  }
  if (await portInUse()) {
    console.error(`Not started: something else is already using port ${server_config.port}.`);
    return 1;
  }

  fs.mkdirSync(dataDir, { recursive: true });
  const logStart = fs.existsSync(logFile) ? fs.statSync(logFile).size : 0;
  const log = fs.openSync(logFile, "a");
  fs.writeSync(log, `\n===== Starting ${new Date().toISOString()} =====\n`);

  const child = spawn(process.execPath, [path.join(root, "server.js")], {
    cwd: root,
    detached: true, // its own process group, so closing this terminal doesn't stop it
    stdio: ["ignore", log, log],
    windowsHide: true,
  });
  fs.closeSync(log);

  let exitCode = null;
  child.once("exit", (code, signal) => { exitCode = code ?? signal; });

  // Wait until the server answers on its port, or gives up (e.g. a config error).
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (exitCode === null && Date.now() < deadline) {
    if (await portInUse()) {
      fs.writeFileSync(pidFile, `${child.pid}\n`);
      child.unref();
      for (const line of logSince(logStart)) console.log(line); // e.g. "listening on ..." and any warnings
      console.log(`Running in the background (pid ${child.pid}). Log: ${relative(logFile)}. Stop with: npm stop`);
      return 0;
    }
    await sleep(150);
  }

  if (exitCode === null) {
    child.kill();
    console.error(`Not started: the server didn't answer on port ${server_config.port} within ${STARTUP_TIMEOUT_MS / 1000}s.`);
  } else {
    console.error(`Not started: the server exited (${exitCode}).`);
  }
  const output = logSince(logStart).slice(-15);
  if (output.length) console.error(`Server output (full log: ${relative(logFile)}):\n${output.join("\n")}`);
  return 1;
}

async function stop() {
  const pid = runningPid();
  if (!pid) {
    console.log("Not running.");
    return 0;
  }

  process.kill(pid, "SIGTERM");
  const deadline = Date.now() + STOP_TIMEOUT_MS;
  while (isAlive(pid) && Date.now() < deadline) await sleep(100);
  if (isAlive(pid)) {
    console.error(`The server (pid ${pid}) didn't stop within ${STOP_TIMEOUT_MS / 1000}s. Forcing it.`);
    process.kill(pid, "SIGKILL");
  }

  fs.rmSync(pidFile, { force: true });
  console.log(`Stopped (pid ${pid}).`);
  return 0;
}

function status() {
  const pid = runningPid();
  if (!pid) {
    console.log("Not running.");
    return 3; // the usual "not running" status code
  }
  console.log(`Running (pid ${pid}) on http://${server_config.host}:${server_config.port}. Log: ${relative(logFile)}`);
  return 0;
}

const commands = {
  start,
  stop,
  restart: async () => (await stop()) || start(),
  status,
};

const command = commands[process.argv[2]];
if (!command) {
  console.error("Usage: node daemon.js start | stop | restart | status");
  process.exit(1);
}
process.exitCode = await command();
