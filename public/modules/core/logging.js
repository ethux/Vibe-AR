// ─── Debug logging ───

export function log(msg) {
  console.log(msg);
  const el = document.getElementById('debug-log');
  if (el) { el.textContent += msg + '\n'; el.scrollTop = el.scrollHeight; }
  fetch('/api/log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ msg }),
  }).catch(() => {});
}

export function setStatus(text) {
  const el = document.getElementById('status');
  if (el) el.textContent = text;
  log(`[STATUS] ${text}`);
}

window.onerror = (m, s, l, c, e) => log(`[ERR] ${m} at ${s}:${l}:${c}`);
window.addEventListener('unhandledrejection', e => log(`[ERR] ${e.reason}`));
