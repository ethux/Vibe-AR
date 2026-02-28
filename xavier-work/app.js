// ─────────────────────────────────────────────
//  WebXR AR – Pixel-Art Window System (Meta Quest)
//  Uses WindowManager.js for window creation & management
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

// ── Shadow-receiving floor ───────────────────
const shadowFloorGeo = new THREE.PlaneGeometry(20, 20);
const shadowFloorMat = new THREE.ShadowMaterial({ opacity: 0.3 });
const shadowFloor = new THREE.Mesh(shadowFloorGeo, shadowFloorMat);
shadowFloor.rotation.x = -Math.PI / 2;
shadowFloor.position.y = 0;
shadowFloor.receiveShadow = true;
scene.add(shadowFloor);
renderer.shadowMap.enabled = true;

// ══════════════════════════════════════════════
//  WINDOW MANAGER — create pixel-art windows
// ══════════════════════════════════════════════
const wm = new WindowManager(scene, renderer, camera);

// ══════════════════════════════════════════════
//  ANIMATION MANAGER — canvas-driven animations
// ══════════════════════════════════════════════
const animMgr = new AnimationManager(scene);

// ══════════════════════════════════════════════
//  CODE CITY — 3D code visualization
// ══════════════════════════════════════════════
const codeCity = new CodeCityRenderer(scene, camera, wm);

// Demo: analyze sample code on startup
const DEMO_CODE = `class Calculator:
    """A simple calculator class."""

    def __init__(self):
        self.history = []

    def add(self, a, b):
        result = a + b
        self.history.append(('add', a, b, result))
        return result

    def subtract(self, a, b):
        result = a - b
        self.history.append(('sub', a, b, result))
        return result

    def multiply(self, a, b):
        result = a * b
        self.history.append(('mul', a, b, result))
        return result

    def get_history(self):
        return self.history

def main():
    calc = Calculator()
    print(calc.add(2, 3))
    print(calc.subtract(10, 4))
    print(calc.multiply(5, 6))
    print(calc.get_history())

if __name__ == "__main__":
    main()`;

codeCity.analyzeCode(DEMO_CODE, 'python', 'calculator.py')
  .then(layout => { if (layout) console.log('Code City loaded:', layout.cityName); })
  .catch(err => console.warn('Code City demo skipped:', err.message));

// Track per-hand animation state
const handAnimState = [
  { active: null, wasOpen: false },  // left
  { active: null, wasOpen: false },  // right
];

// Create the demo window with pixel-art Mistral-orange borders
const mainWindow = wm.createWindow({
  title:    'VIBE AR',
  width:    0.6,
  height:   0.45,
  position: [0, 1.5, -0.8],
  content:  (ctx, w, h) => {
    // Black background is already drawn by the manager
    ctx.fillStyle = '#F97316';
    ctx.font = 'bold 28px monospace';
    ctx.fillText('HELLO FROM WEBXR AR!', 30, 50);

    ctx.fillStyle = '#FFB347';
    ctx.font = '22px monospace';
    const lines = [
      '',
      '  OPEN YOUR PALM TO',
      '  SUMMON A MAGIC BUBBLE',
      '',
      '  PINCH THE TITLE BAR',
      '  TO DRAG THIS WINDOW',
      '',
      '  CONTROLLERS WORK TOO',
    ];
    lines.forEach((l, i) => ctx.fillText(l, 20, 90 + i * 32));
  }
});

// ── Example: teammates can easily create more windows ──
// const secondWindow = wm.createWindow({
//   title:    'TERMINAL',
//   width:    0.5,
//   height:   0.35,
//   position: [0.4, 1.5, -0.9],
//   content:  (ctx, w, h) => {
//     ctx.fillStyle = '#00ff00';
//     ctx.font = '20px monospace';
//     ctx.fillText('$ whoami', 20, 30);
//     ctx.fillText('mistral-hacker', 20, 55);
//   }
// });

// ── Controller setup ─────────────────────────
const controllerGrip0 = renderer.xr.getControllerGrip(0);
const controllerGrip1 = renderer.xr.getControllerGrip(1);
scene.add(controllerGrip0);
scene.add(controllerGrip1);

const controller0 = renderer.xr.getController(0);
const controller1 = renderer.xr.getController(1);
scene.add(controller0);
scene.add(controller1);

// Visible ray lines (orange to match theme)
function addRayVisual(ctrl) {
  const geo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, -3)
  ]);
  const mat = new THREE.LineBasicMaterial({ color: 0xF97316, linewidth: 2 });
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

// ── Controller select → route to WindowManager ──
controller0.addEventListener('selectstart', (e) => wm.onSelectStart(e.target));
controller0.addEventListener('selectend',   (e) => wm.onSelectEnd(e.target));
controller1.addEventListener('selectstart', (e) => wm.onSelectStart(e.target));
controller1.addEventListener('selectend',   (e) => wm.onSelectEnd(e.target));

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
  { jointMeshes: [], bubble: null, bubbleScale: 0, palmOpen: false, palmOpenSmooth: 0, pinching: false, grabbing: false, handedness: 'left' },
  { jointMeshes: [], bubble: null, bubbleScale: 0, palmOpen: false, palmOpenSmooth: 0, pinching: false, grabbing: false, handedness: 'right' }
];

// Joint visual material (hidden — dots disabled)
const jointMat = new THREE.MeshStandardMaterial({
  color: 0x8888ff, roughness: 0.3, metalness: 0.2,
  transparent: true, opacity: 0.0,
  visible: false
});
const jointGeo = new THREE.SphereGeometry(0.005, 8, 8);

// Debug indicator — a small sphere that turns green when hands are detected
// Debug sphere (hidden)
const debugGeo = new THREE.SphereGeometry(0.015, 16, 16);
const debugMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
const debugSphere = new THREE.Mesh(debugGeo, debugMat);
debugSphere.position.set(0.25, 1.5, -0.8);
debugSphere.visible = false;
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

function detectGrab(inputSource, frame, refSpace) {
  const wrist     = getJointPos(inputSource, 'wrist', frame, refSpace);
  const thumbTip  = getJointPos(inputSource, 'thumb-tip', frame, refSpace);
  const indexTip  = getJointPos(inputSource, 'index-finger-tip', frame, refSpace);
  const middleTip = getJointPos(inputSource, 'middle-finger-tip', frame, refSpace);
  const ringTip   = getJointPos(inputSource, 'ring-finger-tip', frame, refSpace);
  const pinkyTip  = getJointPos(inputSource, 'pinky-finger-tip', frame, refSpace);

  const thumbProx  = getJointPos(inputSource, 'thumb-phalanx-proximal', frame, refSpace);
  const indexProx  = getJointPos(inputSource, 'index-finger-phalanx-proximal', frame, refSpace);
  const middleProx = getJointPos(inputSource, 'middle-finger-phalanx-proximal', frame, refSpace);
  const ringProx   = getJointPos(inputSource, 'ring-finger-phalanx-proximal', frame, refSpace);
  const pinkyProx  = getJointPos(inputSource, 'pinky-finger-phalanx-proximal', frame, refSpace);

  if (!wrist || !thumbTip || !indexTip || !middleTip || !ringTip || !pinkyTip
      || !thumbProx || !indexProx || !middleProx || !ringProx || !pinkyProx) {
    return { grabbing: false, grabCenter: null };
  }

  // Full fist: ALL 4 fingers curled (tip closer to wrist than proximal)
  // plus thumb curled in. Strict threshold (0.95) to avoid false positives.
  const allFingersCurled =
    indexTip.distanceTo(wrist) < indexProx.distanceTo(wrist) * 0.95 &&
    middleTip.distanceTo(wrist) < middleProx.distanceTo(wrist) * 0.95 &&
    ringTip.distanceTo(wrist) < ringProx.distanceTo(wrist) * 0.95 &&
    pinkyTip.distanceTo(wrist) < pinkyProx.distanceTo(wrist) * 0.95;

  // Thumb must also be tucked (tip close to index proximal, not extended)
  const thumbTucked = thumbTip.distanceTo(indexProx) < 0.06;

  const isGrabbing = allFingersCurled && thumbTucked;
  const grabCenter = wrist.clone().lerp(middleTip, 0.4);

  return { grabbing: isGrabbing, grabCenter };
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

  // ── Update WindowManager (handles controller drag, hover, resize) ──
  wm.update(frame, dt, elapsed, [controller0, controller1]);

  // ── Update Code City hover detection ──
  codeCity.updateHover([controller0, controller1]);

  // ── Update tooltip position to follow right hand ──
  if (codeCity._tooltipWindow && codeCity._rightHandPos) {
    const tp = codeCity._rightHandPos;
    codeCity._tooltipWindow.root.position.set(tp.x, tp.y + 0.15, tp.z);
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

        // Update joint positions (dots hidden)
        HAND_JOINTS.forEach((jointName, j) => {
          const pos = getJointPos(inputSource, jointName, frame, refSpace);
          const mesh = state.jointMeshes[j];
          if (pos) {
            mesh.position.copy(pos);
            // Dots hidden — only track positions for gesture detection
            mesh.visible = false;
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

        // Bubble hidden — mascot character replaces it on right hand
        const bubble = state.bubble;
        bubble.visible = false;
        bubble.scale.set(0, 0, 0);

        // ── Right hand palm open → mascot animation ──
        if (state.handedness === 'right') {
          const anim = handAnimState[1];

          if (state.palmOpen && !anim.wasOpen) {
            // Palm just opened — spawn mascot (SVG anim plays once, then holds)
            if (anim.active) { anim.active.kill(); anim.active = null; }
            const spawnPos = palmResult.palmCenter
              ? palmResult.palmCenter.clone()
              : bubble.position.clone();
            spawnPos.y += 0.08;
            anim.active = animMgr.play('mascot-bounce', spawnPos);
          }

          // While palm open, keep following hand
          if (state.palmOpen && anim.active && palmResult.palmCenter) {
            const followPos = palmResult.palmCenter.clone();
            followPos.y += 0.08;
            anim.active.moveTo(followPos);
          }

          // Palm closed → fast hide
          if (!state.palmOpen && anim.wasOpen && anim.active) {
            anim.active.fastHide(0.08);
            anim.active = null;
          }

          anim.wasOpen = state.palmOpen;
        }

        // Left hand — placeholder for future animations
        if (state.handedness === 'left') {
          const anim = handAnimState[0];
          anim.wasOpen = state.palmOpen;
        }

        // ── Hand pinch → route to WindowManager ──
        const pinchResult = detectPinch(inputSource, frame, refSpace);
        if (pinchResult.pinching && !state.pinching) {
          state.pinching = true;
          if (pinchResult.pinchPoint) {
            wm.onPinchStart(idx, pinchResult.pinchPoint);
          }
        } else if (!pinchResult.pinching && state.pinching) {
          state.pinching = false;
          wm.onPinchEnd(idx);
        }

        if (state.pinching && pinchResult.pinchPoint) {
          wm.onPinchMove(idx, pinchResult.pinchPoint);
        }

        // ── Hand grab → move/rotate/scale Code City ──
        const grabResult = detectGrab(inputSource, frame, refSpace);
        if (grabResult.grabbing && !state.grabbing) {
          state.grabbing = true;
          if (grabResult.grabCenter) {
            codeCity.onGrabStart(idx, grabResult.grabCenter);
          }
        } else if (!grabResult.grabbing && state.grabbing) {
          state.grabbing = false;
          codeCity.onGrabEnd(idx);
        }

        if (state.grabbing && grabResult.grabCenter) {
          codeCity.onGrabMove(idx, grabResult.grabCenter);
        }

        // ── Hand hover detection (index finger tip) ──
        const indexTipPos = getJointPos(inputSource, 'index-finger-tip', frame, refSpace);
        if (indexTipPos) {
          wm.updateHandHover(idx, indexTipPos);
        }

        // ── Track right hand position for tooltip following ──
        if (state.handedness === 'right') {
          const wristPos = getJointPos(inputSource, 'wrist', frame, refSpace);
          if (wristPos) codeCity._rightHandPos = wristPos;
        }
      });
    }
  }

  // ── Update animations ──
  const xrCamera = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  animMgr.update(dt, elapsed, xrCamera);

  renderer.render(scene, camera);
});

// ── Resize handling ──────────────────────────
window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
