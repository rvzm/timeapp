// Login, logout, and the "/" redirect.
import express from "express";
import * as time from "../time.js";
import { checkLogin, startSession, endSession, homePath, isLockedForever } from "../auth.js";

const router = express.Router();

router.get("/", (req, res) => {
  res.redirect(req.user ? homePath(req.user) : "/login");
});

router.get("/login", (req, res) => {
  if (req.user) return res.redirect(homePath(req.user));
  res.render("login", { title: "Log in", error: null, username: "" });
});

router.post("/login", (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");

  const { user, lockedUntil } = checkLogin(username, password);
  if (!user) {
    // A locked account says so: the person needs to know waiting (or an admin) is the way in.
    const error = lockedUntil
      ? isLockedForever(lockedUntil)
        ? "This account is locked after too many failed logins. Ask an admin to unlock it."
        : `This account is locked after too many failed logins. Try again after ${time.formatTime(lockedUntil)}.`
      : "Invalid username or password.";
    return res.status(lockedUntil ? 429 : 401).render("login", { title: "Log in", error, username });
  }

  startSession(req, res, user.id);
  res.redirect(homePath(user));
});

router.post("/logout", (req, res) => {
  endSession(req, res);
  res.redirect("/login");
});

export default router;
