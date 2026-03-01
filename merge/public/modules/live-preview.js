// ═══════════════════════════════════════════════════════════════════
//  live-preview.js — Live Preview via WebSocket JPEG Stream
//  Polls dev server ports, starts page capture stream, renders
//  JPEG frames onto a 3D ManagedWindow canvas (visible in AR).
// ═══════════════════════════════════════════════════════════════════

import { log } from './logging.js';

// Ports to poll for running dev servers
const POLL_PORTS = [3000, 5173, 8080, 8000, 4200, 5000, 8888, 9000];
const POLL_INTERVAL = 2000; // ms — fast polling
const HEALTH_CHECK_INTERVAL = 3000; // ms — check if active server is still up
const MAX_RECONNECT_FAILURES = 3; // close window after N consecutive WS failures

class LivePreviewManager {

  constructor(scene, windowManager) {
    this.scene = scene;
    this.wm    = windowManager;

    this._win        = null;
    this._port       = null;
    this._ws         = null;
    this._img        = new Image();
    this._connected  = false;
    this._dismissed  = new Set(); // ports user manually closed — stays dismissed
    this._polling    = false;
    this._frameCount = 0;
    this._fps        = 0;
    this._fpsTimer   = 0;
    this._fpsFrames  = 0;
    this._lastFrameBlob = null;
    this._reconnectTimer = null;
    this._reconnectFailures = 0;
    this._healthTimer = null;

    // Start polling for dev servers
    this._startPolling();
  }

  // ── Port polling ─────────────────────────────────────────────

  _startPolling() {
    if (this._polling) return;
    this._polling = true;
    log('[PREVIEW] Polling dev server ports: ' + POLL_PORTS.join(', '));
    this._poll();
  }

  async _poll() {
    if (!this._polling) return;

    // If we have an active preview, check if that server is still up
    if (this._port && this._win && !this._win.closed) {
      const stillUp = await this._checkHealth(this._port);
      if (!stillUp) {
        log(`[PREVIEW] Dev server on port ${this._port} went down — closing preview`);
        this._autoClose(); // does NOT add to _dismissed, so it can reopen
      }
    }

    // Poll for new dev servers (skip active port and user-dismissed ports)
    const checks = POLL_PORTS
      .filter(port => !(this._port === port && this._win) && !this._dismissed.has(port))
      .map(async (port) => {
        try {
          const ctrl = new AbortController();
          const tid = setTimeout(() => ctrl.abort(), 1000);
          const res = await fetch(`/api/devserver/${port}/health`, { signal: ctrl.signal });
          clearTimeout(tid);
          const data = await res.json();
          return data.status === 'up' ? port : null;
        } catch {
          return null;
        }
      });

    const results = await Promise.all(checks);
    const foundPort = results.find(p => p !== null);
    if (foundPort) {
      log(`[PREVIEW] Dev server detected on port ${foundPort}`);
      this.openPreview(foundPort);
    }

    setTimeout(() => this._poll(), POLL_INTERVAL);
  }

  async _checkHealth(port) {
    try {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 1000);
      const res = await fetch(`/api/devserver/${port}/health`, { signal: ctrl.signal });
      clearTimeout(tid);
      const data = await res.json();
      return data.status === 'up';
    } catch {
      return false;
    }
  }

  // Auto-close when server goes down (NOT user-dismissed — can reopen)
  _autoClose() {
    this._disconnectWs();
    this._stopStream();
    if (this._win && !this._win.closed) {
      try { this._win.close(); } catch {}
    }
    this._win = null;
    this._port = null;
    this._reconnectFailures = 0;
  }

  // Keep detectServer for backward compat (scene.js calls it)
  detectServer() { return { detected: false }; }

  // ── Open preview: start page stream + 3D window ───────────────

  async openPreview(port) {
    if (this._win && this._port === port) return;
    if (this._dismissed.has(port)) return;

    // Close existing
    if (this._win) this.closePreview();

    this._port = port;

    // Start the page capture stream on the server
    try {
      const resp = await fetch('/api/devserver/start-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port }),
      });
      const data = await resp.json();
      log(`[PREVIEW] Stream started: ${JSON.stringify(data)}`);
    } catch (e) {
      log(`[PREVIEW] Failed to start stream: ${e.message}`);
      // Continue anyway — stream might already be running or user runs stream_page.py manually
    }

    // Create 3D window via WindowManager
    const self = this;
    this._win = this.wm.createWindow({
      title:    `LIVE PREVIEW :${port}`,
      width:    0.8,
      height:   0.6,
      position: [0.95, 1.4, -0.45],
      canvasWidth:  1280,
      canvasHeight: 960,
      closable: true,
      content: (ctx, w, h) => {
        self._drawFrame(ctx, w, h);
      },
    });

    // Switch texture filtering to smooth for video
    const win = this._win;
    win._contentTex.magFilter = THREE.LinearFilter;
    win._contentTex.minFilter = THREE.LinearFilter;
    win._contentTex.needsUpdate = true;

    // Hook close to dismiss
    const origClose = win.close.bind(win);
    win.close = () => {
      this._dismissed.add(this._port);
      this._disconnectWs();
      this._stopStream();
      origClose();
      this._win = null;
      this._port = null;
    };

    // Hook update for FPS counter
    const origUpdate = win.update.bind(win);
    win.update = (dt, elapsed) => {
      origUpdate(dt, elapsed);
      self._fpsTimer += dt;
      if (self._fpsTimer >= 1.0) {
        self._fps = self._fpsFrames;
        self._fpsFrames = 0;
        self._fpsTimer -= 1.0;
      }
    };

    // Connect WebSocket to page capture stream
    this._connectWs();

    log(`[PREVIEW] Opened live preview for port ${port}`);
  }

  // ── WebSocket connection to server preview stream ─────────────

  _connectWs() {
    this._disconnectWs();

    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${window.location.host}/ws/preview-stream`;

    try {
      this._ws = new WebSocket(url);
      this._ws.binaryType = 'arraybuffer';

      this._ws.onopen = () => {
        this._connected = true;
        this._frameCount = 0;
        this._reconnectFailures = 0;
        log('[PREVIEW] WebSocket connected');
        if (this._win && !this._win.closed) {
          this._win.setTitle(`LIVE PREVIEW :${this._port} — Connected`);
        }
      };

      this._ws.onmessage = (evt) => {
        this._frameCount++;
        this._fpsFrames++;

        const blob = new Blob([evt.data], { type: 'image/jpeg' });
        const objectUrl = URL.createObjectURL(blob);

        if (this._lastFrameBlob) {
          URL.revokeObjectURL(this._lastFrameBlob);
        }
        this._lastFrameBlob = objectUrl;

        this._img.onload = () => {
          if (this._win && !this._win.closed) {
            this._win._drawContentCanvas();
          }
        };
        this._img.src = objectUrl;
      };

      this._ws.onclose = () => {
        this._connected = false;
        this._ws = null;
        this._reconnectFailures++;

        if (this._reconnectFailures >= MAX_RECONNECT_FAILURES) {
          log(`[PREVIEW] ${MAX_RECONNECT_FAILURES} consecutive WS failures — checking server health`);
          this._checkHealth(this._port).then(up => {
            if (!up) {
              log('[PREVIEW] Server confirmed down — auto-closing preview');
              this._autoClose();
            } else {
              // Server is up but WS keeps failing — keep trying
              this._reconnectFailures = 0;
              this._scheduleReconnect();
            }
          });
          return;
        }

        if (this._win && !this._win.closed) {
          this._win.setTitle(`LIVE PREVIEW :${this._port} — Reconnecting...`);
          this._win._drawContentCanvas();
        }
        this._scheduleReconnect();
      };

      this._ws.onerror = () => {};
    } catch (e) {
      log('[PREVIEW] WebSocket failed: ' + e.message);
      this._connected = false;
      this._ws = null;
      this._scheduleReconnect();
    }
  }

  _disconnectWs() {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this._ws) {
      this._ws.close();
      this._ws = null;
    }
    if (this._lastFrameBlob) {
      URL.revokeObjectURL(this._lastFrameBlob);
      this._lastFrameBlob = null;
    }
    this._connected = false;
  }

  _scheduleReconnect() {
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
    this._reconnectTimer = setTimeout(() => {
      if (this._win && !this._win.closed) {
        this._connectWs();
      }
    }, 1000);
  }

  async _stopStream() {
    try {
      await fetch('/api/devserver/stop-stream', { method: 'POST' });
    } catch {}
  }

  // ── Draw frame onto the 3D window canvas ───────────────────

  _drawFrame(ctx, w, h) {
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, w, h);

    if (this._connected && this._img.complete && this._img.naturalWidth > 0) {
      // Draw image with status bar
      const statusH = 32;
      const maxW = w;
      const maxH = h - statusH;
      const scale = Math.min(maxW / this._img.naturalWidth, maxH / this._img.naturalHeight);
      const drawW = this._img.naturalWidth * scale;
      const drawH = this._img.naturalHeight * scale;
      const x = (w - drawW) / 2;
      const y = (maxH - drawH) / 2;

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(this._img, x, y, drawW, drawH);

      // Status bar
      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(0, h - statusH, w, statusH);

      // Live indicator dot
      ctx.fillStyle = '#00E676';
      ctx.beginPath();
      ctx.arc(20, h - statusH + 16, 6, 0, Math.PI * 2);
      ctx.fill();

      ctx.font = 'bold 16px monospace';
      ctx.fillStyle = '#00E676';
      ctx.fillText('LIVE', 32, h - statusH + 10);

      ctx.font = '14px monospace';
      ctx.fillStyle = '#FF6B00';
      ctx.fillText(`Port ${this._port}`, 90, h - statusH + 10);

      ctx.fillStyle = '#77AAFF';
      ctx.fillText(`${this._fps} fps  |  ${this._frameCount} frames`, 200, h - statusH + 10);

      // Mistral branding corners
      ctx.fillStyle = '#FF6B00';
      [[4, 4], [w - 8, 4], [4, h - statusH - 8], [w - 8, h - statusH - 8]].forEach(([cx, cy]) => {
        ctx.fillRect(cx, cy, 4, 12);
        ctx.fillRect(cx, cy, 12, 4);
      });

    } else if (!this._connected) {
      ctx.fillStyle = '#555';
      ctx.font = '24px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('Connecting to preview stream...', w / 2, h / 2 - 30);
      ctx.fillStyle = '#FF6B00';
      ctx.font = '18px monospace';
      ctx.fillText(`Dev server on port ${this._port}`, w / 2, h / 2 + 10);
      ctx.fillStyle = '#666';
      ctx.font = '14px monospace';
      ctx.fillText('Waiting for capture stream...', w / 2, h / 2 + 50);
      ctx.textAlign = 'left';

    } else {
      ctx.fillStyle = '#888';
      ctx.font = '20px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('Waiting for frames...', w / 2, h / 2);
      ctx.textAlign = 'left';
    }
  }

  closePreview() {
    this._disconnectWs();
    this._stopStream();
    if (this._win && !this._win.closed) {
      this._dismissed.add(this._port); // user-initiated: stay dismissed
      try { this._win.close(); } catch {}
    }
    this._win = null;
    this._port = null;
    this._reconnectFailures = 0;
  }

  // Called from render loop
  update(dt, elapsed) {
    // Polling and WebSocket handle everything
  }
}

export { LivePreviewManager };
