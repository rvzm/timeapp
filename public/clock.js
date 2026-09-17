// Clock page: keeps the shift and week durations counting up without a reload.
// Each [data-live-ms] element was rendered with its duration at page load; those with
// data-live-running add the time since then. Formatted like time.formatDuration.
const loadedAt = Date.now();

function formatDuration(ms) {
  const totalMinutes = Math.max(0, Math.floor(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = String(totalMinutes % 60).padStart(2, "0");
  return hours ? `${hours}h ${minutes}m` : `${totalMinutes}m`;
}

function tick() {
  for (const el of document.querySelectorAll("[data-live-ms][data-live-running]")) {
    el.textContent = formatDuration(Number(el.dataset.liveMs) + Date.now() - loadedAt);
  }
}

setInterval(tick, 15000);
