// ═══════════════════════════════════════════════════════════════════
//  ManagedWindow.js — Pixelated Window for WebXR AR
//  Mistral orange branding with Win95-style title bar buttons
// ═══════════════════════════════════════════════════════════════════

import { PixelArt } from './PixelArt.js';

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
    // Mistral orange gradient title bar
    const grad = ctx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, PixelArt.TITLE_ACTIVE);
    grad.addColorStop(1, PixelArt.TITLE_ACTIVE_LT);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    // Pixel title text
    const textY = (h - 7 * ps) / 2 + 2;
    PixelArt.drawPixelText(ctx, this.title, 8, textY, ps, PixelArt.WHITE);
    // Win95 title bar buttons
    const btnSize = 20, btnY = (h - btnSize) / 2, btnGap = 4;
    const closeX = w - btnSize - 6;
    const maxX = closeX - btnSize - btnGap;
    const minX = maxX - btnSize - btnGap;
    const drawBtn = (bx, by) => {
      ctx.fillStyle = PixelArt.BTN_FACE;
      ctx.fillRect(bx, by, btnSize, btnSize);
      ctx.fillStyle = PixelArt.WHITE;
      ctx.fillRect(bx, by, btnSize, 2);
      ctx.fillRect(bx, by, 2, btnSize);
      ctx.fillStyle = PixelArt.DARK_GRAY;
      ctx.fillRect(bx, by + btnSize - 2, btnSize, 2);
      ctx.fillRect(bx + btnSize - 2, by, 2, btnSize);
    };
    // Minimize
    drawBtn(minX, btnY);
    ctx.fillStyle = PixelArt.BLACK;
    ctx.fillRect(minX + 4, btnY + btnSize - 6, btnSize - 8, 2);
    // Maximize
    drawBtn(maxX, btnY);
    ctx.fillStyle = PixelArt.BLACK;
    ctx.fillRect(maxX + 4, btnY + 4, btnSize - 8, 2);
    ctx.strokeStyle = PixelArt.BLACK; ctx.lineWidth = 1;
    ctx.strokeRect(maxX + 4, btnY + 4, btnSize - 8, btnSize - 8);
    // Close
    drawBtn(closeX, btnY);
    ctx.fillStyle = PixelArt.BLACK;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(closeX + 5, btnY + 5);
    ctx.lineTo(closeX + btnSize - 5, btnY + btnSize - 5);
    ctx.moveTo(closeX + btnSize - 5, btnY + 5);
    ctx.lineTo(closeX + 5, btnY + btnSize - 5);
    ctx.stroke();
    if (this._titleTex) this._titleTex.needsUpdate = true;
  }

  _buildBorders(W, H, border, titleH, bottomH) {
    const sideH = this._contentH;
    this._borderMeshes = {};
    const FRAME = 0.006;

    const frameW = W + FRAME * 2, frameH = sideH + this._titleH + FRAME * 2;
    const frameMat = new THREE.MeshBasicMaterial({ color: 0xC0C0C0, side: THREE.DoubleSide });
    const frameMesh = new THREE.Mesh(new THREE.PlaneGeometry(frameW, frameH), frameMat);
    frameMesh.position.set(0, this._titleH / 2 - 0.005, -0.001);
    this.root.add(frameMesh);

    const highlightMat = new THREE.MeshBasicMaterial({ color: 0xFFFFFF, side: THREE.DoubleSide });
    const leftMesh = new THREE.Mesh(new THREE.PlaneGeometry(border, sideH), highlightMat);
    leftMesh.position.set(-W/2 + border/2, -0.005, 0.0005);
    this.root.add(leftMesh);
    this._borderMeshes.left = leftMesh;

    const shadowMat = new THREE.MeshBasicMaterial({ color: 0x808080, side: THREE.DoubleSide });
    const rightMesh = new THREE.Mesh(new THREE.PlaneGeometry(border, sideH), shadowMat);
    rightMesh.position.set(W/2 - border/2, -0.005, 0.0005);
    this.root.add(rightMesh);
    this._borderMeshes.right = rightMesh;

    const botMesh = new THREE.Mesh(new THREE.PlaneGeometry(W, border), shadowMat);
    botMesh.position.set(0, -this._contentH/2 - border/2, 0.0005);
    this.root.add(botMesh);
    this._borderMeshes.bottom = botMesh;
  }

  _buildBottomBar(W, H, barH, border) {
    const totalContentH = this._contentH;
    const PILL_H = 0.008, PILL_W = W * 0.45, CLOSE_W = 0.012, GAP = 0.008;
    const GROUP_W = PILL_W + GAP + CLOSE_W;
    const barY = -totalContentH/2 - 0.015 - PILL_H/2 - 0.004;

    // Silver drag bar
    const pillCanvas = document.createElement('canvas');
    const PC_W = 48, PC_H = 6;
    pillCanvas.width = PC_W; pillCanvas.height = PC_H;
    const pctx = pillCanvas.getContext('2d');
    pctx.imageSmoothingEnabled = false;
    pctx.fillStyle = PixelArt.SILVER;
    pctx.fillRect(0, 0, PC_W, PC_H);
    pctx.fillStyle = PixelArt.WHITE;
    pctx.fillRect(0, 0, PC_W, 1);
    pctx.fillStyle = PixelArt.DARK_GRAY;
    pctx.fillRect(0, PC_H - 1, PC_W, 1);

    const pillTex = new THREE.CanvasTexture(pillCanvas);
    pillTex.minFilter = THREE.NearestFilter; pillTex.magFilter = THREE.NearestFilter;

    const dragGeo = new THREE.PlaneGeometry(PILL_W, PILL_H);
    this._dragBarMat = new THREE.MeshBasicMaterial({
      map: pillTex, transparent: true, opacity: 0.35, side: THREE.DoubleSide
    });
    this.dragBarMesh = new THREE.Mesh(dragGeo, this._dragBarMat);
    this.dragBarMesh.position.set(-GROUP_W/2 + PILL_W/2, barY, 0.001);
    this.root.add(this.dragBarMesh);

    // Close button
    const closeCanvas = document.createElement('canvas');
    const CC = 16;
    closeCanvas.width = CC; closeCanvas.height = CC;
    const cctx = closeCanvas.getContext('2d');
    cctx.imageSmoothingEnabled = false;
    cctx.fillStyle = PixelArt.SILVER;
    cctx.fillRect(0, 0, CC, CC);
    cctx.fillStyle = PixelArt.WHITE;
    cctx.fillRect(0, 0, CC, 2);
    cctx.fillRect(0, 0, 2, CC);
    cctx.fillStyle = PixelArt.DARK_GRAY;
    cctx.fillRect(0, CC - 2, CC, 2);
    cctx.fillRect(CC - 2, 0, 2, CC);
    cctx.strokeStyle = PixelArt.BLACK;
    cctx.lineWidth = 1.5;
    cctx.beginPath();
    cctx.moveTo(4, 4); cctx.lineTo(CC - 4, CC - 4);
    cctx.moveTo(CC - 4, 4); cctx.lineTo(4, CC - 4);
    cctx.stroke();

    const closeTex = new THREE.CanvasTexture(closeCanvas);
    closeTex.minFilter = THREE.NearestFilter; closeTex.magFilter = THREE.NearestFilter;

    const closeGeo = new THREE.PlaneGeometry(CLOSE_W, CLOSE_W);
    this._closeBtnMat = new THREE.MeshBasicMaterial({
      map: closeTex, transparent: true, opacity: 0.35, side: THREE.DoubleSide
    });
    this.closeBtnMesh = new THREE.Mesh(closeGeo, this._closeBtnMat);
    this.closeBtnMesh.position.set(-GROUP_W/2 + PILL_W + GAP + CLOSE_W/2, barY, 0.001);
    this.root.add(this.closeBtnMesh);

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
      ctx.fillStyle = PixelArt.DARK_GRAY;
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

  markContentDirty() { if (this._contentTex) this._contentTex.needsUpdate = true; }

  get contentCanvas() { return this._contentCanvas; }
  get contentCtx() { return this._contentCtx; }

  getTitleBarYOffset() { return this._contentH / 2 + this._titleH / 2; }

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

export { ManagedWindow };
