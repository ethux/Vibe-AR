// ═══════════════════════════════════════════════════════════════════
//  ManagedWindow.js — Individual Window Panel for WebXR AR
// ═══════════════════════════════════════════════════════════════════
//
//  Depends on: PixelArt.js (loaded before this file)
//
//  USAGE:
//    Created via WindowManager.createWindow() — not directly.
//
//    const win = wm.createWindow({
//      title:    'My Panel',
//      width:    0.6,
//      height:   0.45,
//      position: [0, 1.5, -0.8],
//      content:  (ctx, w, h) => { ... }
//    });
//
//    win.setTitle('New Title');
//    win.setContent((ctx, w, h) => { ... });
//    win.close();
//
// ═══════════════════════════════════════════════════════════════════

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
    const handleSize = 0.045; // larger for easier targeting
    const outset = 0.012;     // how far outside the corner to push

    // Create a small pixel-art L-shaped corner icon on a canvas (WHITE)
    const makeCornerCanvas = () => {
      const C = 8;
      const canvas = document.createElement('canvas');
      canvas.width = C; canvas.height = C;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      // L-shape: 2px thick lines along two edges
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, C, 2); // top edge
      ctx.fillRect(0, 0, 2, C); // left edge
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
      mesh.visible = true; // always in scene, but transparent until hover
      this.root.add(mesh);
      this._resizeHandles[name] = { mesh, mat, baseOpacity: 0.0, targetOpacity: 0.0 };
    };

    const halfW = W / 2;
    const halfH = this._contentH / 2;
    // Corner handles — pushed outward from each corner
    makeHandle('br',  halfW + outset, -halfH - 0.015 - outset, -Math.PI / 2);
    makeHandle('bl', -halfW - outset, -halfH - 0.015 - outset, Math.PI);
    makeHandle('tr',  halfW + outset,  halfH + this._titleH + outset, 0);
    makeHandle('tl', -halfW - outset,  halfH + this._titleH + outset, Math.PI / 2);
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

    // Resize handles — show only when hovering that specific corner handle
    for (const [name, handle] of Object.entries(this._resizeHandles)) {
      const isActive = this.hoverTarget === name;
      handle.targetOpacity = isActive ? 1.0 : 0.0;
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
