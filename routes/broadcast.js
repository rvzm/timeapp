// Site broadcast: the admin-only buttons in the header (views/partials/nav.ejs) and the
// poll the toast uses to appear and disappear without a page load.
//
// GET /broadcast is the one JSON endpoint in the app, a deliberate exception to the
// "forms, not APIs" convention: a toast has to reach pages that are already open. It's
// unguarded because the toast also shows on the login page.
import express from "express";
import { requireAdmin } from "../auth.js";
import { getBroadcast, startBroadcast, clearBroadcast, readBroadcastForm } from "../broadcast.js";
import { safePath } from "./helpers.js";

const router = express.Router();

router.get("/broadcast", (req, res) => {
  const broadcast = getBroadcast();
  res.json(broadcast ? { id: broadcast.id, message: broadcast.message } : { id: null });
});

router.post("/broadcast", requireAdmin, (req, res) => {
  const { message, error } = readBroadcastForm(req.body);
  // The button lives in the header of every page, so there's no form page to send
  // them back to with the error on it.
  if (error) return res.status(400).render("error", { title: "Broadcast not sent", message: error });

  startBroadcast(message);
  res.redirect(safePath(req.body.back, "/"));
});

router.post("/broadcast/dismiss", requireAdmin, (req, res) => {
  clearBroadcast();
  res.redirect(safePath(req.body.back, "/"));
});

export default router;
