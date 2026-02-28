// ═══════════════════════════════════════════════════════════════════
//  hand-tracking.js — Hand gesture detection for WebXR AR
//  Adapted from sacha-work as ES module
// ═══════════════════════════════════════════════════════════════════

const HAND_JOINTS = [
  'wrist',
  'thumb-metacarpal','thumb-phalanx-proximal','thumb-phalanx-distal','thumb-tip',
  'index-finger-metacarpal','index-finger-phalanx-proximal','index-finger-phalanx-intermediate','index-finger-phalanx-distal','index-finger-tip',
  'middle-finger-metacarpal','middle-finger-phalanx-proximal','middle-finger-phalanx-intermediate','middle-finger-phalanx-distal','middle-finger-tip',
  'ring-finger-metacarpal','ring-finger-phalanx-proximal','ring-finger-phalanx-intermediate','ring-finger-phalanx-distal','ring-finger-tip',
  'pinky-finger-metacarpal','pinky-finger-phalanx-proximal','pinky-finger-phalanx-intermediate','pinky-finger-phalanx-distal','pinky-finger-tip',
];

// Reusable vectors
const _v3A = new THREE.Vector3();
const _v3B = new THREE.Vector3();
const _v3C = new THREE.Vector3();

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

function detectPalmOpen(inputSource, frame, refSpace, handedness, renderer) {
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

function detectPointing(inputSource, frame, refSpace) {
  const wrist      = getJointPos(inputSource, 'wrist', frame, refSpace);
  const indexTip   = getJointPos(inputSource, 'index-finger-tip', frame, refSpace);
  const indexProx  = getJointPos(inputSource, 'index-finger-phalanx-proximal', frame, refSpace);
  const middleTip  = getJointPos(inputSource, 'middle-finger-tip', frame, refSpace);
  const middleProx = getJointPos(inputSource, 'middle-finger-phalanx-proximal', frame, refSpace);
  const ringTip    = getJointPos(inputSource, 'ring-finger-tip', frame, refSpace);
  const ringProx   = getJointPos(inputSource, 'ring-finger-phalanx-proximal', frame, refSpace);
  const pinkyTip   = getJointPos(inputSource, 'pinky-finger-tip', frame, refSpace);
  const pinkyProx  = getJointPos(inputSource, 'pinky-finger-phalanx-proximal', frame, refSpace);
  const thumbTip   = getJointPos(inputSource, 'thumb-tip', frame, refSpace);
  if (!wrist || !indexTip || !indexProx || !middleTip || !ringTip || !pinkyTip)
    return false;
  const indexExtended = indexTip.distanceTo(wrist) > indexProx.distanceTo(wrist) * 1.1;
  const middleCurled  = middleProx ? middleTip.distanceTo(wrist) < middleProx.distanceTo(wrist) * 1.05 : true;
  const ringCurled    = ringProx   ? ringTip.distanceTo(wrist)   < ringProx.distanceTo(wrist)   * 1.05 : true;
  const pinkyCurled   = pinkyProx  ? pinkyTip.distanceTo(wrist)  < pinkyProx.distanceTo(wrist)  * 1.05 : true;
  const notPinching   = thumbTip   ? thumbTip.distanceTo(indexTip) > 0.03 : true;
  return indexExtended && middleCurled && ringCurled && pinkyCurled && notPinching;
}

export { HAND_JOINTS, getJointPos, detectPalmOpen, detectPinch, detectFist, detectPointing };
