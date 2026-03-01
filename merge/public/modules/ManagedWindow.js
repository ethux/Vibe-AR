// ═══════════════════════════════════════════════════════════════════
//  ManagedWindow.js — Windows 95 Style Window for WebXR AR
//  Mistral orange branding with classic Win95 3D beveled borders
// ═══════════════════════════════════════════════════════════════════

import { PixelArt } from './PixelArt.js';

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

    // Fade/scale targets for explorer toggle
    this._fadeOpacity = 1;
    this._fadeScale = 1;
    this._targetFadeOpacity = 1;
    this._targetFadeScale = 1;

    this.CANVAS_W = opts.canvasWidth  || 512;
    this.CANVAS_H = opts.canvasHeight || 384;

    this._build(opts.position || [0, 1.5, -0.8]);

    // Face the camera on creation
    if (this.camera) {
      const camPos = new THREE.Vector3();
      this.camera.getWorldPosition(camPos);
      // Only rotate on Y axis so the window stays upright
      const lookTarget = new THREE.Vector3(camPos.x, this.root.position.y, camPos.z);
      this.root.lookAt(lookTarget);
    }
  }

  // ── Build all meshes ──────────────────────────────────────────
  _build(pos) {
    const W = this.width;
    const H = this.height;
    const BORDER = 0.006;       // thin 3D bevel border
    const TITLEBAR_H = 0.035;   // classic Win95 title bar height

    this.root = new THREE.Group();
    this.root.position.set(pos[0], pos[1], pos[2]);
    this.scene.add(this.root);

    // ── Silver window frame (background behind everything) ──
    this._buildFrame(W, H);

    // ── Content area (inset, dark bg) ──
    this._buildContent(W, H, BORDER, TITLEBAR_H);

    // ── Title bar (orange gradient with text + buttons) ──
    this._buildTitleBar(W, TITLEBAR_H, BORDER);

    // ── 3D beveled borders ──
    this._buildBorders(W, H, BORDER, TITLEBAR_H);

    // ── Resize handles (corners) ──
    this._buildResizeHandles(W, H, BORDER, TITLEBAR_H);
  }

  // ── Silver frame background ─────────────────────────────────
  _buildFrame(W, H) {
    const frameGeo = new THREE.PlaneGeometry(W + 0.008, H + 0.008);
    this._frameMat = new THREE.MeshBasicMaterial({
      color: 0xC0C0C0, side: THREE.DoubleSide
    });
    this._frameMesh = new THREE.Mesh(frameGeo, this._frameMat);
    this._frameMesh.position.z = -0.001;
    this.root.add(this._frameMesh);
  }

  // ── Content area ────────────────────────────────────────────
  _buildContent(W, H, border, titleH) {
    const inset = 0.008;
    const contentW = W - inset * 2;
    const contentH = H - titleH - inset * 2;
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
    // Position content below title bar, centered in remaining space
    this.contentMesh.position.y = -(titleH / 2);
    this.contentMesh.position.z = 0.001;
    this.root.add(this.contentMesh);
  }

  _drawContentCanvas() {
    const ctx = this._contentCtx;
    const w = this.CANVAS_W;
    const h = this.CANVAS_H;

    // Dark content area with 3D inset border
    ctx.fillStyle = '#0c0c12';
    ctx.fillRect(0, 0, w, h);

    // 3D inset border (dark top-left, light bottom-right)
    const b = 3;
    ctx.fillStyle = PixelArt.SHADOW;
    ctx.fillRect(0, 0, w, b);      // top
    ctx.fillRect(0, 0, b, h);      // left
    ctx.fillStyle = PixelArt.SILVER;
    ctx.fillRect(0, h - b, w, b);  // bottom
    ctx.fillRect(w - b, 0, b, h);  // right

    // User content (drawn on top)
    if (this.contentDrawFn) {
      this.contentDrawFn(ctx, w, h);
    }
    if (this._contentTex) {
      this._contentTex.needsUpdate = true;
    }
  }

  // ── Title bar (Mistral orange gradient, Win95 style) ──────────
  _buildTitleBar(W, titleH, border) {
    this._titleH = titleH;

    const titleCanvasW = 512;
    const titleCanvasH = 48;
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
    // Title bar sits at the top of the window
    this.titleMesh.position.y = (this.height - titleH) / 2;
    this.titleMesh.position.z = 0.001;
    this.root.add(this.titleMesh);

    // The title bar IS the drag target in Windows 95
    this.dragBarMesh = this.titleMesh;

    // ── Close button (invisible overlay for raycasting) ──
    this._buildCloseBtn(W, titleH);
  }

  _drawTitleCanvas() {
    const ctx = this._titleCtx;
    const w = this._titleCanvas.width;
    const h = this._titleCanvas.height;
    const ps = 2; // pixel size for title text

    // Mistral orange gradient background
    const grad = ctx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, PixelArt.TITLE_BLUE);
    grad.addColorStop(1, PixelArt.TITLE_BLUE_LT);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Title text — left aligned, white, bold pixel font
    const textY = (h - 7 * ps) / 2;
    PixelArt.drawPixelText(ctx, this.title, 8, textY, ps, PixelArt.WHITE);

    // Win95 title bar buttons area (right side)
    const btnSize = 14;
    const btnY = (h - btnSize) / 2;
    const btnGap = 2;

    // Close button [X]
    if (this.closable) {
      this._drawWin95Btn(ctx, w - btnSize - 4, btnY, btnSize, btnSize);
      this._drawPixelX(ctx, w - btnSize - 4 + 3, btnY + 2, btnSize - 6);
    }

    // Maximize button [□]
    this._drawWin95Btn(ctx, w - btnSize * 2 - btnGap - 4, btnY, btnSize, btnSize);
    ctx.strokeStyle = PixelArt.BLACK;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(w - btnSize * 2 - btnGap - 4 + 3, btnY + 3, btnSize - 6, btnSize - 6);

    // Minimize button [_]
    this._drawWin95Btn(ctx, w - btnSize * 3 - btnGap * 2 - 4, btnY, btnSize, btnSize);
    ctx.fillStyle = PixelArt.BLACK;
    ctx.fillRect(w - btnSize * 3 - btnGap * 2 - 4 + 3, btnY + btnSize - 5, btnSize - 6, 2);

    if (this._titleTex) {
      this._titleTex.needsUpdate = true;
    }
  }

  // Draw a classic Win95 3D raised button
  _drawWin95Btn(ctx, x, y, w, h) {
    ctx.fillStyle = PixelArt.BTN_FACE;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = PixelArt.WHITE;
    ctx.fillRect(x, y, w, 1);
    ctx.fillRect(x, y, 1, h);
    ctx.fillStyle = PixelArt.SHADOW;
    ctx.fillRect(x, y + h - 1, w, 1);
    ctx.fillRect(x + w - 1, y, 1, h);
    ctx.fillStyle = PixelArt.DARK_GRAY;
    ctx.fillRect(x + 1, y + h - 2, w - 2, 1);
    ctx.fillRect(x + w - 2, y + 1, 1, h - 2);
  }

  // Draw a pixel-art X for the close button
  _drawPixelX(ctx, x, y, size) {
    ctx.fillStyle = PixelArt.BLACK;
    const s = Math.max(1, Math.floor(size / 5));
    for (let i = 0; i < size; i += s) {
      ctx.fillRect(x + i, y + i, s, s);
      ctx.fillRect(x + size - i - s, y + i, s, s);
    }
  }

  // ── Close button mesh (invisible overlay for raycasting) ────
  _buildCloseBtn(W, titleH) {
    const btnW = 0.025;
    const btnH = titleH * 0.8;
    const closeGeo = new THREE.PlaneGeometry(btnW, btnH);
    this._closeBtnMat = new THREE.MeshBasicMaterial({
      transparent: true, opacity: 0.0, side: THREE.DoubleSide
    });
    this.closeBtnMesh = new THREE.Mesh(closeGeo, this._closeBtnMat);
    this.closeBtnMesh.position.set(
      W / 2 - btnW / 2 - 0.005,
      (this.height - titleH) / 2,
      0.002
    );
    this.root.add(this.closeBtnMesh);
    if (!this.closable) this.closeBtnMesh.visible = false;
  }

  // ── 3D Beveled borders (Windows 95 raised look) ────────────
  _buildBorders(W, H, border, titleH) {
    this._borderMeshes = {};
    const bevelW = 0.004;

    const makeHighlightMat = () => new THREE.MeshBasicMaterial({
      color: 0xFFFFFF, transparent: true, opacity: 0.9, side: THREE.DoubleSide
    });
    const makeShadowMat = () => new THREE.MeshBasicMaterial({
      color: 0x404040, transparent: true, opacity: 0.9, side: THREE.DoubleSide
    });

    // Top edge (highlight)
    const topGeo = new THREE.PlaneGeometry(W + 0.004, bevelW);
    const topMesh = new THREE.Mesh(topGeo, makeHighlightMat());
    topMesh.position.set(0, H / 2 + bevelW / 2, 0.0005);
    this.root.add(topMesh);
    this._borderMeshes.top = topMesh;

    // Left edge (highlight)
    const leftGeo = new THREE.PlaneGeometry(bevelW, H);
    const leftMesh = new THREE.Mesh(leftGeo, makeHighlightMat());
    leftMesh.position.set(-W / 2 - bevelW / 2, 0, 0.0005);
    this.root.add(leftMesh);
    this._borderMeshes.left = leftMesh;

    // Bottom edge (shadow)
    const botGeo = new THREE.PlaneGeometry(W + 0.004, bevelW);
    const botMesh = new THREE.Mesh(botGeo, makeShadowMat());
    botMesh.position.set(0, -H / 2 - bevelW / 2, 0.0005);
    this.root.add(botMesh);
    this._borderMeshes.bottom = botMesh;

    // Right edge (shadow)
    const rightGeo = new THREE.PlaneGeometry(bevelW, H);
    const rightMesh = new THREE.Mesh(rightGeo, makeShadowMat());
    rightMesh.position.set(W / 2 + bevelW / 2, 0, 0.0005);
    this.root.add(rightMesh);
    this._borderMeshes.right = rightMesh;
  }

  // ── Resize handles (corner grippy triangles) ───────────────
  _buildResizeHandles(W, H, border, titleH) {
    this._resizeHandles = {};
    const handleSize = 0.04;
    const outset = 0.01;

    // Win95-style diagonal grip lines
    const makeCornerCanvas = () => {
      const C = 8;
      const canvas = document.createElement('canvas');
      canvas.width = C; canvas.height = C;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = PixelArt.SHADOW;
      for (let i = 0; i < C; i++) {
        if (i % 3 === 0) {
          ctx.fillRect(i, C - 1, 1, 1);
          ctx.fillRect(C - 1, i, 1, 1);
        }
      }
      ctx.fillStyle = PixelArt.WHITE;
      for (let i = 1; i < C; i++) {
        if (i % 3 === 1) {
          ctx.fillRect(i, C - 2, 1, 1);
          ctx.fillRect(C - 2, i, 1, 1);
        }
      }
      return canvas;
    };

    const makeHandle = (name, x, y, rotZ) => {
      const cornerCanvas = makeCornerCanvas();
      const cornerTex = new THREE.CanvasTexture(cornerCanvas);
      cornerTex.minFilter = THREE.NearestFilter;
      cornerTex.magFilter = THREE.NearestFilter;

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

    const halfW = W / 2;
    const halfH = H / 2;
    makeHandle('br',  halfW + outset, -halfH - outset, 0);
    makeHandle('bl', -halfW - outset, -halfH - outset, Math.PI / 2);
    makeHandle('tr',  halfW + outset,  halfH + outset, -Math.PI / 2);
    makeHandle('tl', -halfW - outset,  halfH + outset, Math.PI);
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
    return (this.height - this._titleH) / 2;
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
    Object.values(this._borderMeshes).forEach(m => m.visible = !this.minimized);
    Object.values(this._resizeHandles).forEach(h => h.mesh.visible = !this.minimized);
    if (this._frameMesh) this._frameMesh.visible = !this.minimized;
  }

  focus() {
    this.manager._focusWindow(this);
  }

  getInteractableMeshes() {
    const meshes = [this.titleMesh, this.contentMesh, this.closeBtnMesh];
    Object.values(this._borderMeshes).forEach(m => meshes.push(m));
    Object.values(this._resizeHandles).forEach(h => meshes.push(h.mesh));
    return meshes;
  }

  getDragTargets() {
    return [this.dragBarMesh]; // title bar = drag target in Win95
  }

  // ── Fade/scale for explorer toggle ─────────────────────────
  setFade(opacity, scale) {
    this._targetFadeOpacity = opacity;
    this._targetFadeScale = scale;
  }

  // ── Per-frame update ───────────────────────────────────────
  update(dt, elapsed) {
    if (this.closed || !this.visible) return;
    this._updateHover(dt);
    this._updateFade(dt);
  }

  _updateFade(dt) {
    const speed = 6; // lerp speed (~0.17s to settle)
    const k = Math.min(1, speed * dt);

    // Lerp opacity
    this._fadeOpacity += (this._targetFadeOpacity - this._fadeOpacity) * k;
    // Lerp scale
    this._fadeScale += (this._targetFadeScale - this._fadeScale) * k;

    // Apply scale to root
    this.root.scale.setScalar(this._fadeScale);

    // Apply opacity to all materials
    const opacity = this._fadeOpacity;
    if (this._contentMat) this._contentMat.opacity = opacity;
    if (this._titleMat) this._titleMat.opacity = opacity;
    if (this._frameMat) {
      this._frameMat.transparent = true;
      this._frameMat.opacity = opacity;
    }
    for (const m of Object.values(this._borderMeshes)) {
      if (m.material) { m.material.opacity = opacity * 0.9; }
    }
  }

  _updateHover(dt) {
    const lerpSpeed = 8;

    // Close button hover → highlight
    if (this.closable) {
      const closeHover = this.hoverTarget === 'closeBtn';
      const closeTarget = closeHover ? 0.3 : 0.0;
      this._closeBtnMat.opacity += (closeTarget - this._closeBtnMat.opacity) * lerpSpeed * dt;
    }

    // Resize handles — show on hover
    for (const [name, handle] of Object.entries(this._resizeHandles)) {
      const isActive = this.hoverTarget === name;
      handle.targetOpacity = isActive ? 1.0 : 0.0;
      handle.mat.opacity += (handle.targetOpacity - handle.mat.opacity) * lerpSpeed * dt;
    }
  }

  // ── Rebuild after resize ───────────────────────────────────
  _rebuildAfterResize() {
    while (this.root.children.length > 0) {
      this.root.remove(this.root.children[0]);
    }
    const BORDER = 0.006;
    const TITLEBAR_H = 0.035;
    this._build_internal(BORDER, TITLEBAR_H);
  }

  _build_internal(border, titleH) {
    const W = this.width;
    const H = this.height;
    this._buildFrame(W, H);
    this._buildContent(W, H, border, titleH);
    this._buildTitleBar(W, titleH, border);
    this._buildBorders(W, H, border, titleH);
    this._buildResizeHandles(W, H, border, titleH);
  }
}

export { ManagedWindow };
