// ═══════════════════════════════════════════════════════════════════
//  WindowManager.js — Pixelated Window Manager for WebXR AR
// ═══════════════════════════════════════════════════════════════════
//
//  USAGE (for teammates):
//  ─────────────────────
//    Load the scripts in your HTML in this order:
//      <script src="PixelArt.js"></script>
//      <script src="ManagedWindow.js"></script>
//      <script src="WindowManager.js"></script>
//
//    Then:
//      const wm = new WindowManager(scene, renderer, camera);
//
//      const win = wm.createWindow({
//        title:    'My Panel',
//        width:    0.6,          // meters (default 0.6)
//        height:   0.45,         // meters (default 0.45)
//        position: [0, 1.5, -0.8],
//        content:  (ctx, w, h) => {
//          ctx.fillStyle = '#0f0';
//          ctx.font = '24px monospace';
//          ctx.fillText('Hello!', 20, 40);
//        }
//      });
//
//      // In your animation loop:
//      wm.update(frame, dt, elapsed);
//
//      // Later:
//      win.setTitle('New Title');
//      win.setContent((ctx, w, h) => { ... });
//      win.close();
//
//  FILES:
//  ──────
//    PixelArt.js       — Pixel art drawing utilities & color palette
//    ManagedWindow.js   — Individual window panel class (mesh building, hover, resize)
//    WindowManager.js   — Manager class (creation, focus, drag/resize orchestration)
//
// ═══════════════════════════════════════════════════════════════════

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
    this._controllerDragDist   = 0;

    // Hand drag state (per hand index)
    this._handDragState = [
      { dragging: false, window: null, offset: new THREE.Vector3() },
      { dragging: false, window: null, offset: new THREE.Vector3() },
    ];

    // Two-hand pinch state (rotate + scale when both hands grab same window)
    this._twoHandAnchor = null;

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
        this._controllerDragDist = dragHits[0].distance;
        win.dragging = true;
        win.focus();
        return;
      }

      // Check resize handles (corner handles only)
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

  // ── Hand pinch interaction ────────────────────────────────────

  onPinchStart(handIdx, pinchPoint) {
    const otherState = this._handDragState[1 - handIdx];

    // ── PRIORITY: If the OTHER hand is already dragging a window,
    //    let this hand join by pinching ANYWHERE near that window ──
    if (otherState.dragging && otherState.window) {
      const win = otherState.window;
      const winPos = new THREE.Vector3();
      win.root.getWorldPosition(winPos);
      // Generous hit zone — within ~0.3m of the window center
      const maxReach = Math.max(win.width, win.height) + 0.15;
      if (pinchPoint.distanceTo(winPos) < maxReach) {
        this._handDragState[handIdx].dragging = true;
        this._handDragState[handIdx].window = win;
        this._handDragState[handIdx].offset.copy(win.root.position).sub(pinchPoint);
        this._handDragState[handIdx].pinchPoint = pinchPoint.clone();
        win.dragging = true;
        // Both hands on same window → init two-hand transform
        this._initTwoHandAnchor(win);
        return true;
      }
    }

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

      // Check drag targets (title bar)
      for (const target of win.getDragTargets()) {
        const targetWorld = new THREE.Vector3();
        target.getWorldPosition(targetWorld);
        if (pinchPoint.distanceTo(targetWorld) < 0.12) {
          this._handDragState[handIdx].dragging = true;
          this._handDragState[handIdx].window = win;
          this._handDragState[handIdx].offset.copy(win.root.position).sub(pinchPoint);
          this._handDragState[handIdx].pinchPoint = pinchPoint.clone();
          win.dragging = true;
          win.focus();
          return true;
        }
      }

      // Check resize handles (corner handles only)
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
      const win = state.window;
      state.dragging = false;
      state.window = null;
      this._twoHandAnchor = null;

      // If the OTHER hand is still dragging this window, recalculate its offset
      const other = this._handDragState[1 - handIdx];
      if (other.dragging && other.window === win) {
        other.offset.copy(win.root.position).sub(other.pinchPoint || new THREE.Vector3());
      } else {
        win.dragging = false;
      }
    }
    if (this._resizeState.active && this._resizeState.handIdx === handIdx) {
      this._endResize();
    }
  }

  onPinchMove(handIdx, pinchPoint) {
    const state = this._handDragState[handIdx];

    // Always track latest pinch position
    if (state.dragging) {
      state.pinchPoint = pinchPoint.clone();
    }

    if (state.dragging && state.window) {
      const other = this._handDragState[1 - handIdx];

      // ── Two-hand mode: rotate + scale + move ──
      // The goal: the two grab points in LOCAL window space must map
      // exactly to the current hand world positions after transform.
      if (other.dragging && other.window === state.window && this._twoHandAnchor) {
        const anchor = this._twoHandAnchor;
        const win = state.window;

        const p0 = this._handDragState[0].pinchPoint;
        const p1 = this._handDragState[1].pinchPoint;
        if (!p0 || !p1) return;

        // Where hands grabbed in local space (XZ plane, Y ignored for rotation)
        const lx0 = anchor.local0.x, lz0 = anchor.local0.z;
        const lx1 = anchor.local1.x, lz1 = anchor.local1.z;

        // Current hand world positions
        const wx0 = p0.x, wz0 = p0.z;
        const wx1 = p1.x, wz1 = p1.z;

        // Local vector between the two grab points
        const ldx = lx1 - lx0, ldz = lz1 - lz0;
        const localDist = Math.sqrt(ldx * ldx + ldz * ldz);

        // World vector between the two hands
        const wdx = wx1 - wx0, wdz = wz1 - wz0;
        const worldDist = Math.sqrt(wdx * wdx + wdz * wdz);

        // Scale: ratio of world distance to local distance
        const newScale = (localDist > 0.001)
          ? Math.max(0.2, Math.min(4.0, worldDist / localDist))
          : anchor.startScale;
        win.root.scale.setScalar(newScale);

        // Rotation: angle difference between local vector and world vector
        const localAngle = Math.atan2(ldx, ldz);
        const worldAngle = Math.atan2(wdx, wdz);
        const newRotY = worldAngle - localAngle;
        win.root.rotation.y = newRotY;

        // Position: place so that local grab point 0 maps to hand 0 in world.
        // Transform local0 by scale + rotation to get its world-space offset from origin:
        const cosR = Math.cos(newRotY);
        const sinR = Math.sin(newRotY);
        const scaledLocalX = lx0 * newScale;
        const scaledLocalZ = lz0 * newScale;
        const rotatedX = scaledLocalX * cosR + scaledLocalZ * sinR;
        const rotatedZ = -scaledLocalX * sinR + scaledLocalZ * cosR;

        win.root.position.x = wx0 - rotatedX;
        win.root.position.z = wz0 - rotatedZ;

        // Y: follow hand midpoint Y with the original offset
        const midY = (p0.y + p1.y) / 2;
        const scaledLocalY0 = anchor.local0.y * newScale;
        win.root.position.y = (p0.y + p1.y) / 2 - (anchor.local0.y + anchor.local1.y) / 2 * newScale;

      } else if (!other.dragging || other.window !== state.window) {
        // ── Single-hand drag ──
        const target = pinchPoint.clone().add(state.offset);
        state.window.root.position.copy(target);
      }
    }
    if (this._resizeState.active && this._resizeState.handIdx === handIdx) {
      this._updateResize(pinchPoint);
    }
  }

  // ── Two-hand anchor (rotate + scale windows) ─────────────────

  _initTwoHandAnchor(win) {
    const p0 = this._handDragState[0].pinchPoint;
    const p1 = this._handDragState[1].pinchPoint;
    if (!p0 || !p1) return;

    // Convert each hand's world grab point into the window's LOCAL space.
    // This is where the hand "touched" on the window — these must stay
    // glued to the hand positions forever during the gesture.
    const invMatrix = new THREE.Matrix4().copy(win.root.matrixWorld).invert();

    const local0 = p0.clone().applyMatrix4(invMatrix);
    const local1 = p1.clone().applyMatrix4(invMatrix);

    this._twoHandAnchor = {
      local0: local0,
      local1: local1,
      startScale: win.root.scale.x,
    };
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

      // Use the fixed grab distance so the window doesn't drift
      const target = this._raycaster.ray.origin.clone()
        .add(this._raycaster.ray.direction.clone().multiplyScalar(this._controllerDragDist));
      target.add(this._controllerDragOffset);

      win.root.position.copy(target);
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

    // Check resize handles FIRST (corners take priority)
    for (const [name, handle] of Object.entries(win._resizeHandles)) {
      const hits = this._raycaster.intersectObject(handle.mesh, false);
      if (hits.length > 0) {
        win.hoverTarget = name; // 'br','bl','tr','tl'
        return;
      }
    }

    // Check borders (visual hover only — no resize)
    for (const [name, mesh] of Object.entries(win._borderMeshes)) {
      const hits = this._raycaster.intersectObject(mesh, false);
      if (hits.length > 0) {
        win.hoverTarget = 'border_' + name;
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

      // Resize handles proximity (check before borders)
      let foundHandle = false;
      for (const [name, handle] of Object.entries(win._resizeHandles)) {
        const handleWorld = new THREE.Vector3();
        handle.mesh.getWorldPosition(handleWorld);
        if (fingerTipPos.distanceTo(handleWorld) < 0.06) {
          win.hoverTarget = name; // 'br','bl','tr','tl'
          foundHandle = true;
          break;
        }
      }
      if (foundHandle) continue;

      // Borders proximity (visual hover only — no resize)
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
