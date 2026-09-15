// Shift notes: add a note to a shift, or delete one. The forms live on the Portal and
// Manage Employee pages.
//   Add:    the shift's owner, or anyone who can manage their shifts
//   Delete: the note's author, or an admin
import express from "express";
import * as db from "../db.js";
import * as time from "../time.js";
import { requireLogin } from "../auth.js";
import { canManageShifts, isAdmin } from "../permissions.js";
import { toId, notFound, safeRedirect } from "./helpers.js";

const router = express.Router();
router.use("/notes", requireLogin);

const NOTE_MAX = 1000;

router.post("/notes", (req, res) => {
  const punch = db.getPunch(toId(req.body.punch_id));
  const owner = punch && db.getUserById(punch.user_id);
  if (!punch || (owner.id !== req.user.id && !canManageShifts(req.user, owner))) return notFound(res, "shift");

  const body = String(req.body.body ?? "").trim();
  if (!body || body.length > NOTE_MAX) {
    return res.status(400).render("error", { title: "Note not saved", message: `Notes must be 1–${NOTE_MAX} characters.` });
  }

  db.insertNote({ punchId: punch.id, authorId: req.user.id, body, createdAt: time.nowIso() });
  res.redirect(safeRedirect(req.body.back, "/portal"));
});

router.post("/notes/:id/delete", (req, res) => {
  const note = db.getNote(toId(req.params.id));
  if (!note || (note.author_id !== req.user.id && !isAdmin(req.user))) return notFound(res, "note");

  db.deleteNote(note.id);
  res.redirect(safeRedirect(req.body.back, "/portal"));
});

export default router;
