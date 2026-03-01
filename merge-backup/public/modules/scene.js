// ─── Scene — Three.js setup, controllers, hand tracking, render loop ───
import {
  getRenderer, setRenderer, getTermWs, WIN_W, WIN_H,
  getProjectState, setProjectState, getActiveSplash,
  setScene as _setScene, setCamera as _setCamera,
  setBubbleMgr as _setBubbleMgr,
} from './core/state.js';
import { log } from './core/logging.js';
import { renderTermToCanvas, termRenderCanvas } from './terminal.js';
import { WindowManager } from './windowing/WindowManager.js';
import { build3DKeyboard, toggleKb3D, handleKbKeyPress, getKbKeyMeshes, isKbVisible } from './input/keyboard3d.js';
import { toggleMicFromBtn, setMicBtnMesh, startRecording, stopRecording, getIsRecording } from './input/voice.js';
import { makeTextTexture } from './core/textures.js';
import { addTermOutputListener } from './terminal.js';
import { stopTTS, isTtsSpeaking } from './tts.js';
import { AnimationManager } from './visualizations/AnimationManager.js';
import { getJointPos, detectPalmOpen as htDetectPalmOpen, detectPinch as htDetectPinch, detectFist, detectGrab } from './input/hand-tracking.js';
import { CodeCityRenderer } from './visualizations/CodeCity.js';
import { FileBubbleManager } from './visualizations/bubbles.js';
import { GitTreeRenderer } from './visualizations/git-tree.js';
import { LivePreviewManager } from './visualizations/live-preview.js';
import { initHands } from './input/HandRenderer.js';
import { initSceneControl } from './scene-control.js';
import { StreamScreenWindow } from './windowing/StreamScreenWindow.js';
import { FileViewerWindow } from './windowing/FileViewerWindow.js';

let scene, camera, clock;
let wm, termWin, kbBtnMesh, micBtnMesh, expBtnMesh;
let animMgr;  // mascot animation manager
let codeCity;  // 3D code visualization
let bubbleMgr; // file bubble browser
let gitTree;   // 3D git history tree
let livePreview; // dev server preview manager
let handRenderer; // XRHandModelFactory hand models
let streamScreen; // live Mac screen stream
let fileViewer;   // code/image file viewer

export function getScene() { return scene; }
export function getCamera() { return camera; }

export function toggleExplorer() {
  const state = getProjectState();
  if (!state.explorerOpen) {
    // Opening explorer: fade windows, show bubbles
    setProjectState('explorerOpen', true);
    wm.fadeAllWindows(0.3, 0.92);
    bubbleMgr.show();
  } else {
    // Closing explorer: hide bubbles, restore windows
    setProjectState('explorerOpen', false);
    bubbleMgr.hide();
    wm.unfadeAllWindows();
  }
}

export function initScene() {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.01, 100);
  camera.position.set(0, 1.6, 0);
  clock = new THREE.Clock();

  // Store in shared state so other modules can access without circular imports
  _setScene(scene);
  _setCamera(camera);

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
  _setBubbleMgr(bubbleMgr);  // expose to voice.js for palm context

  // ── Git Tree (3D commit history) ──
  gitTree = new GitTreeRenderer(scene, camera, wm);
  gitTree.loadHistory();  // auto-load on init

  // ── Live Preview (dev server detection) ──
  livePreview = new LivePreviewManager(scene, wm);

  // ── Hand Renderer (Three.js XRHandModelFactory — spheres) ──
  handRenderer = initHands(scene, renderer);

  // ── Stream Screen Window (Mac screen capture) ──
  streamScreen = new StreamScreenWindow(wm);

  // ── File Viewer (code editor / image preview) ──
  fileViewer = new FileViewerWindow(wm);

  // ── Scene Control (MCP WebSocket bridge) ──
  initSceneControl({ gitTree, bubbleMgr, codeCity, wm, streamScreen, livePreview, fileViewer, toggleExplorer });

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

  const expBtnGeo = new THREE.PlaneGeometry(0.06, 0.025);
  const expBtnMat = new THREE.MeshBasicMaterial({
    map: makeTextTexture('EXP', 22, '#61dafb', '#C0C0C0', 96, 40),
    transparent: true, depthWrite: true,
  });
  expBtnMesh = new THREE.Mesh(expBtnGeo, expBtnMat);
  expBtnMesh.position.set(WIN_W / 2 - 0.185, titleY, 0.004);
  termWin.root.add(expBtnMesh);

  // ── 3D keyboard attached to terminal window ──
  build3DKeyboard(termWin.root);

  // ── Controllers ──
  const ctrl0 = renderer.xr.getController(0);
  const ctrl1 = renderer.xr.getController(1);
  scene.add(ctrl0); scene.add(ctrl1);

  // Orange ray line + white gradient glow along beam length
  // Gradient: transparent at start (hand) → white at middle → transparent at end (tip)
  const RAY_MAX_LEN = 3;
  const _rayParts = []; // [{line, glow, controller}]
  function addRayWithGlow(c) {
    // Simple orange ray line (unit length along -Z, will be scaled)
    const lineGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)
    ]);
    const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0xFF7000 }));
    line.renderOrder = 1000;
    line.frustumCulled = false;
    c.add(line);

    // White glow quad — gradient ALONG the beam (z-axis), unit length
    const hw = 0.008;
    const positions = new Float32Array([
      -hw, 0, 0,    hw, 0, 0,
      -hw, 0, -0.5, hw, 0, -0.5,
      -hw, 0, -1,   hw, 0, -1,
    ]);
    const alphas = new Float32Array([0, 0, 1, 1, 0, 0]);
    const indices = [0,2,1, 1,2,3, 2,4,3, 3,4,5];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('aAlpha', new THREE.Float32BufferAttribute(alphas, 1));
    geo.setIndex(indices);

    const mat = new THREE.ShaderMaterial({
      vertexShader: `
        attribute float aAlpha;
        varying float vAlpha;
        void main() {
          vAlpha = aAlpha;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying float vAlpha;
        void main() {
          gl_FragColor = vec4(1.0, 1.0, 1.0, vAlpha * 0.5);
        }
      `,
      transparent: true, depthWrite: false, depthTest: false,
      side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    });
    const glow = new THREE.Mesh(geo, mat);
    glow.renderOrder = 999;
    glow.frustumCulled = false;
    c.add(glow);

    _rayParts.push({ line, glow, controller: c });
  }
  addRayWithGlow(ctrl0); addRayWithGlow(ctrl1);

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
    // EXP button
    if (expBtnMesh) {
      const expHits = raycaster.intersectObject(expBtnMesh);
      if (expHits.length) { toggleExplorer(); return; }
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
    // Bubbles via controller ray (same ray as window cursor)
    if (bubbleMgr.isVisible()) {
      const spheres = bubbleMgr.fileBubbles
        .filter(b => !b.userData.inPalm && b.userData.sphere)
        .map(b => b.userData.sphere);
      if (spheres.length) {
        const hits = raycaster.intersectObjects(spheres, false);
        if (hits.length) {
          const bubble = bubbleMgr.fileBubbles.find(b => b.userData.sphere === hits[0].object);
          if (bubble) { bubbleMgr.openBubble(bubble); return; }
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

  // Right palm openness for smooth mascot scale/fade (0=closed, 1=fully open)
  let _rightPalmOpenness = 0;

  // Left fist double-close → navigate back
  let _leftFistWas = false;
  let _leftFistCount = 0;
  let _leftFistLastTime = 0;
  const LEFT_FIST_WINDOW = 900; // ms between two fists

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
  // Gradient quad beam: white center, transparent edges
  const _laserGeo = (() => {
    const hw = 0.004;
    const positions = new Float32Array([
      -hw*3, 0, 0,   0, 0, 0,   0, 0, 0,   hw*3, 0, 0,
      -hw*3, 0, -1,   0, 0, -1,  0, 0, -1,  hw*3, 0, -1,
    ]);
    const alphas = new Float32Array([0,1,1,0, 0,1,1,0]);
    const indices = [0,4,1, 1,4,5, 1,5,2, 2,5,6, 2,6,3, 3,6,7];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('aAlpha', new THREE.Float32BufferAttribute(alphas, 1));
    g.setIndex(indices);
    return g;
  })();
  const _laserMat = new THREE.ShaderMaterial({
    vertexShader: `
      attribute float aAlpha;
      varying float vAlpha;
      void main() {
        vAlpha = aAlpha;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uBrightness;
      varying float vAlpha;
      void main() {
        gl_FragColor = vec4(1.0, 1.0, 1.0, vAlpha * uBrightness);
      }
    `,
    uniforms: { uBrightness: { value: 0.7 } },
    transparent: true,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  const _laserLine = new THREE.Mesh(_laserGeo, _laserMat);
  _laserLine.visible = false;
  _laserLine.renderOrder = 1001;  // Above controller rays
  _laserLine.frustumCulled = false;
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
              if (expBtnMesh) {
                const ew = new THREE.Vector3(); expBtnMesh.getWorldPosition(ew);
                if (p.pinchPoint.distanceTo(ew) < 0.06) { toggleExplorer(); continue; }
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
              // Left hand: add to palm context only (no removal — removal is right hand)
              if (src.handedness === 'left') {
                if (bubbleMgr.isVisible() && bubbleMgr.handleLeftPinchAdd(p.pinchPoint)) continue;
              } else {
                // Right hand pinch near palm bubble → remove from context
                if (bubbleMgr.handleRightPinchRemove(p.pinchPoint)) continue;
                if (!bubbleMgr.isVisible()) { wm.onPinchStart(handIdx, p.pinchPoint); continue; }
                // Right hand laser target → click to open immediately (folder nav or file view)
                if (_laserTargetBubble) {
                  bubbleMgr.openBubble(_laserTargetBubble);
                  _laserTargetBubble = null;
                  _backSwipeActive = false;
                  continue;
                }
                // Right hand proximity grab-drag (no laser, hand is close to a bubble)
                let grabbed = bubbleMgr.findClosestFreeBubble(p.pinchPoint);
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
            // Detect flat open right palm: all fingers extended + wide spread (>4cm index→pinky)
            const rightPalm = htDetectPalmOpen(src, frame, ref, 'right', renderer);
            let rawPalmOpen = rightPalm.open;
            if (rawPalmOpen) {
              const _idxTip = getJointPos(src, 'index-finger-tip', frame, ref);
              const _pkyTip = getJointPos(src, 'pinky-finger-tip', frame, ref);
              if (_idxTip && _pkyTip) rawPalmOpen = _idxTip.distanceTo(_pkyTip) > 0.04;
            }
            const anim = handAnimState[handIdx];

            // Debounce: require sustained flat open palm before triggering
            if (rawPalmOpen) {
              anim.pointFrames = Math.min(anim.pointFrames + 1, POINT_THRESHOLD + 1);
            } else {
              anim.pointFrames = 0;
            }
            const isOpen = anim.pointFrames >= POINT_THRESHOLD;

            // Palm held flat long enough → spawn mascot + start recording
            if (isOpen && !anim.wasOpen) {
              anim.wasOpen = true;
              if (anim.active) { anim.active.kill(); anim.active = null; }
              const spawnPos = rightPalm.palmCenter ? rightPalm.palmCenter.clone() : new THREE.Vector3(0, 1.4, -0.5);
              spawnPos.y += 0.08;
              anim.active = animMgr.play('mascot-bounce', spawnPos, { mode: 'idle' });
              log('[HAND] right palm open flat — recording started');
              if (!getIsRecording()) startRecording();
            }

            // While palm open, mascot follows palm center
            if (isOpen && anim.active && rightPalm.palmCenter) {
              const fp = rightPalm.palmCenter.clone(); fp.y += 0.08; anim.active.moveTo(fp);
            }

            // Palm closed → hide mascot + stop recording/TTS
            if (!isOpen && anim.wasOpen) {
              anim.wasOpen = false;
              if (anim.active) { anim.active.fastHide(0.08); anim.active = null; }
              if (getIsRecording()) { log('[HAND] right palm closed — recording stopped'); stopRecording(); }
              stopTTS();
            }

            // Continuous openness tracking → smooth scale + fade as hand closes (0→0.3 range)
            _rightPalmOpenness += ((rawPalmOpen ? 1 : 0) - _rightPalmOpenness) * Math.min(1, dt * 8);
            if (anim.active) {
              anim.active.setVisScale(_rightPalmOpenness < 0.3 ? _rightPalmOpenness / 0.3 : 1.0);
            }
          }

          // ── Grab (closed fist) → drag windows + CodeCity + right hand rotates bubbles ──
          const grabResult = detectGrab(src, frame, ref);
          if (grabResult.grabbing && !prevGrabState[handIdx]) {
            prevGrabState[handIdx] = true;
            if (grabResult.grabCenter) {
              // Try window grab first, fall through to CodeCity
              const grabbedWindow = wm.onGrabStart(handIdx, grabResult.grabCenter);
              if (!grabbedWindow) {
                codeCity.onGrabStart(handIdx, grabResult.grabCenter);
              }
            }
            if (src.handedness === 'right') { _fistRotating = true; _fistLastX = grabResult.grabCenter?.x ?? 0; }
            // Right fist double-close → navigate back
            if (src.handedness === 'right') {
              const now2 = performance.now();
              if (!_leftFistWas) {
                if (now2 - _leftFistLastTime < LEFT_FIST_WINDOW) {
                  _leftFistCount++;
                } else {
                  _leftFistCount = 1;
                }
                _leftFistLastTime = now2;
                _leftFistWas = true;
                if (_leftFistCount >= 2) {
                  _leftFistCount = 0;
                  bubbleMgr.navigateBack();
                }
              }
            }
          } else if (grabResult.grabbing && prevGrabState[handIdx]) {
            if (grabResult.grabCenter) {
              wm.onGrabMove(handIdx, grabResult.grabCenter);
              codeCity.onGrabMove(handIdx, grabResult.grabCenter);
            }
            if (src.handedness === 'right' && _fistRotating && grabResult.grabCenter) {
              const dx = grabResult.grabCenter.x - _fistLastX;
              _fistLastX = grabResult.grabCenter.x;
              // Accelerate smoothly toward target velocity (clamp to max)
              const target = Math.max(-ROT_MAX, Math.min(ROT_MAX, dx));
              _rotVelocity += (target - _rotVelocity) * ROT_ACCEL;
            }
          } else if (!grabResult.grabbing && prevGrabState[handIdx]) {
            prevGrabState[handIdx] = false;
            wm.onGrabEnd(handIdx);
            codeCity.onGrabEnd(handIdx);
            if (src.handedness === 'right') _fistRotating = false;
            if (src.handedness === 'right') _leftFistWas = false;
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
            if (showLaser && bubbleMgr.isVisible()) {
              const indexProx = getJointPos(src, 'index-finger-phalanx-proximal', frame, ref);
              const laserDir = indexProx
                ? indexTip.clone().sub(indexProx).normalize()
                : new THREE.Vector3(0, 0, -1);
              const hit = bubbleMgr.findBubbleByRay(indexTip, laserDir);
              _laserTargetBubble = (hit && !hit.userData.inPalm) ? hit : null;
              const endPt = hit ? hit.position.clone() : indexTip.clone().addScaledVector(laserDir, 2.5);
              // Position the laser beam quad: place at indexTip, orient toward endPt
              _laserLine.position.copy(indexTip);
              _laserLine.lookAt(endPt);
              const beamLen = indexTip.distanceTo(endPt);
              _laserLine.scale.set(1, 1, beamLen);
              _laserMat.uniforms.uBrightness.value = hit ? 0.95 : 0.55;
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
    if (Math.abs(_rotVelocity) > ROT_STOP && bubbleMgr.isVisible()) {
      bubbleMgr.rotateBubbles(_rotVelocity);
    } else {
      _rotVelocity = 0;  // snap to rest
    }

    // WindowManager update (hover, drag, resize animations, billboarding)
    const xrCamera = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
    wm.update(frame, dt, elapsed, [ctrl0, ctrl1], xrCamera);
    animMgr.update(dt, elapsed, xrCamera);

    // ── Clip rays + glow at window hits ──
    {
      const _rc = new THREE.Raycaster();
      const _tm = new THREE.Matrix4();
      const winMeshes = wm.windows.filter(w => !w.closed).flatMap(w => {
        const m = [];
        w.root.traverse(c => { if (c.isMesh) m.push(c); });
        return m;
      });
      for (const rp of _rayParts) {
        _tm.identity().extractRotation(rp.controller.matrixWorld);
        _rc.ray.origin.setFromMatrixPosition(rp.controller.matrixWorld);
        _rc.ray.direction.set(0, 0, -1).applyMatrix4(_tm);
        _rc.far = RAY_MAX_LEN;
        const hits = winMeshes.length ? _rc.intersectObjects(winMeshes, false) : [];
        const dist = hits.length ? hits[0].distance : RAY_MAX_LEN;
        rp.line.scale.z = dist;
        rp.glow.scale.z = dist;
      }
    }

    // Update CodeCity (matrix rain, finger-touch tooltips)
    codeCity.updateMatrix(dt);
    if (renderer.xr.isPresenting && codeCity._fingerTips) {
      codeCity.updateHover(codeCity._fingerTips);
    }

    // Hand models updated automatically by Three.js XRHandModelFactory (updateMatrixWorld)

    // Update file bubbles (bobbing animation)
    bubbleMgr.update(dt, elapsed);

    // Update git tree (glow pulse, HEAD particles)
    gitTree.update(dt, elapsed);

    // Update live preview (pulse animation)
    livePreview.update(dt, elapsed);

    // ── Startup splash ──
    const _splash = getActiveSplash();
    if (_splash && !_splash.done) {
      _splash.tick(xrCamera, ts ?? performance.now());
    }

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
    if (expBtnMesh) {
      const hits = mouseRaycaster.intersectObject(expBtnMesh);
      if (hits.length) { toggleExplorer(); return; }
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
    // File bubbles (only when explorer is visible)
    if (bubbleMgr.isVisible() && bubbleMgr.handleRaycast(mouseRaycaster)) return;
  });

  window.addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  log('[INIT] Scene ready (WindowManager)');
}
