// ── Hand Tracking ─────────────────────────────────────────────────────────────
const HAND_JOINTS = [
  'wrist',
  'thumb-metacarpal','thumb-phalanx-proximal','thumb-phalanx-distal','thumb-tip',
  'index-finger-metacarpal','index-finger-phalanx-proximal','index-finger-phalanx-intermediate','index-finger-phalanx-distal','index-finger-tip',
  'middle-finger-metacarpal','middle-finger-phalanx-proximal','middle-finger-phalanx-intermediate','middle-finger-phalanx-distal','middle-finger-tip',
  'ring-finger-metacarpal','ring-finger-phalanx-proximal','ring-finger-phalanx-intermediate','ring-finger-phalanx-distal','ring-finger-tip',
  'pinky-finger-metacarpal','pinky-finger-phalanx-proximal','pinky-finger-phalanx-intermediate','pinky-finger-phalanx-distal','pinky-finger-tip',
];

const handStates = [
  { jointMeshes: [], bubble: null, palmOpenSmooth: 0, palmOpen: false, pinching: false, dragging: false, dragOffset: new THREE.Vector3(), handedness: 'left' },
  { jointMeshes: [], bubble: null, palmOpenSmooth: 0, palmOpen: false, pinching: false, dragging: false, dragOffset: new THREE.Vector3(), handedness: 'right' },
];

const palmBubbles  = [];
let   leftPalmCenter = null;

// Reusable vectors (avoid allocations in the loop)
const _v3A = new THREE.Vector3();
const _v3B = new THREE.Vector3();
const _v3C = new THREE.Vector3();

// Debug sphere (red → green when hands detected)
const debugMat    = new THREE.MeshBasicMaterial({ color: 0xff0000 });
const debugSphere = new THREE.Mesh(new THREE.SphereGeometry(0.015, 16, 16), debugMat);
debugSphere.position.set(0.25, 1.5, -0.8);
scene.add(debugSphere);

// ── Palm-bubble visual (orb that appears above open palm) ─────────────────────
function createPalmOrb() {
  const group = new THREE.Group();
  group.add(new THREE.Mesh(
    new THREE.SphereGeometry(0.04, 24, 24),
    new THREE.MeshStandardMaterial({ color: 0x88ccff, transparent: true, opacity: 0.5, roughness: 0.1, metalness: 0.3, emissive: 0x4466ff, emissiveIntensity: 0.4, side: THREE.DoubleSide })
  ));
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.018, 12, 12), new THREE.MeshBasicMaterial({ color: 0xaaddff, transparent: true, opacity: 0.7 }));
  const halo = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 12), new THREE.MeshBasicMaterial({ color: 0x6699ff, transparent: true, opacity: 0.15, side: THREE.BackSide }));
  group.add(core, halo);

  const sparkGeo = new THREE.SphereGeometry(0.004, 6, 6);
  const sparkles = Array.from({ length: 5 }, (_, i) => {
    const s = new THREE.Mesh(sparkGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color().setHSL(0.55 + i * 0.06, 0.8, 0.7), transparent: true, opacity: 0.8 }));
    group.add(s); return s;
  });
  group.userData = { sparkles, coreMesh: core, haloMesh: halo };
  group.visible = false;
  group.scale.set(0, 0, 0);
  scene.add(group);
  return group;
}

// Joint spheres shared material
const jointMat = new THREE.MeshStandardMaterial({ color: 0x8888ff, roughness: 0.3, metalness: 0.2, transparent: true, opacity: 0.6 });
const jointGeo = new THREE.SphereGeometry(0.005, 8, 8);

let hand0, hand1;
if (renderer.xr.getHand) {
  hand0 = renderer.xr.getHand(0);
  hand1 = renderer.xr.getHand(1);
  scene.add(hand0, hand1);
  [hand0, hand1].forEach((_, idx) => {
    const state = handStates[idx];
    for (let j = 0; j < HAND_JOINTS.length; j++) {
      const m = new THREE.Mesh(jointGeo, jointMat.clone());
      m.visible = false;
      scene.add(m);
      state.jointMeshes.push(m);
    }
    state.bubble = createPalmOrb();
  });
}

// ── Gesture detection ─────────────────────────────────────────────────────────
function getJointPos(inputSource, jointName, frame, refSpace) {
  if (!inputSource?.hand) return null;
  const jointSpace = inputSource.hand.get(jointName);
  if (!jointSpace) return null;
  try {
    const pose = frame.getJointPose(jointSpace, refSpace);
    if (!pose) return null;
    const p = pose.transform.position;
    return new THREE.Vector3(p.x, p.y, p.z);
  } catch { return null; }
}

function detectPalmOpen(inputSource, frame, refSpace, handedness) {
  const wrist      = getJointPos(inputSource, 'wrist', frame, refSpace);
  const indexTip   = getJointPos(inputSource, 'index-finger-tip', frame, refSpace);
  const middleTip  = getJointPos(inputSource, 'middle-finger-tip', frame, refSpace);
  const ringTip    = getJointPos(inputSource, 'ring-finger-tip', frame, refSpace);
  const pinkyTip   = getJointPos(inputSource, 'pinky-finger-tip', frame, refSpace);
  const indexProx  = getJointPos(inputSource, 'index-finger-phalanx-proximal', frame, refSpace);
  const middleProx = getJointPos(inputSource, 'middle-finger-phalanx-proximal', frame, refSpace);
  const ringProx   = getJointPos(inputSource, 'ring-finger-phalanx-proximal', frame, refSpace);
  const pinkyProx  = getJointPos(inputSource, 'pinky-finger-phalanx-proximal', frame, refSpace);
  if (!wrist || !indexTip || !middleTip || !ringTip || !pinkyTip || !indexProx || !middleProx || !ringProx || !pinkyProx)
    return { open: false, palmCenter: null };

  const extCount = [
    indexTip.distanceTo(wrist)  > indexProx.distanceTo(wrist)  * 1.05,
    middleTip.distanceTo(wrist) > middleProx.distanceTo(wrist) * 1.05,
    ringTip.distanceTo(wrist)   > ringProx.distanceTo(wrist)   * 1.05,
    pinkyTip.distanceTo(wrist)  > pinkyProx.distanceTo(wrist)  * 1.05,
  ].filter(Boolean).length;

  const spread = indexTip.distanceTo(middleTip) > 0.012 && middleTip.distanceTo(ringTip) > 0.010 && ringTip.distanceTo(pinkyTip) > 0.008;
  const palmCenter = wrist.clone().lerp(middleTip, 0.4);
  _v3A.copy(pinkyProx).sub(indexProx);
  _v3B.copy(middleTip).sub(wrist);
  const palmNormal = handedness === 'right'
    ? _v3C.crossVectors(_v3B, _v3A).normalize()
    : _v3C.crossVectors(_v3A, _v3B).normalize();

  const xrCam = renderer.xr.getCamera();
  const camPos = new THREE.Vector3(); xrCam.getWorldPosition(camPos);
  const facingCam = palmNormal.dot(camPos.clone().sub(palmCenter).normalize()) > 0.1;
  const isOpen = extCount >= 3 && spread && (palmNormal.y > 0.25 || facingCam);
  return { open: isOpen, palmCenter };
}

function detectPinch(inputSource, frame, refSpace) {
  const thumbTip = getJointPos(inputSource, 'thumb-tip', frame, refSpace);
  const indexTip = getJointPos(inputSource, 'index-finger-tip', frame, refSpace);
  if (!thumbTip || !indexTip) return { pinching: false, pinchPoint: null };
  return { pinching: thumbTip.distanceTo(indexTip) < 0.025, pinchPoint: thumbTip.clone().lerp(indexTip, 0.5) };
}

function detectFist(inputSource, frame, refSpace) {
  const wrist      = getJointPos(inputSource, 'wrist', frame, refSpace);
  const indexTip   = getJointPos(inputSource, 'index-finger-tip', frame, refSpace);
  const middleTip  = getJointPos(inputSource, 'middle-finger-tip', frame, refSpace);
  const ringTip    = getJointPos(inputSource, 'ring-finger-tip', frame, refSpace);
  const pinkyTip   = getJointPos(inputSource, 'pinky-finger-tip', frame, refSpace);
  const indexProx  = getJointPos(inputSource, 'index-finger-phalanx-proximal', frame, refSpace);
  const middleProx = getJointPos(inputSource, 'middle-finger-phalanx-proximal', frame, refSpace);
  const ringProx   = getJointPos(inputSource, 'ring-finger-phalanx-proximal', frame, refSpace);
  const pinkyProx  = getJointPos(inputSource, 'pinky-finger-phalanx-proximal', frame, refSpace);
  if (!wrist || !indexTip || !middleTip || !ringTip || !pinkyTip) return { fisting: false, wristPos: null };
  const curled = [
    indexTip.distanceTo(wrist)  < (indexProx  ? indexProx.distanceTo(wrist)  * 1.05 : 0.055),
    middleTip.distanceTo(wrist) < (middleProx ? middleProx.distanceTo(wrist) * 1.05 : 0.055),
    ringTip.distanceTo(wrist)   < (ringProx   ? ringProx.distanceTo(wrist)   * 1.05 : 0.055),
    pinkyTip.distanceTo(wrist)  < (pinkyProx  ? pinkyProx.distanceTo(wrist)  * 1.05 : 0.055),
  ].filter(Boolean).length;
  return { fisting: curled >= 3, wristPos: wrist };
}

// ── Fist rotation + back-swipe state ─────────────────────────────────────────
let _fistRotating   = false;
let _fistLastX      = 0;
let _backSwipeActive = false;
const _backSwipeStart = new THREE.Vector3();
