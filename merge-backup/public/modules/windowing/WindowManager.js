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

    // Hand GRAB state (closed fist — move/rotate/scale windows like Code City)
    this._handGrabState = [
      { grabbing: false, window: null, offset: new THREE.Vector3(), point: new THREE.Vector3() },
      { grabbing: false, window: null, offset: new THREE.Vector3(), point: new THREE.Vector3() },
    ];
    this._grabTwoHandAnchor = null;

    // Content interaction state (per hand) — scroll/cursor within window content
    this._contentInteraction = [
      { active: false, window: null, startPoint: new THREE.Vector3(), startTime: 0, lastPoint: new THREE.Vector3(), totalMove: 0, scrollAmount: 0 },
      { active: false, window: null, startPoint: new THREE.Vector3(), startTime: 0, lastPoint: new THREE.Vector3(), totalMove: 0, scrollAmount: 0 },
    ];

    // Controller content interaction state
    this._controllerContentState = {
      active: false,
      window: null,
      controller: null,
      startPoint: new THREE.Vector3(),
      lastPoint: new THREE.Vector3(),
      startTime: 0,
      totalMove: 0,
      startDist: 0,
    };

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

    // Cursor (transparent circle shown on window surface instead of laser)
    const cursorGeo = new THREE.RingGeometry(0.008, 0.012, 32);
    const cursorMat = new THREE.MeshBasicMaterial({
      color: 0xFF7000, transparent: true, opacity: 0.6,
      side: THREE.DoubleSide, depthTest: false,
    });
    this._cursor = new THREE.Mesh(cursorGeo, cursorMat);
    this._cursor.visible = false;
    this._cursor.renderOrder = 9999;
    scene.add(this._cursor);
  }

  createWindow(opts = {}) {
    // Auto-offset position to prevent overlapping windows
    if (!opts.position) {
      // Place windows in an arc around the user
      const n = this.windows.filter(w => !w.closed).length;
      const angle = (n * 0.6) - 0.3; // spread windows in arc, centered
      const radius = 0.8;
      const x = Math.sin(angle) * radius;
      const z = -Math.cos(angle) * radius;
      opts.position = [x, 1.4, z];
    } else {
      // Check if another open window overlaps this position (accounting for window width)
      const [px, py, pz] = opts.position;
      const myHalfW = (opts.width || 0.5) / 2;
      let nudge = 0;
      for (const w of this.windows) {
        if (w.closed) continue;
        const wp = w.root.position;
        const otherHalfW = (w.width || 0.5) / 2;
        const minSep = myHalfW + otherHalfW + 0.02; // 2cm gap
        if (Math.abs(wp.x - (px + nudge)) < minSep &&
            Math.abs(wp.y - py) < 0.2 &&
            Math.abs(wp.z - pz) < 0.3) {
          nudge += minSep;
        }
      }
      if (nudge > 0) {
        // Cascade: offset right and slightly forward
        opts.position = [px + nudge, py, pz + nudge * 0.1];
      }
    }

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
    win.root.position.z += 0.001;
    this.windows.forEach(w => { if (w !== win) w.focused = false; });
  }

  // ── Controller interaction entry points ───────────────────────

  onSelectStart(controller) {
    this._tempMatrix.identity().extractRotation(controller.matrixWorld);
    this._raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    this._raycaster.ray.direction.set(0, 0, -1).applyMatrix4(this._tempMatrix);

    for (const win of this.windows) {
      if (win.closed || !win.visible) continue;

      // Check close button first
      if (win.closable) {
        const closeHits = this._raycaster.intersectObject(win.closeBtnMesh, false);
        if (closeHits.length > 0) {
          win.close();
          return;
        }
      }

      // Check drag targets (title bar)
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

      // Check resize handles
      for (const [name, handle] of Object.entries(win._resizeHandles)) {
        const resizeHits = this._raycaster.intersectObject(handle.mesh, false);
        if (resizeHits.length > 0) {
          this._startResize(win, name, resizeHits[0].point, controller, null);
          return;
        }
      }

      // Check content mesh for scroll/cursor interaction
      if (win.contentMesh && win.onContentInteraction) {
        const contentHits = this._raycaster.intersectObject(win.contentMesh, false);
        if (contentHits.length > 0) {
          const hit = contentHits[0];
          const invMatrix = new THREE.Matrix4().copy(win.contentMesh.matrixWorld).invert();
          const localPoint = hit.point.clone().applyMatrix4(invMatrix);
          const cs = this._controllerContentState;
          cs.active = true;
          cs.window = win;
          cs.controller = controller;
          cs.startPoint.copy(hit.point);
          cs.lastPoint.copy(hit.point);
          cs.startTime = performance.now();
          cs.totalMove = 0;
          cs.startDist = hit.distance;
          win.onContentInteraction(localPoint, 'start', -1);
          win.focus();
          return;
        }
      }
    }
  }

  onSelectEnd(controller) {
    // Controller content interaction end (tap detection)
    const cs = this._controllerContentState;
    if (cs.active && cs.controller === controller && cs.window) {
      const elapsed = performance.now() - cs.startTime;
      const isTap = elapsed < 500 && cs.totalMove < 0.04;

      if (isTap && cs.window.onContentInteraction) {
        const invMatrix = new THREE.Matrix4().copy(cs.window.contentMesh.matrixWorld).invert();
        const localPoint = cs.startPoint.clone().applyMatrix4(invMatrix);
        cs.window.onContentInteraction(localPoint, 'tap', -1);
      }

      if (cs.window.onContentInteraction) {
        cs.window.onContentInteraction(null, 'end', -1);
      }
      cs.active = false;
      cs.window = null;
      cs.controller = null;
    }

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

    // If the OTHER hand is already dragging a window,
    // let this hand join by pinching ANYWHERE near that window
    if (otherState.dragging && otherState.window) {
      const win = otherState.window;
      const winPos = new THREE.Vector3();
      win.root.getWorldPosition(winPos);
      const maxReach = Math.max(win.width, win.height) + 0.15;
      if (pinchPoint.distanceTo(winPos) < maxReach) {
        this._handDragState[handIdx].dragging = true;
        this._handDragState[handIdx].window = win;
        this._handDragState[handIdx].offset.copy(win.root.position).sub(pinchPoint);
        this._handDragState[handIdx].pinchPoint = pinchPoint.clone();
        win.dragging = true;
        this._initTwoHandAnchor(win);
        return true;
      }
    }

    for (const win of this.windows) {
      if (win.closed || !win.visible) continue;

      // Check close button
      if (win.closable) {
        const closeDist = pinchPoint.distanceTo(
          new THREE.Vector3().setFromMatrixPosition(win.closeBtnMesh.matrixWorld)
        );
        if (closeDist < 0.04) {
          win.close();
          return true;
        }
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

      // Check resize handles
      for (const [name, handle] of Object.entries(win._resizeHandles)) {
        const handleWorld = new THREE.Vector3();
        handle.mesh.getWorldPosition(handleWorld);
        if (pinchPoint.distanceTo(handleWorld) < 0.06) {
          this._startResize(win, name, pinchPoint, null, handIdx);
          return true;
        }
      }

      // Check content mesh for scroll/cursor interaction
      if (win.contentMesh && win.onContentInteraction) {
        const contentWorld = new THREE.Vector3();
        win.contentMesh.getWorldPosition(contentWorld);
        const contentDist = pinchPoint.distanceTo(contentWorld);
        const maxDist = Math.max(win._contentW || 0.5, win._contentH || 0.4) * 0.6;
        if (contentDist < maxDist) {
          const invMatrix = new THREE.Matrix4().copy(win.contentMesh.matrixWorld).invert();
          const localPoint = pinchPoint.clone().applyMatrix4(invMatrix);
          const ci = this._contentInteraction[handIdx];
          ci.active = true;
          ci.window = win;
          ci.startPoint.copy(pinchPoint);
          ci.lastPoint.copy(pinchPoint);
          ci.startTime = performance.now();
          ci.totalMove = 0;
          win.onContentInteraction(localPoint, 'start', handIdx);
          win.focus();
          return true;
        }
      }
    }
    return false;
  }

  onPinchEnd(handIdx) {
    // Handle content interaction end
    const ci = this._contentInteraction[handIdx];
    if (ci.active && ci.window) {
      const elapsed = performance.now() - ci.startTime;
      const isTap = elapsed < 500 && ci.totalMove < 0.04;

      if (isTap && ci.window.onContentInteraction) {
        const invMatrix = new THREE.Matrix4().copy(ci.window.contentMesh.matrixWorld).invert();
        const localPoint = ci.startPoint.clone().applyMatrix4(invMatrix);
        ci.window.onContentInteraction(localPoint, 'tap', handIdx);
      }

      if (ci.window.onContentInteraction) {
        ci.window.onContentInteraction(null, 'end', handIdx);
      }
      ci.active = false;
      ci.window = null;
    }

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
    // Handle content interaction scroll
    const ci = this._contentInteraction[handIdx];
    if (ci.active && ci.window) {
      const delta = pinchPoint.clone().sub(ci.lastPoint);
      ci.totalMove += delta.length();
      ci.lastPoint.copy(pinchPoint);

      // Project delta onto window's local Y axis for scroll
      const win = ci.window;
      const localUp = new THREE.Vector3(0, 1, 0).applyQuaternion(win.root.quaternion);
      const scrollDot = delta.dot(localUp);

      if (win.onContentInteraction) {
        win.onContentInteraction({ y: scrollDot }, 'move', handIdx);
      }
      return;
    }

    const state = this._handDragState[handIdx];

    // Track latest pinch position
    if (state.dragging) {
      state.pinchPoint = pinchPoint.clone();
    }

    if (state.dragging && state.window) {
      const other = this._handDragState[1 - handIdx];

      // Two-hand mode: rotate + scale + move
      if (other.dragging && other.window === state.window && this._twoHandAnchor) {
        const anchor = this._twoHandAnchor;
        const win = state.window;

        const p0 = this._handDragState[0].pinchPoint;
        const p1 = this._handDragState[1].pinchPoint;
        if (!p0 || !p1) return;

        const lx0 = anchor.local0.x, lz0 = anchor.local0.z;
        const lx1 = anchor.local1.x, lz1 = anchor.local1.z;
        const wx0 = p0.x, wz0 = p0.z;
        const wx1 = p1.x, wz1 = p1.z;

        const ldx = lx1 - lx0, ldz = lz1 - lz0;
        const localDist = Math.sqrt(ldx * ldx + ldz * ldz);
        const wdx = wx1 - wx0, wdz = wz1 - wz0;
        const worldDist = Math.sqrt(wdx * wdx + wdz * wdz);

        const newScale = (localDist > 0.001)
          ? Math.max(0.2, Math.min(4.0, worldDist / localDist))
          : anchor.startScale;
        win.root.scale.setScalar(newScale);

        const localAngle = Math.atan2(ldx, ldz);
        const worldAngle = Math.atan2(wdx, wdz);
        const newRotY = worldAngle - localAngle;
        win.root.rotation.y = newRotY;

        const cosR = Math.cos(newRotY);
        const sinR = Math.sin(newRotY);
        const scaledLocalX = lx0 * newScale;
        const scaledLocalZ = lz0 * newScale;
        const rotatedX = scaledLocalX * cosR + scaledLocalZ * sinR;
        const rotatedZ = -scaledLocalX * sinR + scaledLocalZ * cosR;

        win.root.position.x = wx0 - rotatedX;
        win.root.position.z = wz0 - rotatedZ;
        win.root.position.y = (p0.y + p1.y) / 2 - (anchor.local0.y + anchor.local1.y) / 2 * newScale;

      } else if (!other.dragging || other.window !== state.window) {
        // Single-hand drag
        const target = pinchPoint.clone().add(state.offset);
        state.window.root.position.copy(target);
      }
    }
    if (this._resizeState.active && this._resizeState.handIdx === handIdx) {
      this._updateResize(pinchPoint);
    }
  }

  // ── Hand GRAB interaction (closed fist — like Code City) ─────

  onGrabStart(handIdx, grabCenter) {
    // Check if other hand is already grabbing a window → two-hand mode
    const otherGs = this._handGrabState[1 - handIdx];
    if (otherGs.grabbing && otherGs.window) {
      const win = otherGs.window;
      const gs = this._handGrabState[handIdx];
      gs.grabbing = true;
      gs.window = win;
      gs.point.copy(grabCenter);
      gs.offset.copy(win.root.position).sub(grabCenter);
      win.dragging = true;
      this._initGrabTwoHandAnchor(win);
      return true;
    }

    // Grab the nearest open window — no distance limit.
    // Raycast from camera through grabCenter to find the hit point on the window
    // so the anchor is where the ray hits, not where the hand is.
    let closest = null;
    let closestDist = Infinity;
    for (const win of this.windows) {
      if (win.closed || !win.visible) continue;
      const winPos = new THREE.Vector3();
      win.root.getWorldPosition(winPos);
      const d = grabCenter.distanceTo(winPos);
      if (d < closestDist) {
        closestDist = d;
        closest = win;
      }
    }
    if (closest) {
      // Raycast from camera through hand to find intersection on the window frame
      const cam = this.camera;
      const camPos = new THREE.Vector3();
      cam.getWorldPosition(camPos);
      const rayDir = grabCenter.clone().sub(camPos).normalize();
      this._raycaster.set(camPos, rayDir);
      const hits = this._raycaster.intersectObjects(closest.getInteractableMeshes(), false);
      // Offset = window pos minus hit point (or hand if no hit)
      const anchor = (hits.length > 0) ? hits[0].point : grabCenter;

      const gs = this._handGrabState[handIdx];
      gs.grabbing = true;
      gs.window = closest;
      gs.point.copy(grabCenter);
      gs.offset.copy(closest.root.position).sub(anchor);
      closest.dragging = true;
      closest.focus();
      return true;
    }
    return false;
  }

  onGrabEnd(handIdx) {
    const gs = this._handGrabState[handIdx];
    if (gs.grabbing && gs.window) {
      const win = gs.window;
      gs.grabbing = false;
      gs.window = null;
      this._grabTwoHandAnchor = null;

      // If the other hand is still grabbing this window, recalculate its offset
      const other = this._handGrabState[1 - handIdx];
      if (other.grabbing && other.window === win) {
        other.offset.copy(win.root.position).sub(other.point);
      } else {
        win.dragging = false;
      }
    }
  }

  onGrabMove(handIdx, grabCenter) {
    const gs = this._handGrabState[handIdx];
    if (!gs.grabbing || !gs.window) return;
    gs.point.copy(grabCenter);

    const win = gs.window;
    const otherGs = this._handGrabState[1 - handIdx];

    if (otherGs.grabbing && otherGs.window === win) {
      // ── Two-hand: rotate + scale + move ──
      if (!this._grabTwoHandAnchor) this._initGrabTwoHandAnchor(win);
      const anchor = this._grabTwoHandAnchor;

      const p0 = this._handGrabState[0].point;
      const p1 = this._handGrabState[1].point;

      const lx0 = anchor.local0.x, lz0 = anchor.local0.z;
      const lx1 = anchor.local1.x, lz1 = anchor.local1.z;
      const wx0 = p0.x, wz0 = p0.z;
      const wx1 = p1.x, wz1 = p1.z;

      const ldx = lx1 - lx0, ldz = lz1 - lz0;
      const localDist = Math.sqrt(ldx * ldx + ldz * ldz);
      const wdx = wx1 - wx0, wdz = wz1 - wz0;
      const worldDist = Math.sqrt(wdx * wdx + wdz * wdz);

      const newScale = (localDist > 0.001)
        ? Math.max(0.2, Math.min(4.0, worldDist / localDist))
        : anchor.startScale;
      win.root.scale.setScalar(newScale);

      const localAngle = Math.atan2(ldx, ldz);
      const worldAngle = Math.atan2(wdx, wdz);
      const newRotY = worldAngle - localAngle;
      win.root.rotation.y = newRotY;

      const cosR = Math.cos(newRotY);
      const sinR = Math.sin(newRotY);
      const sx = lx0 * newScale;
      const sz = lz0 * newScale;
      const rx = sx * cosR + sz * sinR;
      const rz = -sx * sinR + sz * cosR;

      win.root.position.x = wx0 - rx;
      win.root.position.z = wz0 - rz;
      win.root.position.y = (p0.y + p1.y) / 2
        - (anchor.local0.y + anchor.local1.y) / 2 * newScale;

    } else {
      // ── Single-hand: window follows hand ──
      win.root.position.copy(grabCenter).add(gs.offset);
    }
  }

  _initGrabTwoHandAnchor(win) {
    const p0 = this._handGrabState[0].point;
    const p1 = this._handGrabState[1].point;

    const invMatrix = new THREE.Matrix4().copy(win.root.matrixWorld).invert();
    const local0 = p0.clone().applyMatrix4(invMatrix);
    const local1 = p1.clone().applyMatrix4(invMatrix);

    this._grabTwoHandAnchor = {
      local0,
      local1,
      startScale: win.root.scale.x,
    };
  }

  // ── Two-hand anchor (rotate + scale windows via pinch) ──────

  _initTwoHandAnchor(win) {
    const p0 = this._handDragState[0].pinchPoint;
    const p1 = this._handDragState[1].pinchPoint;
    if (!p0 || !p1) return;

    const invMatrix = new THREE.Matrix4().copy(win.root.matrixWorld).invert();
    const local0 = p0.clone().applyMatrix4(invMatrix);
    const local1 = p1.clone().applyMatrix4(invMatrix);

    this._twoHandAnchor = {
      local0,
      local1,
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
    const worldDelta = currentPoint.clone().sub(rs.startPoint);

    // Project delta into the window's local space so resize works regardless of rotation
    const invQuat = win.root.quaternion.clone().invert();
    const delta = worldDelta.clone().applyQuaternion(invQuat);

    let newW = rs.startWidth;
    let newH = rs.startHeight;

    if (rs.edge === 'right' || rs.edge === 'br' || rs.edge === 'tr') newW = rs.startWidth + delta.x;
    if (rs.edge === 'left'  || rs.edge === 'bl' || rs.edge === 'tl') newW = rs.startWidth - delta.x;
    if (rs.edge === 'bottom'|| rs.edge === 'bl' || rs.edge === 'br') newH = rs.startHeight - delta.y;
    if (rs.edge === 'top'   || rs.edge === 'tl' || rs.edge === 'tr') newH = rs.startHeight + delta.y;

    newW = Math.max(win.minWidth, Math.min(win.maxWidth, newW));
    newH = Math.max(win.minHeight, Math.min(win.maxHeight, newH));

    if (Math.abs(newW - win.width) > 0.005 || Math.abs(newH - win.height) > 0.005) {
      // Use scale-based resize — fast, no rebuild needed
      const scaleX = newW / rs.startWidth;
      const scaleY = newH / rs.startHeight;
      win.root.scale.set(scaleX, scaleY, 1);
      win.width = newW;
      win.height = newH;
    }
  }

  _endResize() {
    const win = this._resizeState.window;
    if (win) {
      win.resizing = false;
      // Reset scale and do a proper rebuild at the final size
      win.root.scale.set(1, 1, 1);
      const pos = [win.root.position.x, win.root.position.y, win.root.position.z];
      const quat = win.root.quaternion.clone();
      while (win.root.children.length > 0) {
        win.root.remove(win.root.children[0]);
      }
      const BORDER = 0.006;
      const TITLEBAR_H = 0.035;
      win._buildFrame(win.width, win.height);
      win._buildContent(win.width, win.height, BORDER, TITLEBAR_H);
      win._buildTitleBar(win.width, TITLEBAR_H, BORDER);
      win._buildBorders(win.width, win.height, BORDER, TITLEBAR_H);
      win._buildResizeHandles(win.width, win.height, BORDER, TITLEBAR_H);
      win.root.quaternion.copy(quat);
    }
    this._resizeState.active = false;
    this._resizeState.window = null;
  }

  // ── Explorer toggle: fade/scale all windows ─────────────────

  fadeAllWindows(opacity = 0.3, scale = 0.92) {
    for (const win of this.windows) {
      if (!win.closed) win.setFade(opacity, scale);
    }
  }

  unfadeAllWindows() {
    for (const win of this.windows) {
      if (!win.closed) win.setFade(1, 1);
    }
  }

  // ── Per-frame update ──────────────────────────────────────────

  update(frame, dt, elapsed, controllers, activeCamera) {
    // Cursor + ray visibility: raycast controllers against windows
    let cursorPlaced = false;
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

        // Raycast against all window meshes for cursor placement
        if (!cursorPlaced) {
          const allMeshes = [];
          for (const win of this.windows) {
            if (win.closed || !win.visible) continue;
            allMeshes.push(...win.getInteractableMeshes());
          }
          const hits = this._raycaster.intersectObjects(allMeshes, false);
          if (hits.length > 0) {
            cursorPlaced = true;
            this._cursor.visible = true;
            this._cursor.position.copy(hits[0].point);
            // Find which window was hit and match its orientation
            const hitObj = hits[0].object;
            for (const win of this.windows) {
              if (win.closed || !win.visible) continue;
              if (win.getInteractableMeshes().includes(hitObj)) {
                this._cursor.quaternion.copy(win.root.quaternion);
                break;
              }
            }
            // Offset forward slightly to prevent z-fighting
            const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(this._cursor.quaternion);
            this._cursor.position.addScaledVector(fwd, 0.002);
            // Hide the ray line on this controller
            const ray = ctrl.children.find(c => c.isLine);
            if (ray) ray.visible = false;
          } else {
            // No hit — show ray
            const ray = ctrl.children.find(c => c.isLine);
            if (ray) ray.visible = true;
          }
        }
      }
    }
    if (!cursorPlaced) this._cursor.visible = false;

    // Controller drag update
    if (this._controllerDragWindow && this._controllerDragCtrl) {
      const win = this._controllerDragWindow;
      const ctrl = this._controllerDragCtrl;

      this._tempMatrix.identity().extractRotation(ctrl.matrixWorld);
      this._raycaster.ray.origin.setFromMatrixPosition(ctrl.matrixWorld);
      this._raycaster.ray.direction.set(0, 0, -1).applyMatrix4(this._tempMatrix);

      const target = this._raycaster.ray.origin.clone()
        .add(this._raycaster.ray.direction.clone().multiplyScalar(this._controllerDragDist));
      target.add(this._controllerDragOffset);

      win.root.position.copy(target);
    }

    // Controller content interaction update (scroll via ray)
    const cs = this._controllerContentState;
    if (cs.active && cs.controller && cs.window) {
      const ctrl = cs.controller;
      this._tempMatrix.identity().extractRotation(ctrl.matrixWorld);
      this._raycaster.ray.origin.setFromMatrixPosition(ctrl.matrixWorld);
      this._raycaster.ray.direction.set(0, 0, -1).applyMatrix4(this._tempMatrix);

      const hits = this._raycaster.intersectObject(cs.window.contentMesh, false);
      if (hits.length > 0) {
        const currentPoint = hits[0].point;
        const delta = currentPoint.clone().sub(cs.lastPoint);
        cs.totalMove += delta.length();

        const localUp = new THREE.Vector3(0, 1, 0).applyQuaternion(cs.window.root.quaternion);
        const scrollDot = delta.dot(localUp);

        if (cs.window.onContentInteraction) {
          cs.window.onContentInteraction({ y: scrollDot }, 'move', -1);
        }
        cs.lastPoint.copy(currentPoint);
      }
    }

    // Controller resize update
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

    // Billboard: only auto-face camera when dragging with CONTROLLER (not hand grab)
    if (this._controllerDragWindow) {
      const cam = activeCamera || this.camera;
      const camPos = new THREE.Vector3();
      cam.getWorldPosition(camPos);
      const win = this._controllerDragWindow;
      if (!win.closed && win.visible) {
        const winPos = win.root.position;
        const lookTarget = new THREE.Vector3(camPos.x, winPos.y, camPos.z);
        win.root.lookAt(lookTarget);
      }
    }

    // Update all windows
    for (const win of this.windows) {
      win.update(dt, elapsed);
    }
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

      // Drag bar (title bar) proximity
      const dragWorld = new THREE.Vector3();
      win.dragBarMesh.getWorldPosition(dragWorld);
      if (fingerTipPos.distanceTo(dragWorld) < 0.06) {
        win.hoverTarget = 'dragBar';
        continue;
      }

      // Close button proximity
      if (win.closable) {
        const closeWorld = new THREE.Vector3();
        win.closeBtnMesh.getWorldPosition(closeWorld);
        if (fingerTipPos.distanceTo(closeWorld) < 0.04) {
          win.hoverTarget = 'closeBtn';
          continue;
        }
      }

      // Resize handles proximity
      let foundHandle = false;
      for (const [name, handle] of Object.entries(win._resizeHandles)) {
        const handleWorld = new THREE.Vector3();
        handle.mesh.getWorldPosition(handleWorld);
        if (fingerTipPos.distanceTo(handleWorld) < 0.06) {
          win.hoverTarget = name;
          foundHandle = true;
          break;
        }
      }
      if (foundHandle) continue;

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

export { PixelArt, ManagedWindow, WindowManager };
