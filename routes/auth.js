// Login, logout, and the "/" redirect.
import express from "express";
import { checkLogin, startSession, endSession, homePath } from "../auth.js";

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

  const user = checkLogin(username, password);
  if (!user) {
    return res.status(401).render("login", { title: "Log in", error: "Invalid username or password.", username });
  }

  startSession(req, res, user.id);
  res.redirect(homePath(user));
});

router.post("/logout", (req, res) => {
  endSession(req, res);
  res.redirect("/login");
});

export default router;
