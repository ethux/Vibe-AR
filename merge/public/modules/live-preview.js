// ═══════════════════════════════════════════════════════════════════
//  live-preview.js — Floating 3D Live Preview Window for Dev Servers
//  Auto-detects running dev servers from terminal output and shows
//  a stylized live status window in WebXR AR space.
// ═══════════════════════════════════════════════════════════════════

import { log } from './logging.js';

// ── Server detection patterns ────────────────────────────────────
// Each entry: { pattern: RegExp, framework: string, portGroup: number }
const SERVER_PATTERNS = [
  // Next.js
  { pattern: /ready started server on.*?:(\d+)/i,             framework: 'Next.js',       portGroup: 1 },
  { pattern: /Local:\s*https?:\/\/localhost:(\d+)/i,           framework: 'Vite',          portGroup: 1 },
  // Flask
  { pattern: /Running on https?:\/\/127\.0\.0\.1:(\d+)/i,     framework: 'Flask',         portGroup: 1 },
  { pattern: /Running on https?:\/\/0\.0\.0\.0:(\d+)/i,       framework: 'Flask',         portGroup: 1 },
  // Express
  { pattern: /listening on port\s+(\d+)/i,                     framework: 'Express',       portGroup: 1 },
  { pattern: /server (?:is )?(?:running|listening) (?:on|at) (?:port )?(\d+)/i, framework: 'Node.js', portGroup: 1 },
  // Python http.server
  { pattern: /Serving HTTP on 0\.0\.0\.0 port (\d+)/i,        framework: 'Python HTTP',   portGroup: 1 },
  { pattern: /Serving HTTP on [\d.]+ port (\d+)/i,            framework: 'Python HTTP',   portGroup: 1 },
  // Django
  { pattern: /Starting development server at https?:\/\/127\.0\.0\.1:(\d+)/i, framework: 'Django', portGroup: 1 },
  { pattern: /Starting development server at https?:\/\/0\.0\.0\.0:(\d+)/i,   framework: 'Django', portGroup: 1 },
  // Streamlit
  { pattern: /Local URL:\s*https?:\/\/localhost:(\d+)/i,       framework: 'Streamlit',     portGroup: 1 },
  // Rails
  { pattern: /Listening on https?:\/\/[\d.]+:(\d+)/i,         framework: 'Rails',         portGroup: 1 },
  // Generic localhost / 0.0.0.0 / 127.0.0.1
  { pattern: /https?:\/\/localhost:(\d+)/i,                    framework: 'Dev Server',    portGroup: 1 },
  { pattern: /https?:\/\/0\.0\.0\.0:(\d+)/i,                  framework: 'Dev Server',    portGroup: 1 },
  { pattern: /https?:\/\/127\.0\.0\.1:(\d+)/i,                framework: 'Dev Server',    portGroup: 1 },
];

// ── Framework display icons (pixel-art style, drawn on canvas) ──
const FRAMEWORK_COLORS = {
  'Next.js':      '#FFFFFF',
  'Vite':         '#646CFF',
  'Flask':        '#44AA88',
  'Express':      '#68A063',
  'Node.js':      '#68A063',
  'Python HTTP':  '#3776AB',
  'Django':       '#0C4B33',
  'Streamlit':    '#FF4B4B',
  'Rails':        '#CC0000',
  'Dev Server':   '#FF6B00',
};

// ── Style constants ──────────────────────────────────────────────
const COLORS = {
  BG:             '#0c0c12',
  BG_PANEL:       '#14141e',
  BORDER:         '#2a2a3a',
  ORANGE:         '#FF6B00',
  ORANGE_DIM:     '#CC5500',
  GREEN:          '#00E676',
  GREEN_DIM:      '#00A54A',
  RED:            '#FF3D3D',
  WHITE:          '#FFFFFF',
  GRAY:           '#888899',
  LIGHT_GRAY:     '#AAAABC',
  DARK_GRAY:      '#555566',
  URL_COLOR:      '#77AAFF',
};

const CANVAS_W = 512;
const CANVAS_H = 400;


class LivePreviewManager {

  /**
   * @param {THREE.Scene} scene
   * @param {WindowManager} windowManager
   */
  constructor(scene, windowManager) {
    this.scene = scene;
    this.wm    = windowManager;

    /** @type {ManagedWindow|null} */
    this._win        = null;
    this._port       = null;
    this._framework   = null;
    this._serverUp    = false;
    this._lastCheck   = 0;
    this._lastRefresh = null;
    this._httpStatus  = null;
    this._checkInterval = 4000;  // ms between health checks
    this._pulsePhase  = 0;       // for LIVE dot animation
    this._detected    = false;

    // Track already-seen ports so we don't re-open after user closes
    this._dismissedPorts = new Set();
  }

  // ── Server detection from terminal output ─────────────────────

  /**
   * Parse terminal output text for dev-server startup patterns.
   * Call this whenever new terminal output arrives.
   *
   * @param {string} terminalOutput — raw text from terminal
   * @returns {{ detected: boolean, port?: number, framework?: string }}
   */
  detectServer(terminalOutput) {
    if (!terminalOutput || typeof terminalOutput !== 'string') {
      return { detected: false };
    }

    for (const entry of SERVER_PATTERNS) {
      const match = terminalOutput.match(entry.pattern);
      if (match) {
        const port = parseInt(match[entry.portGroup], 10);
        if (port > 0 && port <= 65535) {
          return { detected: true, port, framework: entry.framework };
        }
      }
    }

    return { detected: false };
  }

  // ── Open the live preview window ──────────────────────────────

  /**
   * Create and show the floating preview window.
   *
   * @param {number} port
   * @param {string} framework
   */
  openPreview(port, framework) {
    // Don't reopen if same port is already showing
    if (this._win && !this._win.closed && this._port === port) return;

    // Don't reopen a dismissed port
    if (this._dismissedPorts.has(port)) return;

    // Close existing if switching ports
    if (this._win && !this._win.closed) {
      this._win.close();
    }

    this._port      = port;
    this._framework  = framework || 'Dev Server';
    this._serverUp   = false;
    this._httpStatus = null;
    this._lastRefresh = null;
    this._pulsePhase = 0;
    this._detected   = true;

    const titleText = `PREVIEW: ${this._framework} :${this._port}`;

    this._win = this.wm.createWindow({
      title:        titleText,
      width:        0.5,
      height:       0.4,
      position:     [0.55, 1.4, -0.7],
      canvasWidth:  CANVAS_W,
      canvasHeight: CANVAS_H,
      closable:     true,
    });

    // When user closes, mark port as dismissed
    const origClose = this._win.close.bind(this._win);
    this._win.close = () => {
      this._dismissedPorts.add(this._port);
      origClose();
      this._win = null;
    };

    // Initial draw
    this._drawCanvas();

    // Kick off first health check
    this._checkServerHealth();

    log(`[PREVIEW] Opened live preview for ${this._framework} on port ${this._port}`);
  }

  // ── Close the preview window ──────────────────────────────────

  closePreview() {
    if (this._win && !this._win.closed) {
      this._win.close();
    }
    this._win       = null;
    this._port      = null;
    this._framework  = null;
    this._serverUp   = false;
    this._detected   = false;
    this._httpStatus = null;
  }

  // ── Per-frame update (call from render loop) ──────────────────

  /**
   * @param {number} dt  — delta time in seconds
   * @param {number} elapsed — total elapsed seconds
   */
  update(dt, elapsed) {
    if (!this._win || this._win.closed) return;

    // Animate pulse
    this._pulsePhase += dt * 3.0;   // ~3 Hz cycle
    if (this._pulsePhase > Math.PI * 2) this._pulsePhase -= Math.PI * 2;

    // Periodic health check
    const now = performance.now();
    if (now - this._lastCheck > this._checkInterval) {
      this._lastCheck = now;
      this._checkServerHealth();
    }

    // Redraw canvas (pulse animation needs continuous updates)
    this._drawCanvas();
  }

  // ── Health check via proxy ────────────────────────────────────
  // NOTE: You can also use /api/companion/terminal/run to run:
  //   curl -s -o /dev/null -w "%{http_code}" http://localhost:{port}
  // to check if the server is responding.

  async _checkServerHealth() {
    if (!this._port) return;

    try {
      const url = `http://localhost:${this._port}`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);

      const resp = await fetch(url, {
        method: 'HEAD',
        mode: 'no-cors',
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      // In no-cors mode we get opaque response (status 0) but it means
      // the server is reachable. Any non-abort = server is up.
      this._serverUp   = true;
      this._httpStatus = resp.status || 200;
      this._lastRefresh = new Date();
    } catch (err) {
      if (err.name === 'AbortError') {
        this._serverUp   = false;
        this._httpStatus = null;
      } else {
        // Network error — might still mean server exists but CORS blocked.
        // In no-cors mode, a TypeError typically means network unreachable.
        this._serverUp   = false;
        this._httpStatus = null;
      }
    }
  }

  // ── Canvas drawing ────────────────────────────────────────────

  _drawCanvas() {
    if (!this._win || this._win.closed) return;

    const ctx = this._win.contentCtx;
    const W   = CANVAS_W;
    const H   = CANVAS_H;

    // ── Background
    ctx.fillStyle = COLORS.BG;
    ctx.fillRect(0, 0, W, H);

    // ── Outer border
    ctx.strokeStyle = COLORS.BORDER;
    ctx.lineWidth = 2;
    ctx.strokeRect(8, 8, W - 16, H - 16);

    // ── Header panel
    const headerH = 64;
    ctx.fillStyle = COLORS.BG_PANEL;
    ctx.fillRect(12, 12, W - 24, headerH);
    ctx.strokeStyle = COLORS.BORDER;
    ctx.lineWidth = 1;
    ctx.strokeRect(12, 12, W - 24, headerH);

    // ── LIVE indicator (pulsing green dot)
    const pulse     = (Math.sin(this._pulsePhase) + 1) / 2;  // 0..1
    const dotRadius = 8;
    const dotX      = 36;
    const dotY      = 12 + headerH / 2;

    if (this._serverUp) {
      // Glow
      const glowAlpha = 0.15 + pulse * 0.25;
      ctx.beginPath();
      ctx.arc(dotX, dotY, dotRadius + 6, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(0, 230, 118, ${glowAlpha})`;
      ctx.fill();

      // Solid dot
      ctx.beginPath();
      ctx.arc(dotX, dotY, dotRadius, 0, Math.PI * 2);
      const dotBrightness = 0.7 + pulse * 0.3;
      ctx.fillStyle = `rgba(0, ${Math.round(180 + 50 * dotBrightness)}, ${Math.round(90 + 28 * dotBrightness)}, 1.0)`;
      ctx.fill();

      // LIVE text
      ctx.font = 'bold 22px monospace';
      ctx.fillStyle = COLORS.GREEN;
      ctx.textBaseline = 'middle';
      ctx.fillText('LIVE', dotX + 18, dotY);
    } else {
      // Waiting / offline dot
      ctx.beginPath();
      ctx.arc(dotX, dotY, dotRadius, 0, Math.PI * 2);
      const waitAlpha = 0.3 + pulse * 0.4;
      ctx.fillStyle = `rgba(255, 107, 0, ${waitAlpha})`;
      ctx.fill();

      ctx.font = 'bold 22px monospace';
      ctx.fillStyle = COLORS.ORANGE;
      ctx.textBaseline = 'middle';
      ctx.fillText('WAITING', dotX + 18, dotY);
    }

    // ── Framework badge (right side of header)
    const fwColor = FRAMEWORK_COLORS[this._framework] || COLORS.ORANGE;
    const fwText  = this._framework || 'Dev Server';
    ctx.font = 'bold 18px monospace';
    const fwMetrics = ctx.measureText(fwText);
    const fwX = W - 28 - fwMetrics.width;
    const fwY = dotY;

    // Badge background
    const badgePadH = 8, badgePadV = 6;
    ctx.fillStyle = COLORS.BG;
    ctx.strokeStyle = fwColor;
    ctx.lineWidth = 1.5;
    const badgeX = fwX - badgePadH;
    const badgeY = fwY - 12 - badgePadV;
    const badgeW = fwMetrics.width + badgePadH * 2;
    const badgeH = 24 + badgePadV * 2;
    this._roundRect(ctx, badgeX, badgeY, badgeW, badgeH, 4);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = fwColor;
    ctx.textBaseline = 'middle';
    ctx.fillText(fwText, fwX, fwY);

    // ── Separator line
    const sepY = 12 + headerH + 12;
    ctx.strokeStyle = COLORS.BORDER;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(24, sepY);
    ctx.lineTo(W - 24, sepY);
    ctx.stroke();

    // ── Info section
    let infoY = sepY + 28;
    const infoX = 32;
    const labelX = infoX;
    const valueX = 150;

    // URL
    ctx.font = '14px monospace';
    ctx.fillStyle = COLORS.GRAY;
    ctx.textBaseline = 'top';
    ctx.fillText('URL', labelX, infoY);

    ctx.font = '16px monospace';
    ctx.fillStyle = COLORS.URL_COLOR;
    ctx.fillText(`http://localhost:${this._port}`, valueX, infoY);

    infoY += 32;

    // Port
    ctx.font = '14px monospace';
    ctx.fillStyle = COLORS.GRAY;
    ctx.fillText('PORT', labelX, infoY);

    ctx.font = '16px monospace';
    ctx.fillStyle = COLORS.WHITE;
    ctx.fillText(`${this._port}`, valueX, infoY);

    infoY += 32;

    // Status
    ctx.font = '14px monospace';
    ctx.fillStyle = COLORS.GRAY;
    ctx.fillText('STATUS', labelX, infoY);

    ctx.font = '16px monospace';
    if (this._serverUp) {
      ctx.fillStyle = COLORS.GREEN;
      ctx.fillText(`UP  (HTTP ${this._httpStatus || '---'})`, valueX, infoY);
    } else {
      ctx.fillStyle = COLORS.ORANGE;
      ctx.fillText('CONNECTING...', valueX, infoY);
    }

    infoY += 32;

    // Last checked
    ctx.font = '14px monospace';
    ctx.fillStyle = COLORS.GRAY;
    ctx.fillText('CHECKED', labelX, infoY);

    ctx.font = '16px monospace';
    ctx.fillStyle = COLORS.LIGHT_GRAY;
    if (this._lastRefresh) {
      const hh = String(this._lastRefresh.getHours()).padStart(2, '0');
      const mm = String(this._lastRefresh.getMinutes()).padStart(2, '0');
      const ss = String(this._lastRefresh.getSeconds()).padStart(2, '0');
      ctx.fillText(`${hh}:${mm}:${ss}`, valueX, infoY);
    } else {
      ctx.fillText('--:--:--', valueX, infoY);
    }

    infoY += 42;

    // ── Bottom separator
    ctx.strokeStyle = COLORS.BORDER;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(24, infoY);
    ctx.lineTo(W - 24, infoY);
    ctx.stroke();

    infoY += 16;

    // ── Refresh hint
    ctx.font = '12px monospace';
    ctx.fillStyle = COLORS.DARK_GRAY;
    ctx.textBaseline = 'top';
    ctx.fillText(`Auto-refresh every ${this._checkInterval / 1000}s`, infoX, infoY);

    // ── Decorative pixel corners (Mistral branding)
    this._drawPixelCorner(ctx, 14, 14, 1);       // top-left
    this._drawPixelCorner(ctx, W - 14, 14, 2);   // top-right
    this._drawPixelCorner(ctx, 14, H - 14, 3);   // bottom-left
    this._drawPixelCorner(ctx, W - 14, H - 14, 4); // bottom-right

    // ── Server uptime bar (bottom of window)
    const barY = H - 36;
    const barX = 24;
    const barW = W - 48;
    const barH = 6;

    ctx.fillStyle = COLORS.BG_PANEL;
    ctx.fillRect(barX, barY, barW, barH);

    if (this._serverUp) {
      // Animated running bar
      const segmentW = 40;
      const offset = (performance.now() / 20) % barW;
      ctx.fillStyle = COLORS.GREEN_DIM;
      ctx.fillRect(barX, barY, barW, barH);
      // Sliding highlight
      const hlX = barX + offset;
      const hlW = Math.min(segmentW, barX + barW - hlX);
      ctx.fillStyle = COLORS.GREEN;
      ctx.fillRect(hlX, barY, hlW, barH);
      // Wrap-around
      if (hlX + segmentW > barX + barW) {
        ctx.fillRect(barX, barY, (hlX + segmentW) - (barX + barW), barH);
      }
    } else {
      // Pulsing orange bar
      const barAlpha = 0.3 + pulse * 0.4;
      ctx.fillStyle = `rgba(255, 107, 0, ${barAlpha})`;
      ctx.fillRect(barX, barY, barW * 0.3, barH);
    }

    // Mark texture dirty
    this._win.markContentDirty();
  }

  // ── Canvas helpers ────────────────────────────────────────────

  _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  /**
   * Draw a small decorative pixel-art corner element.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} cx — corner x
   * @param {number} cy — corner y
   * @param {number} corner — 1=TL 2=TR 3=BL 4=BR
   */
  _drawPixelCorner(ctx, cx, cy, corner) {
    const ps = 3; // pixel size
    ctx.fillStyle = COLORS.ORANGE;

    // Small L-shaped corner mark
    const dirs = {
      1: { dx: 1, dy: 1 },
      2: { dx: -1, dy: 1 },
      3: { dx: 1, dy: -1 },
      4: { dx: -1, dy: -1 },
    };
    const d = dirs[corner];

    // Horizontal arm (3 pixels)
    for (let i = 0; i < 3; i++) {
      ctx.fillRect(cx + d.dx * i * ps, cy, ps, ps);
    }
    // Vertical arm (2 pixels, skip the corner itself)
    for (let i = 1; i < 3; i++) {
      ctx.fillRect(cx, cy + d.dy * i * ps, ps, ps);
    }
  }
}

export { LivePreviewManager };
