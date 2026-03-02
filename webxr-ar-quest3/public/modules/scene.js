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

let scene, camera, clock;
let wm, termWin, kbBtnMesh, micBtnMesh;

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
    { pinching: false, handOpen: false, handClosed: false, lastGestureTime: 0 },
    { pinching: false, handOpen: false, handClosed: false, lastGestureTime: 0 },
  ];

  // Gesture cooldown to prevent rapid toggling (ms)
  const GESTURE_COOLDOWN = 800;

  function jointPos(src, name, frame, ref) {
    const j = src.hand.get(name);
    if (!j) return null;
    const pose = frame.getJointPose(j, ref);
    if (!pose) return null;
    const p = pose.transform.position;
    return new THREE.Vector3(p.x, p.y, p.z);
  }

  function pinch(src, frame, ref) {
    const t = jointPos(src, 'thumb-tip', frame, ref);
    const i = jointPos(src, 'index-finger-tip', frame, ref);
    if (!t || !i) return { ok: false, pt: null };
    return { ok: t.distanceTo(i) < 0.025, pt: t.clone().lerp(i, 0.5) };
  }

  /**
   * Detect hand open/close gesture.
   * Open hand  = all 4 finger tips are far from the wrist (fingers extended)
   * Closed hand = all 4 finger tips are close to the wrist (fist)
   */
  function detectHandOpenClose(src, frame, ref) {
    const wrist = jointPos(src, 'wrist', frame, ref);
    if (!wrist) return 'unknown';

    const fingerTips = [
      'index-finger-tip',
      'middle-finger-tip',
      'ring-finger-tip',
      'pinky-finger-tip',
    ];
    const fingerMCPs = [
      'index-finger-metacarpal',
      'middle-finger-metacarpal',
      'ring-finger-metacarpal',
      'pinky-finger-metacarpal',
    ];

    let extendedCount = 0;
    let curledCount = 0;

    for (let i = 0; i < fingerTips.length; i++) {
      const tip = jointPos(src, fingerTips[i], frame, ref);
      const mcp = jointPos(src, fingerMCPs[i], frame, ref);
      if (!tip || !mcp) continue;

      const tipDist = tip.distanceTo(wrist);
      const mcpDist = mcp.distanceTo(wrist);

      // If finger tip is farther than MCP from wrist, finger is extended
      if (tipDist > mcpDist * 1.3) {
        extendedCount++;
      }
      // If finger tip is closer to wrist than MCP, finger is curled
      else if (tipDist < mcpDist * 0.9) {
        curledCount++;
      }
    }

    if (extendedCount >= 3) return 'open';
    if (curledCount >= 3) return 'closed';
    return 'partial';
  }

  // ── Render loop ──
  renderer.setAnimationLoop((ts, frame) => {
    const dt = clock.getDelta();
    const elapsed = clock.getElapsedTime();
    const termWs = getTermWs();

    // Terminal texture → draw onto window's content canvas
    if (termWs && termWs.readyState === WebSocket.OPEN) {
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

          // ── Hand open/close gesture for voice control ──
          const now = performance.now();
          const gesture = detectHandOpenClose(src, frame, ref);

          if (gesture === 'open' && !s.handOpen && (now - s.lastGestureTime > GESTURE_COOLDOWN)) {
            s.handOpen = true;
            s.handClosed = false;
            s.lastGestureTime = now;

            // Open hand → start recording if not already recording
            if (!getIsRecording()) {
              log(`[HAND] ${src.handedness} hand OPENED — starting recording`);
              startRecording();
            }
          } else if (gesture === 'closed' && !s.handClosed && (now - s.lastGestureTime > GESTURE_COOLDOWN)) {
            s.handClosed = true;
            s.handOpen = false;
            s.lastGestureTime = now;

            if (getIsRecording()) {
              // Close hand while recording → stop recording (sends to transcribe + chat)
              log(`[HAND] ${src.handedness} hand CLOSED — stopping recording`);
              stopRecording();
            } else if (isTtsSpeaking()) {
              // Close hand while TTS is speaking → stop TTS
              log(`[HAND] ${src.handedness} hand CLOSED — stopping TTS`);
              stopTTS();
            }
          } else if (gesture === 'partial') {
            // Reset so next open/close is detected
            s.handOpen = false;
            s.handClosed = false;
          }

          // Hand hover
          const indexTip = jointPos(src, 'index-finger-tip', frame, ref);
          wm.updateHandHover(handIdx, indexTip);
        }
      }
    }

    // WindowManager update (hover, drag, resize animations)
    wm.update(frame, dt, elapsed, [ctrl0, ctrl1]);

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
