// ═══════════════════════════════════════════════════════════════════
//  WindowManager.js — Pixelated Window Manager for WebXR AR
// ═══════════════════════════════════════════════════════════════════

import { PixelArt } from './PixelArt.js';
import { ManagedWindow } from './ManagedWindow.js';

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

      if (win.closable) {
        const closeHits = this._raycaster.intersectObject(win.closeBtnMesh, false);
        if (closeHits.length > 0) { win.close(); return; }
      }

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

      if (win.closable) {
        const closeDist = pinchPoint.distanceTo(
          new THREE.Vector3().setFromMatrixPosition(win.closeBtnMesh.matrixWorld)
        );
        if (closeDist < 0.04) { win.close(); return true; }
      }

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

  update(frame, dt, elapsed, controllers, activeCamera) {
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

    // Billboard: make dragged windows face the camera (orthogonal to camera normal)
    const cam = activeCamera || this.camera;
    for (const win of this.windows) {
      if (!win.closed && win.visible && win.dragging) {
        win.root.quaternion.copy(cam.quaternion);
      }
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

  // ── Hand-based hover detection ────────────────────────────────

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
