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
import { stopTTS, isTtsSpeaking } from './tts.js';
import { AnimationManager } from './AnimationManager.js';

let scene, camera, clock;
let wm, termWin, kbBtnMesh, micBtnMesh;
let animMgr;  // mascot animation manager

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

  // ── Hand tracking ──
  const hs = [
    { pinching: false, palmOpen: false, palmOpenSmooth: 0, lastGestureTime: 0 },
    { pinching: false, palmOpen: false, palmOpenSmooth: 0, lastGestureTime: 0 },
  ];

  // Per-hand mascot animation state
  const handAnimState = [
    { active: null, wasOpen: false },  // left
    { active: null, wasOpen: false },  // right
  ];

  // Gesture cooldown (ms)
  const GESTURE_COOLDOWN = 600;

  // Temp vectors for palm detection
  const _v3A = new THREE.Vector3();
  const _v3B = new THREE.Vector3();
  const _v3C = new THREE.Vector3();

  function jointPos(src, name, frame, ref) {
    if (!src || !src.hand) return null;
    const j = src.hand.get(name);
    if (!j) return null;
    try {
      const pose = frame.getJointPose(j, ref);
      if (!pose) return null;
      const p = pose.transform.position;
      return new THREE.Vector3(p.x, p.y, p.z);
    } catch (e) { return null; }
  }

  function pinch(src, frame, ref) {
    const t = jointPos(src, 'thumb-tip', frame, ref);
    const i = jointPos(src, 'index-finger-tip', frame, ref);
    if (!t || !i) return { ok: false, pt: null };
    return { ok: t.distanceTo(i) < 0.025, pt: t.clone().lerp(i, 0.5) };
  }

  /**
   * Proper palm-open detection ported from xavier-work.
   * Uses proximal joints (reliable on Quest 3), finger spread, and palm facing.
   */
  function detectPalmOpen(src, frame, ref, handedness) {
    const wrist     = jointPos(src, 'wrist', frame, ref);
    const indexTip  = jointPos(src, 'index-finger-tip', frame, ref);
    const middleTip = jointPos(src, 'middle-finger-tip', frame, ref);
    const ringTip   = jointPos(src, 'ring-finger-tip', frame, ref);
    const pinkyTip  = jointPos(src, 'pinky-finger-tip', frame, ref);
    const indexProx  = jointPos(src, 'index-finger-phalanx-proximal', frame, ref);
    const middleProx = jointPos(src, 'middle-finger-phalanx-proximal', frame, ref);
    const ringProx   = jointPos(src, 'ring-finger-phalanx-proximal', frame, ref);
    const pinkyProx  = jointPos(src, 'pinky-finger-phalanx-proximal', frame, ref);

    if (!wrist || !indexTip || !middleTip || !ringTip || !pinkyTip
        || !indexProx || !middleProx || !ringProx || !pinkyProx) {
      return { open: false, palmCenter: null };
    }

    // 1) Fingers extended: tip farther from wrist than proximal
    const extendedCount = [
      indexTip.distanceTo(wrist) > indexProx.distanceTo(wrist) * 1.05,
      middleTip.distanceTo(wrist) > middleProx.distanceTo(wrist) * 1.05,
      ringTip.distanceTo(wrist) > ringProx.distanceTo(wrist) * 1.05,
      pinkyTip.distanceTo(wrist) > pinkyProx.distanceTo(wrist) * 1.05,
    ].filter(Boolean).length;

    // 2) Fingers spread
    const spread =
      indexTip.distanceTo(middleTip) > 0.012 &&
      middleTip.distanceTo(ringTip) > 0.010 &&
      ringTip.distanceTo(pinkyTip) > 0.008;

    // 3) Palm facing up or toward camera
    const palmCenter = wrist.clone().lerp(middleTip, 0.4);
    _v3A.copy(pinkyProx).sub(indexProx);
    _v3B.copy(middleTip).sub(wrist);
    let palmNormal;
    if (handedness === 'right') {
      palmNormal = _v3C.crossVectors(_v3B, _v3A).normalize();
    } else {
      palmNormal = _v3C.crossVectors(_v3A, _v3B).normalize();
    }
    const facingUp = palmNormal.y > 0.25;
    const xrCam = renderer.xr.getCamera();
    const camPos = new THREE.Vector3();
    xrCam.getWorldPosition(camPos);
    const toCam = camPos.clone().sub(palmCenter).normalize();
    const facingCam = palmNormal.dot(toCam) > 0.1;

    const isOpen = extendedCount >= 3 && spread && (facingUp || facingCam);
    return { open: isOpen, palmCenter };
  }

  /**
   * Detect closed fist (grab) — all fingers curled + thumb tucked.
   */
  function detectGrab(src, frame, ref) {
    const wrist     = jointPos(src, 'wrist', frame, ref);
    const thumbTip  = jointPos(src, 'thumb-tip', frame, ref);
    const indexTip  = jointPos(src, 'index-finger-tip', frame, ref);
    const middleTip = jointPos(src, 'middle-finger-tip', frame, ref);
    const ringTip   = jointPos(src, 'ring-finger-tip', frame, ref);
    const pinkyTip  = jointPos(src, 'pinky-finger-tip', frame, ref);
    const indexProx  = jointPos(src, 'index-finger-phalanx-proximal', frame, ref);
    const middleProx = jointPos(src, 'middle-finger-phalanx-proximal', frame, ref);
    const ringProx   = jointPos(src, 'ring-finger-phalanx-proximal', frame, ref);
    const pinkyProx  = jointPos(src, 'pinky-finger-phalanx-proximal', frame, ref);

    if (!wrist || !thumbTip || !indexTip || !middleTip || !ringTip || !pinkyTip
        || !indexProx || !middleProx || !ringProx || !pinkyProx) {
      return false;
    }

    const allCurled =
      indexTip.distanceTo(wrist) < indexProx.distanceTo(wrist) * 0.95 &&
      middleTip.distanceTo(wrist) < middleProx.distanceTo(wrist) * 0.95 &&
      ringTip.distanceTo(wrist) < ringProx.distanceTo(wrist) * 0.95 &&
      pinkyTip.distanceTo(wrist) < pinkyProx.distanceTo(wrist) * 0.95;

    const thumbTucked = thumbTip.distanceTo(indexProx) < 0.06;
    return allCurled && thumbTucked;
  }

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
          const p = pinch(src, frame, ref);

          if (p.ok && !s.pinching) {
            s.pinching = true;
            if (p.pt) {
              // Check custom buttons first
              if (micBtnMesh) {
                const mw = new THREE.Vector3(); micBtnMesh.getWorldPosition(mw);
                if (p.pt.distanceTo(mw) < 0.06) { toggleMicFromBtn(); continue; }
              }
              if (kbBtnMesh) {
                const bw = new THREE.Vector3(); kbBtnMesh.getWorldPosition(bw);
                if (p.pt.distanceTo(bw) < 0.06) { toggleKb3D(); continue; }
              }
              if (isKbVisible()) {
                const kbKeyMeshes = getKbKeyMeshes();
                let hitKey = false;
                for (const k of kbKeyMeshes) {
                  const kw = new THREE.Vector3(); k.mesh.getWorldPosition(kw);
                  if (p.pt.distanceTo(kw) < 0.035) {
                    handleKbKeyPress(k.char); hitKey = true; break;
                  }
                }
                if (hitKey) continue;
              }
              // Fall through to WindowManager
              wm.onPinchStart(handIdx, p.pt);
            }
          } else if (p.ok && s.pinching && p.pt) {
            wm.onPinchMove(handIdx, p.pt);
          } else if (!p.ok && s.pinching) {
            s.pinching = false;
            wm.onPinchEnd(handIdx);
          }

          // ── Palm open/close → mascot character + voice control ──
          const now = performance.now();
          const handedness = src.handedness || (handIdx === 0 ? 'left' : 'right');
          const palmResult = detectPalmOpen(src, frame, ref, handedness);
          s.palmOpen = palmResult.open;
          const anim = handAnimState[handIdx];

          // Palm just opened → spawn mascot + start recording
          if (s.palmOpen && !anim.wasOpen && (now - s.lastGestureTime > GESTURE_COOLDOWN)) {
            s.lastGestureTime = now;
            // Spawn mascot above palm
            if (anim.active) { anim.active.kill(); anim.active = null; }
            const spawnPos = palmResult.palmCenter
              ? palmResult.palmCenter.clone()
              : new THREE.Vector3(0, 1.4, -0.5);
            spawnPos.y += 0.08;
            anim.active = animMgr.play('mascot-bounce', spawnPos, { mode: 'recording' });
            log(`[HAND] ${handedness} palm OPENED — mascot spawned, starting recording`);
            // Start recording
            if (!getIsRecording()) {
              startRecording();
            }
          }

          // While palm open, follow hand + update mode
          if (s.palmOpen && anim.active && palmResult.palmCenter) {
            const followPos = palmResult.palmCenter.clone();
            followPos.y += 0.08;
            anim.active.moveTo(followPos);
            // Update mascot color based on state
            if (getIsRecording()) {
              anim.active.setMode('recording');
            } else if (isTtsSpeaking()) {
              anim.active.setMode('listening');
            } else {
              anim.active.setMode('idle');
            }
          }

          // Palm closed (any reason) → hide mascot + stop recording or TTS
          if (!s.palmOpen && anim.wasOpen && (now - s.lastGestureTime > GESTURE_COOLDOWN)) {
            s.lastGestureTime = now;
            // Hide mascot
            if (anim.active) {
              anim.active.fastHide(0.08);
              anim.active = null;
            }
            if (getIsRecording()) {
              log(`[HAND] ${handedness} palm CLOSED — stopping recording`);
              stopRecording();
            } else if (isTtsSpeaking()) {
              log(`[HAND] ${handedness} palm CLOSED — stopping TTS`);
              stopTTS();
            }
          }

          anim.wasOpen = s.palmOpen;

          // Hand hover
          const indexTip = jointPos(src, 'index-finger-tip', frame, ref);
          wm.updateHandHover(handIdx, indexTip);
        }
      }
    }

    // WindowManager update (hover, drag, resize animations)
    wm.update(frame, dt, elapsed, [ctrl0, ctrl1]);

    // Update mascot animations (billboarding, redraw canvas)
    const xrCamera = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
    animMgr.update(dt, elapsed, xrCamera);

    renderer.render(scene, camera);
  });

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
  });

  window.addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  log('[INIT] Scene ready (WindowManager)');
}
