// ═══════════════════════════════════════════════════════════════════
//  StreamScreenWindow.js — Live Mac Screen Stream in a Win95 Window
// ═══════════════════════════════════════════════════════════════════
//
//  Connects to stream_screen.py via WebSocket and displays the live
//  Mac screen capture inside a ManagedWindow (Win95 style).
//
//  USAGE:
//    const streamer = new StreamScreenWindow(windowManager);
//    streamer.open();                         // default ws://localhost:9100
//    streamer.open({ url: 'ws://192.168.1.5:9100' });
//    streamer.close();
//
//  Depends on: WindowManager.js, ManagedWindow.js, PixelArt.js
//
// ═══════════════════════════════════════════════════════════════════

class StreamScreenWindow {
  /**
   * @param {WindowManager} windowManager
   */
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
  }

  /**
   * Open the screen stream window.
   * @param {object} [opts]
   * @param {string}   [opts.url]      — WebSocket URL (default: ws://localhost:9100)
   * @param {number[]} [opts.position] — [x, y, z] in meters
   * @param {number}   [opts.width]    — Window width in meters
   * @param {number}   [opts.height]   — Window height in meters
   * @returns {{ window: ManagedWindow }}
   */
  open(opts = {}) {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const url = opts.url || `${proto}://${window.location.hostname}:9100`;
    const position = opts.position || [0.4, 1.5, -0.8];
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

    // ── Upgrade canvas to high-res for video stream ──
    // ManagedWindow defaults to 512x384 with NearestFilter (pixel art).
    // Override to 1280x960 with linear filtering for crisp video.
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
    win._contentTex.anisotropy = win.renderer
      ? win.renderer.capabilities.getMaxAnisotropy()
      : 4;
    win._contentTex.needsUpdate = true;

    // Redraw with new resolution
    win._drawContentCanvas();

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

    this._connect(url);

    return { window: this._win };
  }

  /**
   * Close the stream and window.
   */
  close() {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this._ws) {
      this._ws.close();
      this._ws = null;
    }
    if (this._win) {
      this._win.close();
      this._win = null;
    }
    this._connected = false;
  }

  // ── WebSocket connection ────────────────────────────────────────

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
      console.warn('StreamScreen: WebSocket failed:', e.message);
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
    }, 3000);
  }

  // ── Draw frame onto the ManagedWindow canvas ───────────────────

  _drawFrame(ctx, w, h) {
    // Dark background
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, w, h);

    if (this._connected && this._img.complete && this._img.naturalWidth > 0) {
      // Draw image edge-to-edge with thin status bar
      const statusH = 28;
      const maxW = w;
      const maxH = h - statusH;
      const scale = Math.min(maxW / this._img.naturalWidth, maxH / this._img.naturalHeight);
      const drawW = this._img.naturalWidth * scale;
      const drawH = this._img.naturalHeight * scale;
      const x = (w - drawW) / 2;
      const y = (maxH - drawH) / 2;

      // Enable smooth scaling for the video frame
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
