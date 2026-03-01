// ═══════════════════════════════════════════════════════════════════
//  ManagedWindow.js — Pixel Art Window for WebXR AR
//  Uses image-based 9-slice frame from pixilart sprite layers
// ═══════════════════════════════════════════════════════════════════

import { PixelArt } from './PixelArt.js';

// ── Shared image loader (loads once, used by all windows) ──────
const _imageCache = {};
function _loadImage(src) {
  if (_imageCache[src]) return _imageCache[src];
  const promise = new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
  _imageCache[src] = promise;
  return promise;
}

// Preload all sprite layers
const SPRITE_DIR = '/pixilart-layers-4';
const _sprites = {
  frame:   _loadImage(`${SPRITE_DIR}/frame.png`),
  handles: _loadImage(`${SPRITE_DIR}/handles.png`),
  close:   _loadImage(`${SPRITE_DIR}/close.png`),
  move:    _loadImage(`${SPRITE_DIR}/move.png`),
};

// ── 9-slice drawing utility ────────────────────────────────────
// Sprite is 1970x1970 with 10x10 art-pixel grid (each art-pixel = 197px)
// frame.png: octagon frame with orange border + dark interior
// We slice corners at 2 art-pixels (394px) to preserve the rounded shape

const SRC_SIZE = 1970;

// ── 9-slice with small fixed-size square corners + center fill ─
// Source: 1970×1970 sprite, split at center (985,985).
// Destination: corners are drawn as small SQUARES (no stretch/distortion),
// edges stretch in one direction, center fills the rest.
//
// cornerPx = pixel size of each corner on the dest canvas (default 24).
// Corners stay square regardless of canvas aspect ratio.

function draw9Slice(ctx, img, dw, dh, cornerPx) {
  const c = cornerPx || 24;  // small square corners on dest
  const sw = img.naturalWidth  || img.width;
  const sh = img.naturalHeight || img.height;

  // Source slice at 50%
  const shx = Math.floor(sw / 2);  // source half-x (985)
  const shy = Math.floor(sh / 2);  // source half-y (985)

  // ── 1) Fill the entire center with the interior color ──
  // Sample a 1px strip from dead center of sprite and tile it
  const midW = dw - c * 2;
  const midH = dh - c * 2;
  if (midW > 0 && midH > 0) {
    // Stretch a tiny center patch across the whole middle
    ctx.drawImage(img, shx - 1, shy - 1, 2, 2,  c, c, midW, midH);
  }

  // ── 2) Edges (stretch one axis, fixed on the other) ──
  // Top edge
  if (midW > 0) {
    ctx.drawImage(img, shx - 1, 0, 2, shy,       c, 0, midW, c);
    // Bottom edge
    ctx.drawImage(img, shx - 1, shy, 2, sh - shy, c, dh - c, midW, c);
  }
  // Left edge
  if (midH > 0) {
    ctx.drawImage(img, 0, shy - 1, shx, 2,       0, c, c, midH);
    // Right edge
    ctx.drawImage(img, shx, shy - 1, sw - shx, 2, dw - c, c, c, midH);
  }

  // ── 3) Corners (square, no distortion) ──
  // TL: source top-left quadrant → small square
  ctx.drawImage(img, 0,   0,   shx,      shy,       0,      0,      c, c);
  // TR: source top-right quadrant → small square
  ctx.drawImage(img, shx, 0,   sw - shx, shy,       dw - c, 0,      c, c);
  // BL: source bottom-left quadrant → small square
  ctx.drawImage(img, 0,   shy, shx,      sh - shy,  0,      dh - c, c, c);
  // BR: source bottom-right quadrant → small square
  ctx.drawImage(img, shx, shy, sw - shx, sh - shy,  dw - c, dh - c, c, c);
}


class ManagedWindow {
  constructor(opts) {
    this.manager  = opts.manager;
    this.scene    = opts.scene;
    this.renderer = opts.renderer;
    this.camera   = opts.camera;

    this.title    = opts.title || 'Untitled';
    this.width    = opts.width || 0.6;
    this.height   = opts.height || 0.45;
    this.contentDrawFn = opts.content || null;
    this.visible  = true;
    this.minimized = false;
    this.closed   = false;
    this.focused  = true;
    this.zIndex   = 0;
    this.closable = opts.closable !== false;

    this.dragging   = false;
    this.dragOffset = new THREE.Vector3();
    this.resizing       = false;
    this.resizeEdge     = null;
    this.resizeStart    = new THREE.Vector3();
    this.resizeStartW   = 0;
    this.resizeStartH   = 0;
    this.minWidth  = 0.25;
    this.maxWidth  = 1.4;
    this.minHeight = 0.18;
    this.maxHeight = 1.0;

    this.hoverTarget = null;

    this._fadeOpacity = 1;
    this._fadeScale = 1;
    this._targetFadeOpacity = 1;
    this._targetFadeScale = 1;

    this.CANVAS_W = opts.canvasWidth  || 512;
    this.CANVAS_H = opts.canvasHeight || 384;

    // Sprite images (loaded async)
    this._frameImg = null;
    this._handlesImg = null;
    this._closeImg = null;
    this._moveImg = null;

    this._build(opts.position || [0, 1.5, -0.8]);
    this._loadSprites();

    // Face the camera on creation
    if (this.camera) {
      const camPos = new THREE.Vector3();
      this.camera.getWorldPosition(camPos);
      const lookTarget = new THREE.Vector3(camPos.x, this.root.position.y, camPos.z);
      this.root.lookAt(lookTarget);
    }
  }

  async _loadSprites() {
    try {
      const [frame, handles, close, move] = await Promise.all([
        _sprites.frame, _sprites.handles, _sprites.close, _sprites.move,
      ]);
      this._frameImg = frame;
      this._handlesImg = handles;
      this._closeImg = close;
      this._moveImg = move;
      // Redraw everything now that images are loaded
      this._drawFrameCanvas();
      this._drawHandlesCanvas();
      this._drawCloseCanvas();
      this._drawMoveCanvas();
    } catch (e) {
      console.warn('[ManagedWindow] Failed to load sprites:', e);
    }
  }

  // ── Build all meshes ──────────────────────────────────────────
  _build(pos) {
    const W = this.width;
    const H = this.height;

    this.root = new THREE.Group();
    this.root.position.set(pos[0], pos[1], pos[2]);
    this.scene.add(this.root);

    this._buildFrame(W, H);
    this._buildContent(W, H);
    this._buildTitle(W, H);
    this._buildHandles(W, H);
    this._buildCloseBtn(W, H);
    this._buildMoveBar(W, H);
    this._buildResizeHandles(W, H);
    this._buildBorders(W, H);
  }

  // ── Frame (9-slice pixel-art image) ─────────────────────────
  _buildFrame(W, H) {
    const FRAME_RES = 512;
    const aspect = W / H;
    const frameCanvasW = Math.round(FRAME_RES * Math.max(1, aspect));
    const frameCanvasH = Math.round(FRAME_RES / Math.min(1, aspect));

    this._frameCanvas = document.createElement('canvas');
    this._frameCanvas.width = frameCanvasW;
    this._frameCanvas.height = frameCanvasH;
    this._frameCtx = this._frameCanvas.getContext('2d');
    this._frameCtx.imageSmoothingEnabled = false;

    this._drawFrameCanvas();

    this._frameTex = new THREE.CanvasTexture(this._frameCanvas);
    this._frameTex.minFilter = THREE.LinearFilter;
    this._frameTex.magFilter = THREE.NearestFilter;

    const geo = new THREE.PlaneGeometry(W, H);
    this._frameMat = new THREE.MeshBasicMaterial({
      map: this._frameTex,
      transparent: true,
      side: THREE.DoubleSide,
    });
    this._frameMesh = new THREE.Mesh(geo, this._frameMat);
    this._frameMesh.position.z = -0.001;
    this.root.add(this._frameMesh);
  }

  _drawFrameCanvas() {
    const ctx = this._frameCtx;
    if (!ctx) return;
    const w = this._frameCanvas.width;
    const h = this._frameCanvas.height;
    ctx.clearRect(0, 0, w, h);
    if (this._frameImg) {
      draw9Slice(ctx, this._frameImg, w, h);
    } else {
      // Fallback while loading
      ctx.fillStyle = '#0c0c12';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#FF7E00';
      ctx.lineWidth = 8;
      ctx.strokeRect(4, 4, w - 8, h - 8);
    }
    if (this._frameTex) this._frameTex.needsUpdate = true;
  }

  // ── Content area (inside the frame border) ──────────────────
  _buildContent(W, H) {
    // Content is inset just enough to sit inside the thin frame border
    const borderFrac = 0.06;
    const contentW = W * (1 - borderFrac * 2);
    const contentH = H * (1 - borderFrac * 2);
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
      map: this._contentTex,
      transparent: true,
      side: THREE.DoubleSide,
    });
    this.contentMesh = new THREE.Mesh(geo, this._contentMat);
    this.contentMesh.position.z = 0.001;
    this.root.add(this.contentMesh);
  }

  _drawContentCanvas() {
    const ctx = this._contentCtx;
    if (!ctx) return;
    const w = this.CANVAS_W;
    const h = this.CANVAS_H;

    ctx.fillStyle = '#0c0c12';
    ctx.fillRect(0, 0, w, h);

    if (this.contentDrawFn) {
      this.contentDrawFn(ctx, w, h);
    }
    if (this._contentTex) {
      this._contentTex.needsUpdate = true;
    }
  }

  // ── Floating title above the frame ──────────────────────────
  _buildTitle(W, H) {
    const titleCanvasW = 512;
    const titleCanvasH = 48;
    this._titleCanvas = document.createElement('canvas');
    this._titleCanvas.width = titleCanvasW;
    this._titleCanvas.height = titleCanvasH;
    this._titleCtx = this._titleCanvas.getContext('2d');
    this._titleCtx.imageSmoothingEnabled = false;

    this._titleH = 0.035;
    this._drawTitleCanvas();

    this._titleTex = new THREE.CanvasTexture(this._titleCanvas);
    this._titleTex.minFilter = THREE.LinearFilter;
    this._titleTex.magFilter = THREE.NearestFilter;

    const ps = 2;
    const measuredW = PixelArt.measurePixelText(this.title, ps);
    const textW = Math.min(W * 0.9, measuredW / titleCanvasW * W + 0.06);

    const geo = new THREE.PlaneGeometry(Math.max(textW, 0.08), this._titleH);
    this._titleMat = new THREE.MeshBasicMaterial({
      map: this._titleTex,
      transparent: true,
      side: THREE.DoubleSide,
    });
    this.titleMesh = new THREE.Mesh(geo, this._titleMat);
    // Float above the frame
    this.titleMesh.position.y = H / 2 + this._titleH / 2 + 0.008;
    this.titleMesh.position.z = 0.001;
    this.root.add(this.titleMesh);
  }

  _drawTitleCanvas() {
    const ctx = this._titleCtx;
    if (!ctx) return;
    const w = this._titleCanvas.width;
    const h = this._titleCanvas.height;
    const ps = 2;

    ctx.clearRect(0, 0, w, h);

    // Semi-transparent dark pill background
    ctx.fillStyle = 'rgba(12, 12, 18, 0.75)';
    const r = h / 2;
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.lineTo(w - r, 0);
    ctx.arc(w - r, r, r, -Math.PI / 2, Math.PI / 2);
    ctx.lineTo(r, h);
    ctx.arc(r, r, r, Math.PI / 2, -Math.PI / 2);
    ctx.closePath();
    ctx.fill();

    // Orange accent line at bottom
    ctx.fillStyle = '#FF7E00';
    ctx.fillRect(8, h - 3, w - 16, 2);

    // Title text centered
    const textWidth = PixelArt.measurePixelText(this.title, ps);
    const textX = Math.max(8, (w - textWidth) / 2);
    const textY = (h - 7 * ps) / 2 - 1;
    PixelArt.drawPixelText(ctx, this.title, textX, textY, ps, '#FFFFFF');

    if (this._titleTex) this._titleTex.needsUpdate = true;
  }

  // ── Handles overlay (same size as frame, corner L-shapes) ───
  _buildHandles(W, H) {
    const FRAME_RES = 512;
    const aspect = W / H;
    const cw = Math.round(FRAME_RES * Math.max(1, aspect));
    const ch = Math.round(FRAME_RES / Math.min(1, aspect));

    this._handlesCanvas = document.createElement('canvas');
    this._handlesCanvas.width = cw;
    this._handlesCanvas.height = ch;
    this._handlesCtx = this._handlesCanvas.getContext('2d');
    this._handlesCtx.imageSmoothingEnabled = false;

    this._drawHandlesCanvas();

    this._handlesTex = new THREE.CanvasTexture(this._handlesCanvas);
    this._handlesTex.minFilter = THREE.LinearFilter;
    this._handlesTex.magFilter = THREE.NearestFilter;

    const geo = new THREE.PlaneGeometry(W, H);
    this._handlesMat = new THREE.MeshBasicMaterial({
      map: this._handlesTex,
      transparent: true,
      opacity: 0.0,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this._handlesMesh = new THREE.Mesh(geo, this._handlesMat);
    this._handlesMesh.position.z = 0.002;
    this.root.add(this._handlesMesh);
  }

  _drawHandlesCanvas() {
    const ctx = this._handlesCtx;
    if (!ctx) return;
    const w = this._handlesCanvas.width;
    const h = this._handlesCanvas.height;
    ctx.clearRect(0, 0, w, h);
    if (this._handlesImg) {
      draw9Slice(ctx, this._handlesImg, w, h);
    }
    if (this._handlesTex) this._handlesTex.needsUpdate = true;
  }

  // ── Close button (small square above top-right corner, pixel-art X) ──
  _buildCloseBtn(W, H) {
    const btnSize = Math.min(W, H) * 0.06;

    const closeCanvas = document.createElement('canvas');
    closeCanvas.width = 64;
    closeCanvas.height = 64;
    this._closeCanvas = closeCanvas;
    this._closeCtx = closeCanvas.getContext('2d');
    this._closeCtx.imageSmoothingEnabled = false;

    this._drawCloseCanvas();

    this._closeTex = new THREE.CanvasTexture(closeCanvas);
    this._closeTex.minFilter = THREE.NearestFilter;
    this._closeTex.magFilter = THREE.NearestFilter;

    // Visible mesh
    const geo = new THREE.PlaneGeometry(btnSize, btnSize);
    this._closeBtnMat = new THREE.MeshBasicMaterial({
      map: this._closeTex,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this._closeBtnVisual = new THREE.Mesh(geo, this._closeBtnMat);

    // Invisible hitbox 2.5x bigger for easy tapping
    const hitGeo = new THREE.PlaneGeometry(btnSize * 2.5, btnSize * 2.5);
    const hitMat = new THREE.MeshBasicMaterial({
      transparent: true, opacity: 0.0, depthWrite: false, side: THREE.DoubleSide,
    });
    this.closeBtnMesh = new THREE.Mesh(hitGeo, hitMat);

    // Positioned above the top-right corner of the frame
    const posX = W / 2 + btnSize * 0.15;
    const posY = H / 2 + btnSize * 0.15;
    this._closeBtnVisual.position.set(posX, posY, 0.003);
    this.closeBtnMesh.position.set(posX, posY, 0.003);
    this.root.add(this._closeBtnVisual);
    this.root.add(this.closeBtnMesh);
    if (!this.closable) {
      this.closeBtnMesh.visible = false;
      this._closeBtnVisual.visible = false;
    }
  }

  _drawCloseCanvas() {
    const ctx = this._closeCtx;
    if (!ctx) return;
    const S = 64;
    ctx.clearRect(0, 0, S, S);

    // Dark semi-transparent background square
    ctx.fillStyle = 'rgba(12, 12, 18, 0.7)';
    ctx.fillRect(0, 0, S, S);

    // Orange border (1px)
    ctx.strokeStyle = '#FF7E00';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, S - 2, S - 2);

    // Pixel-art "X" using PixelArt font
    const ps = 3;  // pixel size for the X letter
    const textW = PixelArt.measurePixelText('x', ps);
    const textX = Math.round((S - textW) / 2);
    const textY = Math.round((S - 7 * ps) / 2);
    PixelArt.drawPixelText(ctx, 'x', textX, textY, ps, '#FF7E00');

    if (this._closeTex) this._closeTex.needsUpdate = true;
  }

  // ── Move bar (bottom strip for dragging — sits UNDER the frame) ──
  _buildMoveBar(W, H) {
    const barSize = Math.min(W, H) * 0.07;
    const barH = barSize * 0.25;
    const barW = W * 0.25;

    const moveCanvas = document.createElement('canvas');
    moveCanvas.width = 1576;
    moveCanvas.height = 197;
    this._moveCanvas = moveCanvas;
    this._moveCtx = moveCanvas.getContext('2d');
    this._moveCtx.imageSmoothingEnabled = false;

    this._drawMoveCanvas();

    this._moveTex = new THREE.CanvasTexture(moveCanvas);
    this._moveTex.minFilter = THREE.NearestFilter;
    this._moveTex.magFilter = THREE.NearestFilter;

    // Visible mesh
    const geo = new THREE.PlaneGeometry(barW, barH);
    this._moveMat = new THREE.MeshBasicMaterial({
      map: this._moveTex,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this._moveVisual = new THREE.Mesh(geo, this._moveMat);

    // Invisible hitbox 2x bigger (this is what gets raycasted)
    const hitGeo = new THREE.PlaneGeometry(barW * 2, barH * 2);
    const hitMat = new THREE.MeshBasicMaterial({
      transparent: true, opacity: 0.0, depthWrite: false, side: THREE.DoubleSide,
    });
    this._moveMesh = new THREE.Mesh(hitGeo, hitMat);

    // Position below the frame bottom edge
    const posY = -H / 2 - barH / 2 - 0.003;
    this._moveVisual.position.set(0, posY, 0.001);
    this._moveMesh.position.set(0, posY, 0.001);
    this.root.add(this._moveVisual);
    this.root.add(this._moveMesh);

    // Hitbox is the drag target
    this.dragBarMesh = this._moveMesh;
  }

  _drawMoveCanvas() {
    const ctx = this._moveCtx;
    if (!ctx) return;
    ctx.clearRect(0, 0, 1576, 197);
    if (this._moveImg) {
      ctx.drawImage(this._moveImg, 0, 1773, 1576, 197, 0, 0, 1576, 197);
    } else {
      ctx.fillStyle = '#FF7E00';
      ctx.fillRect(0, 0, 1576, 197);
      ctx.fillStyle = '#FFF';
      for (let x = 100; x < 1476; x += 80) {
        ctx.fillRect(x, 80, 40, 40);
      }
    }
    if (this._moveTex) this._moveTex.needsUpdate = true;
  }

  // ── Resize handles (invisible raycasting targets at corners) ──
  _buildResizeHandles(W, H) {
    this._resizeHandles = {};
    const handleW = W * 0.35;
    const handleH = H * 0.35;

    const makeHandle = (name, x, y) => {
      const geo = new THREE.PlaneGeometry(handleW, handleH);
      const mat = new THREE.MeshBasicMaterial({
        transparent: true, opacity: 0.0, depthWrite: false, side: THREE.DoubleSide
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, 0.002);
      this.root.add(mesh);
      this._resizeHandles[name] = { mesh, mat, baseOpacity: 0.0, targetOpacity: 0.0 };
    };

    const halfW = W / 2;
    const halfH = H / 2;
    const offX = halfW - handleW / 2;
    const offY = halfH - handleH / 2;
    makeHandle('br',  offX, -offY);
    makeHandle('bl', -offX, -offY);
    makeHandle('tr',  offX,  offY);
    makeHandle('tl', -offX,  offY);
  }

  // ── Border meshes (invisible, for raycasting hover detect) ──
  _buildBorders(W, H) {
    this._borderMeshes = {};
    const bevelW = 0.01;

    const makeMat = () => new THREE.MeshBasicMaterial({
      transparent: true, opacity: 0.0, depthWrite: false, side: THREE.DoubleSide
    });

    const topMesh = new THREE.Mesh(new THREE.PlaneGeometry(W, bevelW), makeMat());
    topMesh.position.set(0, H / 2, 0.001);
    this.root.add(topMesh);
    this._borderMeshes.top = topMesh;

    const leftMesh = new THREE.Mesh(new THREE.PlaneGeometry(bevelW, H), makeMat());
    leftMesh.position.set(-W / 2, 0, 0.001);
    this.root.add(leftMesh);
    this._borderMeshes.left = leftMesh;

    const botMesh = new THREE.Mesh(new THREE.PlaneGeometry(W, bevelW), makeMat());
    botMesh.position.set(0, -H / 2, 0.001);
    this.root.add(botMesh);
    this._borderMeshes.bottom = botMesh;

    const rightMesh = new THREE.Mesh(new THREE.PlaneGeometry(bevelW, H), makeMat());
    rightMesh.position.set(W / 2, 0, 0.001);
    this.root.add(rightMesh);
    this._borderMeshes.right = rightMesh;
  }

  // ── Public API ─────────────────────────────────────────────

  setTitle(text) {
    this.title = text;
    this._drawTitleCanvas();
  }

  setContent(drawFn) {
    this.contentDrawFn = drawFn;
    this._drawContentCanvas();
  }

  markContentDirty() {
    if (this._contentTex) this._contentTex.needsUpdate = true;
  }

  get contentCanvas() { return this._contentCanvas; }
  get contentCtx() { return this._contentCtx; }

  getTitleBarYOffset() {
    return this.height / 2 + (this._titleH || 0.035) / 2 + 0.008;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.root.visible = false;
    this.scene.remove(this.root);
    queueMicrotask(() => this.manager._removeWindow(this));
  }

  minimize() {
    this.minimized = !this.minimized;
    this.contentMesh.visible = !this.minimized;
    if (this._frameMesh) this._frameMesh.visible = !this.minimized;
    if (this._handlesMesh) this._handlesMesh.visible = !this.minimized;
    if (this._moveMesh) this._moveMesh.visible = !this.minimized;
    if (this._moveVisual) this._moveVisual.visible = !this.minimized;
    if (this._closeBtnVisual) this._closeBtnVisual.visible = !this.minimized;
  }

  focus() {
    this.manager._focusWindow(this);
  }

  getInteractableMeshes() {
    const meshes = [this.contentMesh, this.closeBtnMesh, this._frameMesh];
    if (this.titleMesh) meshes.push(this.titleMesh);
    if (this._moveMesh) meshes.push(this._moveMesh);
    Object.values(this._borderMeshes).forEach(m => meshes.push(m));
    Object.values(this._resizeHandles).forEach(h => meshes.push(h.mesh));
    return meshes.filter(Boolean);
  }

  getDragTargets() {
    return [this.dragBarMesh];
  }

  setFade(opacity, scale) {
    this._targetFadeOpacity = opacity;
    this._targetFadeScale = scale;
  }

  update(dt, elapsed) {
    if (this.closed || !this.visible) return;
    this._updateHover(dt);
    this._updateFade(dt);
  }

  _updateFade(dt) {
    const speed = 6;
    const k = Math.min(1, speed * dt);

    this._fadeOpacity += (this._targetFadeOpacity - this._fadeOpacity) * k;
    this._fadeScale += (this._targetFadeScale - this._fadeScale) * k;

    this.root.scale.setScalar(this._fadeScale);

    const opacity = this._fadeOpacity;
    if (this._contentMat) this._contentMat.opacity = opacity;
    if (this._titleMat) this._titleMat.opacity = opacity;
    if (this._frameMat) this._frameMat.opacity = opacity;
    // Handles fade with the window
    if (this._handlesMat) this._handlesMat.opacity = Math.min(this._handlesMat.opacity, opacity);
    // Move/close scale with window fade but keep at least their base 0.5
    if (this._moveMat) this._moveMat.opacity = Math.min(this._moveMat.opacity, Math.max(opacity, 0.5));
    if (this._closeBtnMat) this._closeBtnMat.opacity = Math.min(this._closeBtnMat.opacity, Math.max(opacity, 0.5));
  }

  _updateHover(dt) {
    const lerpSpeed = 8;

    // Handles overlay — show when ANY corner is hovered
    const cornerHover = ['tl', 'tr', 'bl', 'br'].some(n => this.hoverTarget === n);
    if (this._handlesMat) {
      const target = cornerHover ? 0.85 : 0.0;
      this._handlesMat.opacity += (target - this._handlesMat.opacity) * lerpSpeed * dt;
    }

    // Close button — always 50%, full on hover
    if (this.closable && this._closeBtnMat) {
      const show = this.hoverTarget === 'closeBtn' || this.hoverTarget === 'tr' || this.hoverTarget === 'border_top';
      const target = show ? 1.0 : 0.5;
      this._closeBtnMat.opacity += (target - this._closeBtnMat.opacity) * lerpSpeed * dt;
    }

    // Move bar — always 50%, full on hover
    if (this._moveMat) {
      const show = this.hoverTarget === 'dragBar'
               || this.hoverTarget === 'border_bottom'
               || this.hoverTarget === 'bl'
               || this.hoverTarget === 'br';
      const target = show ? 1.0 : 0.5;
      this._moveMat.opacity += (target - this._moveMat.opacity) * lerpSpeed * dt;
    }

    // Invisible resize handles stay at 0
    for (const [, handle] of Object.entries(this._resizeHandles)) {
      handle.mat.opacity = 0.0;
    }
  }

  // ── Rebuild after resize ───────────────────────────────────
  _rebuildAfterResize() {
    while (this.root.children.length > 0) {
      this.root.remove(this.root.children[0]);
    }
    this._build_internal();
  }

  _build_internal() {
    const W = this.width;
    const H = this.height;
    this._buildFrame(W, H);
    this._buildContent(W, H);
    this._buildTitle(W, H);
    this._buildHandles(W, H);
    this._buildCloseBtn(W, H);
    this._buildMoveBar(W, H);
    this._buildResizeHandles(W, H);
    this._buildBorders(W, H);
  }
}

export { ManagedWindow };
