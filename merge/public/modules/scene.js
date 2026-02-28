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
import { initSceneControl } from './scene-control.js';

let scene, camera, clock;
let wm, termWin, kbBtnMesh, micBtnMesh;
let animMgr;  // mascot animation manager
let codeCity;  // 3D code visualization
let bubbleMgr; // file bubble browser
let gitTree;   // 3D git history tree
let livePreview; // dev server preview manager

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

  // ── Live Preview: feed terminal output for server detection ──
  addTermOutputListener((text) => {
    const result = livePreview.detectServer(text);
    if (result.detected) livePreview.openPreview(result.port, result.framework);
  });

  // ── Scene Control (MCP WebSocket bridge) ──
  initSceneControl({ gitTree, bubbleMgr, codeCity, wm });

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
    { pinching: false, palmOpen: false, palmOpenSmooth: 0, lastGestureTime: 0 },
    { pinching: false, palmOpen: false, palmOpenSmooth: 0, lastGestureTime: 0 },
  ];

  // Per-hand mascot animation state
  const handAnimState = [
    { active: null, wasOpen: false },  // left
    { active: null, wasOpen: false },  // right
  ];

  // Per-hand grab state for CodeCity
  const prevGrabState = [false, false];

  // Gesture cooldown (ms)
  const GESTURE_COOLDOWN = 600;

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
              // Check file bubbles
              if (bubbleMgr.handlePinch(p.pinchPoint)) continue;
              // Fall through to WindowManager
              wm.onPinchStart(handIdx, p.pinchPoint);
            }
          } else if (p.pinching && s.pinching && p.pinchPoint) {
            wm.onPinchMove(handIdx, p.pinchPoint);
          } else if (!p.pinching && s.pinching) {
            s.pinching = false;
            wm.onPinchEnd(handIdx);
          }

          // ── Palm open/close → mascot character + voice control (RIGHT HAND ONLY) ──
          const now = performance.now();
          const handedness = src.handedness || (handIdx === 0 ? 'left' : 'right');

          // ── Left hand palm tracking → file bubble orbit ──
          if (handedness === 'left') {
            const leftPalm = htDetectPalmOpen(src, frame, ref, handedness, renderer);
            const palmCenter = leftPalm.palmCenter ? leftPalm.palmCenter.clone() : null;
            if (palmCenter) palmCenter.y += 0.05;
            bubbleMgr.updatePalm(palmCenter, leftPalm.open);
          }

          if (handedness === 'right') {
            const isPointing = detectPointing(src, frame, ref);
            const anim = handAnimState[handIdx];

            // Index just raised → spawn mascot + start recording
            if (isPointing && !anim.wasOpen && (now - s.lastGestureTime > GESTURE_COOLDOWN)) {
              s.lastGestureTime = now;
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
              if (indexTip) { const p = indexTip.clone(); p.y += 0.08; anim.active.moveTo(p); }
            }

            // Index lowered → hide mascot + stop recording/TTS
            if (!isPointing && anim.wasOpen && (now - s.lastGestureTime > GESTURE_COOLDOWN)) {
              s.lastGestureTime = now;
              if (anim.active) { anim.active.fastHide(0.08); anim.active = null; }
              if (getIsRecording()) { log('[HAND] right index folded — recording stopped'); stopRecording(); }
              stopTTS();
            }

            anim.wasOpen = isPointing;
          }

          // ── Fist detection → CodeCity grab interaction ──
          const fistResult = detectFist(src, frame, ref);
          if (fistResult.fisting && !prevGrabState[handIdx]) {
            prevGrabState[handIdx] = true;
            if (fistResult.wristPos) codeCity.onGrabStart(handIdx, fistResult.wristPos);
          } else if (fistResult.fisting && prevGrabState[handIdx]) {
            if (fistResult.wristPos) codeCity.onGrabMove(handIdx, fistResult.wristPos);
          } else if (!fistResult.fisting && prevGrabState[handIdx]) {
            prevGrabState[handIdx] = false;
            codeCity.onGrabEnd(handIdx);
          }

          // Track right hand for CodeCity tooltips
          if (handedness === 'right') {
            const wristPos = getJointPos(src, 'wrist', frame, ref);
            if (wristPos) codeCity._rightHandPos = wristPos;
          }

          // Hand hover
          const indexTip = getJointPos(src, 'index-finger-tip', frame, ref);
          wm.updateHandHover(handIdx, indexTip);
        }
      }
    }

    // WindowManager update (hover, drag, resize animations)
    wm.update(frame, dt, elapsed, [ctrl0, ctrl1]);

    // Update mascot animations (billboarding, redraw canvas)
    const xrCamera = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
    animMgr.update(dt, elapsed, xrCamera);

    // Update CodeCity (matrix rain, hover tooltips)
    codeCity.updateMatrix(dt);
    if (renderer.xr.isPresenting) {
      codeCity.updateHover([ctrl0, ctrl1]);
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
