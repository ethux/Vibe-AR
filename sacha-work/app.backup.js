// ─────────────────────────────────────────────
//  WebXR AR Draggable Window – Meta Quest
// ─────────────────────────────────────────────

// ── Scene, Camera, Renderer ──────────────────
const scene    = new THREE.Scene();
const camera   = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.01, 100);
camera.position.set(0, 1.6, 0); // standing height

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(devicePixelRatio);
renderer.setClearColor(0x000000, 0); // transparent background for AR
renderer.xr.enabled = true;
document.body.appendChild(renderer.domElement);

// ── Lighting ─────────────────────────────────
scene.add(new THREE.AmbientLight(0xffffff, 1.0));
const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
dirLight.position.set(2, 4, 3);
dirLight.castShadow = true;
scene.add(dirLight);

// ── Shadow-receiving floor (invisible, just catches shadows) ──
const shadowFloorGeo = new THREE.PlaneGeometry(20, 20);
const shadowFloorMat = new THREE.ShadowMaterial({ opacity: 0.3 });
const shadowFloor = new THREE.Mesh(shadowFloorGeo, shadowFloorMat);
shadowFloor.rotation.x = -Math.PI / 2;
shadowFloor.position.y = 0;
shadowFloor.receiveShadow = true;
scene.add(shadowFloor);
renderer.shadowMap.enabled = true;

// ── Build the draggable "window" panel ───────
const WINDOW_W = 0.6;
const WINDOW_H = 0.45;
const TITLEBAR_H = 0.06;
const CORNER_R = 0.015;

// -- Window body
const bodyGeo = new THREE.PlaneGeometry(WINDOW_W, WINDOW_H);
const bodyMat = new THREE.MeshStandardMaterial({
  color: 0x1e1e2e, side: THREE.DoubleSide, transparent: true, opacity: 0.92,
  roughness: 0.7, metalness: 0.1
});
const windowBody = new THREE.Mesh(bodyGeo, bodyMat);

// -- Title bar (child of body)
const titleGeo = new THREE.PlaneGeometry(WINDOW_W, TITLEBAR_H);
const titleMat = new THREE.MeshStandardMaterial({
  color: 0x3a3a5c, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.15
});
const titleBar = new THREE.Mesh(titleGeo, titleMat);
titleBar.position.y = WINDOW_H / 2 - TITLEBAR_H / 2;
titleBar.position.z = 0.001; // slightly in front
windowBody.add(titleBar);

// -- Title text (using canvas texture)
function makeTextTexture(text, fontSize, color, bgColor, w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (bgColor) { ctx.fillStyle = bgColor; ctx.fillRect(0, 0, w, h); }
  ctx.fillStyle = color;
  ctx.font = `bold ${fontSize}px Segoe UI, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  return tex;
}

const titleTextGeo = new THREE.PlaneGeometry(WINDOW_W * 0.8, TITLEBAR_H * 0.7);
const titleTextMat = new THREE.MeshBasicMaterial({
  map: makeTextTexture('My Window', 48, '#ffffff', 'transparent', 512, 64),
  transparent: true, depthWrite: false
});
const titleText = new THREE.Mesh(titleTextGeo, titleTextMat);
titleText.position.z = 0.002;
titleBar.add(titleText);

// -- Window content area (some placeholder text)
const contentGeo = new THREE.PlaneGeometry(WINDOW_W * 0.9, WINDOW_H * 0.7);
const contentMat = new THREE.MeshBasicMaterial({
  map: makeTextTexture(
    'Hello from WebXR! 🎉\n\nGrab the title bar\nwith your controller\nto drag this window.',
    32, '#ccccdd', 'transparent', 512, 384
  ),
  transparent: true, depthWrite: false
});
// multi-line canvas helper
(function patchContent() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 384;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#1e1e2e';
  ctx.fillRect(0, 0, 512, 384);
  ctx.fillStyle = '#ccccdd';
  ctx.font = '28px Segoe UI, sans-serif';
  const lines = [
    'Hello from WebXR AR! 🎉', '',
    '✋ Open your palm to',
    '   summon a magic bubble!', '',
    '🤏 Pinch the title bar',
    '   to drag this window!', '',
    '🎮 Controllers work too!'
  ];
  lines.forEach((l, i) => ctx.fillText(l, 30, 40 + i * 38));
  contentMat.map = new THREE.CanvasTexture(c);
  contentMat.map.minFilter = THREE.LinearFilter;
})();

const contentMesh = new THREE.Mesh(contentGeo, contentMat);
contentMesh.position.y = -TITLEBAR_H / 2 - 0.01;
contentMesh.position.z = 0.001;
windowBody.add(contentMesh);

// -- Border glow
const borderGeo = new THREE.PlaneGeometry(WINDOW_W + 0.008, WINDOW_H + 0.008);
const borderMat = new THREE.MeshBasicMaterial({
  color: 0x6366f1, transparent: true, opacity: 0.3, side: THREE.DoubleSide
});
const border = new THREE.Mesh(borderGeo, borderMat);
border.position.z = -0.002;
windowBody.add(border);

// -- Close button (red dot)
const closeBtnGeo = new THREE.CircleGeometry(0.015, 24);
const closeBtnMat = new THREE.MeshBasicMaterial({ color: 0xff5555 });
const closeBtn = new THREE.Mesh(closeBtnGeo, closeBtnMat);
closeBtn.position.set(WINDOW_W / 2 - 0.035, 0, 0.003);
titleBar.add(closeBtn);

// -- Minimize button (yellow dot)
const minBtnMat = new THREE.MeshBasicMaterial({ color: 0xf1fa8c });
const minBtn = new THREE.Mesh(closeBtnGeo.clone(), minBtnMat);
minBtn.position.set(WINDOW_W / 2 - 0.075, 0, 0.003);
titleBar.add(minBtn);

// -- Maximize button (green dot)
const maxBtnMat = new THREE.MeshBasicMaterial({ color: 0x50fa7b });
const maxBtn = new THREE.Mesh(closeBtnGeo.clone(), maxBtnMat);
maxBtn.position.set(WINDOW_W / 2 - 0.115, 0, 0.003);
titleBar.add(maxBtn);

// Place the window in front of the user
windowBody.position.set(0, 1.5, -0.8);
scene.add(windowBody);

// ── File Bubbles (colored orbs) ──────────────
const BUBBLE_COLORS = [
  0xFF7000, 0xFF8C00, 0x76B900, 0x8BC34A,
  0xFF9900, 0x4285F4, 0x0668E1, 0x61DAFB,
  0xBD93F9, 0xCE422B, 0xF1FA8C, 0xff79c6,
  0x50fa7b, 0x00A4EF, 0xE535AB,
];

const fileBubbles = [];
let grabbedBubble = null;
let grabController = null;
let grabOffset = new THREE.Vector3();

// Shared geometry — 1 sphere, 1 material per bubble = max perf
const sharedSphereGeo = new THREE.SphereGeometry(1, 16, 16);

BUBBLE_COLORS.forEach((color, i) => {
  const size = 0.04 + Math.random() * 0.03;
  const group = new THREE.Group();

  const mat = new THREE.MeshStandardMaterial({
    color: color,
    roughness: 0.15,
    metalness: 0.4,
    emissive: color,
    emissiveIntensity: 0.3,
    transparent: true,
    opacity: 0.9,
  });
  const sphere = new THREE.Mesh(sharedSphereGeo, mat);
  sphere.scale.setScalar(size);
  group.add(sphere);

  group.userData.sphere = sphere;
  group.userData.sphereMat = mat;

  const angle = (i / BUBBLE_COLORS.length) * Math.PI * 1.6 - Math.PI * 0.8;
  const radius = 0.7 + Math.random() * 0.3;
  const x = Math.sin(angle) * radius;
  const z = -Math.cos(angle) * radius;
  const y = 1.2 + Math.sin(i * 1.1) * 0.2;

  group.position.set(x, y, z);
  group.userData.basePos = new THREE.Vector3(x, y, z);
  group.userData.restPos = new THREE.Vector3(x, y, z);
  group.userData.index = i;
  group.userData.size = size;
  group.userData.bobSpeed = 0.5 + Math.random() * 0.8;
  group.userData.bobAmp = 0.008 + Math.random() * 0.012;
  group.userData.grabbed = false;
  group.userData.releaseVel = new THREE.Vector3();
  group.userData.scaleTarget = 1;
  group.userData.glowTarget = 0.25;

  scene.add(group);
  fileBubbles.push(group);
});

// ── Controller setup ─────────────────────────
const controllerGrip0 = renderer.xr.getControllerGrip(0);
const controllerGrip1 = renderer.xr.getControllerGrip(1);
scene.add(controllerGrip0);
scene.add(controllerGrip1);

const controller0 = renderer.xr.getController(0);
const controller1 = renderer.xr.getController(1);
scene.add(controller0);
scene.add(controller1);

// Visible ray lines
function addRayVisual(ctrl) {
  const geo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, -3)
  ]);
  const mat = new THREE.LineBasicMaterial({ color: 0x6366f1, linewidth: 2 });
  ctrl.add(new THREE.Line(geo, mat));
}
addRayVisual(controller0);
addRayVisual(controller1);

// Controller models (simple cubes as fallback)
function addControllerModel(grip) {
  const geo = new THREE.BoxGeometry(0.04, 0.04, 0.1);
  const mat = new THREE.MeshStandardMaterial({ color: 0x888899, roughness: 0.5 });
  grip.add(new THREE.Mesh(geo, mat));
}
addControllerModel(controllerGrip0);
addControllerModel(controllerGrip1);

// ── Drag logic ───────────────────────────────
const raycaster = new THREE.Raycaster();
const tempMatrix = new THREE.Matrix4();

let dragging = false;
let activeController = null;
let dragOffset = new THREE.Vector3();

// We track select events (trigger press) on each controller
function onSelectStart(event) {
  const ctrl = event.target;
  tempMatrix.identity().extractRotation(ctrl.matrixWorld);
  raycaster.ray.origin.setFromMatrixPosition(ctrl.matrixWorld);
  raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);

  // Check bubbles first
  const bubbleSpheres = fileBubbles.map(b => b.userData.sphere);
  const bubbleHits = raycaster.intersectObjects(bubbleSpheres, false);
  if (bubbleHits.length > 0) {
    const hitSphere = bubbleHits[0].object;
    const bubble = fileBubbles.find(b => b.userData.sphere === hitSphere);
    if (bubble && !grabbedBubble) {
      grabbedBubble = bubble;
      grabController = ctrl;
      bubble.userData.grabbed = true;
      bubble.userData.scaleTarget = 1.6;
      bubble.userData.glowTarget = 0.9;
      grabOffset.copy(bubble.position).sub(bubbleHits[0].point);
      return;
    }
  }

  // Then check title bar
  const titleBarWorld = titleBar;
  const hits = raycaster.intersectObject(titleBarWorld, true);
  if (hits.length > 0) {
    dragging = true;
    activeController = ctrl;
    const hitPoint = hits[0].point;
    dragOffset.copy(windowBody.position).sub(hitPoint);
    borderMat.opacity = 0.7;
    titleMat.color.set(0x5a5a8c);
  }
}

function onSelectEnd(event) {
  // Release bubble
  if (grabbedBubble && event.target === grabController) {
    grabbedBubble.userData.grabbed = false;
    grabbedBubble.userData.scaleTarget = 1;
    grabbedBubble.userData.glowTarget = 0.35;
    grabbedBubble.userData.restPos.copy(grabbedBubble.position);
    grabbedBubble = null;
    grabController = null;
  }

  if (dragging && event.target === activeController) {
    dragging = false;
    activeController = null;
    borderMat.opacity = 0.3;
    titleMat.color.set(0x3a3a5c);
  }
}

controller0.addEventListener('selectstart', onSelectStart);
controller0.addEventListener('selectend',   onSelectEnd);
controller1.addEventListener('selectstart', onSelectStart);
controller1.addEventListener('selectend',   onSelectEnd);

// ── Enter AR button ──────────────────────────
const vrButton = document.getElementById('enter-vr');
vrButton.textContent = 'Enter AR';

const XR_SESSION_MODE = 'immersive-ar';
const XR_FEATURES = {
  requiredFeatures: ['local-floor'],
  optionalFeatures: ['bounded-floor', 'hand-tracking', 'hit-test']
};

async function startSession() {
  const session = await navigator.xr.requestSession(XR_SESSION_MODE, XR_FEATURES);
  renderer.xr.setReferenceSpaceType('local-floor');
  renderer.xr.setSession(session);
  document.getElementById('overlay').style.display = 'none';

  session.addEventListener('end', () => {
    document.getElementById('overlay').style.display = 'flex';
  });
}

async function initXR() {
  // Check if page is served over HTTPS (required for WebXR)
  if (location.protocol !== 'https:' && location.hostname !== 'localhost'
      && location.hostname !== '127.0.0.1') {
    vrButton.textContent = 'HTTPS required for WebXR';
    vrButton.disabled = true;
    document.getElementById('info').textContent =
      '⚠️ WebXR requires HTTPS. Use the HTTPS server (node server.js) on port 8443.';
    return;
  }

  if (!navigator.xr) {
    vrButton.textContent = 'WebXR not supported';
    vrButton.disabled = true;
    document.getElementById('info').textContent =
      '⚠️ navigator.xr not found. Make sure you are using a WebXR-capable browser (Meta Quest Browser, Chrome).';
    return;
  }

  // Check AR support first, fall back to VR
  let arSupported = false;
  try {
    arSupported = await navigator.xr.isSessionSupported('immersive-ar');
  } catch (e) {
    console.warn('AR isSessionSupported error:', e);
  }

  if (!arSupported) {
    // Try anyway — some Quest browser versions don't report correctly
    vrButton.textContent = 'Enter AR';
    vrButton.addEventListener('click', async () => {
      try {
        await startSession();
      } catch (err) {
        vrButton.textContent = 'AR not available';
        vrButton.disabled = true;
        document.getElementById('info').textContent =
          '⚠️ Could not start AR session: ' + err.message;
        console.error('XR session request failed:', err);
      }
    });
    return;
  }

  vrButton.addEventListener('click', async () => {
    try {
      await startSession();
    } catch (err) {
      vrButton.textContent = 'AR session failed';
      document.getElementById('info').textContent = '⚠️ ' + err.message;
      console.error('XR session error:', err);
    }
  });
}
initXR();

// ── Hand Tracking ────────────────────────────
// WebXR Hand Joint names (indices into the hand.joints map)
const HAND_JOINTS = [
  'wrist',
  'thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip',
  'index-finger-metacarpal', 'index-finger-phalanx-proximal', 'index-finger-phalanx-intermediate', 'index-finger-phalanx-distal', 'index-finger-tip',
  'middle-finger-metacarpal', 'middle-finger-phalanx-proximal', 'middle-finger-phalanx-intermediate', 'middle-finger-phalanx-distal', 'middle-finger-tip',
  'ring-finger-metacarpal', 'ring-finger-phalanx-proximal', 'ring-finger-phalanx-intermediate', 'ring-finger-phalanx-distal', 'ring-finger-tip',
  'pinky-finger-metacarpal', 'pinky-finger-phalanx-proximal', 'pinky-finger-phalanx-intermediate', 'pinky-finger-phalanx-distal', 'pinky-finger-tip'
];

let hand0, hand1;
const handStates = [
  { jointMeshes: [], bubble: null, bubbleScale: 0, palmOpen: false, palmOpenSmooth: 0, pinching: false, dragging: false, dragOffset: new THREE.Vector3(), handedness: 'left' },
  { jointMeshes: [], bubble: null, bubbleScale: 0, palmOpen: false, palmOpenSmooth: 0, pinching: false, dragging: false, dragOffset: new THREE.Vector3(), handedness: 'right' }
];

// Bubbles collected in the left palm
const palmBubbles = [];
let leftPalmCenter = null;

// Joint visual material
const jointMat = new THREE.MeshStandardMaterial({
  color: 0x8888ff, roughness: 0.3, metalness: 0.2,
  transparent: true, opacity: 0.6
});
const jointGeo = new THREE.SphereGeometry(0.005, 8, 8);

// Debug indicator — a small sphere that turns green when hands are detected
const debugGeo = new THREE.SphereGeometry(0.015, 16, 16);
const debugMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
const debugSphere = new THREE.Mesh(debugGeo, debugMat);
debugSphere.position.set(0.25, 1.5, -0.8);
scene.add(debugSphere);

// Create bubble for each hand
function createBubble() {
  const group = new THREE.Group();

  // Main bubble sphere — use simpler material for Quest compatibility
  const bubbleGeo = new THREE.SphereGeometry(0.04, 24, 24);
  const bubbleMat = new THREE.MeshStandardMaterial({
    color: 0x88ccff,
    transparent: true,
    opacity: 0.5,
    roughness: 0.1,
    metalness: 0.3,
    emissive: 0x4466ff,
    emissiveIntensity: 0.4,
    side: THREE.DoubleSide,
  });
  const bubble = new THREE.Mesh(bubbleGeo, bubbleMat);
  group.add(bubble);

  // Inner glow core
  const coreGeo = new THREE.SphereGeometry(0.018, 12, 12);
  const coreMat = new THREE.MeshBasicMaterial({
    color: 0xaaddff,
    transparent: true,
    opacity: 0.7,
  });
  const core = new THREE.Mesh(coreGeo, coreMat);
  group.add(core);

  // Outer glow halo
  const haloGeo = new THREE.SphereGeometry(0.055, 12, 12);
  const haloMat = new THREE.MeshBasicMaterial({
    color: 0x6699ff,
    transparent: true,
    opacity: 0.15,
    side: THREE.BackSide,
  });
  const halo = new THREE.Mesh(haloGeo, haloMat);
  group.add(halo);

  // Little orbiting sparkle particles
  const sparkles = [];
  const sparkGeo = new THREE.SphereGeometry(0.004, 6, 6);
  for (let i = 0; i < 5; i++) {
    const sparkMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color().setHSL(0.55 + i * 0.06, 0.8, 0.7),
      transparent: true, opacity: 0.8
    });
    const spark = new THREE.Mesh(sparkGeo, sparkMat);
    group.add(spark);
    sparkles.push(spark);
  }
  group.userData.sparkles = sparkles;
  group.userData.coreMesh = core;
  group.userData.haloMesh = halo;
  group.userData.bubbleMesh = bubble;

  group.visible = false;
  group.scale.set(0, 0, 0);
  scene.add(group);
  return group;
}

// Set up hands
if (renderer.xr.getHand) {
  hand0 = renderer.xr.getHand(0);
  hand1 = renderer.xr.getHand(1);
  scene.add(hand0);
  scene.add(hand1);

  // Create joint visuals and bubbles for each hand
  [hand0, hand1].forEach((hand, idx) => {
    const state = handStates[idx];

    // Joint spheres
    for (let j = 0; j < HAND_JOINTS.length; j++) {
      const mesh = new THREE.Mesh(jointGeo, jointMat.clone());
      mesh.visible = false;
      scene.add(mesh);
      state.jointMeshes.push(mesh);
    }

    // Bubble
    state.bubble = createBubble();
  });
}

// ── Palm Pose Detection (Quest 3 compatible) ─
const _v3A = new THREE.Vector3();
const _v3B = new THREE.Vector3();
const _v3C = new THREE.Vector3();

// Get joint position from XRFrame directly — works on Quest 3
function getJointPos(inputSource, jointName, frame, refSpace) {
  if (!inputSource || !inputSource.hand) return null;
  const hand = inputSource.hand;
  const jointSpace = hand.get(jointName);
  if (!jointSpace) return null;
  try {
    const pose = frame.getJointPose(jointSpace, refSpace);
    if (!pose) return null;
    const p = pose.transform.position;
    return new THREE.Vector3(p.x, p.y, p.z);
  } catch (e) {
    return null;
  }
}

function detectPalmOpen(inputSource, frame, refSpace, handedness) {
  const wrist     = getJointPos(inputSource, 'wrist', frame, refSpace);
  const indexTip  = getJointPos(inputSource, 'index-finger-tip', frame, refSpace);
  const middleTip = getJointPos(inputSource, 'middle-finger-tip', frame, refSpace);
  const ringTip   = getJointPos(inputSource, 'ring-finger-tip', frame, refSpace);
  const pinkyTip  = getJointPos(inputSource, 'pinky-finger-tip', frame, refSpace);

  const indexProx  = getJointPos(inputSource, 'index-finger-phalanx-proximal', frame, refSpace);
  const middleProx = getJointPos(inputSource, 'middle-finger-phalanx-proximal', frame, refSpace);
  const ringProx   = getJointPos(inputSource, 'ring-finger-phalanx-proximal', frame, refSpace);
  const pinkyProx  = getJointPos(inputSource, 'pinky-finger-phalanx-proximal', frame, refSpace);

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

  // 3) Palm facing upward or toward camera — use palm normal
  const palmCenter = wrist.clone().lerp(middleTip, 0.4);
  _v3A.copy(pinkyProx).sub(indexProx);
  _v3B.copy(middleTip).sub(wrist);

  // Flip cross product for right hand so normal points outward from palm
  let palmNormal;
  if (handedness === 'right') {
    palmNormal = _v3C.crossVectors(_v3B, _v3A).normalize();
  } else {
    palmNormal = _v3C.crossVectors(_v3A, _v3B).normalize();
  }

  // Accept palm facing up (y > 0.3) OR facing toward headset
  const facingUp = palmNormal.y > 0.25;

  // Also check facing camera
  const xrCam = renderer.xr.getCamera();
  const camPos = new THREE.Vector3();
  xrCam.getWorldPosition(camPos);
  const toCam = camPos.clone().sub(palmCenter).normalize();
  const facingCam = palmNormal.dot(toCam) > 0.1;

  const isOpen = extendedCount >= 3 && spread && (facingUp || facingCam);

  return { open: isOpen, palmCenter };
}

function detectPinch(inputSource, frame, refSpace) {
  const thumbTip = getJointPos(inputSource, 'thumb-tip', frame, refSpace);
  const indexTip = getJointPos(inputSource, 'index-finger-tip', frame, refSpace);
  if (!thumbTip || !indexTip) return { pinching: false, pinchPoint: null };
  const dist = thumbTip.distanceTo(indexTip);
  const pinchPoint = thumbTip.clone().lerp(indexTip, 0.5);
  return { pinching: dist < 0.025, pinchPoint };
}

// ── Animation loop ───────────────────────────
const clock = new THREE.Clock();
let handDetectedOnce = false;

renderer.setAnimationLoop((timestamp, frame) => {
  const dt = clock.getDelta();
  const elapsed = clock.elapsedTime;

  // ── Controller-based drag ──
  if (dragging && activeController) {
    tempMatrix.identity().extractRotation(activeController.matrixWorld);
    raycaster.ray.origin.setFromMatrixPosition(activeController.matrixWorld);
    raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);

    const dist = windowBody.position.distanceTo(raycaster.ray.origin);
    const target = raycaster.ray.origin.clone()
      .add(raycaster.ray.direction.clone().multiplyScalar(dist));
    target.add(dragOffset);

    windowBody.position.lerp(target, 0.5);

    const camPos = new THREE.Vector3();
    camera.getWorldPosition(camPos);
    windowBody.lookAt(camPos);
  }

  // ── Hand tracking update ──
  if (frame && renderer.xr.isPresenting) {
    const session = renderer.xr.getSession();
    const refSpace = renderer.xr.getReferenceSpace();

    if (session && refSpace) {
      // Find hand input sources from the session
      const inputSources = session.inputSources;
      let handInputs = [null, null]; // [left, right] or [0, 1]

      for (const source of inputSources) {
        if (source.hand) {
          if (source.handedness === 'left')  handInputs[0] = source;
          if (source.handedness === 'right') handInputs[1] = source;
        }
      }

      handInputs.forEach((inputSource, idx) => {
        if (!inputSource || !inputSource.hand) return;
        const state = handStates[idx];
        state.handedness = inputSource.handedness;

        // Debug: hands detected
        if (!handDetectedOnce) {
          handDetectedOnce = true;
          debugMat.color.set(0x00ff00);
          console.log('✋ Hand tracking active!', inputSource.handedness);
        }

        // Update joint visuals
        HAND_JOINTS.forEach((jointName, j) => {
          const pos = getJointPos(inputSource, jointName, frame, refSpace);
          const mesh = state.jointMeshes[j];
          if (pos) {
            mesh.position.copy(pos);
            mesh.visible = true;
            const isTip = jointName.endsWith('-tip');
            mesh.scale.setScalar(isTip ? 1.4 : 1.0);
          } else {
            mesh.visible = false;
          }
        });

        // ── Open palm detection & bubble ──
        const palmResult = detectPalmOpen(inputSource, frame, refSpace, state.handedness);
        state.palmOpen = palmResult.open;

        // Debug color: yellow when palm open detected
        if (state.palmOpen && handDetectedOnce) {
          debugMat.color.set(0xffff00);
        }

        const targetSmooth = state.palmOpen ? 1 : 0;
        state.palmOpenSmooth += (targetSmooth - state.palmOpenSmooth) * 0.12;

        const bubble = state.bubble;
        if (palmResult.palmCenter) {
          const bubbleTarget = palmResult.palmCenter.clone();
          bubbleTarget.y += 0.06 + Math.sin(elapsed * 2.5) * 0.008;
          bubble.position.lerp(bubbleTarget, 0.3);
        }

        if (state.palmOpenSmooth > 0.05) {
          bubble.visible = true;
          const s = state.palmOpenSmooth;
          bubble.scale.set(s, s, s);

          const sparkles = bubble.userData.sparkles;
          sparkles.forEach((spark, i) => {
            const angle = elapsed * (1.5 + i * 0.3) + i * (Math.PI * 2 / sparkles.length);
            const radius = 0.035 + Math.sin(elapsed * 2 + i) * 0.008;
            spark.position.set(
              Math.cos(angle) * radius,
              Math.sin(elapsed * 3 + i * 1.2) * 0.015,
              Math.sin(angle) * radius
            );
            spark.material.opacity = 0.5 + Math.sin(elapsed * 4 + i) * 0.3;
          });

          const core = bubble.userData.coreMesh;
          core.material.opacity = 0.5 + Math.sin(elapsed * 3) * 0.2;
          const cs = 0.9 + Math.sin(elapsed * 2.5) * 0.1;
          core.scale.set(cs, cs, cs);

          const halo = bubble.userData.haloMesh;
          halo.material.opacity = 0.1 + state.palmOpenSmooth * 0.1;

          bubble.rotation.y += dt * 0.5;

          state.jointMeshes.forEach(m => {
            if (!m.material.emissive) m.material.emissive = new THREE.Color();
            m.material.emissive.setHex(0x4466ff);
            m.material.emissiveIntensity = state.palmOpenSmooth * 0.5;
          });
        } else {
          bubble.visible = false;
          bubble.scale.set(0, 0, 0);
          state.jointMeshes.forEach(m => {
            if (m.material.emissiveIntensity !== undefined) {
              m.material.emissiveIntensity = 0;
            }
          });
        }

        // ── Hand pinch interactions ──
        const pinchResult = detectPinch(inputSource, frame, refSpace);

        if (state.handedness === 'left') {
          // LEFT HAND: pinch a bubble → grab into palm (hidden), open palm → show orbiting
          if (pinchResult.pinching && !state.pinching) {
            state.pinching = true;
            if (pinchResult.pinchPoint) {
              const titleWorldPos = new THREE.Vector3();
              titleBar.getWorldPosition(titleWorldPos);
              if (pinchResult.pinchPoint.distanceTo(titleWorldPos) < 0.15) {
                state.dragging = true;
                state.dragOffset.copy(windowBody.position).sub(pinchResult.pinchPoint);
                borderMat.opacity = 0.7;
                titleMat.color.set(0x5a5a8c);
              } else {
                let closest = null;
                let closestDist = 0.12;
                fileBubbles.forEach(b => {
                  if (b.userData.inPalm) return;
                  const d = pinchResult.pinchPoint.distanceTo(b.position);
                  if (d < closestDist) { closestDist = d; closest = b; }
                });
                if (closest) {
                  closest.userData.inPalm = true;
                  closest.userData.grabbed = false;
                  closest.userData.scaleTarget = 0.6;
                  closest.userData.palmOrbitIndex = palmBubbles.length;
                  closest.visible = false;
                  palmBubbles.push(closest);
                }
              }
            }
          } else if (!pinchResult.pinching && state.pinching) {
            state.pinching = false;
            if (state.dragging) {
              state.dragging = false;
              borderMat.opacity = 0.3;
              titleMat.color.set(0x3a3a5c);
            }
          }

          if (state.dragging && pinchResult.pinchPoint) {
            const target = pinchResult.pinchPoint.clone().add(state.dragOffset);
            windowBody.position.lerp(target, 0.4);
            const camPos = new THREE.Vector3();
            camera.getWorldPosition(camPos);
            windowBody.lookAt(camPos);
          }

          // Track left palm
          const palmData = detectPalmOpen(inputSource, frame, refSpace, 'left');
          if (palmData.palmCenter) {
            leftPalmCenter = palmData.palmCenter.clone();
            leftPalmCenter.y += 0.05;
          }

          // Palm open → show palm bubbles orbiting, palm closed → hide them
          palmBubbles.forEach(b => {
            b.visible = palmData.open;
          });

        } else {
          // RIGHT HAND: pinch a palm bubble → release it back to its original position
          if (pinchResult.pinching && !state.pinching) {
            state.pinching = true;
            if (pinchResult.pinchPoint) {
              const titleWorldPos = new THREE.Vector3();
              titleBar.getWorldPosition(titleWorldPos);
              if (pinchResult.pinchPoint.distanceTo(titleWorldPos) < 0.15) {
                state.dragging = true;
                state.dragOffset.copy(windowBody.position).sub(pinchResult.pinchPoint);
                borderMat.opacity = 0.7;
                titleMat.color.set(0x5a5a8c);
              } else {
                let closest = null;
                let closestDist = 0.1;
                let closestIdx = -1;
                palmBubbles.forEach((b, pi) => {
                  if (!b.visible) return;
                  const d = pinchResult.pinchPoint.distanceTo(b.position);
                  if (d < closestDist) { closestDist = d; closest = b; closestIdx = pi; }
                });
                if (closest) {
                  closest.userData.inPalm = false;
                  closest.userData.scaleTarget = 1;
                  closest.userData.glowTarget = 0.3;
                  closest.userData.restPos.copy(closest.userData.basePos);
                  closest.visible = true;
                  palmBubbles.splice(closestIdx, 1);
                  palmBubbles.forEach((b, pi) => { b.userData.palmOrbitIndex = pi; });
                }
              }
            }
          } else if (!pinchResult.pinching && state.pinching) {
            state.pinching = false;
            if (state.dragging) {
              state.dragging = false;
              borderMat.opacity = 0.3;
              titleMat.color.set(0x3a3a5c);
            }
          }

          if (state.dragging && pinchResult.pinchPoint) {
            const target = pinchResult.pinchPoint.clone().add(state.dragOffset);
            windowBody.position.lerp(target, 0.4);
            const camPos = new THREE.Vector3();
            camera.getWorldPosition(camPos);
            windowBody.lookAt(camPos);
          }
        }
      });
    }
  }

  // Subtle idle animation
  if (!dragging && !handStates[0].dragging && !handStates[1].dragging) {
    windowBody.position.y += Math.sin(elapsed * 0.8) * 0.0002;
  }

  // ── Animate file bubbles ──
  // Move grabbed bubble with controller
  if (grabbedBubble && grabController) {
    tempMatrix.identity().extractRotation(grabController.matrixWorld);
    raycaster.ray.origin.setFromMatrixPosition(grabController.matrixWorld);
    raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);

    const dist = grabbedBubble.position.distanceTo(raycaster.ray.origin);
    const target = raycaster.ray.origin.clone()
      .add(raycaster.ray.direction.clone().multiplyScalar(Math.min(dist, 0.5)));
    target.add(grabOffset);
    grabbedBubble.position.lerp(target, 0.4);
  }

  fileBubbles.forEach((group) => {
    const d = group.userData;

    if (d.inPalm && leftPalmCenter) {
      // Orbit around left palm like electrons
      const total = Math.max(palmBubbles.length, 1);
      const orbitR = 0.06 + total * 0.015;
      const speed = 1.5 + d.palmOrbitIndex * 0.3;
      const angle = elapsed * speed + (d.palmOrbitIndex / total) * Math.PI * 2;
      const tiltAngle = d.palmOrbitIndex * 0.6;

      const tx = leftPalmCenter.x + Math.cos(angle) * orbitR;
      const ty = leftPalmCenter.y + Math.sin(angle) * Math.sin(tiltAngle) * orbitR * 0.5;
      const tz = leftPalmCenter.z + Math.sin(angle) * Math.cos(tiltAngle) * orbitR;

      group.position.lerp(new THREE.Vector3(tx, ty, tz), 0.15);

    } else if (d.destroying) {
      // Shrink to nothing then remove from scene
      const s = group.scale.x;
      if (s < 0.02) {
        group.visible = false;
        d.inPalm = false;
        d.destroying = false;
        // Respawn at original position after a delay
        setTimeout(() => {
          group.visible = true;
          group.position.copy(d.basePos);
          d.restPos.copy(d.basePos);
          d.scaleTarget = 1;
          d.glowTarget = 0.25;
        }, 2000);
      }

    } else if (!d.grabbed && !d.inPalm) {
      // Free floating
      const rp = d.restPos;
      group.position.x = rp.x + Math.sin(elapsed * 0.2 + d.index * 2) * 0.015;
      group.position.y = rp.y + Math.sin(elapsed * d.bobSpeed + d.index) * d.bobAmp;
      group.position.z = rp.z + Math.cos(elapsed * 0.25 + d.index * 1.5) * 0.015;
    }

    // Smooth scale
    const currentScale = group.scale.x;
    const scaleDiff = d.scaleTarget - currentScale;
    group.scale.setScalar(currentScale + scaleDiff * 0.12);

    // Glow
    const mat = d.sphereMat;
    if (mat) {
      const targetGlow = d.inPalm ? 0.6 : (d.grabbed ? 0.8 : 0.3);
      mat.emissiveIntensity += (targetGlow - mat.emissiveIntensity) * 0.1;
    }
  });

  renderer.render(scene, camera);
});

// ── Resize handling ──────────────────────────
window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
