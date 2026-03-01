// ─── Shared state — getters/setters to avoid circular imports ───

let xrSession = null;
let renderer = null;
let termTexture = null;
let term = null;
let termWs = null;

export function getXrSession() { return xrSession; }
export function setXrSession(v) { xrSession = v; }
export function getRenderer() { return renderer; }
export function setRenderer(v) { renderer = v; }
export function getTermTexture() { return termTexture; }
export function setTermTexture(v) { termTexture = v; }
export function getTerm() { return term; }
export function setTerm(v) { term = v; }
export function getTermWs() { return termWs; }
export function setTermWs(v) { termWs = v; }

// ─── Project-level state (explorer toggle, etc.) ───
let projectState = {
  explorerOpen: false,
};
export function getProjectState() { return projectState; }
export function setProjectState(key, val) { projectState[key] = val; }

// Window size in meters
export const WIN_W = 0.8;
export const WIN_H = 0.55;
export const TITLE_H = 0.05;

// Expose for debugging
window._debug = () => {
  if (!term) return 'no term';
  const buf = term.buffer.active;
  const lines = [];
  for (let i = 0; i < Math.min(term.rows, 5); i++) {
    const line = buf.getLine(buf.viewportY + i);
    if (line) lines.push(line.translateToString(false).substring(0, 80));
  }
  return { rows: term.rows, cols: term.cols, cx: buf.cursorX, cy: buf.cursorY, base: buf.baseY, vp: buf.viewportY, len: buf.length, lines, ws: termWs?.readyState, tex: !!termTexture };
};
