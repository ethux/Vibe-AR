// ═══════════════════════════════════════════════════════════════════
//  StreamScreenWindow.js — Live Mac Screen Stream in a Win95 Window
// ═══════════════════════════════════════════════════════════════════
//
//  Connects to stream_screen.py via WebSocket and displays the live
//  Mac screen capture inside a ManagedWindow (Win95 style).
//
//  USAGE:
//    import { StreamScreenWindow } from './StreamScreenWindow.js';
//    const streamer = new StreamScreenWindow(windowManager);
//    streamer.open();                         // default ws://localhost:9100
//    streamer.open({ url: 'ws://192.168.1.5:9100' });
//    streamer.close();
//
// ═══════════════════════════════════════════════════════════════════

import { log } from './logging.js';

const STREAM_POLL_INTERVAL = 3000; // ms

class StreamScreenWindow {
  constructor(windowManager) {
    this.wm = windowManager;
    this._win = null;
    this._ws = null;
    this._img = new Image();
    this._connected = false;
    this._frameCount = 0;
    this._fps = 0;
    this._fpsTimer = 0;
    this._fpsFrames = 0;
    this._lastFrameBlob = null;
    this._reconnectTimer = null;
    this._url = null;
    this._dismissed = false; // user manually closed — don't auto-reopen

    // Auto-detect stream_screen.py
    this._startPolling();
  }

  _startPolling() {
    this._poll();
  }

  async _poll() {
    // Don't poll if user dismissed or already open
    if (!this._dismissed && !this._win) {
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const url = `${proto}://${window.location.hostname}:9100`;
      try {
        // Try a quick WebSocket probe
        const probe = new WebSocket(url);
        probe.binaryType = 'arraybuffer';
        const opened = await new Promise(resolve => {
          probe.onopen = () => resolve(true);
          probe.onerror = () => resolve(false);
          setTimeout(() => { try { probe.close(); } catch {} resolve(false); }, 1500);
        });
        if (opened) {
          probe.close();
          if (!this._win && !this._dismissed) {
            log('[STREAM] Auto-detected stream_screen.py on port 9100');
            this.open({ url });
          }
        }
      } catch {}
    }
    setTimeout(() => this._poll(), STREAM_POLL_INTERVAL);
  }

  open(opts = {}) {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const url = opts.url || `${proto}://${window.location.hostname}:9100`;
    const position = opts.position || [-0.95, 1.4, -0.45];
    const width = opts.width || 0.9;
    const height = opts.height || 0.6;

    this._url = url;

    const self = this;

    this._win = this.wm.createWindow({
      title: 'Screen Stream',
      width,
      height,
      position,
      content: (ctx, w, h) => {
        self._drawFrame(ctx, w, h);
      }
    });

    // Upgrade canvas to high-res for video stream
    const win = this._win;
    win.CANVAS_W = 1280;
    win.CANVAS_H = 960;
    win._contentCanvas.width = 1280;
    win._contentCanvas.height = 960;
    win._contentCtx = win._contentCanvas.getContext('2d');
    win._contentCtx.imageSmoothingEnabled = true;
    win._contentCtx.imageSmoothingQuality = 'high';

    // Switch texture filtering from pixelated to smooth
    win._contentTex.magFilter = THREE.LinearFilter;
    win._contentTex.minFilter = THREE.LinearFilter;
    win._contentTex.needsUpdate = true;

    // Redraw with new resolution
    win._drawContentCanvas();

    // Remote cursor control via Quest pointer
    win.onContentInteraction = (localPoint, type, handIdx) => {
      if (!localPoint || !self._ws || self._ws.readyState !== 1) return;
      if (!self._img.naturalWidth) return;

      // Convert mesh-local coords to canvas pixel coords
      const cw = win._contentW;
      const ch = win._contentH;
      const canvasX = ((localPoint.x / cw) + 0.5) * win.CANVAS_W;
      const canvasY = (1.0 - ((localPoint.y / ch) + 0.5)) * win.CANVAS_H;

      // Replicate layout math from _drawFrame to find video rect
      const W = win.CANVAS_W;
      const H = win.CANVAS_H;
      const statusH = 28;
      const maxW = W;
      const maxH = H - statusH;
      const scale = Math.min(maxW / self._img.naturalWidth, maxH / self._img.naturalHeight);
      const drawW = self._img.naturalWidth * scale;
      const drawH = self._img.naturalHeight * scale;
      const imgX = (W - drawW) / 2;
      const imgY = (maxH - drawH) / 2;

      // Map to UV within video rect
      const u = (canvasX - imgX) / drawW;
      const v = (canvasY - imgY) / drawH;
      if (u < 0 || u > 1 || v < 0 || v > 1) return;

      if (type === 'tap') {
        self._ws.send(JSON.stringify({ type: 'click', u, v }));
      } else if (type === 'start') {
        self._ws.send(JSON.stringify({ type: 'move', u, v }));
      }
    };

    // Hook into update loop for FPS counter
    const origUpdate = this._win.update.bind(this._win);
    this._win.update = (dt, elapsed) => {
      origUpdate(dt, elapsed);
      self._fpsTimer += dt;
      if (self._fpsTimer >= 1.0) {
        self._fps = self._fpsFrames;
        self._fpsFrames = 0;
        self._fpsTimer -= 1.0;
      }
    };

    // Hook close button to mark as user-dismissed
    const origClose = win.close.bind(win);
    win.close = () => {
      this._dismissed = true;
      this._disconnect();
      origClose();
      this._win = null;
    };

    this._connect(url);

    log(`[STREAM] Opened screen stream window → ${url}`);
    return { window: this._win };
  }

  close() {
    this._dismissed = true;
    this._disconnect();
    if (this._win) {
      try { this._win.close(); } catch {}
      this._win = null;
    }
  }

  _disconnect() {
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

  // ── WebSocket connection ────────────────────────────────────

  _connect(url) {
    try {
      if (this._ws) {
        this._ws.close();
        this._ws = null;
      }

      this._ws = new WebSocket(url);
      this._ws.binaryType = 'arraybuffer';

      this._ws.onopen = () => {
        this._connected = true;
        this._frameCount = 0;
        log('[STREAM] WebSocket connected');
        if (this._win && !this._win.closed) {
          this._win.setTitle('Screen Stream — Connected');
          this._win.setContent(this._win.contentDrawFn);
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
        if (this._win && !this._win.closed) {
          this._win.setTitle('Screen Stream — Reconnecting...');
          this._win.setContent(this._win.contentDrawFn);
        }
        this._scheduleReconnect(url);
      };

      this._ws.onerror = () => {
        // onclose will fire after this
      };
    } catch (e) {
      log('[STREAM] WebSocket failed: ' + e.message);
      this._connected = false;
      this._ws = null;
      this._scheduleReconnect(url);
    }
  }

  _scheduleReconnect(url) {
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
    this._reconnectTimer = setTimeout(() => {
      if (this._win && !this._win.closed) {
        this._connect(url);
      }
    }, 1000);
  }

  // ── Draw frame onto the ManagedWindow canvas ───────────────

  _drawFrame(ctx, w, h) {
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, w, h);

    if (this._connected && this._img.complete && this._img.naturalWidth > 0) {
      const statusH = 28;
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
      ctx.fillStyle = '#0f0';
      ctx.font = '14px monospace';
      ctx.fillText(
        `  LIVE  ${this._img.naturalWidth}x${this._img.naturalHeight}  |  ${this._fps} fps  |  ${this._frameCount} frames`,
        8, h - statusH + 8
      );

      // Live indicator dot
      ctx.fillStyle = '#0f0';
      ctx.beginPath();
      ctx.arc(16, h - statusH + 16, 5, 0, Math.PI * 2);
      ctx.fill();

    } else if (!this._connected) {
      ctx.fillStyle = '#333';
      ctx.font = '20px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('Connecting to screen stream...', w / 2, h / 2 - 20);
      ctx.fillStyle = '#666';
      ctx.font = '16px monospace';
      ctx.fillText(this._url || 'ws://localhost:9100', w / 2, h / 2 + 20);
      ctx.fillText('Run: python stream_screen.py', w / 2, h / 2 + 50);
      ctx.textAlign = 'left';

    } else {
      ctx.fillStyle = '#888';
      ctx.font = '18px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('Waiting for frames...', w / 2, h / 2);
      ctx.textAlign = 'left';
    }
  }
}

export { StreamScreenWindow };
