// ═══════════════════════════════════════════════════════════════════
//  WindowManager.js — Pixelated Window Manager for WebXR AR
//  (ES module version with extensions for terminal integration)
// ═══════════════════════════════════════════════════════════════════

// ─── Pixel Art Utilities ─────────────────────────────────────────

const PixelArt = {
  ORANGE_LIGHT:  '#FFB347',
  ORANGE:        '#F97316',
  ORANGE_DARK:   '#C2410C',
  ORANGE_SHADOW: '#7C2D12',
  BLACK:         '#000000',
  DARK_BG:       '#0A0A0A',
  BORDER_BG:     '#111111',

  drawPixel(ctx, px, py, pixelSize, color) {
    ctx.fillStyle = color;
    ctx.fillRect(px * pixelSize, py * pixelSize, pixelSize, pixelSize);
  },

  drawSprite(ctx, grid, ox, oy, pixelSize, palette) {
    for (let r = 0; r < grid.length; r++) {
      for (let c = 0; c < grid[r].length; c++) {
        const idx = grid[r][c];
        if (idx === 0) continue;
        ctx.fillStyle = palette[idx];
        ctx.fillRect(ox + c * pixelSize, oy + r * pixelSize, pixelSize, pixelSize);
      }
    }
  },

  fillSolidBorder(ctx, x, y, w, h, color) {
    ctx.fillStyle = color || this.ORANGE;
    ctx.fillRect(x, y, w, h);
  },

  drawPixelText(ctx, text, x, y, pixelSize, color) {
    const glyphs = this._getGlyphs();
    ctx.fillStyle = color;
    let cursorX = x;
    for (const ch of text.toUpperCase()) {
      const glyph = glyphs[ch];
      if (glyph) {
        for (let r = 0; r < glyph.length; r++) {
          for (let c = 0; c < glyph[r].length; c++) {
            if (glyph[r][c]) {
              ctx.fillRect(cursorX + c * pixelSize, y + r * pixelSize, pixelSize, pixelSize);
            }
          }
        }
      }
      cursorX += (glyph ? glyph[0].length + 1 : 3) * pixelSize;
    }
  },

  measurePixelText(text, pixelSize) {
    const glyphs = this._getGlyphs();
    let w = 0;
    for (const ch of text.toUpperCase()) {
      const g = glyphs[ch];
      w += (g ? g[0].length + 1 : 3) * pixelSize;
    }
    return w - pixelSize;
  },

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

  makeCloseIcon(pixelSize, color, bgColor) {
    const size = 3 * pixelSize;
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    if (bgColor) { ctx.fillStyle = bgColor; ctx.fillRect(0, 0, size, size); }
    ctx.fillStyle = color;
    const ps = pixelSize;
    ctx.fillRect(0, 0, ps, ps); ctx.fillRect(2*ps, 0, ps, ps);
    ctx.fillRect(ps, ps, ps, ps);
    ctx.fillRect(0, 2*ps, ps, ps); ctx.fillRect(2*ps, 2*ps, ps, ps);
    return canvas;
  },

  makeDragBarIcon(widthPx, pixelSize, color, bgColor) {
    const artW = widthPx, artH = 3;
    const canvas = document.createElement('canvas');
    canvas.width = artW * pixelSize; canvas.height = artH * pixelSize;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    if (bgColor) { ctx.fillStyle = bgColor; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    ctx.fillStyle = color;
    for (let row = 0; row < 3; row++)
      for (let col = 0; col < artW; col++)
        if ((row + col) % 2 === 0)
          ctx.fillRect(col * pixelSize, row * pixelSize, pixelSize, pixelSize);
    return canvas;
  },

  makeResizeIcon(pixelSize, color) {
    const size = 5;
    const canvas = document.createElement('canvas');
    canvas.width = size * pixelSize; canvas.height = size * pixelSize;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = color;
    const pattern = [[0,0,0,0,1],[0,0,0,0,0],[0,0,1,0,1],[0,0,0,0,0],[1,0,1,0,1]];
    for (let r = 0; r < size; r++)
      for (let c = 0; c < size; c++)
        if (pattern[r][c])
          ctx.fillRect(c * pixelSize, r * pixelSize, pixelSize, pixelSize);
    return canvas;
  },
};


// ─── ManagedWindow Class ─────────────────────────────────────────

class ManagedWindow {
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
    this.closable = opts.closable !== false; // default true

    // Drag state
    this.dragging   = false;
    this.dragOffset = new THREE.Vector3();

    // Resize state
    this.resizing       = false;
    this.resizeEdge     = null;
    this.resizeStart    = new THREE.Vector3();
    this.resizeStartW   = 0;
    this.resizeStartH   = 0;
    this.minWidth  = 0.25;
    this.maxWidth  = 1.4;
    this.minHeight = 0.18;
    this.maxHeight = 1.0;

    // Hover state
    this.hoverTarget = null;

    // Internal canvas dimensions — configurable
    this.CANVAS_W = opts.canvasWidth  || 512;
    this.CANVAS_H = opts.canvasHeight || 384;
    this.BORDER_ART_PX = 5;
    this.PIXEL_SIZE = 4;

    this._build(opts.position || [0, 1.5, -0.8]);
  }

  // ── Build all meshes ──────────────────────────────────────────
  _build(pos) {
    const W = this.width, H = this.height;
    const BORDER = 0.004, TITLEBAR_H = 0.04, BOTTOMBAR_H = 0.012;

    this.root = new THREE.Group();
    this.root.position.set(pos[0], pos[1], pos[2]);
    this.scene.add(this.root);

    this._buildContent(W, H, BORDER, TITLEBAR_H);
    this._buildTitleBar(W, TITLEBAR_H, BORDER);
    this._buildBorders(W, H, BORDER, TITLEBAR_H, BOTTOMBAR_H);
    this._buildBottomBar(W, H, BOTTOMBAR_H, BORDER);
    this._buildResizeHandles(W, H, BORDER, TITLEBAR_H, BOTTOMBAR_H);
  }

  _buildContent(W, H, border, titleH) {
    const contentW = W - border * 2;
    const contentH = H - titleH - 0.015;
    this._contentW = contentW;
    this._contentH = contentH;

    this._contentCanvas = document.createElement('canvas');
    this._contentCanvas.width = this.CANVAS_W;
    this._contentCanvas.height = this.CANVAS_H;
    this._contentCtx = this._contentCanvas.getContext('2d');
    this._contentCtx.imageSmoothingEnabled = false;

    this._drawContentCanvas();

    this._contentTex = new THREE.CanvasTexture(this._contentCanvas);
    this._contentTex.minFilter = THREE.LinearFilter;
    this._contentTex.magFilter = THREE.NearestFilter;

    const geo = new THREE.PlaneGeometry(contentW, contentH);
    this._contentMat = new THREE.MeshBasicMaterial({
      map: this._contentTex, transparent: true, side: THREE.DoubleSide,
    });
    this.contentMesh = new THREE.Mesh(geo, this._contentMat);
    this.contentMesh.position.y = -0.005;
    this.contentMesh.position.z = 0.001;
    this.root.add(this.contentMesh);
  }

  _drawContentCanvas() {
    const ctx = this._contentCtx, w = this.CANVAS_W, h = this.CANVAS_H;
    ctx.fillStyle = PixelArt.BLACK;
    ctx.fillRect(0, 0, w, h);
    if (this.contentDrawFn) this.contentDrawFn(ctx, w, h);
    if (this._contentTex) this._contentTex.needsUpdate = true;
  }

  _buildTitleBar(W, titleH, border) {
    this._titleH = titleH;
    const titleCanvasW = 512, titleCanvasH = 64;
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
      map: this._titleTex, transparent: true, side: THREE.DoubleSide,
    });
    this.titleMesh = new THREE.Mesh(geo, this._titleMat);
    this.titleMesh.position.y = this._contentH / 2 + titleH / 2;
    this.titleMesh.position.z = 0.001;
    this.root.add(this.titleMesh);
  }

  _drawTitleCanvas() {
    const ctx = this._titleCtx, w = this._titleCanvas.width, h = this._titleCanvas.height;
    const ps = 3;
    // Dark background matching content
    ctx.fillStyle = '#0c0c12';
    ctx.fillRect(0, 0, w, h);
    // Thin orange accent line at top (2px)
    ctx.fillStyle = '#FF6B00';
    ctx.fillRect(0, 0, w, 2);
    // Subtle bottom separator
    ctx.fillStyle = 'rgba(255, 107, 0, 0.15)';
    ctx.fillRect(0, h - 1, w, 1);
    // Pixel title text
    const textW = PixelArt.measurePixelText(this.title, ps);
    const textX = (w - textW) / 2;
    const textY = (h - 7 * ps) / 2 + 2;
    PixelArt.drawPixelText(ctx, this.title, textX, textY, ps, '#FF6B00');
    if (this._titleTex) this._titleTex.needsUpdate = true;
  }

  _buildBorders(W, H, border, titleH, bottomH) {
    const sideH = this._contentH;
    this._borderMeshes = {};
    const makeBorderMat = () => new THREE.MeshBasicMaterial({
      color: 0xFF6B00, transparent: true, opacity: 0.15, side: THREE.DoubleSide
    });

    const leftGeo = new THREE.PlaneGeometry(border, sideH);
    this._leftBorderMat = makeBorderMat();
    const leftMesh = new THREE.Mesh(leftGeo, this._leftBorderMat);
    leftMesh.position.set(-W/2 + border/2, -0.005, 0.0005);
    this.root.add(leftMesh);
    this._borderMeshes.left = leftMesh;

    const rightGeo = new THREE.PlaneGeometry(border, sideH);
    this._rightBorderMat = makeBorderMat();
    const rightMesh = new THREE.Mesh(rightGeo, this._rightBorderMat);
    rightMesh.position.set(W/2 - border/2, -0.005, 0.0005);
    this.root.add(rightMesh);
    this._borderMeshes.right = rightMesh;

    const botGeo = new THREE.PlaneGeometry(W, border);
    this._botBorderMat = makeBorderMat();
    const botMesh = new THREE.Mesh(botGeo, this._botBorderMat);
    botMesh.position.set(0, -this._contentH/2 - border/2, 0.0005);
    this.root.add(botMesh);
    this._borderMeshes.bottom = botMesh;
  }

  _buildBottomBar(W, H, barH, border) {
    const totalContentH = this._contentH;
    const PILL_H = 0.008, PILL_W = W * 0.45, CLOSE_W = 0.012, GAP = 0.008;
    const GROUP_W = PILL_W + GAP + CLOSE_W;
    const barY = -totalContentH/2 - 0.015 - PILL_H/2 - 0.004;

    // Pill drag bar
    const pillCanvas = document.createElement('canvas');
    const PC_W = 48, PC_H = 6;
    pillCanvas.width = PC_W; pillCanvas.height = PC_H;
    const pctx = pillCanvas.getContext('2d');
    pctx.imageSmoothingEnabled = false;
    pctx.fillStyle = '#FF6B00';
    pctx.fillRect(1, 0, PC_W-2, PC_H);
    pctx.fillRect(0, 1, 1, PC_H-2);
    pctx.fillRect(PC_W-1, 1, 1, PC_H-2);

    const pillTex = new THREE.CanvasTexture(pillCanvas);
    pillTex.minFilter = THREE.NearestFilter; pillTex.magFilter = THREE.NearestFilter;

    const dragGeo = new THREE.PlaneGeometry(PILL_W, PILL_H);
    this._dragBarMat = new THREE.MeshBasicMaterial({
      map: pillTex, transparent: true, opacity: 0.20, side: THREE.DoubleSide
    });
    this.dragBarMesh = new THREE.Mesh(dragGeo, this._dragBarMat);
    this.dragBarMesh.position.set(-GROUP_W/2 + PILL_W/2, barY, 0.001);
    this.root.add(this.dragBarMesh);

    // Close button
    const closeCanvas = document.createElement('canvas');
    const CC = 8;
    closeCanvas.width = CC; closeCanvas.height = CC;
    const cctx = closeCanvas.getContext('2d');
    cctx.imageSmoothingEnabled = false;
    cctx.fillStyle = '#FF6B00';
    cctx.fillRect(1, 0, CC-2, CC);
    cctx.fillRect(0, 1, CC, CC-2);

    const closeTex = new THREE.CanvasTexture(closeCanvas);
    closeTex.minFilter = THREE.NearestFilter; closeTex.magFilter = THREE.NearestFilter;

    const closeGeo = new THREE.PlaneGeometry(CLOSE_W, CLOSE_W);
    this._closeBtnMat = new THREE.MeshBasicMaterial({
      map: closeTex, transparent: true, opacity: 0.20, side: THREE.DoubleSide
    });
    this.closeBtnMesh = new THREE.Mesh(closeGeo, this._closeBtnMat);
    this.closeBtnMesh.position.set(-GROUP_W/2 + PILL_W + GAP + CLOSE_W/2, barY, 0.001);
    this.root.add(this.closeBtnMesh);

    // Hide close button if not closable
    if (!this.closable) this.closeBtnMesh.visible = false;
  }

  _buildResizeHandles(W, H, border, titleH, bottomH) {
    this._resizeHandles = {};
    const handleSize = 0.045, outset = 0.012;

    const makeCornerCanvas = () => {
      const C = 8;
      const canvas = document.createElement('canvas');
      canvas.width = C; canvas.height = C;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = '#FF6B00';
      ctx.fillRect(0, 0, C, 2);
      ctx.fillRect(0, 0, 2, C);
      return canvas;
    };

    const makeHandle = (name, x, y, rotZ) => {
      const cornerCanvas = makeCornerCanvas();
      const cornerTex = new THREE.CanvasTexture(cornerCanvas);
      cornerTex.minFilter = THREE.NearestFilter; cornerTex.magFilter = THREE.NearestFilter;

      const geo = new THREE.PlaneGeometry(handleSize, handleSize);
      const mat = new THREE.MeshBasicMaterial({
        map: cornerTex, transparent: true, opacity: 0.0, side: THREE.DoubleSide
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, 0.002);
      mesh.rotation.z = rotZ || 0;
      mesh.visible = true;
      this.root.add(mesh);
      this._resizeHandles[name] = { mesh, mat, baseOpacity: 0.0, targetOpacity: 0.0 };
    };

    const halfW = W / 2, halfH = this._contentH / 2;
    makeHandle('br',  halfW + outset, -halfH - 0.015 - outset, -Math.PI/2);
    makeHandle('bl', -halfW - outset, -halfH - 0.015 - outset, Math.PI);
    makeHandle('tr',  halfW + outset,  halfH + this._titleH + outset, 0);
    makeHandle('tl', -halfW - outset,  halfH + this._titleH + outset, Math.PI/2);
  }

  // ── Public API ────────────────────────────────────────────────

  setTitle(text) { this.title = text; this._drawTitleCanvas(); }

  setContent(drawFn) { this.contentDrawFn = drawFn; this._drawContentCanvas(); }

  /** Mark content texture as needing update (for direct canvas drawing) */
  markContentDirty() { if (this._contentTex) this._contentTex.needsUpdate = true; }

  /** Direct access to content canvas */
  get contentCanvas() { return this._contentCanvas; }
  get contentCtx() { return this._contentCtx; }

  /** Y offset of title bar center relative to root (for placing buttons) */
  getTitleBarYOffset() { return this._contentH / 2 + this._titleH / 2; }

  close() {
    this.closed = true;
    this.root.visible = false;
    this.scene.remove(this.root);
    this.manager._removeWindow(this);
  }

  minimize() {
    this.minimized = !this.minimized;
    this.contentMesh.visible = !this.minimized;
    Object.values(this._borderMeshes).forEach(m => m.visible = !this.minimized);
    Object.values(this._resizeHandles).forEach(h => h.mesh.visible = !this.minimized);
  }

  focus() { this.manager._focusWindow(this); }

  getInteractableMeshes() {
    const meshes = [this.titleMesh, this.contentMesh, this.dragBarMesh, this.closeBtnMesh];
    Object.values(this._borderMeshes).forEach(m => meshes.push(m));
    Object.values(this._resizeHandles).forEach(h => meshes.push(h.mesh));
    return meshes;
  }

  getDragTargets() { return [this.dragBarMesh]; }

  update(dt, elapsed) {
    if (this.closed || !this.visible) return;
    this._updateHover(dt);
  }

  _updateHover(dt) {
    const lerpSpeed = 8;

    const dragHover = this.hoverTarget === 'dragBar';
    const dragTargetOpacity = dragHover ? 0.7 : 0.20;
    this._dragBarMat.opacity += (dragTargetOpacity - this._dragBarMat.opacity) * lerpSpeed * dt;
    const dragTargetScale = dragHover ? 1.15 : 1.0;
    const cs = this.dragBarMesh.scale.x;
    this.dragBarMesh.scale.set(cs + (dragTargetScale - cs) * lerpSpeed * dt, 1, 1);

    if (this.closable) {
      const closeHover = this.hoverTarget === 'closeBtn';
      const closeTargetOpacity = closeHover ? 0.8 : 0.20;
      this._closeBtnMat.opacity += (closeTargetOpacity - this._closeBtnMat.opacity) * lerpSpeed * dt;
      const closeTargetScale = closeHover ? 1.4 : 1.0;
      const ccs = this.closeBtnMesh.scale.x;
      const cns = ccs + (closeTargetScale - ccs) * lerpSpeed * dt;
      this.closeBtnMesh.scale.set(cns, cns, 1);
    }

    for (const [name, handle] of Object.entries(this._resizeHandles)) {
      const isActive = this.hoverTarget === name;
      handle.targetOpacity = isActive ? 1.0 : 0.0;
      handle.mat.opacity += (handle.targetOpacity - handle.mat.opacity) * lerpSpeed * dt;
    }
  }

  _rebuildAfterResize() {
    while (this.root.children.length > 0) this.root.remove(this.root.children[0]);
    this._build_internal(0.004, 0.04, 0.012);
  }

  _build_internal(border, titleH, bottomH) {
    const W = this.width, H = this.height;
    this._buildContent(W, H, border, titleH);
    this._buildTitleBar(W, titleH, border);
    this._buildBorders(W, H, border, titleH, bottomH);
    this._buildBottomBar(W, H, bottomH, border);
    this._buildResizeHandles(W, H, border, titleH, bottomH);
  }
}


// ─── WindowManager Class ─────────────────────────────────────────

class WindowManager {
  constructor(scene, renderer, camera) {
    this.scene    = scene;
    this.renderer = renderer;
    this.camera   = camera;
    this.windows  = [];
    this._nextZ   = 0;

    this._raycaster = new THREE.Raycaster();
    this._tempMatrix = new THREE.Matrix4();

    this._controllerDragWindow = null;
    this._controllerDragCtrl   = null;
    this._controllerDragOffset = new THREE.Vector3();
    this._controllerDragDist   = 0;

    this._handDragState = [
      { dragging: false, window: null, offset: new THREE.Vector3() },
      { dragging: false, window: null, offset: new THREE.Vector3() },
    ];

    this._resizeState = {
      active: false, window: null, edge: null,
      controller: null, handIdx: null,
      startPoint: new THREE.Vector3(),
      startWidth: 0, startHeight: 0, startPos: new THREE.Vector3(),
    };
  }

  createWindow(opts = {}) {
    const win = new ManagedWindow({
      ...opts,
      scene: this.scene, renderer: this.renderer,
      camera: this.camera, manager: this,
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
    win.root.position.z += 0.001;
    this.windows.forEach(w => { if (w !== win) w.focused = false; });
  }

  // ── Controller interaction ───────────────────────────────────

  onSelectStart(controller) {
    this._tempMatrix.identity().extractRotation(controller.matrixWorld);
    this._raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    this._raycaster.ray.direction.set(0, 0, -1).applyMatrix4(this._tempMatrix);

    for (const win of this.windows) {
      if (win.closed || !win.visible) continue;

      // Close button (only if closable)
      if (win.closable) {
        const closeHits = this._raycaster.intersectObject(win.closeBtnMesh, false);
        if (closeHits.length > 0) { win.close(); return; }
      }

      // Drag targets
      const dragHits = this._raycaster.intersectObjects(win.getDragTargets(), false);
      if (dragHits.length > 0) {
        this._controllerDragWindow = win;
        this._controllerDragCtrl = controller;
        this._controllerDragOffset.copy(win.root.position).sub(dragHits[0].point);
        this._controllerDragDist = dragHits[0].distance;
        win.dragging = true;
        win.focus();
        return;
      }

      // Resize handles
      for (const [name, handle] of Object.entries(win._resizeHandles)) {
        const resizeHits = this._raycaster.intersectObject(handle.mesh, false);
        if (resizeHits.length > 0) {
          this._startResize(win, name, resizeHits[0].point, controller, null);
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

  // ── Hand pinch ────────────────────────────────────────────────

  onPinchStart(handIdx, pinchPoint) {
    for (const win of this.windows) {
      if (win.closed || !win.visible) continue;

      // Close button (only if closable)
      if (win.closable) {
        const closeDist = pinchPoint.distanceTo(
          new THREE.Vector3().setFromMatrixPosition(win.closeBtnMesh.matrixWorld)
        );
        if (closeDist < 0.04) { win.close(); return true; }
      }

      // Drag targets
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

      // Resize handles
      for (const [name, handle] of Object.entries(win._resizeHandles)) {
        const handleWorld = new THREE.Vector3();
        handle.mesh.getWorldPosition(handleWorld);
        if (pinchPoint.distanceTo(handleWorld) < 0.06) {
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
      state.window.root.position.copy(pinchPoint.clone().add(state.offset));
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
    let newW = rs.startWidth, newH = rs.startHeight;

    if (rs.edge === 'right' || rs.edge === 'br' || rs.edge === 'tr') newW = rs.startWidth + delta.x;
    if (rs.edge === 'left'  || rs.edge === 'bl' || rs.edge === 'tl') newW = rs.startWidth - delta.x;
    if (rs.edge === 'bottom'|| rs.edge === 'bl' || rs.edge === 'br') newH = rs.startHeight - delta.y;
    if (rs.edge === 'top'   || rs.edge === 'tl' || rs.edge === 'tr') newH = rs.startHeight + delta.y;

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
    if (this._resizeState.window) this._resizeState.window.resizing = false;
    this._resizeState.active = false;
    this._resizeState.window = null;
  }

  // ── Per-frame update ───────────────────────────────────────────

  update(frame, dt, elapsed, controllers) {
    if (controllers) {
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

    // Controller drag
    if (this._controllerDragWindow && this._controllerDragCtrl) {
      const win = this._controllerDragWindow, ctrl = this._controllerDragCtrl;
      this._tempMatrix.identity().extractRotation(ctrl.matrixWorld);
      this._raycaster.ray.origin.setFromMatrixPosition(ctrl.matrixWorld);
      this._raycaster.ray.direction.set(0, 0, -1).applyMatrix4(this._tempMatrix);
      const target = this._raycaster.ray.origin.clone()
        .add(this._raycaster.ray.direction.clone().multiplyScalar(this._controllerDragDist));
      target.add(this._controllerDragOffset);
      win.root.position.copy(target);
    }

    // Controller resize
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

    for (const win of this.windows) win.update(dt, elapsed);
  }

  _detectHover(win) {
    const dragHits = this._raycaster.intersectObject(win.dragBarMesh, false);
    if (dragHits.length > 0) { win.hoverTarget = 'dragBar'; return; }

    if (win.closable) {
      const closeHits = this._raycaster.intersectObject(win.closeBtnMesh, false);
      if (closeHits.length > 0) { win.hoverTarget = 'closeBtn'; return; }
    }

    for (const [name, handle] of Object.entries(win._resizeHandles)) {
      const hits = this._raycaster.intersectObject(handle.mesh, false);
      if (hits.length > 0) { win.hoverTarget = name; return; }
    }

    for (const [name, mesh] of Object.entries(win._borderMeshes)) {
      const hits = this._raycaster.intersectObject(mesh, false);
      if (hits.length > 0) { win.hoverTarget = 'border_' + name; return; }
    }
  }

  updateHandHover(handIdx, fingerTipPos) {
    if (!fingerTipPos) return;
    for (const win of this.windows) {
      if (win.closed || !win.visible) continue;

      const dragWorld = new THREE.Vector3();
      win.dragBarMesh.getWorldPosition(dragWorld);
      if (fingerTipPos.distanceTo(dragWorld) < 0.06) { win.hoverTarget = 'dragBar'; continue; }

      if (win.closable) {
        const closeWorld = new THREE.Vector3();
        win.closeBtnMesh.getWorldPosition(closeWorld);
        if (fingerTipPos.distanceTo(closeWorld) < 0.04) { win.hoverTarget = 'closeBtn'; continue; }
      }

      let foundHandle = false;
      for (const [name, handle] of Object.entries(win._resizeHandles)) {
        const handleWorld = new THREE.Vector3();
        handle.mesh.getWorldPosition(handleWorld);
        if (fingerTipPos.distanceTo(handleWorld) < 0.06) {
          win.hoverTarget = name; foundHandle = true; break;
        }
      }
      if (foundHandle) continue;

      for (const [name, mesh] of Object.entries(win._borderMeshes)) {
        const meshWorld = new THREE.Vector3();
        mesh.getWorldPosition(meshWorld);
        if (fingerTipPos.distanceTo(meshWorld) < 0.05) {
          win.hoverTarget = 'border_' + name; break;
        }
      }
    }
  }
}

export { PixelArt, ManagedWindow, WindowManager };
