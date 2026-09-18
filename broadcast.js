// Site-wide broadcast: one message an admin pins to every page for everyone.
// The message lives in this module's memory on purpose, not in the database, so
// stopping or restarting the server clears it. An admin can also clear it with
// the Dismiss Broadcast button in the header.

export const BROADCAST_MAX_LENGTH = 200;

let current = null; // { id, message, startedAt } while a broadcast is up
let nextId = 1;

export const getBroadcast = () => current;

export function startBroadcast(message) {
  // A fresh id every time, so a page that's already open can tell a new
  // broadcast from the one it's already showing.
  current = { id: nextId++, message, startedAt: new Date().toISOString() };
  return current;
}

export function clearBroadcast() {
  current = null;
}

// Validates the header's broadcast form. Returns { message, error }.
export function readBroadcastForm(body) {
  const message = String(body.message ?? "").trim();

  let error = null;
  if (!message) {
    error = "Type a message to broadcast.";
  } else if (message.length > BROADCAST_MAX_LENGTH) {
    error = `Keep the broadcast under ${BROADCAST_MAX_LENGTH} characters.`;
  }
  return { message, error };
}
