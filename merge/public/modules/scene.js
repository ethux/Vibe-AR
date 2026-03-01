// ─── Scene — Three.js setup, controllers, hand tracking, render loop ───
import {
  getRenderer, setRenderer, getTermWs, WIN_W, WIN_H,
} from './state.js';
import { log } from './logging.js';
import { renderTermToCanvas, termRenderCanvas } from './terminal.js';
import { WindowManager } from './WindowManager.js';
import { build3DKeyboard, toggleKb3D, handleKbKeyPress, getKbKeyMeshes, isKbVisible } from './keyboard3d.js';
import { toggleMicFromBtn, setMicBtnMesh, startRecording, stopRecording, getIsRecording } from './voice.js';
import { makeTextTexture } from './textures.js';
import { addTermOutputListener } from './terminal.js';
import { stopTTS, isTtsSpeaking } from './tts.js';
import { AnimationManager } from './AnimationManager.js';
import { getJointPos, detectPalmOpen as htDetectPalmOpen, detectPinch as htDetectPinch, detectFist, detectPointing } from './hand-tracking.js';
import { CodeCityRenderer } from './CodeCity.js';
import { FileBubbleManager } from './bubbles.js';
import { GitTreeRenderer } from './git-tree.js';
import { LivePreviewManager } from './live-preview.js';
import { HandRenderer } from './HandRenderer.js';
import { initSceneControl } from './scene-control.js';
import { StreamScreenWindow } from './StreamScreenWindow.js';
import { FileViewerWindow } from './FileViewerWindow.js';

let scene, camera, clock;
let wm, termWin, kbBtnMesh, micBtnMesh;
let animMgr;  // mascot animation manager
let codeCity;  // 3D code visualization
let bubbleMgr; // file bubble browser
let gitTree;   // 3D git history tree
let livePreview; // dev server preview manager
let handRenderer; // 3D glove hand models
let streamScreen; // live Mac screen stream
let fileViewer;   // code/image file viewer

export function getScene() { return scene; }
export function getCamera() { return camera; }

export function initScene() {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.01, 100);
  camera.position.set(0, 1.6, 0);
  clock = new THREE.Clock();

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(devicePixelRatio);
  renderer.setClearColor(0x000000, 0);
  renderer.xr.enabled = true;
  document.body.appendChild(renderer.domElement);
  setRenderer(renderer);

  scene.add(new THREE.AmbientLight(0xffffff, 1.0));
  const dl = new THREE.DirectionalLight(0xffffff, 1.0);
  dl.position.set(2, 4, 3);
  scene.add(dl);

  // ── Animation Manager for mascot character ──
  animMgr = new AnimationManager(scene);

  // ── WindowManager + terminal window ──
  wm = new WindowManager(scene, renderer, camera);
  termWin = wm.createWindow({
    title: 'VIBE AR',
    width: WIN_W,
    height: WIN_H,
    position: [0, 1.4, -0.7],
    canvasWidth: 1024,
    canvasHeight: 768,
    closable: false,
  });
  // Linear filtering for terminal text readability
  termWin._contentTex.magFilter = THREE.LinearFilter;

  // ── CodeCity + File Bubbles ──
  codeCity = new CodeCityRenderer(scene, camera, wm);
  bubbleMgr = new FileBubbleManager(scene, wm, codeCity);
  bubbleMgr.loadFiles('.');  // load root workspace files

  // ── Git Tree (3D commit history) ──
  gitTree = new GitTreeRenderer(scene, camera, wm);
  gitTree.loadHistory();  // auto-load on init

  // ── Live Preview (dev server detection) ──
  livePreview = new LivePreviewManager(scene, wm);

  // ── Hand Renderer (3D glove models) ──
  handRenderer = new HandRenderer(scene);

  // ── Stream Screen Window (Mac screen capture) ──
  streamScreen = new StreamScreenWindow(wm);

  // ── File Viewer (code editor / image preview) ──
  fileViewer = new FileViewerWindow(wm);

  // ── Scene Control (MCP WebSocket bridge) ──
  initSceneControl({ gitTree, bubbleMgr, codeCity, wm, streamScreen, livePreview, fileViewer });

  // ── KB + MIC buttons on the title bar ──
  const titleY = termWin.getTitleBarYOffset();

  const kbBtnGeo = new THREE.PlaneGeometry(0.06, 0.025);
  const kbBtnMat = new THREE.MeshBasicMaterial({
    map: makeTextTexture('KB', 24, '#FF7000', '#C0C0C0', 96, 40),
    transparent: true, depthWrite: true,
  });
  kbBtnMesh = new THREE.Mesh(kbBtnGeo, kbBtnMat);
  kbBtnMesh.position.set(WIN_W / 2 - 0.045, titleY, 0.004);
  termWin.root.add(kbBtnMesh);

  const micBtnGeo = new THREE.PlaneGeometry(0.06, 0.025);
  const micBtnMat = new THREE.MeshBasicMaterial({
    map: makeTextTexture('MIC', 22, '#28c840', '#C0C0C0', 96, 40),
    transparent: true, depthWrite: true,
  });
  micBtnMesh = new THREE.Mesh(micBtnGeo, micBtnMat);
  micBtnMesh.position.set(WIN_W / 2 - 0.115, titleY, 0.004);
  termWin.root.add(micBtnMesh);
  setMicBtnMesh(micBtnMesh);

  // ── 3D keyboard attached to terminal window ──
  build3DKeyboard(termWin.root);

  // ── Controllers ──
  const ctrl0 = renderer.xr.getController(0);
  const ctrl1 = renderer.xr.getController(1);
  scene.add(ctrl0); scene.add(ctrl1);

  function addRay(c) {
    const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,0,0), new THREE.Vector3(0,0,-3)]);
    c.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xFF7000 })));
  }
  addRay(ctrl0); addRay(ctrl1);

  scene.add(renderer.xr.getControllerGrip(0));
  scene.add(renderer.xr.getControllerGrip(1));

  // ── Controller select — route custom buttons first, then WM ──
  const raycaster = new THREE.Raycaster();
  const tempMatrix = new THREE.Matrix4();

  function onSelStart(e) {
    const c = e.target;
    tempMatrix.identity().extractRotation(c.matrixWorld);
    raycaster.ray.origin.setFromMatrixPosition(c.matrixWorld);
    raycaster.ray.direction.set(0,0,-1).applyMatrix4(tempMatrix);

    // MIC button
    if (micBtnMesh) {
      const micHits = raycaster.intersectObject(micBtnMesh);
      if (micHits.length) { toggleMicFromBtn(); return; }
    }
    // KB button
    if (kbBtnMesh) {
      const kbHits = raycaster.intersectObject(kbBtnMesh);
      if (kbHits.length) { toggleKb3D(); return; }
    }
    // 3D keyboard keys
    if (isKbVisible()) {
      const kbKeyMeshes = getKbKeyMeshes();
      if (kbKeyMeshes.length) {
        const keyMeshList = kbKeyMeshes.map(k => k.mesh);
        const keyHits = raycaster.intersectObjects(keyMeshList);
        if (keyHits.length) {
          const hit = kbKeyMeshes.find(k => k.mesh === keyHits[0].object);
          if (hit) { handleKbKeyPress(hit.char); return; }
        }
      }
    }
    // Fall through to WindowManager (drag, resize)
    wm.onSelectStart(c);
  }

  function onSelEnd(e) {
    wm.onSelectEnd(e.target);
  }

  ctrl0.addEventListener('selectstart', onSelStart); ctrl0.addEventListener('selectend', onSelEnd);
  ctrl1.addEventListener('selectstart', onSelStart); ctrl1.addEventListener('selectend', onSelEnd);

  // ── Hand tracking (using imported gesture detection) ──
  const hs = [
    { pinching: false },
    { pinching: false },
  ];

  // Per-hand mascot animation state
  // pointFrames: debounce counter — must reach POINT_THRESHOLD before triggering
  const POINT_THRESHOLD = 8;
  const handAnimState = [
    { active: null, wasOpen: false, pointFrames: 0 }, // left
    { active: null, wasOpen: false, pointFrames: 0 }, // right
  ];

  // Per-hand grab state for CodeCity
  const prevGrabState = [false, false];

  // Back-swipe state (right hand pinch in empty space + 7cm move → go back)
  let _backSwipeActive = false;
  const _backSwipeStart = new THREE.Vector3();

  // Fist rotation state (right hand) — physics-based with momentum
  let _fistRotating = false;
  let _fistLastX    = 0;
  let _rotVelocity  = 0;          // current angular velocity (dx units/frame)
  const ROT_FRICTION = 0.97;      // deceleration per frame after fist release (~1.5s coast)
  const ROT_ACCEL    = 0.35;      // lerp factor toward target velocity (responsiveness)
  const ROT_MAX      = 0.035;     // velocity cap to avoid wild spinning
  const ROT_STOP     = 0.00008;   // below this, snap to zero

  // Grab-drag state (right hand pinch on bubble → bubble tracks hand; pull 5cm + release = open)
  let _draggedBubble         = null;
  const _dragGrabOffset      = new THREE.Vector3(); // bubble pos − pinch pos at grab start
  let _dragStartCamDist      = 0;                   // distance camera→pinch at grab start
  const _dragOriginalPos     = new THREE.Vector3();
  const DRAG_OPEN_THRESHOLD  = 0.05;  // 5cm closer to camera → open/enter

  // ── Hand laser pointer (right hand index finger → distant bubble targeting) ──
  const _laserGeo = new THREE.BufferGeometry();
  _laserGeo.setAttribute('position', new THREE.Float32BufferAttribute([0,0,0, 0,0,-2.5], 3));
  const _laserMat = new THREE.LineBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.55, depthTest: false });
  const _laserLine = new THREE.Line(_laserGeo, _laserMat);
  _laserLine.visible = false;
  _laserLine.renderOrder = 999;
  scene.add(_laserLine);
  let _laserTargetBubble = null; // bubble currently aimed at by the laser

  // ── Render loop ──
  renderer.setAnimationLoop((ts, frame) => {
    const dt = clock.getDelta();
    const elapsed = clock.getElapsedTime();
    const termWs = getTermWs();

    // Terminal texture → draw onto window's content canvas
    if (termWs && termWs.readyState === WebSocket.OPEN && termWin && !termWin.closed) {
      renderTermToCanvas();
      const ctx = termWin.contentCtx;
      ctx.drawImage(termRenderCanvas, 0, 0, termWin.CANVAS_W, termWin.CANVAS_H);
      termWin.markContentDirty();
    }

    // Hand tracking
    if (frame && renderer.xr.isPresenting) {
      const sess = renderer.xr.getSession();
      const ref = renderer.xr.getReferenceSpace();
      if (sess && ref) {
        for (const src of sess.inputSources) {
          if (!src.hand) continue;
          const handIdx = src.handedness === 'left' ? 0 : 1;
          const s = hs[handIdx];
          const p = htDetectPinch(src, frame, ref);

          if (p.pinching && !s.pinching) {
            s.pinching = true;
            if (p.pinchPoint) {
              // Check custom buttons first
              if (micBtnMesh) {
                const mw = new THREE.Vector3(); micBtnMesh.getWorldPosition(mw);
                if (p.pinchPoint.distanceTo(mw) < 0.06) { toggleMicFromBtn(); continue; }
              }
              if (kbBtnMesh) {
                const bw = new THREE.Vector3(); kbBtnMesh.getWorldPosition(bw);
                if (p.pinchPoint.distanceTo(bw) < 0.06) { toggleKb3D(); continue; }
              }
              if (isKbVisible()) {
                const kbKeyMeshes = getKbKeyMeshes();
                let hitKey = false;
                for (const k of kbKeyMeshes) {
                  const kw = new THREE.Vector3(); k.mesh.getWorldPosition(kw);
                  if (p.pinchPoint.distanceTo(kw) < 0.035) {
                    handleKbKeyPress(k.char); hitKey = true; break;
                  }
                }
                if (hitKey) continue;
              }
              // Check git tree
              {
                const tmpRay = new THREE.Raycaster();
                tmpRay.ray.origin.copy(p.pinchPoint);
                tmpRay.ray.direction.set(0, 0, -1);
                if (gitTree.handleRaycast(tmpRay)) continue;
              }
              // Check file bubbles — left/right distinction
              if (src.handedness === 'left') {
                if (bubbleMgr.handleLeftPinch(p.pinchPoint)) continue;
              } else {
                // Right hand: grab-drag — laser target first, then proximity, then camera ray
                let grabbed = _laserTargetBubble
                  || bubbleMgr.findClosestFreeBubble(p.pinchPoint);
                if (!grabbed) {
                  const xrCam = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
                  const camPos = new THREE.Vector3();
                  xrCam.getWorldPosition(camPos);
                  const rayDir = p.pinchPoint.clone().sub(camPos);
                  grabbed = bubbleMgr.findBubbleByRay(camPos, rayDir);
                }
                if (grabbed) {
                  _draggedBubble = grabbed;
                  _dragGrabOffset.copy(grabbed.position).sub(p.pinchPoint);
                  _dragOriginalPos.copy(grabbed.position);
                  const _grabCam = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
                  const _grabCamPos = new THREE.Vector3();
                  _grabCam.getWorldPosition(_grabCamPos);
                  _dragStartCamDist = p.pinchPoint.distanceTo(_grabCamPos);
                  grabbed.userData.scaleTarget = 1.15;
                  _backSwipeActive = false;
                  continue;
                }
                // Right pinch in empty space → start back-swipe tracking
                _backSwipeActive = true;
                _backSwipeStart.copy(p.pinchPoint);
              }
              // Fall through to WindowManager
              wm.onPinchStart(handIdx, p.pinchPoint);
            }
          } else if (p.pinching && s.pinching && p.pinchPoint) {
            // Move grabbed bubble along Z while pinching
            if (_draggedBubble && src.handedness === 'right') {
              // Bubble tracks hand freely in 3D (offset preserved from grab start)
              _draggedBubble.position.copy(p.pinchPoint).add(_dragGrabOffset);
            } else {
              wm.onPinchMove(handIdx, p.pinchPoint);
            }
          } else if (!p.pinching && s.pinching) {
            s.pinching = false;
            // Resolve grab-drag on release
            if (_draggedBubble && src.handedness === 'right') {
              // Compute pull distance toward camera (direction-independent)
              const xrCamR = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
              const camPosR = new THREE.Vector3();
              xrCamR.getWorldPosition(camPosR);
              const endCamDist = p.pinchPoint ? p.pinchPoint.distanceTo(camPosR) : _dragStartCamDist;
              const dr = _dragStartCamDist - endCamDist; // positive = pulled toward camera
              if (dr > DRAG_OPEN_THRESHOLD) {
                bubbleMgr.openBubble(_draggedBubble);           // pull 5cm toward self → open/enter
              } else {
                _draggedBubble.position.copy(_dragOriginalPos); // small move → cancel
                _draggedBubble.userData.scaleTarget = 1;
              }
              _draggedBubble = null;
            } else {
              wm.onPinchEnd(handIdx);
              // Back-swipe: right hand pinch + swipe left 10cm → go back
              if (src.handedness === 'right' && _backSwipeActive) {
                _backSwipeActive = false;
                if (p.pinchPoint && (p.pinchPoint.x - _backSwipeStart.x) < -0.10) {
                  bubbleMgr.navigateBack();
                }
              }
            }
          }

          // ── Palm open/close → mascot character + voice control (RIGHT HAND ONLY) ──
          const handedness = src.handedness || (handIdx === 0 ? 'left' : 'right');

          // ── Left hand palm tracking → file bubble orbit ──
          if (handedness === 'left') {
            const leftPalm = htDetectPalmOpen(src, frame, ref, handedness, renderer);
            const palmCenter = leftPalm.palmCenter ? leftPalm.palmCenter.clone() : null;
            if (palmCenter) palmCenter.y += 0.05;
            bubbleMgr.updatePalm(palmCenter, leftPalm.open);
          }

          if (handedness === 'right') {
            const rawPointing = detectPointing(src, frame, ref);
            const anim = handAnimState[handIdx];

            // Debounce: increment counter while pointing, reset instantly on stop
            if (rawPointing) {
              anim.pointFrames = Math.min(anim.pointFrames + 1, POINT_THRESHOLD + 1);
            } else {
              anim.pointFrames = 0;
            }
            const isPointing = anim.pointFrames >= POINT_THRESHOLD;

            // Index held long enough → spawn mascot + start recording
            if (isPointing && !anim.wasOpen) {
              anim.wasOpen = true;
              if (anim.active) { anim.active.kill(); anim.active = null; }
              const indexTip = getJointPos(src, 'index-finger-tip', frame, ref);
              const spawnPos = indexTip ? indexTip.clone() : new THREE.Vector3(0, 1.4, -0.5);
              spawnPos.y += 0.08;
              anim.active = animMgr.play('mascot-bounce', spawnPos, { mode: 'idle' });
              log('[HAND] right index pointed — recording started');
              if (!getIsRecording()) startRecording();
            }

            // While pointing, mascot follows index tip
            if (isPointing && anim.active) {
              const indexTip = getJointPos(src, 'index-finger-tip', frame, ref);
              if (indexTip) { const fp = indexTip.clone(); fp.y += 0.08; anim.active.moveTo(fp); }
            }

            // Index lowered → hide mascot + stop recording/TTS
            if (!isPointing && anim.wasOpen) {
              anim.wasOpen = false;
              if (anim.active) { anim.active.fastHide(0.08); anim.active = null; }
              if (getIsRecording()) { log('[HAND] right index folded — recording stopped'); stopRecording(); }
              stopTTS();
            }
          }

          // ── Fist detection → CodeCity grab + right hand rotates bubbles ──
          const fistResult = detectFist(src, frame, ref);
          if (fistResult.fisting && !prevGrabState[handIdx]) {
            prevGrabState[handIdx] = true;
            if (fistResult.wristPos) codeCity.onGrabStart(handIdx, fistResult.wristPos);
            if (src.handedness === 'right') { _fistRotating = true; _fistLastX = fistResult.wristPos?.x ?? 0; }
          } else if (fistResult.fisting && prevGrabState[handIdx]) {
            if (fistResult.wristPos) codeCity.onGrabMove(handIdx, fistResult.wristPos);
            if (src.handedness === 'right' && _fistRotating && fistResult.wristPos) {
              const dx = fistResult.wristPos.x - _fistLastX;
              _fistLastX = fistResult.wristPos.x;
              // Accelerate smoothly toward target velocity (clamp to max)
              const target = Math.max(-ROT_MAX, Math.min(ROT_MAX, dx));
              _rotVelocity += (target - _rotVelocity) * ROT_ACCEL;
            }
          } else if (!fistResult.fisting && prevGrabState[handIdx]) {
            prevGrabState[handIdx] = false;
            codeCity.onGrabEnd(handIdx);
            if (src.handedness === 'right') _fistRotating = false;
            // Velocity persists — momentum continues after fist release
          }

          // Track index finger tips for CodeCity touch detection
          const indexTip = getJointPos(src, 'index-finger-tip', frame, ref);
          if (indexTip) {
            if (!codeCity._fingerTips) codeCity._fingerTips = [];
            codeCity._fingerTips[handIdx] = { pos: indexTip, handedness: handedness };
          }

          // Hand hover
          wm.updateHandHover(handIdx, indexTip);

          // ── Right hand laser pointer (only when not pinching, not doing voice, not dragging) ──
          if (handedness === 'right') {
            const isVoiceActive = handAnimState[handIdx].wasOpen;
            const showLaser = !s.pinching && !isVoiceActive && !_draggedBubble && indexTip;
            if (showLaser) {
              const indexProx = getJointPos(src, 'index-finger-phalanx-proximal', frame, ref);
              const laserDir = indexProx
                ? indexTip.clone().sub(indexProx).normalize()
                : new THREE.Vector3(0, 0, -1);
              const hit = bubbleMgr.findBubbleByRay(indexTip, laserDir);
              _laserTargetBubble = (hit && !hit.userData.inPalm) ? hit : null;
              const endPt = hit ? hit.position.clone() : indexTip.clone().addScaledVector(laserDir, 2.5);
              const pos = _laserLine.geometry.attributes.position;
              pos.setXYZ(0, indexTip.x, indexTip.y, indexTip.z);
              pos.setXYZ(1, endPt.x, endPt.y, endPt.z);
              pos.needsUpdate = true;
              _laserMat.color.setHex(hit ? 0xffffff : 0x00ffff);
              _laserMat.opacity = hit ? 0.85 : 0.45;
              if (hit) hit.userData.scaleTarget = Math.max(hit.userData.scaleTarget || 1, 1.1);
              _laserLine.visible = true;
            } else {
              _laserLine.visible = false;
              if (s.pinching) _laserTargetBubble = null;
            }
          }
        }
      }
    }

    // ── Fist rotation physics — apply once per frame outside inputSources loop ──
    if (!_fistRotating) _rotVelocity *= ROT_FRICTION;  // coast + decelerate when released
    if (Math.abs(_rotVelocity) > ROT_STOP) {
      bubbleMgr.rotateBubbles(_rotVelocity);
    } else {
      _rotVelocity = 0;  // snap to rest
    }

    // WindowManager update (hover, drag, resize animations, billboarding)
    const xrCamera = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
    wm.update(frame, dt, elapsed, [ctrl0, ctrl1], xrCamera);
    animMgr.update(dt, elapsed, xrCamera);

    // Update CodeCity (matrix rain, finger-touch tooltips)
    codeCity.updateMatrix(dt);
    if (renderer.xr.isPresenting && codeCity._fingerTips) {
      codeCity.updateHover(codeCity._fingerTips);
    }

    // Update 3D hand glove models
    if (frame && renderer.xr.isPresenting) {
      const sess = renderer.xr.getSession();
      const ref = renderer.xr.getReferenceSpace();
      if (sess && ref) {
        const handSources = [...sess.inputSources].filter(s => s.hand);
        handRenderer.update(frame, ref, handSources);
      }
    }

    // Update file bubbles (bobbing animation)
    bubbleMgr.update(dt, elapsed);

    // Update git tree (glow pulse, HEAD particles)
    gitTree.update(dt, elapsed);

    // Update live preview (pulse animation)
    livePreview.update(dt, elapsed);

    renderer.render(scene, camera);
  });

  // ── Trackpad-friendly orbit camera (browser only) ──
  const orbitState = { dragging: false, prevX: 0, prevY: 0, theta: Math.PI, phi: Math.PI / 2, radius: 1.2, targetY: 1.2 };
  function updateOrbitCamera() {
    camera.position.set(
      Math.sin(orbitState.phi) * Math.sin(orbitState.theta) * orbitState.radius,
      orbitState.targetY + Math.cos(orbitState.phi) * orbitState.radius,
      Math.sin(orbitState.phi) * Math.cos(orbitState.theta) * orbitState.radius
    );
    camera.lookAt(0, orbitState.targetY, -0.5);
  }
  renderer.domElement.addEventListener('pointerdown', (e) => {
    if (renderer.xr.isPresenting) return;
    orbitState.dragging = true; orbitState.prevX = e.clientX; orbitState.prevY = e.clientY;
  });
  window.addEventListener('pointermove', (e) => {
    if (!orbitState.dragging || renderer.xr.isPresenting) return;
    const dx = e.clientX - orbitState.prevX, dy = e.clientY - orbitState.prevY;
    orbitState.prevX = e.clientX; orbitState.prevY = e.clientY;
    orbitState.theta -= dx * 0.005;
    orbitState.phi = Math.max(0.3, Math.min(Math.PI - 0.3, orbitState.phi - dy * 0.005));
    updateOrbitCamera();
  });
  window.addEventListener('pointerup', () => { orbitState.dragging = false; });
  renderer.domElement.addEventListener('wheel', (e) => {
    if (renderer.xr.isPresenting) return;
    e.preventDefault();
    if (e.ctrlKey) {
      // Pinch-to-zoom on trackpad
      orbitState.radius = Math.max(0.3, Math.min(5, orbitState.radius + e.deltaY * 0.005));
    } else {
      // Two-finger scroll = zoom
      orbitState.radius = Math.max(0.3, Math.min(5, orbitState.radius + e.deltaY * 0.002));
    }
    updateOrbitCamera();
  }, { passive: false });
  updateOrbitCamera();
  log('[SCENE] Trackpad orbit camera — drag to orbit, scroll/pinch to zoom');

  // ── Mouse click on 3D elements (browser) ──
  const mouseRaycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  renderer.domElement.addEventListener('click', (e) => {
    if (renderer.xr.isPresenting) return;
    mouse.x = (e.clientX / innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / innerHeight) * 2 + 1;
    mouseRaycaster.setFromCamera(mouse, camera);

    if (micBtnMesh) {
      const micHits = mouseRaycaster.intersectObject(micBtnMesh);
      if (micHits.length) { toggleMicFromBtn(); return; }
    }
    if (kbBtnMesh) {
      const hits = mouseRaycaster.intersectObject(kbBtnMesh);
      if (hits.length) { toggleKb3D(); return; }
    }
    if (isKbVisible()) {
      const kbKeyMeshes = getKbKeyMeshes();
      if (kbKeyMeshes.length) {
        const keyMeshList = kbKeyMeshes.map(k => k.mesh);
        const keyHits = mouseRaycaster.intersectObjects(keyMeshList);
        if (keyHits.length) {
          const hit = kbKeyMeshes.find(k => k.mesh === keyHits[0].object);
          if (hit) { handleKbKeyPress(hit.char); return; }
        }
      }
    }
    // Git tree commits
    if (gitTree.handleRaycast(mouseRaycaster)) return;
    // File bubbles
    if (bubbleMgr.handleRaycast(mouseRaycaster)) return;
  });

  window.addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  log('[INIT] Scene ready (WindowManager)');
}
