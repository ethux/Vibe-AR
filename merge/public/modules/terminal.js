// ─── xterm.js init + ttyd WebSocket ───
import { getTerm, setTerm, getTermWs, setTermWs } from './state.js';
import { log, setStatus } from './logging.js';
import { onTermOutput } from './tts.js';

// Terminal output listeners (for live-preview, etc.)
const _termOutputListeners = [];
export function addTermOutputListener(fn) { _termOutputListeners.push(fn); }

export async function initTerminal() {
  setStatus('Connecting to terminal...');

  let ttydBase = '/terminal';
  try {
    const res = await fetch('/api/config');
    const cfg = await res.json();
    if (cfg.ttydUrl) ttydBase = cfg.ttydUrl.replace(/\/$/, '');
  } catch (e) { log(`[TERM] config: ${e.message}`); }

  let token = '';
  try {
    const res = await fetch(`${ttydBase}/token`);
    const data = await res.json();
    token = data.token || '';
  } catch (e) { log(`[TERM] token: ${e.message}`); }

  const container = document.getElementById('xterm-container');
  const term = new window.Terminal({
    cols: 100, rows: 35, fontSize: 14,
    fontFamily: "'Courier New', monospace",
    theme: { background: '#0c0c12', foreground: '#e0e0e0', cursor: '#ff6b00' },
    allowTransparency: false,
  });
  term.open(container);
  setTerm(term);

  if (window.FitAddon) {
    const fa = new window.FitAddon.FitAddon();
    term.loadAddon(fa);
    try { fa.fit(); } catch {}
  }

  log(`[TERM] xterm: ${term.cols}x${term.rows}`);

  // Connect to ttyd
  const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${wsProto}//${location.host}${ttydBase}/ws${token ? '?token=' + token : ''}`;
  log(`[TERM] WS: ${wsUrl}`);

  const termWs = new WebSocket(wsUrl, ['tty']);
  termWs.binaryType = 'arraybuffer';
  setTermWs(termWs);

  const textEncoder = new TextEncoder();
  termWs.onopen = () => {
    log('[TERM] WS connected');
    setStatus('Terminal connected — tap START AR');
    const initMsg = JSON.stringify({ AuthToken: token, columns: term.cols, rows: term.rows });
    termWs.send(textEncoder.encode(initMsg));
    log(`[TERM] Sent auth+size: ${term.cols}x${term.rows}`);
  };
  termWs.onclose = () => { log('[TERM] WS closed'); setStatus('Terminal disconnected'); };
  termWs.onerror = () => { log('[TERM] WS error'); setStatus('Terminal error'); };

  const textDecoder = new TextDecoder();
  let msgCount = 0;
  termWs.onmessage = (evt) => {
    msgCount++;
    const data = evt.data;
    if (typeof data === 'string') {
      if (msgCount <= 3) log(`[TERM] str msg: ${data.substring(0, 60)}`);
      term.write(data);
    } else {
      const arr = new Uint8Array(data);
      const cmd = String.fromCharCode(arr[0]);
      const payload = arr.slice(1);
      if (msgCount <= 3) log(`[TERM] bin cmd='${cmd}' len=${payload.length}`);
      switch (cmd) {
        case '0': // OUTPUT
          term.write(payload);
          { const txt = textDecoder.decode(payload); onTermOutput(txt); for (const fn of _termOutputListeners) fn(txt); }
          break;
        case '1': // SET_WINDOW_TITLE
          document.title = textDecoder.decode(payload);
          break;
        case '2': // SET_PREFERENCES
          break;
      }
    }
  };

  // ttyd protocol: ASCII "0" + input data
  term.onData((data) => {
    const ws = getTermWs();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(textEncoder.encode('0' + data));
    }
  });

  // ttyd protocol: ASCII "1" + JSON resize
  term.onResize(({ cols, rows }) => {
    const ws = getTermWs();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(textEncoder.encode('1' + JSON.stringify({ columns: cols, rows })));
    }
  });
}

// ─── Terminal canvas for texture ───
const termRenderCanvas = document.createElement('canvas');
termRenderCanvas.width = 1024;
termRenderCanvas.height = 768;
const termRenderCtx = termRenderCanvas.getContext('2d');

let canvasSearchLogged = false;
export function getTermCanvas() {
  const container = document.getElementById('xterm-container');
  const canvases = container.querySelectorAll('canvas');
  if (!canvasSearchLogged) {
    log(`[TERM] Canvas search: found ${canvases.length} canvases`);
    canvases.forEach((c, i) => log(`[TERM]   canvas[${i}]: ${c.width}x${c.height} class=${c.className}`));
    canvasSearchLogged = true;
  }
  let best = null;
  canvases.forEach(c => { if (!best || c.width * c.height > best.width * best.height) best = c; });
  if (best && best.width > 50) return best;

  renderTermToCanvas();
  return termRenderCanvas;
}

export function renderTermToCanvas() {
  const term = getTerm();
  if (!term) return;
  const ctx = termRenderCtx;
  const W = termRenderCanvas.width;
  const H = termRenderCanvas.height;
  const rows = term.rows;
  const cols = term.cols;
  const charW = Math.floor(W / cols);
  const lineH = Math.floor(H / rows);

  ctx.fillStyle = '#0c0c12';
  ctx.fillRect(0, 0, W, H);
  ctx.font = `${lineH - 2}px "Courier New", monospace`;
  ctx.textBaseline = 'top';

  const buf = term.buffer.active;

  for (let row = 0; row < rows; row++) {
    const line = buf.getLine(buf.viewportY + row);
    if (!line) continue;
    const lineStr = line.translateToString(false);
    ctx.fillStyle = '#e0e0e0';
    ctx.fillText(lineStr, 4, row * lineH + 2);
  }

  // Cursor
  ctx.fillStyle = '#ff6b00';
  ctx.globalAlpha = 0.8;
  ctx.fillRect(4 + buf.cursorX * charW, buf.cursorY * lineH, charW, lineH);
  ctx.globalAlpha = 1.0;
}

export { termRenderCanvas };
