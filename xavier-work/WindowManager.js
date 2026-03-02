// ═══════════════════════════════════════════════════════════════════
//  WindowManager.js — Pixelated Window Manager for WebXR AR
// ═══════════════════════════════════════════════════════════════════
//
//  USAGE (for teammates):
//  ─────────────────────
//    const wm = new WindowManager(scene, renderer, camera);
//
//    const win = wm.createWindow({
//      title:    'My Panel',
//      width:    0.6,          // meters (default 0.6)
//      height:   0.45,         // meters (default 0.45)
//      position: [0, 1.5, -0.8],
//      content:  (ctx, w, h) => {
//        // draw whatever you want on the black canvas
//        ctx.fillStyle = '#0f0';
//        ctx.font = '24px monospace';
//        ctx.fillText('Hello!', 20, 40);
//      }
//    });
//
//    // In your animation loop:
//    wm.update(frame, dt, elapsed);
//
//    // Later:
//    win.setTitle('New Title');
//    win.setContent((ctx, w, h) => { ... });
//    win.close();
//
// ═══════════════════════════════════════════════════════════════════

// ─── Pixel Art Utilities ─────────────────────────────────────────

const PixelArt = {

  // Mistral brand orange palette
  ORANGE_LIGHT:  '#FFB347',
  ORANGE:        '#F97316',
  ORANGE_DARK:   '#C2410C',
  ORANGE_SHADOW: '#7C2D12',
  BLACK:         '#000000',
  DARK_BG:       '#0A0A0A',
  BORDER_BG:     '#111111',

  /**
   * Draw a single "fat pixel" on a canvas context.
   * pixelSize = how many real pixels per "art pixel"
   */
  drawPixel(ctx, px, py, pixelSize, color) {
    ctx.fillStyle = color;
    ctx.fillRect(px * pixelSize, py * pixelSize, pixelSize, pixelSize);
  },

  /**
   * Draw a full sprite from a 2D array of color indices.
   * palette = ['transparent', '#F97316', '#C2410C', ...]
   * grid[row][col] = palette index (0 = skip/transparent)
   */
  drawSprite(ctx, grid, ox, oy, pixelSize, palette) {
    for (let r = 0; r < grid.length; r++) {
      for (let c = 0; c < grid[r].length; c++) {
        const idx = grid[r][c];
        if (idx === 0) continue; // transparent
        ctx.fillStyle = palette[idx];
        ctx.fillRect(
          ox + c * pixelSize,
          oy + r * pixelSize,
          pixelSize, pixelSize
        );
      }
    }
  },

  /**
   * Fill a solid orange rectangle (no motif/pattern, just flat color).
   */
  fillSolidBorder(ctx, x, y, w, h, color) {
    ctx.fillStyle = color || this.ORANGE;
    ctx.fillRect(x, y, w, h);
  },

  /**
   * Draw a pixel-art title text. Each character is 5×7 art-pixels.
   * Renders blocky monospace text — no font loading needed.
   */
  drawPixelText(ctx, text, x, y, pixelSize, color) {
    // Compact 5×7 pixel font glyphs (only uppercase + digits + common punctuation)
    const glyphs = this._getGlyphs();
    ctx.fillStyle = color;
    let cursorX = x;
    for (const ch of text.toUpperCase()) {
      const glyph = glyphs[ch];
      if (glyph) {
        for (let r = 0; r < glyph.length; r++) {
          for (let c = 0; c < glyph[r].length; c++) {
            if (glyph[r][c]) {
              ctx.fillRect(
                cursorX + c * pixelSize,
                y + r * pixelSize,
                pixelSize, pixelSize
              );
            }
          }
        }
      }
      cursorX += (glyph ? glyph[0].length + 1 : 3) * pixelSize;
    }
  },

  /** Measure pixel text width in real pixels */
  measurePixelText(text, pixelSize) {
    const glyphs = this._getGlyphs();
    let w = 0;
    for (const ch of text.toUpperCase()) {
      const g = glyphs[ch];
      w += (g ? g[0].length + 1 : 3) * pixelSize;
    }
    return w - pixelSize; // remove trailing gap
  },

  /**
   * 5×7 pixel font for A-Z, 0-9, and a few symbols.
   * Each glyph is an array of rows, each row an array of 0/1.
   */
  _getGlyphs() {
    if (this._glyphCache) return this._glyphCache;
    // prettier-ignore
    this._glyphCache = {
      'A': [[0,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[1,1,1,1,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1]],
      'B': [[1,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[1,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[1,1,1,1,0]],
      'C': [[0,1,1,1,0],[1,0,0,0,1],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,1],[0,1,1,1,0]],
      'D': [[1,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,1,1,1,0]],
      'E': [[1,1,1,1,1],[1,0,0,0,0],[1,0,0,0,0],[1,1,1,1,0],[1,0,0,0,0],[1,0,0,0,0],[1,1,1,1,1]],
      'F': [[1,1,1,1,1],[1,0,0,0,0],[1,0,0,0,0],[1,1,1,1,0],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0]],
      'G': [[0,1,1,1,0],[1,0,0,0,1],[1,0,0,0,0],[1,0,1,1,1],[1,0,0,0,1],[1,0,0,0,1],[0,1,1,1,0]],
      'H': [[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,1,1,1,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1]],
      'I': [[1,1,1],[0,1,0],[0,1,0],[0,1,0],[0,1,0],[0,1,0],[1,1,1]],
      'J': [[0,0,1,1,1],[0,0,0,1,0],[0,0,0,1,0],[0,0,0,1,0],[1,0,0,1,0],[1,0,0,1,0],[0,1,1,0,0]],
      'K': [[1,0,0,0,1],[1,0,0,1,0],[1,0,1,0,0],[1,1,0,0,0],[1,0,1,0,0],[1,0,0,1,0],[1,0,0,0,1]],
      'L': [[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0],[1,1,1,1,1]],
      'M': [[1,0,0,0,1],[1,1,0,1,1],[1,0,1,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1]],
      'N': [[1,0,0,0,1],[1,1,0,0,1],[1,0,1,0,1],[1,0,0,1,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1]],
      'O': [[0,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[0,1,1,1,0]],
      'P': [[1,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[1,1,1,1,0],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0]],
      'Q': [[0,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,1,0,1],[1,0,0,1,0],[0,1,1,0,1]],
      'R': [[1,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[1,1,1,1,0],[1,0,1,0,0],[1,0,0,1,0],[1,0,0,0,1]],
      'S': [[0,1,1,1,0],[1,0,0,0,1],[1,0,0,0,0],[0,1,1,1,0],[0,0,0,0,1],[1,0,0,0,1],[0,1,1,1,0]],
      'T': [[1,1,1,1,1],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0]],
      'U': [[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[0,1,1,1,0]],
      'V': [[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[0,1,0,1,0],[0,1,0,1,0],[0,0,1,0,0]],
      'W': [[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,1,0,1],[1,0,1,0,1],[1,1,0,1,1],[1,0,0,0,1]],
      'X': [[1,0,0,0,1],[1,0,0,0,1],[0,1,0,1,0],[0,0,1,0,0],[0,1,0,1,0],[1,0,0,0,1],[1,0,0,0,1]],
      'Y': [[1,0,0,0,1],[1,0,0,0,1],[0,1,0,1,0],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0]],
      'Z': [[1,1,1,1,1],[0,0,0,0,1],[0,0,0,1,0],[0,0,1,0,0],[0,1,0,0,0],[1,0,0,0,0],[1,1,1,1,1]],
      '0': [[0,1,1,1,0],[1,0,0,0,1],[1,0,0,1,1],[1,0,1,0,1],[1,1,0,0,1],[1,0,0,0,1],[0,1,1,1,0]],
      '1': [[0,0,1,0,0],[0,1,1,0,0],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0],[0,1,1,1,0]],
      '2': [[0,1,1,1,0],[1,0,0,0,1],[0,0,0,0,1],[0,0,0,1,0],[0,0,1,0,0],[0,1,0,0,0],[1,1,1,1,1]],
      '3': [[0,1,1,1,0],[1,0,0,0,1],[0,0,0,0,1],[0,0,1,1,0],[0,0,0,0,1],[1,0,0,0,1],[0,1,1,1,0]],
      '4': [[0,0,0,1,0],[0,0,1,1,0],[0,1,0,1,0],[1,0,0,1,0],[1,1,1,1,1],[0,0,0,1,0],[0,0,0,1,0]],
      '5': [[1,1,1,1,1],[1,0,0,0,0],[1,1,1,1,0],[0,0,0,0,1],[0,0,0,0,1],[1,0,0,0,1],[0,1,1,1,0]],
      '6': [[0,1,1,1,0],[1,0,0,0,0],[1,0,0,0,0],[1,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[0,1,1,1,0]],
      '7': [[1,1,1,1,1],[0,0,0,0,1],[0,0,0,1,0],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0]],
      '8': [[0,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[0,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[0,1,1,1,0]],
      '9': [[0,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[0,1,1,1,1],[0,0,0,0,1],[0,0,0,0,1],[0,1,1,1,0]],
      ' ': [[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0]],
      '.': [[0],[0],[0],[0],[0],[0],[1]],
      ':': [[0],[0],[1],[0],[1],[0],[0]],
      '-': [[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0],[1,1,1,1,1],[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0]],
      '_': [[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0],[1,1,1,1,1]],
      '!': [[0,1,0],[0,1,0],[0,1,0],[0,1,0],[0,1,0],[0,0,0],[0,1,0]],
      '?': [[0,1,1,1,0],[1,0,0,0,1],[0,0,0,0,1],[0,0,0,1,0],[0,0,1,0,0],[0,0,0,0,0],[0,0,1,0,0]],
      '/': [[0,0,0,0,1],[0,0,0,0,1],[0,0,0,1,0],[0,0,1,0,0],[0,1,0,0,0],[1,0,0,0,0],[1,0,0,0,0]],
    };
    return this._glyphCache;
  },

  /**
   * Draw a 3×3 pixel "X" cross for the close button.
   * Returns a canvas.
   */
  makeCloseIcon(pixelSize, color, bgColor) {
    const size = 3 * pixelSize;
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    if (bgColor) {
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, size, size);
    }
    ctx.fillStyle = color;
    // X pattern: corners + center
    const ps = pixelSize;
    ctx.fillRect(0 * ps, 0 * ps, ps, ps);       // top-left
    ctx.fillRect(2 * ps, 0 * ps, ps, ps);       // top-right
    ctx.fillRect(1 * ps, 1 * ps, ps, ps);       // center
    ctx.fillRect(0 * ps, 2 * ps, ps, ps);       // bottom-left
    ctx.fillRect(2 * ps, 2 * ps, ps, ps);       // bottom-right
    return canvas;
  },

  /**
   * Draw a horizontal drag bar (3 pixels tall, variable width).
   * Returns a canvas.
   */
  makeDragBarIcon(widthPx, pixelSize, color, bgColor) {
    const artW = widthPx; // in art pixels
    const artH = 3;
    const canvas = document.createElement('canvas');
    canvas.width = artW * pixelSize;
    canvas.height = artH * pixelSize;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    if (bgColor) {
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.fillStyle = color;
    // Three horizontal lines with gaps (grip pattern)
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < artW; col++) {
        // Alternating dots pattern for grip feel
        if ((row + col) % 2 === 0) {
          ctx.fillRect(col * pixelSize, row * pixelSize, pixelSize, pixelSize);
        }
      }
    }
    return canvas;
  },

  /**
   * Draw a pixel-art resize handle (small square with arrow pattern).
   * Returns a canvas.
   */
  makeResizeIcon(pixelSize, color) {
    // 5x5 diagonal resize indicator
    const size = 5;
    const canvas = document.createElement('canvas');
    canvas.width = size * pixelSize;
    canvas.height = size * pixelSize;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = color;
    // Diagonal lines pattern (bottom-right corner resize feel)
    const pattern = [
      [0,0,0,0,1],
      [0,0,0,0,0],
      [0,0,1,0,1],
      [0,0,0,0,0],
      [1,0,1,0,1],
    ];
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (pattern[r][c]) {
          ctx.fillRect(c * pixelSize, r * pixelSize, pixelSize, pixelSize);
        }
      }
    }
    return canvas;
  },
};


// ─── ManagedWindow Class ─────────────────────────────────────────

class ManagedWindow {
  /**
   * @param {object} opts
   * @param {string}   opts.title       Window title text
   * @param {number}   opts.width       Window width in meters (default 0.6)
   * @param {number}   opts.height      Window height in meters (default 0.45)
   * @param {number[]} opts.position    [x, y, z] in world (default [0, 1.5, -0.8])
   * @param {Function} opts.content     (ctx, canvasW, canvasH) => void — draw on the content canvas
   * @param {THREE.Scene} opts.scene
   * @param {THREE.WebGLRenderer} opts.renderer
   * @param {THREE.Camera} opts.camera
   * @param {WindowManager} opts.manager
   */
  constructor(opts) {
    this.manager  = opts.manager;
    this.scene    = opts.scene;
    this.renderer = opts.renderer;
    this.camera   = opts.camera;

    this.title    = opts.title || 'UNTITLED';
    this.width    = opts.width || 0.6;
    this.height   = opts.height || 0.45;
    this.contentDrawFn = opts.content || null;
    this.visible  = true;
    this.minimized = false;
    this.closed   = false;
    this.focused  = false;
    this.zIndex   = 0;

    // Drag state
    this.dragging   = false;
    this.dragOffset = new THREE.Vector3();

    // Resize state
    this.resizing       = false;
    this.resizeEdge     = null; // 'left','right','top','bottom','bl','br','tl','tr'
    this.resizeStart    = new THREE.Vector3();
    this.resizeStartW   = 0;
    this.resizeStartH   = 0;
    this.minWidth  = 0.25;
    this.maxWidth  = 1.4;
    this.minHeight = 0.18;
    this.maxHeight = 1.0;

    // Hover state
    this.hoverTarget = null; // null | 'dragBar' | 'closeBtn' | 'borderL' | 'borderR' | 'borderB' | 'cornerBL' | 'cornerBR'

    // Internal canvas dimensions
    this.CANVAS_W = 512;
    this.CANVAS_H = 384;
    this.BORDER_ART_PX = 5; // border thickness in art-pixels
    this.PIXEL_SIZE = 4;    // each art-pixel = 4 real canvas pixels

    // Build the 3D mesh hierarchy
    this._build(opts.position || [0, 1.5, -0.8]);
  }

  // ── Build all meshes ──────────────────────────────────────────
  _build(pos) {
    const W = this.width;
    const H = this.height;
    const BORDER = 0.015; // border strip width in meters (slim)
    const TITLEBAR_H = 0.04;
    const BOTTOMBAR_H = 0.012; // very slim bottom bar

    // ── Root group ──
    this.root = new THREE.Group();
    this.root.position.set(pos[0], pos[1], pos[2]);
    this.scene.add(this.root);

    // ── Window body (black center content) ──
    this._buildContent(W, H, BORDER, TITLEBAR_H);

    // ── Title bar (top, with pixel art text) ──
    this._buildTitleBar(W, TITLEBAR_H, BORDER);

    // ── Pixel art borders (left + right) ──
    this._buildBorders(W, H, BORDER, TITLEBAR_H, BOTTOMBAR_H);

    // ── Bottom bar row (drag handle + close button) ──
    this._buildBottomBar(W, H, BOTTOMBAR_H, BORDER);

    // ── Resize handles (corners + edges, hidden until hover) ──
    this._buildResizeHandles(W, H, BORDER, TITLEBAR_H, BOTTOMBAR_H);
  }

  // ── Content area ──────────────────────────────────────────────
  _buildContent(W, H, border, titleH) {
    const contentW = W - border * 2;
    const contentH = H - titleH - 0.015; // leave room for title + bottom
    this._contentW = contentW;
    this._contentH = contentH;

    // Canvas for content
    this._contentCanvas = document.createElement('canvas');
    this._contentCanvas.width = this.CANVAS_W;
    this._contentCanvas.height = this.CANVAS_H;
    this._contentCtx = this._contentCanvas.getContext('2d');
    this._contentCtx.imageSmoothingEnabled = false;

    this._drawContentCanvas();

    this._contentTex = new THREE.CanvasTexture(this._contentCanvas);
    this._contentTex.minFilter = THREE.LinearFilter;
    this._contentTex.magFilter = THREE.NearestFilter; // pixel-crisp

    const geo = new THREE.PlaneGeometry(contentW, contentH);
    this._contentMat = new THREE.MeshBasicMaterial({
      map: this._contentTex,
      transparent: true,
      side: THREE.DoubleSide,
    });
    this.contentMesh = new THREE.Mesh(geo, this._contentMat);
    this.contentMesh.position.y = -0.005; // slightly below center to leave room for title
    this.contentMesh.position.z = 0.001;
    this.root.add(this.contentMesh);
  }

  _drawContentCanvas() {
    const ctx = this._contentCtx;
    const w = this.CANVAS_W;
    const h = this.CANVAS_H;
    // Black background
    ctx.fillStyle = PixelArt.BLACK;
    ctx.fillRect(0, 0, w, h);
    // User content
    if (this.contentDrawFn) {
      this.contentDrawFn(ctx, w, h);
    }
    if (this._contentTex) {
      this._contentTex.needsUpdate = true;
    }
  }

  // ── Title bar ─────────────────────────────────────────────────
  _buildTitleBar(W, titleH, border) {
    this._titleH = titleH;

    // Canvas for title
    const titleCanvasW = 512;
    const titleCanvasH = 64;
    this._titleCanvas = document.createElement('canvas');
    this._titleCanvas.width = titleCanvasW;
    this._titleCanvas.height = titleCanvasH;
    this._titleCtx = this._titleCanvas.getContext('2d');
    this._titleCtx.imageSmoothingEnabled = false;

    this._drawTitleCanvas();

    this._titleTex = new THREE.CanvasTexture(this._titleCanvas);
    this._titleTex.minFilter = THREE.LinearFilter;
    this._titleTex.magFilter = THREE.NearestFilter;

    const geo = new THREE.PlaneGeometry(W, titleH);
    this._titleMat = new THREE.MeshBasicMaterial({
      map: this._titleTex,
      transparent: true,
      side: THREE.DoubleSide,
    });
    this.titleMesh = new THREE.Mesh(geo, this._titleMat);
    this.titleMesh.position.y = this._contentH / 2 + titleH / 2;
    this.titleMesh.position.z = 0.001;
    this.root.add(this.titleMesh);
  }

  _drawTitleCanvas() {
    const ctx = this._titleCtx;
    const w = this._titleCanvas.width;
    const h = this._titleCanvas.height;
    const ps = 3; // pixel size for title text

    // Dark background
    ctx.fillStyle = '#0A0A0A';
    ctx.fillRect(0, 0, w, h);

    // Thin orange line at very top (2px)
    ctx.fillStyle = PixelArt.ORANGE;
    ctx.fillRect(0, 0, w, ps);

    // Title text centered
    const textW = PixelArt.measurePixelText(this.title, ps);
    const textX = (w - textW) / 2;
    const textY = (h - 7 * ps) / 2 + ps;
    PixelArt.drawPixelText(ctx, this.title, textX, textY, ps, PixelArt.ORANGE_LIGHT);

    if (this._titleTex) {
      this._titleTex.needsUpdate = true;
    }
  }

  // ── Side borders (plain translucent orange) ──────────────────
  _buildBorders(W, H, border, titleH, bottomH) {
    const sideH = this._contentH;
    this._borderMeshes = {};

    // Shared material style: solid orange, translucent
    const makeBorderMat = () => new THREE.MeshBasicMaterial({
      color: 0xF97316, transparent: true, opacity: 0.35, side: THREE.DoubleSide
    });

    // Left border
    const leftGeo = new THREE.PlaneGeometry(border, sideH);
    this._leftBorderMat = makeBorderMat();
    const leftMesh = new THREE.Mesh(leftGeo, this._leftBorderMat);
    leftMesh.position.set(-W / 2 + border / 2, -0.005, 0.0005);
    this.root.add(leftMesh);
    this._borderMeshes.left = leftMesh;

    // Right border
    const rightGeo = new THREE.PlaneGeometry(border, sideH);
    this._rightBorderMat = makeBorderMat();
    const rightMesh = new THREE.Mesh(rightGeo, this._rightBorderMat);
    rightMesh.position.set(W / 2 - border / 2, -0.005, 0.0005);
    this.root.add(rightMesh);
    this._borderMeshes.right = rightMesh;

    // Bottom border
    const botGeo = new THREE.PlaneGeometry(W, border);
    this._botBorderMat = makeBorderMat();
    const botMesh = new THREE.Mesh(botGeo, this._botBorderMat);
    botMesh.position.set(0, -this._contentH / 2 - border / 2, 0.0005);
    this.root.add(botMesh);
    this._borderMeshes.bottom = botMesh;
  }

  // ── Bottom bar: centered pill drag handle + small close dot ──
  _buildBottomBar(W, H, barH, border) {
    const totalContentH = this._contentH;

    // Fixed sizes — independent of window width
    const PILL_H   = 0.008;  // 3-"pixel" height pill
    const PILL_W   = W * 0.45; // narrower than window, centered
    const CLOSE_W  = 0.012;  // small square close button
    const GAP      = 0.008;  // gap between pill and close button
    const GROUP_W  = PILL_W + GAP + CLOSE_W;
    const barY     = -totalContentH / 2 - 0.015 - PILL_H / 2 - 0.004;

    // ── Pill drag bar — white rounded rect drawn on canvas ──
    const pillCanvas = document.createElement('canvas');
    // Low-res canvas scaled up = pixelated look
    const PC_W = 48; const PC_H = 6;
    pillCanvas.width = PC_W; pillCanvas.height = PC_H;
    const pctx = pillCanvas.getContext('2d');
    pctx.imageSmoothingEnabled = false;
    // Rounded pill: fill center, leave 1px corner pixels empty (pixel-art rounded)
    pctx.fillStyle = '#ffffff';
    pctx.fillRect(1, 0, PC_W - 2, PC_H);     // horizontal fill
    pctx.fillRect(0, 1, 1, PC_H - 2);         // left edge
    pctx.fillRect(PC_W - 1, 1, 1, PC_H - 2); // right edge

    const pillTex = new THREE.CanvasTexture(pillCanvas);
    pillTex.minFilter = THREE.NearestFilter;
    pillTex.magFilter = THREE.NearestFilter;

    const dragGeo = new THREE.PlaneGeometry(PILL_W, PILL_H);
    this._dragBarMat = new THREE.MeshBasicMaterial({
      map: pillTex, transparent: true, opacity: 0.35, side: THREE.DoubleSide
    });
    this.dragBarMesh = new THREE.Mesh(dragGeo, this._dragBarMat);
    // Center the group, pill sits on the left of group
    this.dragBarMesh.position.set(-GROUP_W / 2 + PILL_W / 2, barY, 0.001);
    this.root.add(this.dragBarMesh);

    // ── Close button — white rounded square on canvas ──
    const closeCanvas = document.createElement('canvas');
    const CC = 8;
    closeCanvas.width = CC; closeCanvas.height = CC;
    const cctx = closeCanvas.getContext('2d');
    cctx.imageSmoothingEnabled = false;
    // Rounded square: fill minus corners
    cctx.fillStyle = '#ffffff';
    cctx.fillRect(1, 0, CC - 2, CC);
    cctx.fillRect(0, 1, CC, CC - 2);

    const closeTex = new THREE.CanvasTexture(closeCanvas);
    closeTex.minFilter = THREE.NearestFilter;
    closeTex.magFilter = THREE.NearestFilter;

    const closeGeo = new THREE.PlaneGeometry(CLOSE_W, CLOSE_W);
    this._closeBtnMat = new THREE.MeshBasicMaterial({
      map: closeTex, transparent: true, opacity: 0.35, side: THREE.DoubleSide
    });
    this.closeBtnMesh = new THREE.Mesh(closeGeo, this._closeBtnMat);
    // Close button sits on the right of group
    this.closeBtnMesh.position.set(-GROUP_W / 2 + PILL_W + GAP + CLOSE_W / 2, barY, 0.001);
    this.root.add(this.closeBtnMesh);
  }

  // ── Resize handles ────────────────────────────────────────────
  _buildResizeHandles(W, H, border, titleH, bottomH) {
    this._resizeHandles = {};
    const handleSize = 0.03;

    const makeHandle = (name, x, y, rotZ) => {
      const geo = new THREE.PlaneGeometry(handleSize, handleSize);
      const mat = new THREE.MeshBasicMaterial({
        color: 0xF97316, transparent: true, opacity: 0.0, side: THREE.DoubleSide
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, 0.002);
      mesh.rotation.z = rotZ || 0;
      mesh.visible = true; // always in scene, but transparent until hover
      this.root.add(mesh);
      this._resizeHandles[name] = { mesh, mat, baseOpacity: 0.0, targetOpacity: 0.0 };
    };

    const halfW = W / 2;
    const halfH = this._contentH / 2;
    // Corner handles
    makeHandle('br', halfW, -halfH - 0.015, 0);
    makeHandle('bl', -halfW, -halfH - 0.015, Math.PI / 2);
    makeHandle('tr', halfW, halfH + this._titleH, -Math.PI / 2);
    makeHandle('tl', -halfW, halfH + this._titleH, Math.PI);
    // Edge mid-point handles (optional — we'll show corners primarily)
  }

  // ── Public API ────────────────────────────────────────────────

  setTitle(text) {
    this.title = text;
    this._drawTitleCanvas();
  }

  setContent(drawFn) {
    this.contentDrawFn = drawFn;
    this._drawContentCanvas();
  }

  close() {
    this.closed = true;
    this.root.visible = false;
    this.scene.remove(this.root);
    this.manager._removeWindow(this);
  }

  minimize() {
    this.minimized = !this.minimized;
    // Hide everything except the title bar + bottom bar
    this.contentMesh.visible = !this.minimized;
    Object.values(this._borderMeshes).forEach(m => m.visible = !this.minimized);
    Object.values(this._resizeHandles).forEach(h => h.mesh.visible = !this.minimized);
  }

  focus() {
    this.manager._focusWindow(this);
  }

  // ── Get all meshes that can be raycasted ─────────────────────
  getInteractableMeshes() {
    const meshes = [this.titleMesh, this.contentMesh, this.dragBarMesh, this.closeBtnMesh];
    Object.values(this._borderMeshes).forEach(m => meshes.push(m));
    Object.values(this._resizeHandles).forEach(h => meshes.push(h.mesh));
    return meshes;
  }

  getDragTargets() {
    return [this.dragBarMesh];
  }

  // ── Per-frame update (called by WindowManager) ───────────────
  update(dt, elapsed) {
    if (this.closed || !this.visible) return;

    // Animate hover effects
    this._updateHover(dt);

    // (no idle float — window stays where the user placed it)
  }

  _updateHover(dt) {
    const lerpSpeed = 8;

    // Drag bar hover → scale up + fully opaque
    const dragHover = this.hoverTarget === 'dragBar';
    const dragTargetScale = dragHover ? 1.15 : 1.0;
    const dragTargetOpacity = dragHover ? 0.9 : 0.35;
    this._dragBarMat.opacity += (dragTargetOpacity - this._dragBarMat.opacity) * lerpSpeed * dt;
    const cs = this.dragBarMesh.scale.x;
    const ns = cs + (dragTargetScale - cs) * lerpSpeed * dt;
    this.dragBarMesh.scale.set(ns, 1, 1); // scale only horizontally (keep height)

    // Close button hover → scale up + fully opaque
    const closeHover = this.hoverTarget === 'closeBtn';
    const closeTargetScale = closeHover ? 1.4 : 1.0;
    const closeTargetOpacity = closeHover ? 1.0 : 0.35;
    this._closeBtnMat.opacity += (closeTargetOpacity - this._closeBtnMat.opacity) * lerpSpeed * dt;
    const ccs = this.closeBtnMesh.scale.x;
    const cns = ccs + (closeTargetScale - ccs) * lerpSpeed * dt;
    this.closeBtnMesh.scale.set(cns, cns, 1);

    // Resize handles — show when hovering any border
    const borderHover = this.hoverTarget && this.hoverTarget.startsWith('border');
    const cornerHover = this.hoverTarget && this.hoverTarget.startsWith('corner');
    for (const [name, handle] of Object.entries(this._resizeHandles)) {
      const isActive = (cornerHover && this.hoverTarget === name) ||
                       (borderHover) || (cornerHover);
      handle.targetOpacity = isActive ? 0.85 : 0.0;
      handle.mat.opacity += (handle.targetOpacity - handle.mat.opacity) * lerpSpeed * dt;
    }
  }

  // ── Rebuild geometry after resize ─────────────────────────────
  _rebuildAfterResize() {
    // Remove old meshes
    while (this.root.children.length > 0) {
      this.root.remove(this.root.children[0]);
    }
    // Rebuild
    const BORDER = 0.015;
    const TITLEBAR_H = 0.04;
    const BOTTOMBAR_H = 0.012;
    this._build_internal(BORDER, TITLEBAR_H, BOTTOMBAR_H);
  }

  _build_internal(border, titleH, bottomH) {
    const W = this.width;
    const H = this.height;
    this._buildContent(W, H, border, titleH);
    this._buildTitleBar(W, titleH, border);
    this._buildBorders(W, H, border, titleH, bottomH);
    this._buildBottomBar(W, H, bottomH, border);
    this._buildResizeHandles(W, H, border, titleH, bottomH);
  }
}


// ─── WindowManager Class ─────────────────────────────────────────

class WindowManager {
  /**
   * @param {THREE.Scene} scene
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.Camera} camera
   */
  constructor(scene, renderer, camera) {
    this.scene    = scene;
    this.renderer = renderer;
    this.camera   = camera;
    this.windows  = [];
    this._nextZ   = 0;

    // Shared raycaster
    this._raycaster = new THREE.Raycaster();
    this._tempMatrix = new THREE.Matrix4();

    // Controller drag state
    this._controllerDragWindow = null;
    this._controllerDragCtrl   = null;
    this._controllerDragOffset = new THREE.Vector3();

    // Hand drag state (per hand index)
    this._handDragState = [
      { dragging: false, window: null, offset: new THREE.Vector3() },
      { dragging: false, window: null, offset: new THREE.Vector3() },
    ];

    // Resize state
    this._resizeState = {
      active: false,
      window: null,
      edge: null,
      controller: null,
      handIdx: null,
      startPoint: new THREE.Vector3(),
      startWidth: 0,
      startHeight: 0,
      startPos: new THREE.Vector3(),
    };
  }

  /**
   * Create a new managed window.
   * @param {object} opts See ManagedWindow constructor for options.
   * @returns {ManagedWindow}
   */
  createWindow(opts = {}) {
    const win = new ManagedWindow({
      ...opts,
      scene:    this.scene,
      renderer: this.renderer,
      camera:   this.camera,
      manager:  this,
    });
    win.zIndex = this._nextZ++;
    this.windows.push(win);
    return win;
  }

  _removeWindow(win) {
    const idx = this.windows.indexOf(win);
    if (idx >= 0) this.windows.splice(idx, 1);
  }

  _focusWindow(win) {
    win.zIndex = this._nextZ++;
    win.focused = true;
    // Bring forward in z slightly
    win.root.position.z += 0.001;
    this.windows.forEach(w => { if (w !== win) w.focused = false; });
  }

  // ── Controller interaction entry points ───────────────────────

  onSelectStart(controller) {
    this._tempMatrix.identity().extractRotation(controller.matrixWorld);
    this._raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    this._raycaster.ray.direction.set(0, 0, -1).applyMatrix4(this._tempMatrix);

    // Gather all interactable meshes from all windows
    for (const win of this.windows) {
      if (win.closed || !win.visible) continue;

      // Check close button first
      const closeHits = this._raycaster.intersectObject(win.closeBtnMesh, false);
      if (closeHits.length > 0) {
        win.close();
        return;
      }

      // Check drag targets (title bar + drag bar)
      const dragTargets = win.getDragTargets();
      const dragHits = this._raycaster.intersectObjects(dragTargets, false);
      if (dragHits.length > 0) {
        this._controllerDragWindow = win;
        this._controllerDragCtrl = controller;
        this._controllerDragOffset.copy(win.root.position).sub(dragHits[0].point);
        win.dragging = true;
        win.focus();
        return;
      }

      // Check resize handles
      for (const [name, handle] of Object.entries(win._resizeHandles)) {
        const resizeHits = this._raycaster.intersectObject(handle.mesh, false);
        if (resizeHits.length > 0 && handle.mat.opacity > 0.3) {
          this._startResize(win, name, resizeHits[0].point, controller, null);
          return;
        }
      }

      // Check border meshes for resize
      for (const [name, mesh] of Object.entries(win._borderMeshes)) {
        const borderHits = this._raycaster.intersectObject(mesh, false);
        if (borderHits.length > 0) {
          this._startResize(win, name, borderHits[0].point, controller, null);
          return;
        }
      }
    }
  }

  onSelectEnd(controller) {
    if (this._controllerDragWindow && this._controllerDragCtrl === controller) {
      this._controllerDragWindow.dragging = false;
      this._controllerDragWindow = null;
      this._controllerDragCtrl = null;
    }
    if (this._resizeState.active && this._resizeState.controller === controller) {
      this._endResize();
    }
  }

  // ── Hand pinch interaction ────────────────────────────────────

  onPinchStart(handIdx, pinchPoint) {
    for (const win of this.windows) {
      if (win.closed || !win.visible) continue;

      // Check close button
      const closeDist = pinchPoint.distanceTo(
        new THREE.Vector3().setFromMatrixPosition(win.closeBtnMesh.matrixWorld)
      );
      if (closeDist < 0.04) {
        win.close();
        return true;
      }

      // Check drag targets
      for (const target of win.getDragTargets()) {
        const targetWorld = new THREE.Vector3();
        target.getWorldPosition(targetWorld);
        if (pinchPoint.distanceTo(targetWorld) < 0.12) {
          this._handDragState[handIdx].dragging = true;
          this._handDragState[handIdx].window = win;
          this._handDragState[handIdx].offset.copy(win.root.position).sub(pinchPoint);
          win.dragging = true;
          win.focus();
          return true;
        }
      }

      // Check borders for resize
      for (const [name, mesh] of Object.entries(win._borderMeshes)) {
        const meshWorld = new THREE.Vector3();
        mesh.getWorldPosition(meshWorld);
        if (pinchPoint.distanceTo(meshWorld) < 0.06) {
          this._startResize(win, name, pinchPoint, null, handIdx);
          return true;
        }
      }
    }
    return false;
  }

  onPinchEnd(handIdx) {
    const state = this._handDragState[handIdx];
    if (state.dragging && state.window) {
      state.window.dragging = false;
      state.dragging = false;
      state.window = null;
    }
    if (this._resizeState.active && this._resizeState.handIdx === handIdx) {
      this._endResize();
    }
  }

  onPinchMove(handIdx, pinchPoint) {
    const state = this._handDragState[handIdx];
    if (state.dragging && state.window) {
      const target = pinchPoint.clone().add(state.offset);
      state.window.root.position.lerp(target, 0.4);
      // Billboard
      const camPos = new THREE.Vector3();
      this.camera.getWorldPosition(camPos);
      state.window.root.lookAt(camPos);
    }
    if (this._resizeState.active && this._resizeState.handIdx === handIdx) {
      this._updateResize(pinchPoint);
    }
  }

  // ── Resize logic ──────────────────────────────────────────────

  _startResize(win, edge, point, controller, handIdx) {
    this._resizeState.active = true;
    this._resizeState.window = win;
    this._resizeState.edge = edge;
    this._resizeState.controller = controller;
    this._resizeState.handIdx = handIdx;
    this._resizeState.startPoint.copy(point);
    this._resizeState.startWidth = win.width;
    this._resizeState.startHeight = win.height;
    this._resizeState.startPos.copy(win.root.position);
    win.resizing = true;
    win.focus();
  }

  _updateResize(currentPoint) {
    const rs = this._resizeState;
    if (!rs.active || !rs.window) return;

    const win = rs.window;
    const delta = currentPoint.clone().sub(rs.startPoint);

    // Convert world delta to local delta (approximate, ignoring rotation for now)
    let newW = rs.startWidth;
    let newH = rs.startHeight;

    if (rs.edge === 'right' || rs.edge === 'br' || rs.edge === 'tr') {
      newW = rs.startWidth + delta.x;
    }
    if (rs.edge === 'left' || rs.edge === 'bl' || rs.edge === 'tl') {
      newW = rs.startWidth - delta.x;
    }
    if (rs.edge === 'bottom' || rs.edge === 'bl' || rs.edge === 'br') {
      newH = rs.startHeight - delta.y;
    }
    if (rs.edge === 'top' || rs.edge === 'tl' || rs.edge === 'tr') {
      newH = rs.startHeight + delta.y;
    }

    newW = Math.max(win.minWidth, Math.min(win.maxWidth, newW));
    newH = Math.max(win.minHeight, Math.min(win.maxHeight, newH));

    if (Math.abs(newW - win.width) > 0.01 || Math.abs(newH - win.height) > 0.01) {
      win.width = newW;
      win.height = newH;
      const pos = [win.root.position.x, win.root.position.y, win.root.position.z];
      win.root.clear();
      this.scene.remove(win.root);
      win._build(pos);
    }
  }

  _endResize() {
    if (this._resizeState.window) {
      this._resizeState.window.resizing = false;
    }
    this._resizeState.active = false;
    this._resizeState.window = null;
  }

  // ── Per-frame update (call from animation loop) ───────────────

  update(frame, dt, elapsed, controllers) {
    // ── Hover detection via controllers ──
    if (controllers) {
      // Reset all hover states
      this.windows.forEach(w => { w.hoverTarget = null; });

      for (const ctrl of controllers) {
        if (!ctrl || !ctrl.matrixWorld) continue;

        this._tempMatrix.identity().extractRotation(ctrl.matrixWorld);
        this._raycaster.ray.origin.setFromMatrixPosition(ctrl.matrixWorld);
        this._raycaster.ray.direction.set(0, 0, -1).applyMatrix4(this._tempMatrix);

        for (const win of this.windows) {
          if (win.closed || !win.visible) continue;
          this._detectHover(win);
        }
      }
    }

    // ── Controller drag update ──
    if (this._controllerDragWindow && this._controllerDragCtrl) {
      const win = this._controllerDragWindow;
      const ctrl = this._controllerDragCtrl;

      this._tempMatrix.identity().extractRotation(ctrl.matrixWorld);
      this._raycaster.ray.origin.setFromMatrixPosition(ctrl.matrixWorld);
      this._raycaster.ray.direction.set(0, 0, -1).applyMatrix4(this._tempMatrix);

      const dist = win.root.position.distanceTo(this._raycaster.ray.origin);
      const target = this._raycaster.ray.origin.clone()
        .add(this._raycaster.ray.direction.clone().multiplyScalar(dist));
      target.add(this._controllerDragOffset);

      win.root.position.lerp(target, 0.5);

      // Billboard
      const camPos = new THREE.Vector3();
      this.camera.getWorldPosition(camPos);
      win.root.lookAt(camPos);
    }

    // ── Controller resize update ──
    if (this._resizeState.active && this._resizeState.controller) {
      const ctrl = this._resizeState.controller;
      this._tempMatrix.identity().extractRotation(ctrl.matrixWorld);
      this._raycaster.ray.origin.setFromMatrixPosition(ctrl.matrixWorld);
      this._raycaster.ray.direction.set(0, 0, -1).applyMatrix4(this._tempMatrix);

      const dist = this._resizeState.startPoint.distanceTo(this._raycaster.ray.origin);
      const currentPoint = this._raycaster.ray.origin.clone()
        .add(this._raycaster.ray.direction.clone().multiplyScalar(dist));
      this._updateResize(currentPoint);
    }

    // ── Update all windows ──
    for (const win of this.windows) {
      win.update(dt, elapsed);
    }
  }

  _detectHover(win) {
    // Check drag bar
    const dragHits = this._raycaster.intersectObject(win.dragBarMesh, false);
    if (dragHits.length > 0) { win.hoverTarget = 'dragBar'; return; }

    // Check close button
    const closeHits = this._raycaster.intersectObject(win.closeBtnMesh, false);
    if (closeHits.length > 0) { win.hoverTarget = 'closeBtn'; return; }

    // Check borders
    for (const [name, mesh] of Object.entries(win._borderMeshes)) {
      const hits = this._raycaster.intersectObject(mesh, false);
      if (hits.length > 0) {
        win.hoverTarget = 'border_' + name;
        return;
      }
    }

    // Check resize handles
    for (const [name, handle] of Object.entries(win._resizeHandles)) {
      const hits = this._raycaster.intersectObject(handle.mesh, false);
      if (hits.length > 0) {
        win.hoverTarget = name; // 'br','bl','tr','tl'
        return;
      }
    }
  }

  // ── Hand-based hover detection ────────────────────────────────

  updateHandHover(handIdx, fingerTipPos) {
    if (!fingerTipPos) return;

    for (const win of this.windows) {
      if (win.closed || !win.visible) continue;

      // Drag bar proximity
      const dragWorld = new THREE.Vector3();
      win.dragBarMesh.getWorldPosition(dragWorld);
      if (fingerTipPos.distanceTo(dragWorld) < 0.06) {
        win.hoverTarget = 'dragBar';
        continue;
      }

      // Close button proximity
      const closeWorld = new THREE.Vector3();
      win.closeBtnMesh.getWorldPosition(closeWorld);
      if (fingerTipPos.distanceTo(closeWorld) < 0.04) {
        win.hoverTarget = 'closeBtn';
        continue;
      }

      // Borders proximity
      for (const [name, mesh] of Object.entries(win._borderMeshes)) {
        const meshWorld = new THREE.Vector3();
        mesh.getWorldPosition(meshWorld);
        if (fingerTipPos.distanceTo(meshWorld) < 0.05) {
          win.hoverTarget = 'border_' + name;
          break;
        }
      }
    }
  }
}
