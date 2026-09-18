// Small helpers shared by the route files.
import * as time from "../time.js";

// Returns a positive integer id from a route param or form field, or null.
export function toId(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function notFound(res, what) {
  return res.status(404).render("error", { title: "Not found", message: `That ${what} doesn't exist.` });
}

// Reads a from/to date range from a query string or form body.
// Missing or invalid dates fall back to `fallbackDate` (default: today).
export function readRange(src, fallbackDate = time.localDate()) {
  let from = time.isValidDate(src.from) ? src.from : fallbackDate;
  let to = time.isValidDate(src.to) ? src.to : from;
  if (to < from) [from, to] = [to, from];
  return { from, to };
}

// A Portal or Manage URL from a form's `back` field, or `fallback`. Never another site.
export function safeRedirect(value, fallback) {
  const url = String(value ?? "");
  return /^\/(portal|manage)(\/|\?|$)/.test(url) ? url : fallback;
}

// Any page on this site from a form's `back` field, or `fallback`. Never another site.
// For forms like the header's broadcast buttons, which submit from every page.
export function safePath(value, fallback) {
  const url = String(value ?? "");
  // No backslashes: browsers read a leading "/\" the same as "//", i.e. another site.
  return /^\/(?!\/)[\w\-./?=&%]*$/.test(url) ? url : fallback;
}

// Keeps the current range if it already includes `date`, otherwise jumps to that day.
export function rangeIncluding(range, date) {
  return date >= range.from && date <= range.to ? range : { from: date, to: date };
}
